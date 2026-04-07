const fs = require('fs');
const path = require('path');

const SECTIONS = {
  SESSION: '---SESSION---',
  RELEVANT: '---RELEVANT_FILES---',
  PENDING: '---PENDING---',
  EXPLORED: '---EXPLORED---',
  CONTEXT: '---KEY_CONTEXT---',
  RESPONSES: '---RESPONSE_MAP---'
};

function getMemoryPath(sessionId) {
  return path.join('./sessions', sessionId, 'memory.txt');
}

function initSession(sessionId, jiraData) {
  fs.mkdirSync(path.join('./sessions', sessionId), { recursive: true });
  const content = `${SECTIONS.SESSION}
JiraTicket: ${jiraData.ticketId}
Feature: ${jiraData.title}
Entities: 
Modules: 
Rules: 

${SECTIONS.RELEVANT}

${SECTIONS.PENDING}

${SECTIONS.EXPLORED}

${SECTIONS.CONTEXT}

${SECTIONS.RESPONSES}
`;
  fs.writeFileSync(getMemoryPath(sessionId), content);
}

function readFull(sessionId) {
  return fs.readFileSync(getMemoryPath(sessionId), 'utf8');
}

function getSection(sessionId, sectionHeader) {
  const content = readFull(sessionId);
  const headers = content.match(/---[A-Z_]+---/g) || [];
  const idx = headers.indexOf(sectionHeader);
  if (idx === -1) return '';
  const sectionStart = content.indexOf(sectionHeader) + sectionHeader.length;
  const nextHeader = headers[idx + 1];
  const sectionEnd = nextHeader ? content.indexOf(nextHeader) : content.length;
  return content.substring(sectionStart, sectionEnd).trim();
}

function appendToSection(sessionId, sectionHeader, line) {
  let content = readFull(sessionId);
  const sectionIdx = content.indexOf(sectionHeader);
  if (sectionIdx === -1) return;
  // Find next section start
  const afterSection = content.indexOf('---', sectionIdx + sectionHeader.length);
  const insertAt = afterSection === -1 ? content.length : afterSection;
  const before = content.substring(0, insertAt).trimEnd();
  const after = content.substring(insertAt);
  fs.writeFileSync(getMemoryPath(sessionId), `${before}\n${line}\n${after}`);
}

function addToPending(sessionId, items) {
  const explored = getSection(sessionId, SECTIONS.EXPLORED);
  const pending = getSection(sessionId, SECTIONS.PENDING);
  for (const item of items) {
    if (!explored.includes(item) && !pending.includes(item)) {
      appendToSection(sessionId, SECTIONS.PENDING, `${item} | to explore`);
    }
  }
}

function markExplored(sessionId, nameOrPath, relevant, reason) {
  let content = readFull(sessionId);
  // Remove from PENDING section
  const lines = content.split('\n');
  const pendingStart = content.indexOf(SECTIONS.PENDING);
  const exploredStart = content.indexOf(SECTIONS.EXPLORED);
  const filtered = lines.filter((line, i) => {
    const linePos = content.indexOf(line);
    if (linePos >= pendingStart && linePos < exploredStart && line.includes(nameOrPath)) {
      return false;
    }
    return true;
  });
  content = filtered.join('\n');
  fs.writeFileSync(getMemoryPath(sessionId), content);
  // Add to EXPLORED
  appendToSection(sessionId, SECTIONS.EXPLORED, `${nameOrPath} | ${relevant ? 'relevant' : 'not-relevant'} | ${reason}`);
}

function addRelevant(sessionId, filepath, reason) {
  appendToSection(sessionId, SECTIONS.RELEVANT, `${filepath} | ${reason}`);
}

function addKeyContext(sessionId, fact) {
  if (fact && fact !== 'null') {
    appendToSection(sessionId, SECTIONS.CONTEXT, fact);
  }
}

function getRelevantFiles(sessionId) {
  const section = getSection(sessionId, SECTIONS.RELEVANT);
  return section.split('\n').filter(l => l.trim()).map(l => l.split(' | ')[0].trim()).filter(Boolean);
}

function getPending(sessionId) {
  const pendingSection = getSection(sessionId, SECTIONS.PENDING);
  const exploredSection = getSection(sessionId, SECTIONS.EXPLORED);
  return pendingSection.split('\n')
    .filter(l => l.trim())
    .map(l => l.split(' | ')[0].trim())
    .filter(item => item && !exploredSection.includes(item));
}

function addResponseMap(sessionId, area, values) {
  appendToSection(sessionId, SECTIONS.RESPONSES, `${area} | ${values}`);
}

module.exports = { initSession, readFull, addToPending, markExplored, addRelevant, addKeyContext, getRelevantFiles, getPending, addResponseMap };
