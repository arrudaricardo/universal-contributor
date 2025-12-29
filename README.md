# Universal Contributor

An autonomous AI-powered system that automatically fixes GitHub issues by spinning up isolated Docker containers with the correct development environment and using OpenCode to implement solutions.

## Overview

Universal Contributor automates the entire process of fixing GitHub issues:

1. **Add an issue** - Paste a GitHub issue URL into the web UI
2. **AI extracts context** - Browser automation extracts issue details and repository environment info
3. **AI generates fix prompt** - GPT-4o analyzes the issue and creates a detailed prompt for fixing it
4. **Docker environment spins up** - AI generates a Dockerfile tailored to the repository's tech stack
5. **OpenCode fixes the issue** - The AI coding agent works inside the container to implement the fix
6. **PR is created** - Changes are committed and a pull request is opened

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Architecture                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────────┐   │
│   │  Web UI  │────▶│  DB API  │────▶│  Docker  │────▶│   OpenCode   │   │
│   │ (React)  │     │ (Elysia) │     │Container │     │  AI Agent    │   │
│   └──────────┘     └──────────┘     └──────────┘     └──────────────┘   │
│                          │                                   │          │
│                          ▼                                   ▼          │
│                    ┌──────────┐                      ┌──────────────┐   │
│                    │  SQLite  │                      │  GitHub PR   │   │
│                    │ Database │                      │   Created    │   │
│                    └──────────┘                      └──────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key Features

- **Automatic Environment Detection** - Detects Node.js, Python, Rust, Go, Java projects and installs correct dependencies
- **AI-Generated Dockerfiles** - Creates optimized Docker images for each repository
- **Isolated Execution** - Each fix runs in its own container, protecting your system
- **Progress Tracking** - Real-time status updates in the web UI
- **Error Recovery** - Automatic retry with AI-regenerated Dockerfiles on build failures

## Project Structure

```
universal-contributor/
├── apps/
│   ├── web/           # React web UI (TanStack Router)
│   ├── db-api/        # Elysia API server + OpenCode management
│   └── agents/        # Background agent for processing issues
├── packages/
│   └── shared/        # Shared database schema and utilities
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime
- [Docker Desktop](https://www.docker.com/products/docker-desktop)
- OpenAI API key
- Browser-use API key (for issue extraction)
- GitHub token (optional, for creating PRs)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/universal-contributor
cd universal-contributor

# Install dependencies
bun install
```

### Running

```bash
# Terminal 1: Start the API server
cd apps/db-api
export OPENAI_API_KEY="sk-..."
export BROWSER_USE_API_KEY="..."
export GH_TOKEN="ghp_..."  # Optional
bun dev

# Terminal 2: Start the web UI
cd apps/web
bun dev

# Terminal 3 (Optional): Start the background agent
cd apps/agents
bun start
```

Open http://localhost:3000/issues to start fixing issues!

## How It Works

### 1. Issue Extraction

When you add a GitHub issue URL, the system uses browser automation to extract:
- Issue title, description, and labels
- Repository language and structure
- Dependency files (package.json, requirements.txt, etc.)
- Setup instructions from README

### 2. Fix Prompt Generation

GPT-4o analyzes the extracted data and generates a detailed prompt that instructs OpenCode how to:
- Understand the issue
- Find relevant code
- Implement the fix
- Run tests
- Create a PR

### 3. Docker Environment

AI generates a Dockerfile that:
- Uses the appropriate base image (node:20, python:3.12, etc.)
- Installs OpenCode AI and GitHub CLI
- Clones the repository
- Installs all dependencies
- Configures the environment for contributing

### 4. OpenCode Execution

Inside the container, OpenCode runs with the fix prompt:
```bash
opencode run --attach http://host:4096 "<fix prompt>"
```

OpenCode autonomously:
- Analyzes the codebase
- Makes targeted changes
- Runs tests
- Creates commits
- Opens a pull request

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key for GPT-4o | Yes |
| `BROWSER_USE_API_KEY` | Browser-use API key for extraction | Yes |
| `GH_TOKEN` | GitHub token for PR creation | No |
| `OPENCODE_URL` | OpenCode server URL | No (default: localhost:4096) |
| `DB_API_URL` | API server URL | No (default: localhost:3002) |

## Tech Stack

- **Frontend**: React, TanStack Router, TanStack Query, Tailwind CSS, shadcn/ui
- **Backend**: Bun, Elysia, SQLite
- **AI**: OpenAI GPT-4o, TanStack AI, OpenCode
- **Infrastructure**: Docker, Browser-use

## License

MIT
