// BugFinder AI — Frontend Application

(function () {
  'use strict';

  // DOM Elements
  const repoPathInput = document.getElementById('repoPath');
  const loadBranchesBtn = document.getElementById('loadBranchesBtn');
  const branchSelect = document.getElementById('branchSelect');
  const jiraTicketInput = document.getElementById('jiraTicket');
  const testItSuitesInput = document.getElementById('testItSuites');
  const keyFilesInput = document.getElementById('keyFiles');
  const responsesInput = document.getElementById('responses');
  const runAnalysisBtn = document.getElementById('runAnalysisBtn');
  const loadingCard = document.getElementById('loadingCard');
  const loadingMessage = document.getElementById('loadingMessage');
  const loadingBranch = document.getElementById('loadingBranch');
  const resultsCard = document.getElementById('resultsCard');
  const summaryBar = document.getElementById('summaryBar');
  const toggleFilesBtn = document.getElementById('toggleFilesBtn');
  const filesList = document.getElementById('filesList');
  const findingsOutput = document.getElementById('findingsOutput');
  const copyBtn = document.getElementById('copyBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const newAnalysisBtn = document.getElementById('newAnalysisBtn');
  const errorCard = document.getElementById('errorCard');
  const errorMessage = document.getElementById('errorMessage');
  const errorDismissBtn = document.getElementById('errorDismissBtn');
  const healthDot = document.getElementById('healthDot');
  const healthText = document.getElementById('healthText');
  const footerHealth = document.getElementById('footerHealth');
  const indexBtn = document.getElementById('indexBtn');
  const configCard = document.getElementById('configCard');
  const analysisCard = document.getElementById('analysisCard');

  let currentFindings = '';
  let loadingInterval = null;

  const LOADING_MESSAGES = [
    'Fetching Jira ticket...',
    'Fetching TestIT test cases...',
    'Syncing codebase...',
    'Exploring codebase files...',
    'Running adversarial analysis...',
    'Preparing findings...'
  ];

  // --- LocalStorage ---
  function saveToStorage() {
    localStorage.setItem('bugfinder_repoPath', repoPathInput.value);
    localStorage.setItem('bugfinder_branch', branchSelect.value);
    const ruleset = document.querySelector('input[name="ruleset"]:checked');
    if (ruleset) localStorage.setItem('bugfinder_ruleset', ruleset.value);
  }

  function loadFromStorage() {
    const savedRepo = localStorage.getItem('bugfinder_repoPath');
    if (savedRepo) repoPathInput.value = savedRepo;

    const savedRuleset = localStorage.getItem('bugfinder_ruleset');
    if (savedRuleset) {
      const radio = document.querySelector(`input[name="ruleset"][value="${savedRuleset}"]`);
      if (radio) radio.checked = true;
    }
  }

  // --- Health Check ---
  async function checkHealth() {
    try {
      const res = await fetch('/health');
      const data = await res.json();
      healthDot.className = 'health-dot ok';
      healthText.textContent = data.status;
      const parts = [];
      parts.push(`Codebase: ${data.codebase}`);
      parts.push(`ChromaDB: ${data.chromadb}`);
      if (data.currentBranch !== 'none') parts.push(`Branch: ${data.currentBranch}`);
      footerHealth.textContent = parts.join(' | ');
    } catch (_) {
      healthDot.className = 'health-dot error';
      healthText.textContent = 'Error';
      footerHealth.textContent = 'Server unreachable';
    }
  }

  // --- Load Branches ---
  async function loadBranches() {
    const repoPath = repoPathInput.value.trim();
    if (!repoPath) {
      showError('Please enter a GitLab repo path first.');
      return;
    }

    loadBranchesBtn.disabled = true;
    loadBranchesBtn.textContent = 'Loading...';

    // Animate button text so user knows it's working
    let dots = 0;
    const loadingTimer = setInterval(() => {
      dots = (dots + 1) % 4;
      loadBranchesBtn.textContent = 'Loading' + '.'.repeat(dots);
    }, 500);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const res = await fetch(`/branches?repoPath=${encodeURIComponent(repoPath)}`, {
        signal: controller.signal
      });
      clearTimeout(timeout);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to load branches');

      branchSelect.innerHTML = '';
      if (data.branches && data.branches.length > 0) {
        for (const branch of data.branches) {
          const opt = document.createElement('option');
          opt.value = branch;
          opt.textContent = branch;
          branchSelect.appendChild(opt);
        }
        branchSelect.disabled = false;

        // Restore saved branch if available
        const savedBranch = localStorage.getItem('bugfinder_branch');
        if (savedBranch && data.branches.includes(savedBranch)) {
          branchSelect.value = savedBranch;
        }
      } else {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '— No branches found —';
        branchSelect.appendChild(opt);
      }

      saveToStorage();
    } catch (e) {
      if (e.name === 'AbortError') {
        showError('Request timed out after 60s. Check that your server can reach ' + config?.gitlab?.baseUrl + ' and your GITLAB_ACCESS_TOKEN is valid.');
      } else {
        showError(e.message);
      }
    } finally {
      clearInterval(loadingTimer);
      loadBranchesBtn.disabled = false;
      loadBranchesBtn.textContent = 'Load Branches';
    }
  }

  // --- Run Analysis ---
  async function runAnalysis() {
    const jiraTicket = jiraTicketInput.value.trim();
    const repoPath = repoPathInput.value.trim();
    const branch = branchSelect.value;

    if (!jiraTicket) {
      showError('Jira Ticket is required.');
      return;
    }
    if (!repoPath) {
      showError('GitLab Repo Path is required.');
      return;
    }
    if (!branch) {
      showError('Please load and select a branch first.');
      return;
    }

    const ruleset = document.querySelector('input[name="ruleset"]:checked').value;

    const testItSuites = testItSuitesInput.value.trim()
      ? testItSuitesInput.value.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const keyFiles = keyFilesInput.value.trim()
      ? keyFilesInput.value.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const responses = responsesInput.value.trim()
      ? responsesInput.value.split('\n').filter(s => s.trim())
      : [];

    saveToStorage();

    // Show loading
    configCard.classList.add('hidden');
    analysisCard.classList.add('hidden');
    resultsCard.classList.add('hidden');
    errorCard.classList.add('hidden');
    loadingCard.classList.remove('hidden');
    loadingBranch.textContent = `Analysing branch: ${branch}`;

    let msgIndex = 0;
    loadingMessage.textContent = LOADING_MESSAGES[0];
    loadingInterval = setInterval(() => {
      msgIndex = (msgIndex + 1) % LOADING_MESSAGES.length;
      loadingMessage.textContent = LOADING_MESSAGES[msgIndex];
    }, 3000);

    try {
      const res = await fetch('/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jiraTicket, testItSuites, keyFiles, responses, ruleset, repoPath, branch })
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Analysis failed');

      showResults(data);
    } catch (e) {
      showError(e.message);
      configCard.classList.remove('hidden');
      analysisCard.classList.remove('hidden');
    } finally {
      clearInterval(loadingInterval);
      loadingCard.classList.add('hidden');
    }
  }

  // --- Show Results ---
  function showResults(data) {
    currentFindings = data.findings || '';

    // Summary bar
    const filesCount = data.filesAnalysed ? data.filesAnalysed.length : 0;
    const tokens = data.tokenUsage || {};
    summaryBar.innerHTML = `
      <span>Files Analysed: ${filesCount}</span>
      <span>Branch: ${data.branch || '-'}</span>
      <span>Exploration Tokens: ${tokens.exploration || 0}</span>
      <span>Analysis Tokens: ${tokens.analysis || 0}</span>
      <span>Cache Read: ${tokens.cacheRead || 0}</span>
    `;

    // Files list
    filesList.innerHTML = '';
    if (data.filesAnalysed) {
      for (const f of data.filesAnalysed) {
        const div = document.createElement('div');
        div.textContent = f;
        filesList.appendChild(div);
      }
    }

    // Findings
    findingsOutput.innerHTML = renderFindings(currentFindings);

    resultsCard.classList.remove('hidden');
    configCard.classList.remove('hidden');
    analysisCard.classList.remove('hidden');
  }

  // --- Render Findings (simple markdown to HTML) ---
  function renderFindings(text) {
    if (!text) return '<em>No findings returned.</em>';
    let html = text
      // Escape HTML
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Bold: **text**
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Code blocks: ```...```
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      // Inline code: `text`
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Dividers: ---
      .replace(/^---$/gm, '<hr>')
      // Line breaks
      .replace(/\n/g, '<br>');
    return html;
  }

  // --- Show Error ---
  function showError(msg) {
    errorMessage.textContent = msg;
    errorCard.classList.remove('hidden');
  }

  // --- Copy to Clipboard ---
  async function copyFindings() {
    try {
      await navigator.clipboard.writeText(currentFindings);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy to Clipboard'; }, 2000);
    } catch (_) {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = currentFindings;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy to Clipboard'; }, 2000);
    }
  }

  // --- Download as .md ---
  function downloadFindings() {
    const blob = new Blob([currentFindings], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bugfinder-findings-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --- New Analysis ---
  function newAnalysis() {
    resultsCard.classList.add('hidden');
    errorCard.classList.add('hidden');
    jiraTicketInput.value = '';
    testItSuitesInput.value = '';
    keyFilesInput.value = '';
    responsesInput.value = '';
    currentFindings = '';
    configCard.classList.remove('hidden');
    analysisCard.classList.remove('hidden');
  }

  // --- Index Codebase ---
  async function indexCodebase() {
    const repoPath = repoPathInput.value.trim();
    const branch = branchSelect.value;

    indexBtn.disabled = true;
    indexBtn.textContent = 'Indexing...';

    try {
      const body = {};
      if (repoPath) body.repoPath = repoPath;
      if (branch) body.branch = branch;

      const res = await fetch('/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      indexBtn.textContent = 'Indexing Started';
      setTimeout(() => {
        indexBtn.textContent = 'Index Codebase';
        indexBtn.disabled = false;
      }, 5000);
    } catch (e) {
      showError('Indexing failed: ' + e.message);
      indexBtn.textContent = 'Index Codebase';
      indexBtn.disabled = false;
    }
  }

  // --- Event Listeners ---
  loadBranchesBtn.addEventListener('click', loadBranches);
  runAnalysisBtn.addEventListener('click', runAnalysis);
  copyBtn.addEventListener('click', copyFindings);
  downloadBtn.addEventListener('click', downloadFindings);
  newAnalysisBtn.addEventListener('click', newAnalysis);
  errorDismissBtn.addEventListener('click', () => errorCard.classList.add('hidden'));
  indexBtn.addEventListener('click', indexCodebase);

  toggleFilesBtn.addEventListener('click', () => {
    filesList.classList.toggle('hidden');
    toggleFilesBtn.textContent = filesList.classList.contains('hidden')
      ? 'Show Files Analysed'
      : 'Hide Files Analysed';
  });

  repoPathInput.addEventListener('change', saveToStorage);
  branchSelect.addEventListener('change', saveToStorage);

  // --- Init ---
  loadFromStorage();
  checkHealth();
  setInterval(checkHealth, 5000);

  // Auto-load branches if repoPath saved
  if (repoPathInput.value.trim()) {
    loadBranches();
  }
})();
