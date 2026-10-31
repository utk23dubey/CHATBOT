import "dotenv/config";
import { createHash } from "node:crypto";
import { Document } from "@langchain/core/documents";
import { connect } from "@lancedb/lancedb";
import {
  createEmbeddings,
  getVectorStore,
  vectorStoreCollectionName,
} from "../models/vectorStore.model.js";

const lanceDbPath = process.env.LANCEDB_PATH || "./lancedb_data";
const lanceDbTable = process.env.LANCEDB_TABLE || "pdf_documents_hf_minilm";
const batchSize = 128;

function createPointId(row) {
  const hash = createHash("sha256")
    .update(
      JSON.stringify([
        row.index,
        row.source,
        row.pageNumber,
        row.loc,
        row.text,
      ]),
    )
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function loadLanceRows(table) {
  const rows = [];
  let offset = 0;

  while (true) {
    const batch = await table
      .query()
      .select(["vector", "text", "source", "pageNumber", "loc"])
      .limit(batchSize)
      .offset(offset)
      .toArray();

    rows.push(...batch.map((row) => ({ ...row, index: offset++ })));
    if (batch.length < batchSize) {
      return rows;
    }
  }
}

async function migrate() {
  const database = await connect(lanceDbPath);
  const tableNames = await database.tableNames();
  if (!tableNames.includes(lanceDbTable)) {
    throw new Error(
      `LanceDB table '${lanceDbTable}' was not found at '${lanceDbPath}'. Set LANCEDB_PATH and LANCEDB_TABLE to the source you want to migrate.`,
    );
  }

  const table = await database.openTable(lanceDbTable);
  const rows = await loadLanceRows(table);
  if (rows.length === 0) {
    console.log(`LanceDB table '${lanceDbTable}' contains no vectors to migrate.`);
    return;
  }

  const invalidRow = rows.find(
    (row) =>
      !row.vector ||
      typeof row.text !== "string" ||
      typeof row.source !== "string" ||
      !Number.isInteger(row.pageNumber),
  );
  if (invalidRow) {
    throw new Error(
      "The LanceDB table contains rows without a vector, text, source, or integer pageNumber.",
    );
  }

  const expectedDimension = (
    await createEmbeddings().embedQuery("Qdrant migration dimension check")
  ).length;
  const sourceDimension = rows[0].vector.length;
  if (sourceDimension !== expectedDimension) {
    throw new Error(
      `The selected LanceDB table contains ${sourceDimension}-dimensional vectors, but the configured embedding model produces ${expectedDimension}. Set LANCEDB_TABLE to the matching active index or re-ingest the PDFs with the configured model.`,
    );
  }
  if (rows.some((row) => row.vector.length !== sourceDimension)) {
    throw new Error("The LanceDB table contains inconsistent vector dimensions.");
  }

  rows.sort((left, right) => {
    const sourceOrder = left.source.localeCompare(right.source);
    if (sourceOrder !== 0) return sourceOrder;
    if (left.pageNumber !== right.pageNumber) {
      return left.pageNumber - right.pageNumber;
    }
    const leftLine = left.loc?.lines?.from ?? Number.MAX_SAFE_INTEGER;
    const rightLine = right.loc?.lines?.from ?? Number.MAX_SAFE_INTEGER;
    return leftLine - rightLine || left.index - right.index;
  });

  const pageChunkIndexes = new Map();
  const documents = rows.map((row) => {
    const key = `${row.source}:${row.pageNumber}`;
    const chunkIndex = pageChunkIndexes.get(key) || 0;
    pageChunkIndexes.set(key, chunkIndex + 1);
    return new Document({
      id: createPointId(row),
      pageContent: row.text,
      metadata: {
        source: row.source,
        pageNumber: row.pageNumber,
        chunkIndex,
        ...(row.loc ? { loc: row.loc } : {}),
      },
    });
  });
  const vectorStore = await getVectorStore({ createIfMissing: true });

  for (let start = 0; start < rows.length; start += batchSize) {
    const batchRows = rows.slice(start, start + batchSize);
    await vectorStore.addVectors(
      batchRows.map((row) => Array.from(row.vector)),
      documents.slice(start, start + batchSize),
    );
    console.log(
      `Migrated ${Math.min(start + batchSize, rows.length)} / ${rows.length} vectors.`,
    );
  }

  console.log(
    `Migration complete: ${rows.length} vectors from LanceDB '${lanceDbTable}' to Qdrant '${vectorStoreCollectionName}'.`,
  );
}

migrate().catch((error) => {
  console.error("LanceDB to Qdrant migration failed:", error);
  process.exitCode = 1;
});
