const { ChromaClient } = require('chromadb');

let embedderInstance = null;

async function getEmbedder() {
  if (!embedderInstance) {
    const { pipeline } = require('@xenova/transformers');
    embedderInstance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedderInstance;
}

async function chromaSearch(queryText, topK = 10) {
  try {
    const client = new ChromaClient({ path: './chroma_db' });
    let collection;
    try {
      collection = await client.getCollection({ name: 'codebase' });
    } catch (_) {
      // Collection not found — chromadb not indexed yet
      return [];
    }

    const embedder = await getEmbedder();
    const output = await embedder(queryText, { pooling: 'mean', normalize: true });
    const embedding = Array.from(output.data);

    const results = await collection.query({
      queryEmbeddings: [embedding],
      nResults: topK
    });

    // Extract unique file paths from results
    const filePaths = new Set();
    if (results.metadatas && results.metadatas[0]) {
      for (const meta of results.metadatas[0]) {
        if (meta && meta.filepath) {
          filePaths.add(meta.filepath);
        }
      }
    }

    return [...filePaths];
  } catch (e) {
    // chromadb is optional layer — fail silently
    return [];
  }
}

module.exports = { chromaSearch };
