const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config.json');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const tokenLog = {};

async function call({ system, user, maxTokens, sessionId }) {
  const attempt = async () => client.messages.create({
    model: config.llm.model,
    max_tokens: maxTokens || config.llm.maxTokensExploration,
    system: system,
    messages: [{ role: 'user', content: user }]
  });

  let response;
  try {
    response = await attempt();
  } catch (_) {
    await new Promise(r => setTimeout(r, 2000));
    response = await attempt(); // retry once
  }

  // Log tokens only — never log content
  if (sessionId) {
    if (!tokenLog[sessionId]) tokenLog[sessionId] = { exploration: 0, analysis: 0, cacheRead: 0 };
    tokenLog[sessionId].exploration += response.usage.input_tokens + response.usage.output_tokens;
  }

  return response.content[0].text;
}

async function callWithCache({ systemWithCache, user, maxTokens, sessionId }) {
  const attempt = async () => client.messages.create({
    model: config.llm.model,
    max_tokens: maxTokens || config.llm.maxTokensAnalysis,
    system: [{ type: 'text', text: systemWithCache, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }]
  });

  let response;
  try {
    response = await attempt();
  } catch (_) {
    await new Promise(r => setTimeout(r, 2000));
    response = await attempt();
  }

  if (sessionId) {
    if (!tokenLog[sessionId]) tokenLog[sessionId] = { exploration: 0, analysis: 0, cacheRead: 0 };
    tokenLog[sessionId].analysis += response.usage.input_tokens + response.usage.output_tokens;
    tokenLog[sessionId].cacheRead += response.usage.cache_read_input_tokens || 0;
  }

  return response.content[0].text;
}

function getSessionTokens(sessionId) {
  return tokenLog[sessionId] || { exploration: 0, analysis: 0, cacheRead: 0 };
}

function clearSessionTokens(sessionId) {
  delete tokenLog[sessionId];
}

module.exports = { call, callWithCache, getSessionTokens, clearSessionTokens };
