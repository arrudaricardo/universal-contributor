import { Writable, Readable } from "stream";
import { pack } from "tar-stream";
import { createConnection, Socket } from "net";
import { homedir } from "os";
import { readFile } from "fs/promises";
import { join } from "path";

// Default Docker socket paths
const DOCKER_SOCKET_PATHS = [
  process.env.DOCKER_HOST?.replace(/^unix:\/\//, ""),
  join(homedir(), ".docker/run/docker.sock"),
  "/var/run/docker.sock",
].filter(Boolean) as string[];

let dockerSocketPath: string | null = null;

/**
 * Find the Docker socket path
 */
async function getDockerSocketPath(): Promise<string> {
  if (dockerSocketPath) return dockerSocketPath;

  // Try to read from Docker config first
  try {
    const configPath = join(homedir(), ".docker", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    if (config.currentContext && config.currentContext !== "default") {
      // Try to find the context's socket path
      const contextsDir = join(homedir(), ".docker", "contexts", "meta");
      const { readdir } = await import("fs/promises");
      const entries = await readdir(contextsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const metaPath = join(contextsDir, entry.name, "meta.json");
            const meta = JSON.parse(await readFile(metaPath, "utf8"));
            if (meta.Name === config.currentContext && meta.Endpoints?.docker?.Host) {
              const host = meta.Endpoints.docker.Host;
              // Handle unix:///path or unix:/path formats
              const socketPath = host.replace(/^unix:\/\//, "").replace(/^unix:/, "");
              if (socketPath) {
                dockerSocketPath = socketPath;
                return socketPath;
              }
            }
          } catch {
            // Continue to next context
          }
        }
      }
    }
  } catch {
    // Fall back to default paths
  }

  // Try default socket paths
  for (const path of DOCKER_SOCKET_PATHS) {
    try {
      const { access } = await import("fs/promises");
      await access(path);
      dockerSocketPath = path;
      return dockerSocketPath;
    } catch {
      // Try next path
    }
  }

  throw new Error("Docker socket not found. Is Docker running?");
}

/**
 * Make an HTTP request to the Docker API over Unix socket
 */
async function dockerRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  options: { stream?: boolean; headers?: Record<string, string> } = {}
): Promise<T> {
  const socketPath = await getDockerSocketPath();

  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let responseData = "";
    let headersParsed = false;
    let statusCode = 0;
    let contentLength = -1;
    let isChunked = false;
    let bodyData = "";

    const bodyStr = body ? JSON.stringify(body) : "";
    const headers = [
      `${method} ${path} HTTP/1.1`,
      "Host: localhost",
      "Accept: application/json",
      "Connection: close",
      ...(body ? ["Content-Type: application/json", `Content-Length: ${Buffer.byteLength(bodyStr)}`] : []),
      ...(options.headers ? Object.entries(options.headers).map(([k, v]) => `${k}: ${v}`) : []),
      "",
      "",
    ].join("\r\n");

    socket.on("connect", () => {
      socket.write(headers);
      if (body) {
        socket.write(bodyStr);
      }
    });

    socket.on("data", (chunk) => {
      responseData += chunk.toString();

      if (!headersParsed) {
        const headerEnd = responseData.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
          const headerSection = responseData.substring(0, headerEnd);
          const statusLine = headerSection.split("\r\n")[0] ?? "";
          statusCode = parseInt(statusLine.split(" ")[1] ?? "0", 10);

          const clMatch = headerSection.match(/Content-Length:\s*(\d+)/i);
          if (clMatch) {
            contentLength = parseInt(clMatch[1] ?? "0", 10);
          }
          isChunked = /Transfer-Encoding:\s*chunked/i.test(headerSection);

          headersParsed = true;
          bodyData = responseData.substring(headerEnd + 4);

          // Check if we have all the data
          if (contentLength >= 0 && Buffer.byteLength(bodyData) >= contentLength) {
            socket.end();
          }
        }
      } else {
        bodyData = responseData.substring(responseData.indexOf("\r\n\r\n") + 4);
        if (contentLength >= 0 && Buffer.byteLength(bodyData) >= contentLength) {
          socket.end();
        }
      }
    });

    socket.on("end", () => {
      if (isChunked) {
        // Parse chunked encoding
        bodyData = parseChunkedBody(bodyData);
      }

      if (statusCode >= 200 && statusCode < 300) {
        try {
          resolve(bodyData ? JSON.parse(bodyData) : ({} as T));
        } catch {
          resolve(bodyData as unknown as T);
        }
      } else {
        let errorMessage = `Docker API error: ${statusCode}`;
        try {
          const errorBody = JSON.parse(bodyData);
          errorMessage = errorBody.message || errorMessage;
        } catch {
          // Use default error message
        }
        reject(new Error(errorMessage));
      }
    });

    socket.on("error", (err) => {
      reject(new Error(`Docker socket error: ${err.message}`));
    });

    // Timeout after 30 seconds
    socket.setTimeout(30000, () => {
      socket.destroy();
      reject(new Error("Docker request timeout"));
    });
  });
}

/**
 * Parse chunked transfer encoding body
 */
function parseChunkedBody(data: string): string {
  let result = "";
  let remaining = data;

  while (remaining.length > 0) {
    const sizeEnd = remaining.indexOf("\r\n");
    if (sizeEnd === -1) break;

    const sizeHex = remaining.substring(0, sizeEnd);
    const chunkSize = parseInt(sizeHex, 16);

    if (chunkSize === 0) break;

    const chunkStart = sizeEnd + 2;
    const chunkEnd = chunkStart + chunkSize;
    result += remaining.substring(chunkStart, chunkEnd);
    remaining = remaining.substring(chunkEnd + 2); // Skip trailing \r\n
  }

  return result;
}

/**
 * Make a streaming request to Docker API
 */
async function dockerStreamRequest(
  method: string,
  path: string,
  inputStream?: Readable,
  options: { headers?: Record<string, string>; onData?: (data: Buffer) => void } = {}
): Promise<{ statusCode: number; body: string }> {
  const socketPath = await getDockerSocketPath();

  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let responseData = Buffer.alloc(0);
    let headersParsed = false;
    let statusCode = 0;
    let headerEndIndex = 0;

    const headerLines = [
      `${method} ${path} HTTP/1.1`,
      "Host: localhost",
      "Accept: application/json",
      "Connection: close",
      ...(inputStream ? ["Content-Type: application/x-tar", "Transfer-Encoding: chunked"] : []),
      ...(options.headers ? Object.entries(options.headers).map(([k, v]) => `${k}: ${v}`) : []),
      "",
      "",
    ].join("\r\n");

    socket.on("connect", () => {
      socket.write(headerLines);

      if (inputStream) {
        inputStream.on("data", (chunk) => {
          const size = chunk.length.toString(16);
          socket.write(`${size}\r\n`);
          socket.write(chunk);
          socket.write("\r\n");
        });

        inputStream.on("end", () => {
          socket.write("0\r\n\r\n");
        });

        inputStream.on("error", (err) => {
          reject(err);
          socket.destroy();
        });
      }
    });

    socket.on("data", (chunk) => {
      responseData = Buffer.concat([responseData, chunk]);

      if (!headersParsed) {
        const headerEnd = responseData.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
          const headerSection = responseData.subarray(0, headerEnd).toString();
          const statusLine = headerSection.split("\r\n")[0] ?? "";
          statusCode = parseInt(statusLine.split(" ")[1] ?? "0", 10);
          headersParsed = true;
          headerEndIndex = headerEnd + 4;

          if (options.onData) {
            const bodyPart = responseData.subarray(headerEndIndex);
            if (bodyPart.length > 0) {
              options.onData(bodyPart);
            }
          }
        }
      } else if (options.onData) {
        options.onData(chunk);
      }
    });

    socket.on("end", () => {
      const body = responseData.subarray(headerEndIndex).toString();
      resolve({ statusCode, body });
    });

    socket.on("error", (err) => {
      reject(new Error(`Docker socket error: ${err.message}`));
    });

    socket.setTimeout(300000, () => {
      socket.destroy();
      reject(new Error("Docker request timeout"));
    });
  });
}

/**
 * Close the Docker client connection (no-op for socket-based implementation)
 */
export async function closeDockerClient(): Promise<void> {
  // No persistent connection to close
  dockerSocketPath = null;
}

/**
 * Check if Docker is available and responsive
 */
export async function checkDockerAvailable(): Promise<boolean> {
  try {
    await dockerRequest("GET", "/_ping");
    return true;
  } catch (error) {
    console.error("Error pinging Docker.", { error });
    return false;
  }
}

/**
 * Build a Docker image from a Dockerfile string
 * @param dockerfile - The Dockerfile content as a string
 * @param imageName - The tag to apply to the built image (e.g., "myapp:latest")
 * @param onProgress - Optional callback for build progress messages
 * @returns The built image ID
 */
export async function buildImageFromDockerfile(
  dockerfile: string,
  imageName: string,
  onProgress?: (message: string) => void
): Promise<string> {
  // Create tar archive with Dockerfile in memory
  const tarStream = pack();
  tarStream.entry({ name: "Dockerfile" }, dockerfile);
  tarStream.finalize();

  const encodedTag = encodeURIComponent(imageName);
  let imageId = "";
  let lastError = "";

  const { body } = await dockerStreamRequest(
    "POST",
    `/build?t=${encodedTag}&dockerfile=Dockerfile`,
    tarStream,
    {
      onData: (data) => {
        // Parse NDJSON stream
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.stream) {
              const trimmed = msg.stream.trim();
              if (trimmed) {
                onProgress?.(trimmed);
                // Try to extract image ID from build output
                const idMatch = trimmed.match(/Successfully built ([a-f0-9]+)/);
                if (idMatch) {
                  imageId = idMatch[1];
                }
              }
            } else if (msg.status) {
              onProgress?.(msg.status);
            } else if (msg.errorDetail) {
              lastError = msg.errorDetail.message || "Build error";
            } else if (msg.aux?.ID) {
              imageId = msg.aux.ID;
            }
          } catch {
            // Not JSON, skip
          }
        }
      },
    }
  );

  if (lastError) {
    throw new Error(lastError);
  }

  // Try to extract image ID from final response if not found in stream
  if (!imageId) {
    const lines = body.split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.aux?.ID) {
          imageId = msg.aux.ID;
        }
      } catch {
        // Skip
      }
    }
  }

  return imageId || imageName;
}

/**
 * Options for creating a container
 */
export interface CreateContainerOptions {
  image: string;
  name?: string;
  cmd?: string[];
  env?: Record<string, string>;
  workingDir?: string;
  user?: string;
  tty?: boolean;
  binds?: string[];
  networkMode?: string;
  labels?: Record<string, string>;
}

/**
 * Create and start a Docker container
 * @param options - Container creation options
 * @returns The container ID
 */
export async function createAndStartContainer(
  options: CreateContainerOptions
): Promise<string> {
  // Convert env object to array format
  const envArray = options.env
    ? Object.entries(options.env).map(([key, value]) => `${key}=${value}`)
    : undefined;

  const queryParams = options.name ? `?name=${encodeURIComponent(options.name)}` : "";

  // Create container
  const createResponse = await dockerRequest<{ Id: string }>(
    "POST",
    `/containers/create${queryParams}`,
    {
      Image: options.image,
      Cmd: options.cmd,
      Env: envArray,
      WorkingDir: options.workingDir,
      User: options.user,
      Tty: options.tty ?? false,
      Labels: options.labels,
      HostConfig: {
        Binds: options.binds,
        NetworkMode: options.networkMode,
      },
    }
  );

  const containerId = createResponse.Id;

  // Start container
  await dockerRequest("POST", `/containers/${containerId}/start`);

  return containerId;
}

/**
 * Stop and remove a Docker container
 * @param containerId - The container ID to stop and remove
 * @param force - Force removal even if running (default: true)
 */
export async function stopAndRemoveContainer(
  containerId: string,
  force: boolean = true
): Promise<void> {
  try {
    await dockerRequest("POST", `/containers/${containerId}/stop?t=10`);
  } catch {
    // Container might already be stopped, continue to removal
  }

  await dockerRequest("DELETE", `/containers/${containerId}?force=${force}`);
}

/**
 * Result of executing a command in a container
 */
export interface ExecResult {
  exitCode: number;
}

/**
 * Options for executing a command in a container
 */
export interface ExecOptions {
  containerId: string;
  cmd: string[];
  stdout?: Writable;
  stderr?: Writable;
  tty?: boolean;
  user?: string;
  workingDir?: string;
  env?: string[];
}

/**
 * Execute a command inside a running container with streaming output
 * @param options - Exec options including container ID, command, and output streams
 * @returns Promise that resolves with the exit code when command completes
 */
export async function execInContainer(options: ExecOptions): Promise<ExecResult> {
  // Create exec instance
  const execResponse = await dockerRequest<{ Id: string }>(
    "POST",
    `/containers/${options.containerId}/exec`,
    {
      Cmd: options.cmd,
      AttachStdout: true,
      AttachStderr: true,
      Tty: options.tty ?? false,
      User: options.user,
      WorkingDir: options.workingDir,
      Env: options.env,
    }
  );

  const execId = execResponse.Id;

  // Start exec and capture output
  const socketPath = await getDockerSocketPath();

  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(socketPath);
    let headersParsed = false;

    const headers = [
      `POST /exec/${execId}/start HTTP/1.1`,
      "Host: localhost",
      "Content-Type: application/json",
      "Connection: Upgrade",
      "Upgrade: tcp",
      "",
      "",
    ].join("\r\n");

    socket.on("connect", () => {
      socket.write(headers);
      socket.write(JSON.stringify({ Detach: false, Tty: options.tty ?? false }));
    });

    socket.on("data", (chunk) => {
      if (!headersParsed) {
        const str = chunk.toString();
        const headerEnd = str.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
          headersParsed = true;
          const bodyStart = headerEnd + 4;
          if (bodyStart < chunk.length) {
            const body = chunk.subarray(bodyStart);
            processExecOutput(body, options);
          }
        }
      } else {
        processExecOutput(chunk, options);
      }
    });

    socket.on("end", () => resolve());
    socket.on("error", reject);
    socket.setTimeout(300000, () => {
      socket.destroy();
      reject(new Error("Exec timeout"));
    });
  });

  // Get exit code
  const execInfo = await dockerRequest<{ ExitCode: number }>("GET", `/exec/${execId}/json`);

  return {
    exitCode: execInfo.ExitCode ?? 1,
  };
}

/**
 * Process Docker exec multiplexed output
 */
function processExecOutput(data: Buffer, options: ExecOptions): void {
  let offset = 0;

  while (offset < data.length) {
    if (offset + 8 > data.length) {
      // Not enough data for header, write raw
      options.stdout?.write(data.subarray(offset));
      break;
    }

    const streamType = data[offset]; // 1 = stdout, 2 = stderr
    const frameSize = data.readUInt32BE(offset + 4);
    offset += 8;

    if (offset + frameSize > data.length) {
      // Partial frame, write what we have
      const partial = data.subarray(offset);
      if (streamType === 2) {
        options.stderr?.write(partial);
      } else {
        options.stdout?.write(partial);
      }
      break;
    }

    const frame = data.subarray(offset, offset + frameSize);
    if (streamType === 2) {
      options.stderr?.write(frame);
    } else {
      options.stdout?.write(frame);
    }

    offset += frameSize;
  }
}

/**
 * Create a writable stream that buffers lines and calls a callback for each complete line
 * Useful for processing Docker exec output line by line
 */
export function createLineBufferedStream(
  onLine: (line: string) => void
): { stream: Writable; flush: () => void } {
  let buffer = "";

  const stream = new Writable({
    write(chunk, _encoding, callback) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          onLine(line);
        }
      }
      callback();
    },
  });

  // Flush any remaining buffered content
  const flush = () => {
    if (buffer.trim()) {
      onLine(buffer);
      buffer = "";
    }
  };

  return { stream, flush };
}
