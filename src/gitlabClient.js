const axios = require('axios');
const simpleGit = require('simple-git');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');

async function getAuthHeaders(token) {
  // Try each auth method against /api/v4/user to find which one works.
  // Cache result in module scope so we only probe once per server lifetime.
  if (getAuthHeaders._cached) return getAuthHeaders._cached;

  const methods = [
    { 'PRIVATE-TOKEN': token },
    { 'Authorization': `Bearer ${token}` },
    { 'Authorization': `token ${token}` }
  ];

  for (const headers of methods) {
    try {
      await axios.get(`${config.gitlab.baseUrl}/api/v4/user`, {
        headers,
        timeout: 10000
      });
      getAuthHeaders._cached = headers;
      console.log('GitLab auth method:', Object.keys(headers)[0]);
      return headers;
    } catch (e) {
      if (e.response && e.response.status !== 401 && e.response.status !== 403) {
        // Unexpected error, try next
        continue;
      }
      continue;
    }
  }

  // Fallback to PRIVATE-TOKEN if none worked during probe
  console.log('GitLab auth: falling back to PRIVATE-TOKEN');
  getAuthHeaders._cached = { 'PRIVATE-TOKEN': token };
  return getAuthHeaders._cached;
}

async function listBranches(repoPath) {
  const encodedPath = encodeURIComponent(repoPath);
  const token = process.env.GITLAB_ACCESS_TOKEN;
  const branches = [];
  let page = 1;
  const perPage = 100;

  const headers = await getAuthHeaders(token);

  try {
    while (true) {
      const response = await axios.get(
        `${config.gitlab.baseUrl}/api/v4/projects/${encodedPath}/repository/branches`,
        {
          headers,
          params: { per_page: perPage, page },
          timeout: 30000
        }
      );

      if (!response.data || response.data.length === 0) break;

      for (const branch of response.data) {
        branches.push(branch.name);
      }

      if (response.data.length < perPage) break;
      page++;
    }

    // Sort: default branch first, then alphabetical
    branches.sort((a, b) => {
      if (a === 'main' || a === 'master') return -1;
      if (b === 'main' || b === 'master') return 1;
      return a.localeCompare(b);
    });

    return branches;
  } catch (e) {
    const status = e.response?.status || 'unknown';
    throw new Error(
      `Failed to list branches for ${repoPath} (HTTP ${status}): ${e.message}. ` +
      `Check that your GITLAB_ACCESS_TOKEN has api or read_repository scope.`
    );
  }
}

async function syncCodebase(repoPath, branch) {
  const localPath = config.gitlab.localPath;
  const token = process.env.GITLAB_ACCESS_TOKEN;
  const repoUrl = `${config.gitlab.baseUrl}/${repoPath}.git`;
  const authUrl = repoUrl.replace('https://', `https://oauth2:${token}@`);

  const gitDir = path.join(localPath, '.git');

  try {
    if (!fs.existsSync(gitDir)) {
      // Clone fresh
      const git = simpleGit();
      await git.clone(authUrl, localPath, ['--branch', branch, '--single-branch']);
      return { success: true, branch, localPath };
    }

    const git = simpleGit(localPath);
    const currentBranch = (await git.branch()).current;

    if (currentBranch !== branch) {
      // Different branch needed
      await git.fetch('origin');
      try {
        await git.checkout(branch);
      } catch (_) {
        await git.checkoutBranch(branch, `origin/${branch}`);
      }
      await git.pull('origin', branch);
    } else {
      // Same branch, just pull
      await git.pull('origin', branch);
    }

    return { success: true, branch, localPath };
  } catch (e) {
    if (!fs.existsSync(gitDir)) {
      throw new Error(`Failed to clone repo ${repoPath}: ${e.message}`);
    }
    console.log(`Warning: pull failed, using existing codebase: ${e.message}`);
    return { success: true, warning: 'pull failed, using existing', branch, localPath };
  }
}

async function getCurrentBranch() {
  const git = simpleGit(config.gitlab.localPath);
  return (await git.branch()).current;
}

module.exports = { listBranches, syncCodebase, getCurrentBranch };
