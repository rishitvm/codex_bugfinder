const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');

async function resolveFile(nameOrPath, codebasePath) {
  codebasePath = codebasePath || config.gitlab.localPath;

  const extensions = ['.js', '.ts', '.java', '.cls', '.apex', '.py', '.rb', '.go', '.cs', '.php', '.html', '.jsx', '.tsx', '.vue'];

  // 1. Try exact path
  const fullPath = path.join(codebasePath, nameOrPath);
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    return { filepath: fullPath, content: fs.readFileSync(fullPath, 'utf8') };
  }

  // 2. Try with extensions appended
  for (const ext of extensions) {
    const withExt = path.join(codebasePath, nameOrPath + ext);
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
      return { filepath: withExt, content: fs.readFileSync(withExt, 'utf8') };
    }
  }

  // 3. Try filename search (case insensitive)
  try {
    const result = execSync(
      `find ${codebasePath} -iname "*${nameOrPath}*" -type f 2>/dev/null | head -5`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    if (result) {
      const firstMatch = result.split('\n')[0].trim();
      if (firstMatch && fs.existsSync(firstMatch)) {
        return { filepath: firstMatch, content: fs.readFileSync(firstMatch, 'utf8') };
      }
    }
  } catch (_) {}

  // 4. Try grep for class/function definition
  try {
    const result = execSync(
      `grep -r -l "class ${nameOrPath}\\|function ${nameOrPath}\\|def ${nameOrPath}" ${codebasePath} 2>/dev/null | head -3`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    if (result) {
      const firstMatch = result.split('\n')[0].trim();
      if (firstMatch && fs.existsSync(firstMatch)) {
        return { filepath: firstMatch, content: fs.readFileSync(firstMatch, 'utf8') };
      }
    }
  } catch (_) {}

  // 5. Try grep for name appearing anywhere
  try {
    const result = execSync(
      `grep -r -l "${nameOrPath}" ${codebasePath} 2>/dev/null | head -3`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    if (result) {
      const firstMatch = result.split('\n')[0].trim();
      if (firstMatch && fs.existsSync(firstMatch)) {
        return { filepath: firstMatch, content: fs.readFileSync(firstMatch, 'utf8') };
      }
    }
  } catch (_) {}

  // 6. Not found
  console.log(`Could not resolve: ${nameOrPath}`);
  return null;
}

module.exports = { resolveFile };
