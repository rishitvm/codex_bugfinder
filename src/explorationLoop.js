const config = require('../config.json');
const { resolveFile } = require('./fileResolver');
const { grepSearch } = require('./grepSearch');
const { chromaSearch } = require('./chromaSearch');
const memory = require('./memoryManager');
const llm = require('./llmClient');
const fs = require('fs');

async function runExploration(sessionId, keyFiles, jiraText, jiraData) {
  const codebasePath = config.gitlab.localPath;
  const explorationPrompt = fs.readFileSync('./prompts/exploration.txt', 'utf8');

  // STEP 1 — Seed starting files
  if (keyFiles && keyFiles.length > 0) {
    for (const keyFile of keyFiles) {
      const resolved = await resolveFile(keyFile, codebasePath);
      if (resolved) {
        memory.addRelevant(sessionId, resolved.filepath, 'provided as key file by tester');
        // Extract references from key file
        const refs = extractReferences(resolved.content);
        memory.addToPending(sessionId, refs);
        memory.markExplored(sessionId, keyFile, true, 'key file — confirmed relevant');
      } else {
        console.log(`Key file not found: ${keyFile}`);
      }
    }
  }

  const grepResults = await grepSearch(jiraText, codebasePath);
  memory.addToPending(sessionId, grepResults);

  const chromaResults = await chromaSearch(jiraData.description || jiraData.title);
  memory.addToPending(sessionId, chromaResults);

  // STEP 2 — Exploration loop
  let iterations = 0;
  const maxIterations = 100; // safety limit

  while (memory.getPending(sessionId).length > 0 && iterations < maxIterations) {
    iterations++;
    const pending = memory.getPending(sessionId);
    const current = pending[0];

    const resolved = await resolveFile(current, codebasePath);

    if (!resolved) {
      memory.markExplored(sessionId, current, false, 'file not found');
      continue;
    }

    // FRESH LLM CALL — no history
    const memContent = memory.readFull(sessionId);
    const userMessage = `MEMORY:\n${memContent}\n\nFILE: ${resolved.filepath}\n\n${resolved.content}`;

    let responseText;
    try {
      responseText = await llm.call({
        system: explorationPrompt,
        user: userMessage,
        maxTokens: config.llm.maxTokensExploration,
        sessionId
      });
    } catch (e) {
      console.log(`LLM call failed for ${current}: ${e.message}`);
      memory.markExplored(sessionId, current, false, 'LLM call failed');
      continue;
    }

    // Parse JSON response
    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch (_) {
      console.log(`Failed to parse LLM response for ${current}`);
      memory.markExplored(sessionId, current, false, 'parse failed');
      continue;
    }

    if (parsed.relevant) {
      memory.addRelevant(sessionId, resolved.filepath, parsed.reason || 'relevant');
    }

    if (parsed.explore_next && Array.isArray(parsed.explore_next)) {
      memory.addToPending(sessionId, parsed.explore_next);
    }

    if (parsed.key_context && parsed.key_context !== 'null') {
      memory.addKeyContext(sessionId, parsed.key_context);
    }

    memory.markExplored(sessionId, current, parsed.relevant, parsed.reason || '');

    // File content NOT kept — next iteration is fresh
  }

  return memory.getRelevantFiles(sessionId);
}

function extractReferences(fileContent) {
  const refs = [];
  // Import statements: import X from, require('X'), import { X }
  const importMatches = fileContent.match(/(?:import|require)\s*[\({]?\s*['"]?([A-Za-z][A-Za-z0-9_/.-]+)['"]?/g) || [];
  for (const match of importMatches) {
    const name = match.replace(/(?:import|require)\s*[\({]?\s*['"]?/, '').replace(/['"].*/, '').trim();
    if (name && !name.startsWith('.') && name.length > 2) refs.push(name);
  }
  // Class references: new ClassName, extends ClassName, implements ClassName
  const classMatches = fileContent.match(/(?:new|extends|implements)\s+([A-Z][a-zA-Z0-9]+)/g) || [];
  for (const match of classMatches) {
    const name = match.replace(/(?:new|extends|implements)\s+/, '').trim();
    if (name) refs.push(name);
  }
  return [...new Set(refs)];
}

module.exports = { runExploration };
