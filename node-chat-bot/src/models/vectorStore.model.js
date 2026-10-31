import { Document } from "@langchain/core/documents";
import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/huggingface_transformers";
import { LanceDB } from "@langchain/community/vectorstores/lancedb";
import { connect } from "@lancedb/lancedb";

const lanceDbPath = process.env.LANCEDB_PATH || "./lancedb_data";
const tableName = process.env.LANCEDB_TABLE || "pdf_documents_hf_minilm";

function getEmbeddings() {
  return new HuggingFaceTransformersEmbeddings({
    model:
      process.env.HUGGINGFACE_EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2",
    batchSize: 32,
  });
}

export async function getVectorStore({ createIfMissing = false } = {}) {
  const database = await connect(lanceDbPath);
  const existingTables = await database.tableNames();

  if (existingTables.includes(tableName)) {
    return new LanceDB(getEmbeddings(), {
      table: await database.openTable(tableName),
    });
  }

  if (!createIfMissing) {
    return null;
  }

  return new LanceDB(getEmbeddings(), {
    uri: lanceDbPath,
    tableName,
    mode: "create",
  });
}

function joinOverlappingChunks(chunks) {
  let text = "";

  for (const chunk of chunks) {
    if (!text) {
      text = chunk;
      continue;
    }

    const maxOverlap = Math.min(text.length, chunk.length, 200);
    let overlap = maxOverlap;

    while (overlap > 0 && text.slice(-overlap) !== chunk.slice(0, overlap)) {
      overlap -= 1;
    }

    text += chunk.slice(overlap);
  }

  return text;
}

export async function expandRetrievedPages(documents) {
  const pagesBySource = new Map();

  for (const document of documents) {
    const { source, pageNumber } = document.metadata;
    if (!source || !Number.isInteger(pageNumber)) {
      continue;
    }

    if (!pagesBySource.has(source)) {
      pagesBySource.set(source, new Set());
    }
    pagesBySource.get(source).add(pageNumber);
  }

  if (pagesBySource.size === 0) {
    return documents;
  }

  const database = await connect(lanceDbPath);
  const table = await database.openTable(tableName);
  const expandedPages = [];

  for (const [source, selectedPages] of pagesBySource) {
    const escapedSource = source.replaceAll("'", "''");
    const rows = await table
      .query()
      .where(`source = '${escapedSource}'`)
      .select(["source", "pageNumber", "text"])
      .limit(10000)
      .toArray();
    const chunksByPage = new Map();

    for (const row of rows) {
      if (!selectedPages.has(row.pageNumber)) {
        continue;
      }

      if (!chunksByPage.has(row.pageNumber)) {
        chunksByPage.set(row.pageNumber, []);
      }
      chunksByPage.get(row.pageNumber).push(row.text);
    }

    for (const pageNumber of selectedPages) {
      const pageChunks = chunksByPage.get(pageNumber);
      if (!pageChunks?.length) {
        continue;
      }

      expandedPages.push(
        new Document({
          pageContent: joinOverlappingChunks(pageChunks),
          metadata: { source, pageNumber },
        }),
      );
    }
  }

  return expandedPages.length > 0 ? expandedPages : documents;
}

export const vectorStoreTableName = tableName;
