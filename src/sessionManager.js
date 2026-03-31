const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

function createSession(analysisRequest) {
  const sessionId = uuidv4();
  const sessionDir = path.join('./sessions', sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const sessionData = {
    sessionId,
    ...analysisRequest,
    createdAt: new Date().toISOString(),
    status: 'running'
  };
  fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify(sessionData, null, 2));
  return sessionId;
}

function getSession(sessionId) {
  const sessionPath = path.join('./sessions', sessionId, 'session.json');
  if (!fs.existsSync(sessionPath)) return null;
  return JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
}

function completeSession(sessionId) {
  const sessionPath = path.join('./sessions', sessionId, 'session.json');
  if (!fs.existsSync(sessionPath)) return;
  const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  session.status = 'completed';
  session.completedAt = new Date().toISOString();
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
  // Schedule deletion after 2 hours
  setTimeout(() => {
    fs.rmSync(path.join('./sessions', sessionId), { recursive: true, force: true });
  }, 2 * 60 * 60 * 1000);
}

function cleanupOldSessions() {
  if (!fs.existsSync('./sessions')) return;
  const sessions = fs.readdirSync('./sessions');
  const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
  for (const sessionId of sessions) {
    const sessionPath = path.join('./sessions', sessionId, 'session.json');
    if (!fs.existsSync(sessionPath)) continue;
    try {
      const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      if (new Date(session.createdAt).getTime() < twoHoursAgo) {
        fs.rmSync(path.join('./sessions', sessionId), { recursive: true, force: true });
      }
    } catch (_) {
      // Skip corrupted session files
    }
  }
}

module.exports = { createSession, getSession, completeSession, cleanupOldSessions };
