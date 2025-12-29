import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-plugin";
import Firecrawl from "firecrawl";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

export interface Issue {
  id: number;
  repository_id: number;
  github_issue_number: number;
  title: string;
  url: string;
  body: string | null;
  labels: string | null;
  has_good_first_issue: number;
  has_help_wanted: number;
  has_bug_label: number;
  ai_complexity_score: number | null;
  ai_solvability_score: number | null;
  ai_analysis: string | null;
  ai_fix_prompt: string | null;
  status: string;
  claimed_by_agent_id: number | null;
  claimed_at: string | null;
  discovered_at: string;
}

export interface RepositoryEnvironment {
  id: number;
  repository_id: number;
  primary_language: string | null;
  runtime: string | null;
  runtime_version: string | null;
  package_manager: string | null;
  setup_commands: string | null;
  test_commands: string | null;
  memory_mb: number;
  cpu_cores: number;
  disk_mb: number;
  docker_image: string | null;
  discovered_at: string;
  last_updated_at: string | null;
}

export const issuesRoutes = new Elysia({ prefix: "/issues" })
  .use(dbPlugin)
  .get(
    "/",
    ({ db, query }) => {
      if (query.repository_id && query.github_issue_number) {
        const issue = db.get<Issue>(
          `SELECT * FROM issues WHERE repository_id = ? AND github_issue_number = ?`,
          parseInt(query.repository_id),
          parseInt(query.github_issue_number)
        );
        return issue ? [issue] : [];
      }
      if (query.repository_id) {
        return db.query<Issue>(
          `SELECT * FROM issues WHERE repository_id = ? ORDER BY discovered_at DESC`,
          parseInt(query.repository_id)
        );
      }
      if (query.status) {
        return db.query<Issue>(
          `SELECT * FROM issues WHERE status = ? ORDER BY discovered_at DESC`,
          query.status
        );
      }
      return db.query<Issue>(
        `SELECT * FROM issues ORDER BY discovered_at DESC`
      );
    },
    {
      query: t.Object({
        repository_id: t.Optional(t.String()),
        github_issue_number: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .get("/:id", ({ db, params }) => {
    const issue = db.get<Issue>(
      `SELECT * FROM issues WHERE id = ?`,
      parseInt(params.id)
    );
    if (!issue) {
      throw new Error("Issue not found");
    }
    return issue;
  })
  .post(
    "/",
    ({ db, body }) => {
      db.run(
        `INSERT INTO issues (repository_id, github_issue_number, title, url, body, labels, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        body.repository_id,
        body.github_issue_number,
        body.title,
        body.url,
        body.body ?? null,
        body.labels ?? null,
        body.status ?? "pending"
      );
      const issue = db.get<Issue>(
        `SELECT * FROM issues WHERE repository_id = ? AND github_issue_number = ?`,
        body.repository_id,
        body.github_issue_number
      );
      return issue;
    },
    {
      body: t.Object({
        repository_id: t.Number(),
        github_issue_number: t.Number(),
        title: t.String(),
        url: t.String(),
        body: t.Optional(t.String()),
        labels: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .patch(
    "/:id",
    ({ db, params, body }) => {
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (body.title !== undefined) {
        updates.push("title = ?");
        values.push(body.title);
      }
      if (body.body !== undefined) {
        updates.push("body = ?");
        values.push(body.body);
      }
      if (body.labels !== undefined) {
        updates.push("labels = ?");
        values.push(body.labels);
      }
      if (body.status !== undefined) {
        updates.push("status = ?");
        values.push(body.status);
      }
      if (body.ai_analysis !== undefined) {
        updates.push("ai_analysis = ?");
        values.push(body.ai_analysis);
      }
      if (body.ai_complexity_score !== undefined) {
        updates.push("ai_complexity_score = ?");
        values.push(body.ai_complexity_score);
      }
      if (body.ai_solvability_score !== undefined) {
        updates.push("ai_solvability_score = ?");
        values.push(body.ai_solvability_score);
      }
      if (body.claimed_by_agent_id !== undefined) {
        updates.push("claimed_by_agent_id = ?");
        values.push(body.claimed_by_agent_id);
      }
      if (body.claimed_at !== undefined) {
        updates.push("claimed_at = ?");
        values.push(body.claimed_at);
      }
      if (body.ai_fix_prompt !== undefined) {
        updates.push("ai_fix_prompt = ?");
        values.push(body.ai_fix_prompt);
      }

      if (updates.length === 0) {
        throw new Error("No fields to update");
      }

      values.push(parseInt(params.id));
      db.run(
        `UPDATE issues SET ${updates.join(", ")} WHERE id = ?`,
        ...values
      );

      return db.get<Issue>(
        `SELECT * FROM issues WHERE id = ?`,
        parseInt(params.id)
      );
    },
    {
      body: t.Object({
        title: t.Optional(t.String()),
        body: t.Optional(t.String()),
        labels: t.Optional(t.String()),
        status: t.Optional(t.String()),
        ai_analysis: t.Optional(t.String()),
        ai_complexity_score: t.Optional(t.Number()),
        ai_solvability_score: t.Optional(t.Number()),
        claimed_by_agent_id: t.Optional(t.Nullable(t.Number())),
        claimed_at: t.Optional(t.Nullable(t.String())),
        ai_fix_prompt: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  .delete("/:id", ({ db, params }) => {
    db.run(`DELETE FROM issues WHERE id = ?`, parseInt(params.id));
    return { success: true };
  })
  .post(
    "/:id/extract",
    async ({ db, params }) => {
      const issueId = parseInt(params.id);
      const issue = db.get<Issue>(
        `SELECT * FROM issues WHERE id = ?`,
        issueId
      );

      if (!issue) {
        throw new Error("Issue not found");
      }

      // Get repository info
      const repo = db.get<{ id: number; full_name: string; language: string | null }>(
        `SELECT id, full_name, language FROM repositories WHERE id = ?`,
        issue.repository_id
      );

      if (!repo) {
        throw new Error("Repository not found");
      }

      // Update status to 'extracting'
      db.run(
        `UPDATE issues SET status = ? WHERE id = ?`,
        "extracting",
        issueId
      );

      try {
        const firecrawl = new Firecrawl({
          apiKey: process.env.FIRECRAWL_API_KEY!,
        });

        // Define the schema for issue extraction
        const IssueDataSchema = {
          type: "object",
          properties: {
            title: { type: "string", description: "The issue title" },
            body: { type: "string", description: "The full issue description/body text" },
            labels: { type: "array", items: { type: "string" }, description: "Array of label names" },
            state: { type: "string", description: "The issue state (open or closed)" },
            author: { type: "string", description: "The GitHub username who created the issue" },
            createdAt: { type: "string", description: "When the issue was created" },
          },
          required: ["title", "body", "labels", "state", "author", "createdAt"],
        };

        // Define the schema for repository extraction with environment info
        const RepoDataSchema = {
          type: "object",
          properties: {
            description: { type: ["string", "null"], description: "The repository description" },
            stars: { type: "number", description: "Number of stars" },
            forks: { type: "number", description: "Number of forks" },
            language: { type: ["string", "null"], description: "Primary programming language" },
            defaultBranch: { type: "string", description: "The default branch name" },
            hasPackageJson: { type: "boolean", description: "true if package.json exists in the root" },
            hasRequirementsTxt: { type: "boolean", description: "true if requirements.txt exists in the root" },
            hasPyprojectToml: { type: "boolean", description: "true if pyproject.toml exists in the root" },
            hasCargoToml: { type: "boolean", description: "true if Cargo.toml exists in the root" },
            hasGoMod: { type: "boolean", description: "true if go.mod exists in the root" },
            hasPomXml: { type: "boolean", description: "true if pom.xml exists in the root" },
            hasGradleBuild: { type: "boolean", description: "true if build.gradle or build.gradle.kts exists in the root" },
            hasMakefile: { type: "boolean", description: "true if Makefile exists in the root" },
            hasDockerfile: { type: "boolean", description: "true if Dockerfile exists in the root" },
            readmeSetupInstructions: { type: ["string", "null"], description: "Setup/installation instructions from README (max 500 chars)" },
          },
          required: ["description", "stars", "forks", "language", "defaultBranch", "hasPackageJson", "hasRequirementsTxt", "hasPyprojectToml", "hasCargoToml", "hasGoMod", "hasPomXml", "hasGradleBuild", "hasMakefile", "hasDockerfile", "readmeSetupInstructions"],
        };

        // Extract issue data using Firecrawl
        const issueResponse = await firecrawl.scrape(issue.url, {
          formats: [
            {
              type: "json",
              schema: IssueDataSchema,
              prompt: `Extract the following information from this GitHub issue page:
                - title: The issue title
                - body: The full issue description/body text
                - labels: Array of label names (e.g., ["bug", "help wanted"])
                - state: The issue state (open or closed)
                - author: The GitHub username who created the issue
                - createdAt: When the issue was created`,
            },
          ],
        });

        const issueResult = {
          parsed: issueResponse.json as {
            title: string;
            body: string;
            labels: string[];
            state: string;
            author: string;
            createdAt: string;
          } | undefined,
        };

        // Extract repository data with environment info
        const repoUrl = `https://github.com/${repo.full_name}`;
        const repoResponse = await firecrawl.scrape(repoUrl, {
          formats: [
            {
              type: "json",
              schema: RepoDataSchema,
              prompt: `Extract the following information from this GitHub repository page:
                - description: The repository description (can be null if none)
                - stars: Number of stars (as a number)
                - forks: Number of forks (as a number)
                - language: Primary programming language (can be null)
                - defaultBranch: The default branch name (e.g., "main" or "master")
                
                Look at the file tree in the repository root and determine:
                - hasPackageJson: true if package.json exists in the root
                - hasRequirementsTxt: true if requirements.txt exists in the root
                - hasPyprojectToml: true if pyproject.toml exists in the root
                - hasCargoToml: true if Cargo.toml exists in the root
                - hasGoMod: true if go.mod exists in the root
                - hasPomXml: true if pom.xml exists in the root
                - hasGradleBuild: true if build.gradle or build.gradle.kts exists in the root
                - hasMakefile: true if Makefile exists in the root
                - hasDockerfile: true if Dockerfile exists in the root
                
                Also look at the README file and extract:
                - readmeSetupInstructions: Any setup/installation instructions found in the README (summarize in 500 chars max, or null if none found)`,
            },
          ],
        });

        const repoResult = {
          parsed: repoResponse.json as {
            description: string | null;
            stars: number;
            forks: number;
            language: string | null;
            defaultBranch: string;
            hasPackageJson: boolean;
            hasRequirementsTxt: boolean;
            hasPyprojectToml: boolean;
            hasCargoToml: boolean;
            hasGoMod: boolean;
            hasPomXml: boolean;
            hasGradleBuild: boolean;
            hasMakefile: boolean;
            hasDockerfile: boolean;
            readmeSetupInstructions: string | null;
          } | undefined,
        };

        // Update issue with extracted data
        const labelsJson = JSON.stringify(issueResult.parsed?.labels);
        const labelsArray = issueResult.parsed?.labels || [];
        
        db.run(
          `UPDATE issues SET title = ?, body = ?, labels = ?, status = ?, 
           has_good_first_issue = ?, has_help_wanted = ?, has_bug_label = ? WHERE id = ?`,
          issueResult.parsed?.title || "",
          issueResult.parsed?.body || "",
          labelsJson,
          issueResult.parsed?.state || "open",
          labelsArray.some((l: string) => l.toLowerCase().includes("good first issue")) ? 1 : 0,
          labelsArray.some((l: string) => l.toLowerCase().includes("help wanted")) ? 1 : 0,
          labelsArray.some((l: string) => l.toLowerCase().includes("bug")) ? 1 : 0,
          issueId
        );

        // Update repository with extracted data
        db.run(
          `UPDATE repositories SET description = ?, stars = ?, forks = ?, language = ?, last_checked_at = datetime('now') WHERE id = ?`,
          repoResult.parsed?.description || "",
          repoResult.parsed?.stars || 0,
          repoResult.parsed?.forks || 0,
          repoResult.parsed?.language || "",
          repo.id
        );

        // Update or insert repository environment
        const repoEnvData = repoResult.parsed;
        if (repoEnvData) {
          // Determine runtime and package manager based on detected files
          let runtime: string | null = null;
          let packageManager: string | null = null;
          let setupCommands: string | null = null;
          let testCommands: string | null = null;

          if (repoEnvData.hasPackageJson) {
            runtime = "node";
            packageManager = "npm";
            setupCommands = "npm install";
            testCommands = "npm test";
          } else if (repoEnvData.hasRequirementsTxt) {
            runtime = "python";
            packageManager = "pip";
            setupCommands = "pip install -r requirements.txt";
            testCommands = "pytest";
          } else if (repoEnvData.hasPyprojectToml) {
            runtime = "python";
            packageManager = "poetry";
            setupCommands = "poetry install";
            testCommands = "poetry run pytest";
          } else if (repoEnvData.hasCargoToml) {
            runtime = "rust";
            packageManager = "cargo";
            setupCommands = "cargo build";
            testCommands = "cargo test";
          } else if (repoEnvData.hasGoMod) {
            runtime = "go";
            packageManager = "go";
            setupCommands = "go mod download";
            testCommands = "go test ./...";
          } else if (repoEnvData.hasPomXml) {
            runtime = "java";
            packageManager = "maven";
            setupCommands = "mvn install";
            testCommands = "mvn test";
          } else if (repoEnvData.hasGradleBuild) {
            runtime = "java";
            packageManager = "gradle";
            setupCommands = "./gradlew build";
            testCommands = "./gradlew test";
          }

          // Check if environment record exists
          const existingEnv = db.get<RepositoryEnvironment>(
            `SELECT * FROM repository_environments WHERE repository_id = ?`,
            repo.id
          );

          if (existingEnv) {
            db.run(
              `UPDATE repository_environments SET 
                primary_language = ?, runtime = ?, package_manager = ?, 
                setup_commands = ?, test_commands = ?, last_updated_at = datetime('now')
               WHERE repository_id = ?`,
              repoEnvData.language,
              runtime,
              packageManager,
              setupCommands,
              testCommands,
              repo.id
            );
          } else {
            db.run(
              `INSERT INTO repository_environments 
                (repository_id, primary_language, runtime, package_manager, setup_commands, test_commands)
               VALUES (?, ?, ?, ?, ?, ?)`,
              repo.id,
              repoEnvData.language,
              runtime,
              packageManager,
              setupCommands,
              testCommands
            );
          }
        }

        // Generate AI fix prompt
        const issueData = issueResult.parsed;
        const aiFixPrompt = await chat({
          adapter: openaiText("gpt-4o"),
          messages: [{
            role: "user",
            content: `Generate a detailed prompt for an AI coding agent (OpenCode) to fix this GitHub issue.

Repository: ${repo.full_name}
URL: https://github.com/${repo.full_name}
Primary Language: ${repoResult.parsed?.language || repo.language || "Unknown"}
Default Branch: ${repoResult.parsed?.defaultBranch || "main"}

Issue #${issue.github_issue_number}: ${issueData?.title || issue.title}

Description:
${issueData?.body || issue.body || "No description provided"}

Labels: ${(issueData?.labels || []).join(", ") || "None"}

The prompt should instruct the AI coding agent to:
1. Understand and analyze the issue thoroughly
2. Find relevant code files in the repository
3. Make minimal, targeted changes to fix the issue
4. Run tests if available to verify the fix works
5. Create a git branch named 'fix/issue-${issue.github_issue_number}'
6. Commit changes with a descriptive message referencing the issue
7. Push the branch and create a pull request

The prompt should be self-contained and provide enough context for the AI to work autonomously.
Output ONLY the prompt text, no explanations or meta-commentary.`
          }],
          stream: false,
        });

        // Update issue with AI fix prompt
        db.run(
          `UPDATE issues SET ai_fix_prompt = ? WHERE id = ?`,
          aiFixPrompt,
          issueId
        );

        return { success: true };
      } catch (error) {
        // Update status to 'error' on failure
        db.run(
          `UPDATE issues SET status = ?, ai_analysis = ? WHERE id = ?`,
          "error",
          error instanceof Error ? error.message : "Unknown error during extraction",
          issueId
        );
        throw error;
      }
    }
  )
  .post(
    "/:id/claim",
    ({ db, params, body }) => {
      db.run(
        `UPDATE issues SET claimed_by_agent_id = ?, claimed_at = datetime('now'), status = 'claimed' WHERE id = ?`,
        body.agent_id,
        parseInt(params.id)
      );
      return db.get<Issue>(
        `SELECT * FROM issues WHERE id = ?`,
        parseInt(params.id)
      );
    },
    {
      body: t.Object({
        agent_id: t.Number(),
      }),
    }
  );
