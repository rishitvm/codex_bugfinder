require('dotenv').config();
const express = require('express');
const path = require('path');
const config = require('./config.json');

const { fetchJiraTicket, fetchTestITSuite } = require('./src/mcpClient');
const { listBranches, syncCodebase, getCurrentBranch } = require('./src/gitlabClient');
const { createSession, completeSession, cleanupOldSessions } = require('./src/sessionManager');
const memory = require('./src/memoryManager');
const { mapResponses } = require('./src/responseMapper');
const { runExploration } = require('./src/explorationLoop');
const { runAnalysis } = require('./src/analysisRunner');
const { getSessionTokens, clearSessionTokens } = require('./src/llmClient');
const { indexCodebase } = require('./indexer/indexer');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('./ui'));

// Startup
cleanupOldSessions();
setInterval(cleanupOldSessions, 30 * 60 * 1000);
fs.mkdirSync('./sessions', { recursive: true });
fs.mkdirSync('./codebase', { recursive: true });
fs.mkdirSync('./chroma_db', { recursive: true });

// GET / — serve UI
app.get('/', (req, res) => res.sendFile(path.resolve('./ui/index.html')));

// GET /branches
app.get('/branches', async (req, res) => {
  try {
    const { repoPath } = req.query;
    if (!repoPath) return res.status(400).json({ error: 'repoPath required' });
    const branches = await listBranches(repoPath);
    res.json({ branches });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /health
app.get('/health', async (req, res) => {
  const codebaseExists = fs.existsSync('./codebase/.git');
  let chromaStatus = 'not-indexed';
  try {
    const { ChromaClient } = require('chromadb');
    const client = new ChromaClient({ path: './chroma_db' });
    await client.getCollection({ name: 'codebase' });
    chromaStatus = 'indexed';
  } catch (_) {}
  res.json({
    status: 'ok',
    codebase: codebaseExists ? 'cloned' : 'not-cloned',
    chromadb: chromaStatus,
    currentBranch: codebaseExists ? await getCurrentBranch().catch(() => 'unknown') : 'none'
  });
});

// POST /index
app.post('/index', async (req, res) => {
  const { repoPath, branch } = req.body;
  if (repoPath && branch) {
    await syncCodebase(repoPath, branch).catch(e => console.log('sync warning:', e.message));
  }
  res.json({ status: 'indexing started' });
  indexCodebase('./codebase').then(result => {
    console.log('Indexing complete:', result);
  }).catch(e => console.log('Indexing error:', e.message));
});

// POST /analyse
app.post('/analyse', async (req, res) => {
  const { jiraTicket, testItSuites = [], keyFiles = [], responses = [], ruleset, repoPath, branch } = req.body;

  if (!jiraTicket) return res.status(400).json({ error: 'jiraTicket is required' });
  if (!repoPath) return res.status(400).json({ error: 'repoPath is required' });
  if (!branch) return res.status(400).json({ error: 'branch is required' });

  // Override ruleset if provided
  if (ruleset) config.ruleset = ruleset;

  const sessionId = createSession({ jiraTicket, testItSuites, keyFiles, responses, ruleset, repoPath, branch });

  try {
    // Sync codebase
    await syncCodebase(repoPath, branch);

    // Fetch Jira
    const jiraData = await fetchJiraTicket(jiraTicket);

    // Fetch TestIT
    const testItData = testItSuites.length > 0 ? await fetchTestITSuite(testItSuites) : [];

    // Init memory
    memory.initSession(sessionId, jiraData);

    // Map responses
    await mapResponses(sessionId, responses);

    // Phase 1 — Exploration
    const relevantFiles = await runExploration(sessionId, keyFiles, jiraData.description || jiraData.title, jiraData);

    if (relevantFiles.length === 0) {
      return res.status(400).json({
        error: 'No relevant files found in codebase. Please provide Key Files to help narrow the search.',
        sessionId
      });
    }

    // Phase 2 — Analysis
    const findings = await runAnalysis(sessionId, jiraData, testItData, relevantFiles);

    const tokenUsage = getSessionTokens(sessionId);
    completeSession(sessionId);
    clearSessionTokens(sessionId);

    res.json({
      sessionId,
      ticket: jiraTicket,
      branch,
      findings,
      filesAnalysed: relevantFiles,
      tokenUsage
    });

  } catch (e) {
    console.error('Analysis error:', e.message);
    res.status(500).json({ error: e.message, sessionId });
  }
});

app.listen(config.server.port, () => {
  console.log(`BugFinder AI running at http://localhost:${config.server.port}`);
});
