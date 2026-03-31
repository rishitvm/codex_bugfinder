# BugFinder AI Backend

Adversarial QA tool that finds test cases which will definitely fail on implemented code — test cases the QA team has not written yet. It replaces agentic loops with a controlled two-phase architecture (Exploration + Analysis) that eliminates snowballing and gives cleaner results.

Works for **any codebase in any language** — Java, TypeScript, JavaScript, Apex, Angular, Python, mixed — no language assumptions anywhere.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Folder Structure](#folder-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Server](#running-the-server)
- [Using the Web UI](#using-the-web-ui)
- [Indexing the Codebase](#indexing-the-codebase)
- [API Endpoints](#api-endpoints)
- [Data Privacy](#data-privacy)
- [Troubleshooting](#troubleshooting)

---

## How It Works

BugFinder AI operates in two phases:

1. **Phase 1 — Exploration**: Automatically discovers relevant code files by seeding from Jira ticket context, grep search, and ChromaDB vector search. An LLM evaluates each file and decides whether it is relevant and what to explore next. No conversation history is carried — each file evaluation is a fresh LLM call using a shared memory file.

2. **Phase 2 — Analysis**: All relevant files are passed to the LLM along with the BugFinder ruleset, Jira ticket data, TestIT baseline, and any runtime data from the tester. The LLM applies adversarial analysis rules and outputs findings — test cases that will fail on the current implementation.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Server | Node.js + Express |
| LLM | Anthropic Claude (via @anthropic-ai/sdk) |
| MCP Client | @modelcontextprotocol/sdk (SSE transport) |
| Git Operations | simple-git + axios (GitLab REST API) |
| Vector Database | ChromaDB (local) |
| Embeddings | @xenova/transformers (local, Xenova/all-MiniLM-L6-v2) |
| Frontend | Plain HTML/CSS/JS (no framework) |

---

## Folder Structure

```
bugfinder-server/
  server.js              # Express HTTP server — main entry point
  config.json            # All configuration (LLM, MCP, GitLab, server)
  .env.example           # Template for environment variables
  .gitignore
  package.json
  README.md

  src/
    mcpClient.js         # Jira and TestIT data fetching via MCP SSE
    gitlabClient.js      # GitLab branch listing and repo cloning (read-only)
    fileResolver.js      # Resolves file names/paths to actual files in codebase
    grepSearch.js        # Grep-based code search for Jira term matching
    chromaSearch.js      # ChromaDB vector similarity search
    memoryManager.js     # Session memory file management (exploration state)
    explorationLoop.js   # Phase 1 — iterative file exploration with LLM
    analysisRunner.js    # Phase 2 — adversarial analysis with LLM
    llmClient.js         # Anthropic API wrapper with caching and token tracking
    responseMapper.js    # Maps tester-provided runtime data to memory
    sessionManager.js    # Session creation, completion, and cleanup

  indexer/
    indexer.js           # ChromaDB codebase indexer
    reindex.sh           # Shell script to re-index codebase

  prompts/
    exploration.txt      # System prompt for Phase 1 exploration
    ruleset_v3.txt       # BugFinder ruleset v3 (user must paste content)
    ruleset_v5.txt       # BugFinder ruleset v5 (user must paste content)

  ui/
    index.html           # Web UI
    style.css            # Styles
    app.js               # Frontend JavaScript

  sessions/              # Auto-created — stores session data (auto-deleted after 2h)
  codebase/              # Auto-created — cloned GitLab repo
  chroma_db/             # Auto-created — ChromaDB vector database
```

---

## Prerequisites

- **Node.js** v18 or higher
- **npm** (comes with Node.js)
- An **Anthropic API key** (for Claude LLM calls)
- A **GitLab Personal Access Token** with read-only repo access
- Network access to your Jira and TestIT MCP SSE endpoints (if using those features)

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/rishitvm/codex_bugfinder.git
cd codex_bugfinder

# 2. Install dependencies
npm install

# 3. Create your environment file
cp .env.example .env
```

---

## Configuration

### Step 1: Set up environment variables

Edit the `.env` file and add your keys:

```env
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxx
GITLAB_ACCESS_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxxx
```

- `ANTHROPIC_API_KEY` — Get from https://console.anthropic.com/
- `GITLAB_ACCESS_TOKEN` — Create at GitLab > Settings > Access Tokens (needs `read_repository` scope)

### Step 2: Add your BugFinder rulesets

The analysis engine needs ruleset files to know what rules to apply. You must manually paste your ruleset content into:

- `prompts/ruleset_v3.txt` — BugFinder ruleset version 3
- `prompts/ruleset_v5.txt` — BugFinder ruleset version 5

These files ship with placeholder text. Replace the placeholder with your actual ruleset content.

### Step 3: Review config.json (optional)

`config.json` contains all other settings. The defaults work out of the box, but you can customize:

```json
{
  "llm": {
    "model": "claude-sonnet-4-20250514",
    "maxTokensExploration": 1000,
    "maxTokensAnalysis": 8000
  },
  "mcp": {
    "jira": { "url": "http://your-jira-mcp-endpoint/sse" },
    "testit": { "url": "http://your-testit-mcp-endpoint/sse" }
  },
  "gitlab": {
    "baseUrl": "https://gitlab.com",
    "localPath": "./codebase"
  },
  "server": { "port": 3000 },
  "ruleset": "v3"
}
```

---

## Running the Server

```bash
# Start the server
node server.js

# Or use npm
npm start
```

The server starts at **http://localhost:3000**. Open this URL in your browser to access the web UI.

---

## Using the Web UI

### First-Time Setup

1. **Enter your GitLab repo path** in the Configuration section (e.g. `my-org/my-repo`)
2. **Click "Load Branches"** — this fetches all branches from GitLab
3. **Select a branch** from the dropdown
4. **Click "Index Codebase"** in the footer — this clones the repo and creates vector embeddings for semantic search (do this once, or repeat when code changes significantly)

### Running an Analysis

1. **Enter a Jira ticket number** (e.g. `PROJ-1234`) — this is required
2. **Optionally add TestIT Suite IDs** — comma-separated (e.g. `CRM-40910, CRM-40918`)
3. **Optionally add Key Files** — comma-separated class/file names to help narrow the search (e.g. `SaveActionService, QuoteService`)
4. **Optionally paste Responses/Logs** — API responses, console logs, or network tab data to reduce false positives
5. **Select your ruleset** — v3 or v5
6. **Click "Run BugFinder Analysis"**

### Viewing Results

- The analysis takes a few minutes depending on codebase size
- Loading messages rotate to show progress
- When complete, you'll see:
  - **Summary bar** — files analysed count, token usage, branch
  - **Files Analysed** — collapsible list of all files the system examined
  - **Findings** — formatted analysis output with adversarial test cases
- Use **"Copy to Clipboard"** to copy findings
- Use **"Download as .md"** to save as a Markdown file
- Use **"New Analysis"** to start fresh

### Tips for Better Results

- **Always provide Key Files** when you know which files implement the feature — this dramatically improves accuracy and speed
- **Paste runtime data** (API responses, logs) to help the system understand actual behavior vs. expected behavior
- **Re-index the codebase** after significant code changes for better vector search results
- Configuration values (repo path, branch, ruleset) are saved to localStorage automatically

---

## Indexing the Codebase

ChromaDB indexing creates vector embeddings for semantic code search. This is optional but improves file discovery.

```bash
# Via the UI: click "Index Codebase" in the footer

# Via CLI:
npm run index

# Via shell script:
./indexer/reindex.sh
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Serves the web UI |
| `GET` | `/health` | Returns server health status, codebase state, ChromaDB status |
| `GET` | `/branches?repoPath=org/repo` | Lists all branches for a GitLab repository |
| `POST` | `/index` | Syncs codebase and starts ChromaDB indexing |
| `POST` | `/analyse` | Runs the full BugFinder analysis pipeline |

### POST /analyse — Request Body

```json
{
  "jiraTicket": "PROJ-1234",
  "repoPath": "org/repo-name",
  "branch": "main",
  "testItSuites": ["CRM-40910"],
  "keyFiles": ["SaveActionService", "QuoteService"],
  "responses": ["{ \"status\": 200, \"data\": {...} }"],
  "ruleset": "v3"
}
```

### POST /analyse — Response

```json
{
  "sessionId": "uuid",
  "ticket": "PROJ-1234",
  "branch": "main",
  "findings": "... analysis output ...",
  "filesAnalysed": ["./codebase/src/Service.java", "..."],
  "tokenUsage": {
    "exploration": 12000,
    "analysis": 8000,
    "cacheRead": 3000
  }
}
```

---

## Data Privacy

| Data | Where it goes |
|------|--------------|
| Codebase files | Cloned to server machine only — never uploaded |
| Relevant code files | Sent to Anthropic API for analysis only |
| Jira / TestIT data | Fetched via internal MCP SSE servers — stays within org network |
| ChromaDB embeddings | Generated locally — stored in `./chroma_db` — never leaves machine |
| API keys | Loaded from `.env` — never hardcoded — never logged |
| Session data | Stored in `./sessions` — auto-deleted after 2 hours |

**The system NEVER modifies any file in the GitLab repository.**

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `ANTHROPIC_API_KEY not set` | Make sure `.env` file exists and contains your key |
| `Failed to list branches` | Check your `GITLAB_ACCESS_TOKEN` has `read_repository` scope |
| `No relevant files found` | Provide Key Files to help narrow the search |
| `MCP connection failed` | Verify MCP SSE endpoint URLs in `config.json` are reachable |
| `ChromaDB not indexed` | Click "Index Codebase" in the footer or run `npm run index` |
| Server won't start | Check port 3000 is not in use: `lsof -i :3000` |
| Analysis takes too long | Provide Key Files to reduce exploration scope |
