const { ChromaClient } = require('chromadb');
const { pipeline } = require('@xenova/transformers');
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'build', 'dist', 'target',
  '__pycache__', '.gradle', 'out', 'bin', 'obj'
]);

const MAX_FILE_SIZE = 500 * 1024; // 500KB

function walkDirectory(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDirectory(fullPath, files);
    } else if (entry.isFile()) {
      try {
        const stats = fs.statSync(fullPath);
        if (stats.size <= MAX_FILE_SIZE) {
          files.push(fullPath);
        }
      } catch (_) {}
    }
  }
  return files;
}

function chunkText(text, chunkSize = 1600, overlap = 100) {
  // ~400 tokens = ~1600 characters
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.substring(start, end));
    start = end - overlap;
    if (start >= text.length) break;
  }
  return chunks;
}

async function indexCodebase(codebasePath = './codebase') {
  console.log(`Indexing codebase at: ${codebasePath}`);

  const client = new ChromaClient({ path: './chroma_db' });

  // Delete existing collection if exists, create fresh
  try {
    await client.deleteCollection({ name: 'codebase' });
  } catch (_) {}
  const collection = await client.createCollection({ name: 'codebase' });

  // Load embedder
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  // Walk codebase
  const files = walkDirectory(codebasePath);
  console.log(`Found ${files.length} files to index`);

  let filesIndexed = 0;
  let chunksCreated = 0;

  for (const filepath of files) {
    try {
      const content = fs.readFileSync(filepath, 'utf8');
      const chunks = chunkText(content);

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        const output = await embedder(chunk, { pooling: 'mean', normalize: true });
        const embedding = Array.from(output.data);

        await collection.add({
          ids: [`${filepath}_${chunkIndex}`],
          embeddings: [embedding],
          documents: [chunk],
          metadatas: [{ filepath: filepath.replace(codebasePath, ''), chunkIndex }]
        });

        chunksCreated++;
      }

      filesIndexed++;
      if (filesIndexed % 50 === 0) {
        console.log(`Indexed ${filesIndexed}/${files.length} files...`);
      }
    } catch (e) {
      console.log(`Skipping ${filepath}: ${e.message}`);
    }
  }

  console.log(`Indexed ${filesIndexed} files, ${chunksCreated} chunks total`);
  return { filesIndexed, chunksCreated };
}

module.exports = { indexCodebase };

// Run directly if called as script
if (require.main === module) {
  indexCodebase().then(result => {
    console.log('Indexing complete:', result);
  }).catch(e => {
    console.error('Indexing failed:', e.message);
    process.exit(1);
  });
}
