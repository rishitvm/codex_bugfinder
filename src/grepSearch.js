const { execSync } = require('child_process');

const STOP_WORDS = new Set([
  'The', 'This', 'That', 'With', 'From', 'When', 'Where', 'Which',
  'What', 'Then', 'Than', 'Should', 'Could', 'Would', 'Have', 'Has',
  'Been', 'Being', 'Will', 'Shall', 'Must', 'Need', 'Each', 'Every',
  'Also', 'Into', 'Only', 'Very', 'Just', 'Some', 'More', 'Most',
  'Other', 'About', 'After', 'Before', 'Between', 'Under', 'Over',
  'Such', 'Like', 'Given', 'Both', 'Either', 'Neither', 'Does', 'Done',
  'Make', 'Made', 'Take', 'Taken', 'Come', 'Came', 'True', 'False',
  'Null', 'Undefined', 'Return', 'String', 'Number', 'Boolean', 'Object',
  'Array', 'Function', 'Class', 'Error', 'Exception', 'Test', 'TODO'
]);

async function grepSearch(jiraText, codebasePath) {
  const terms = new Set();

  // PascalCase words
  const pascalMatches = jiraText.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) || [];
  for (const m of pascalMatches) terms.add(m);

  // __c fields
  const fieldMatches = jiraText.match(/\b\w+__c\b/g) || [];
  for (const m of fieldMatches) terms.add(m);

  // Words in backticks
  const backtickMatches = jiraText.match(/`([^`]+)`/g) || [];
  for (const m of backtickMatches) {
    const clean = m.replace(/`/g, '').trim();
    if (clean && clean.length > 2) terms.add(clean);
  }

  // Words in code blocks
  const codeBlockMatches = jiraText.match(/```[\s\S]*?```/g) || [];
  for (const block of codeBlockMatches) {
    const inner = block.replace(/```/g, '').trim();
    const words = inner.match(/\b[A-Z][a-zA-Z0-9_]+\b/g) || [];
    for (const w of words) {
      if (w.length > 2) terms.add(w);
    }
  }

  // Remove stop words
  const filteredTerms = [...terms].filter(t => !STOP_WORDS.has(t));

  const fileScores = {};
  const searchTerms = filteredTerms.slice(0, 30);

  for (const term of searchTerms) {
    try {
      const result = execSync(
        `grep -r -l --include="*.js" --include="*.ts" --include="*.java" --include="*.cls" --include="*.html" --include="*.apex" --include="*.py" --include="*.rb" --include="*.go" --include="*.cs" --include="*.php" "${term}" ${codebasePath} 2>/dev/null`,
        { encoding: 'utf8', timeout: 15000 }
      ).trim();

      if (result) {
        const files = result.split('\n').filter(f => f.trim());
        for (const file of files) {
          fileScores[file] = (fileScores[file] || 0) + 1;
        }
      }
    } catch (_) {
      // grep returns non-zero if no matches — continue
      continue;
    }
  }

  // Sort by score descending
  const sorted = Object.entries(fileScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([filepath]) => filepath);

  return sorted;
}

module.exports = { grepSearch };
