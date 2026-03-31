const fs = require('fs');
const path = require('path');
const config = require('../config.json');
const memory = require('./memoryManager');
const llm = require('./llmClient');

async function runAnalysis(sessionId, jiraData, testItData, relevantFiles) {

  // COMPLETELY FRESH — zero Phase 1 history

  const ruleset = fs.readFileSync(`./prompts/ruleset_${config.ruleset}.txt`, 'utf8');

  let requirementsSummary = '';
  const summaryPath = path.join(config.gitlab.localPath, 'requirements-summary.md');
  if (fs.existsSync(summaryPath)) {
    requirementsSummary = fs.readFileSync(summaryPath, 'utf8');
  }

  const keyContext = memory.readFull(sessionId).split('---KEY_CONTEXT---')[1]?.split('---')[0]?.trim() || '';
  const responseMap = memory.readFull(sessionId).split('---RESPONSE_MAP---')[1]?.trim() || '';

  const fileContents = [];
  for (const filepath of relevantFiles) {
    try {
      const content = fs.readFileSync(filepath, 'utf8');
      fileContents.push(`FILE: ${filepath}\n\n${content}`);
    } catch (_) {
      console.log(`Could not read file: ${filepath}`);
    }
  }

  const testItBaseline = testItData.length > 0
    ? testItData.map(tc => `- ${tc.name}: ${tc.steps || ''}`).join('\n')
    : 'No TestIT data provided';

  const userMessage = `
--- REQUIREMENTS CONTEXT ---
${requirementsSummary || 'No requirements-summary.md found'}

--- KEY CONTEXT FROM EXPLORATION ---
${keyContext || 'None'}

--- JIRA TICKET ---
Ticket: ${jiraData.ticketId}
Title: ${jiraData.title}
Description: ${jiraData.description || ''}
Comments: ${(jiraData.comments || []).join('\n')}
Image URLs: ${(jiraData.imageUrls || []).join(', ')}
Linked Tickets: ${(jiraData.linkedTickets || []).map(t => t.ticketId + ': ' + t.title).join(', ')}

--- TESTIT BASELINE (already covered — never duplicate) ---
${testItBaseline}

--- RUNTIME DATA FROM TESTER ---
${responseMap || 'None provided'}

--- CODEBASE FILES FOR ANALYSIS ---
${fileContents.join('\n\n---\n\n')}

--- INSTRUCTION ---
Apply all BugFinder analysis rules to the codebase files above.
Follow the ruleset exactly. Output findings in the exact format specified in the ruleset.
`;

  const findings = await llm.callWithCache({
    systemWithCache: ruleset,
    user: userMessage,
    maxTokens: config.llm.maxTokensAnalysis,
    sessionId
  });

  return findings;
}

module.exports = { runAnalysis };
