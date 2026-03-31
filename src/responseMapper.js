const memory = require('./memoryManager');

async function mapResponses(sessionId, responseItems) {
  if (!responseItems || responseItems.length === 0) return;

  const memContent = memory.readFull(sessionId);

  for (const item of responseItems) {
    if (!item || !item.trim()) continue;

    let area = 'unmatched';
    let values = item.substring(0, 200);

    try {
      // Try JSON parse
      const parsed = JSON.parse(item);
      const fields = Object.keys(parsed).join(', ');
      values = `fields: ${fields}, sample: ${JSON.stringify(parsed).substring(0, 150)}`;
      // Match to feature area by checking if any field appears in memory
      for (const field of Object.keys(parsed)) {
        if (memContent.includes(field)) {
          area = `matched on field: ${field}`;
          break;
        }
      }
    } catch (_) {
      // Not JSON — extract key terms
      const terms = item.match(/\b[A-Z][a-zA-Z]+\b/g) || [];
      for (const term of terms) {
        if (memContent.includes(term)) {
          area = `matched on term: ${term}`;
          break;
        }
      }
      values = item.substring(0, 200);
    }

    memory.addResponseMap(sessionId, area, values);
  }
}

module.exports = { mapResponses };
