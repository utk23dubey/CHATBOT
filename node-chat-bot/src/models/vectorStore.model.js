import { randomUUID } from "node:crypto";
import { Document } from "@langchain/core/documents";
import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/huggingface_transformers";
import { QdrantVectorStore } from "@langchain/qdrant";

const collectionName =
  process.env.QDRANT_COLLECTION || "pdf_documents_hf_minilm";
const hybridCollectionName =
  process.env.QDRANT_HYBRID_COLLECTION || `${collectionName}_hybrid`;
const metadataPayloadKey = "metadata";
const contentPayloadKey = "content";
const denseVectorName = "dense";
const sparseVectorName = "keywords";
let vectorStore;
let embeddings;
let collectionCheckPromise;
let collectionCreatePromise;
let payloadIndexPromise;
let collectionReady = false;
let hybridCollectionReady = false;
let hybridCollectionCheckPromise;
let hybridCollectionCreatePromise;
let hybridPayloadIndexPromise;
let embeddingDimensionPromise;

function getQdrantConfig() {
  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;
  if (!url) {
    throw new Error("QDRANT_URL must be set to connect to Qdrant Cloud.");
  }
  if (!apiKey) {
    throw new Error("QDRANT_API_KEY must be set to connect to Qdrant Cloud.");
  }
  return { url, apiKey };
}

export function createEmbeddings() {
  if (!embeddings) {
    embeddings = new HuggingFaceTransformersEmbeddings({
      model:
        process.env.HUGGINGFACE_EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2",
      batchSize: 32,
    });
  }
  return embeddings;
}

async function getEmbeddingDimension() {
  if (!embeddingDimensionPromise) {
    embeddingDimensionPromise = createEmbeddings()
      .embedQuery("Determine configured embedding dimensions")
      .then((vector) => vector.length)
      .catch((error) => {
        embeddingDimensionPromise = undefined;
        throw error;
      });
  }
  return embeddingDimensionPromise;
}

/*
 * Sparse token indexes are deterministic across processes, allowing independent
 * ingestion and query workers to create compatible Qdrant sparse vectors.
 */
export function createSparseVector(text) {
  const frequencies = new Map();
  for (const token of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const tokenIndex = hash >>> 0;
    frequencies.set(tokenIndex, (frequencies.get(tokenIndex) || 0) + 1);
  }

  const indices = [...frequencies.keys()].sort((left, right) => left - right);
  return {
    indices,
    values: indices.map((index) => 1 + Math.log(frequencies.get(index))),
  };
}

function initializeVectorStore() {
  if (!vectorStore) {
    const qdrantConfig = getQdrantConfig();
    vectorStore = new QdrantVectorStore(createEmbeddings(), {
      ...qdrantConfig,
      collectionName,
      metadataPayloadKey,
      contentPayloadKey,
    });
  }
  return vectorStore;
}

export function getQdrantClient() {
  return initializeVectorStore().client;
}

export async function getVectorStore({ createIfMissing = false } = {}) {
  initializeVectorStore();

  if (!collectionReady) {
    if (!collectionCheckPromise) {
      collectionCheckPromise = vectorStore.client
        .getCollections()
        .then(({ collections }) =>
          collections.some((collection) => collection.name === collectionName),
        )
        .finally(() => {
          collectionCheckPromise = undefined;
        });
    }

    const collectionExists = await collectionCheckPromise;
    if (!collectionExists) {
      if (!createIfMissing) {
        return null;
      }

      if (!collectionCreatePromise) {
        collectionCreatePromise = vectorStore
          .ensureCollection()
          .finally(() => {
            collectionCreatePromise = undefined;
          });
      }
      await collectionCreatePromise;
    }

    if (!payloadIndexPromise) {
      payloadIndexPromise = Promise.all([
        vectorStore.client.createPayloadIndex(collectionName, {
          field_name: `${metadataPayloadKey}.source`,
          field_schema: "keyword",
          wait: true,
        }),
        vectorStore.client.createPayloadIndex(collectionName, {
          field_name: `${metadataPayloadKey}.pageNumber`,
          field_schema: "integer",
          wait: true,
        }),
      ])
        .then(() => {
          collectionReady = true;
        })
        .finally(() => {
          payloadIndexPromise = undefined;
        });
    }
    await payloadIndexPromise;
  }

  return vectorStore;
}

async function ensureHybridCollection({ createIfMissing }) {
  const client = getQdrantClient();
  if (!hybridCollectionReady) {
    if (!hybridCollectionCheckPromise) {
      hybridCollectionCheckPromise = client
        .getCollections()
        .then(({ collections }) =>
          collections.some(
            (collection) => collection.name === hybridCollectionName,
          ),
        )
        .finally(() => {
          hybridCollectionCheckPromise = undefined;
        });
    }

    const collectionExists = await hybridCollectionCheckPromise;
    if (!collectionExists) {
      if (!createIfMissing) {
        return null;
      }

      if (!hybridCollectionCreatePromise) {
        hybridCollectionCreatePromise = (async () => {
          const vectorSize = await getEmbeddingDimension();
          await client.createCollection(hybridCollectionName, {
            vectors: {
              [denseVectorName]: { size: vectorSize, distance: "Cosine" },
            },
            sparse_vectors: {
              [sparseVectorName]: { modifier: "idf" },
            },
          });
        })().finally(() => {
          hybridCollectionCreatePromise = undefined;
        });
      }
      await hybridCollectionCreatePromise;
    }

    const collectionInfo = await client.getCollection(hybridCollectionName);
    const configuredVectors = collectionInfo.config.params.vectors;
    const configuredSparseVectors =
      collectionInfo.config.params.sparse_vectors;
    if (
      !configuredVectors ||
      typeof configuredVectors !== "object" ||
      !(denseVectorName in configuredVectors) ||
      !configuredSparseVectors ||
      !(sparseVectorName in configuredSparseVectors)
    ) {
      throw new Error(
        `Qdrant collection '${hybridCollectionName}' must have named dense '${denseVectorName}' and sparse '${sparseVectorName}' vectors. Choose a new QDRANT_HYBRID_COLLECTION or recreate it with hybrid vectors.`,
      );
    }
    const denseConfiguration = configuredVectors[denseVectorName];
    if (
      typeof denseConfiguration !== "object" ||
      !("size" in denseConfiguration) ||
      denseConfiguration.size !== (await getEmbeddingDimension())
    ) {
      throw new Error(
        `Qdrant collection '${hybridCollectionName}' has a dense vector size that does not match HUGGINGFACE_EMBEDDING_MODEL.`,
      );
    }

    if (!hybridPayloadIndexPromise) {
      hybridPayloadIndexPromise = Promise.all([
        client.createPayloadIndex(hybridCollectionName, {
          field_name: `${metadataPayloadKey}.source`,
          field_schema: "keyword",
          wait: true,
        }),
        client.createPayloadIndex(hybridCollectionName, {
          field_name: `${metadataPayloadKey}.pageNumber`,
          field_schema: "integer",
          wait: true,
        }),
        client.createPayloadIndex(hybridCollectionName, {
          field_name: `${metadataPayloadKey}.documentType`,
          field_schema: "keyword",
          wait: true,
        }),
      ])
        .then(() => {
          hybridCollectionReady = true;
        })
        .finally(() => {
          hybridPayloadIndexPromise = undefined;
        });
    }
    await hybridPayloadIndexPromise;
  }

  return { client, collectionName: hybridCollectionName };
}

export async function addHybridDocuments(documents, { ids } = {}) {
  const collection = await ensureHybridCollection({ createIfMissing: true });
  const embeddings = createEmbeddings();
  const denseVectors = await embeddings.embedDocuments(
    documents.map((document) => document.pageContent),
  );
  const points = documents.map((document, index) => ({
    id: ids?.[index] || randomUUID(),
    vector: {
      [denseVectorName]: denseVectors[index],
      [sparseVectorName]: createSparseVector(document.pageContent),
    },
    payload: {
      [metadataPayloadKey]: document.metadata,
      [contentPayloadKey]: document.pageContent,
    },
  }));
  await collection.client.upsert(collection.collectionName, {
    points,
    wait: true,
  });
  return collection.collectionName;
}

export async function searchHybridDocuments(query, limit = 8) {
  const collection = await ensureHybridCollection({ createIfMissing: false });
  if (!collection) {
    return null;
  }

  const queryDenseVector = await createEmbeddings().embedQuery(query);
  const querySparseVector = createSparseVector(query);
  const result =
    querySparseVector.indices.length === 0
      ? await collection.client.query(collection.collectionName, {
          query: queryDenseVector,
          using: denseVectorName,
          limit,
          with_payload: true,
        })
      : await collection.client.query(collection.collectionName, {
          prefetch: [
            {
              query: queryDenseVector,
              using: denseVectorName,
              limit: Math.max(limit * 3, 24),
            },
            {
              query: querySparseVector,
              using: sparseVectorName,
              limit: Math.max(limit * 3, 24),
            },
          ],
          query: { fusion: "rrf" },
          limit,
          with_payload: true,
        });

  return result.points
    .filter(
      (point) =>
        typeof point.payload?.[contentPayloadKey] === "string" &&
        point.payload?.[metadataPayloadKey] !== null &&
        typeof point.payload?.[metadataPayloadKey] === "object",
    )
    .map(
      (point) =>
        new Document({
          pageContent: point.payload[contentPayloadKey],
          metadata: point.payload[metadataPayloadKey],
        }),
    );
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

export async function expandRetrievedPages(documents, store) {
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

  const expandedPages = [];

  for (const [source, selectedPages] of pagesBySource) {
    for (const pageNumber of selectedPages) {
      const chunks = [];
      let offset;

      do {
        const result = await store.client.scroll(store.collectionName, {
          filter: {
            must: [
              {
                key: `${store.metadataPayloadKey}.source`,
                match: { value: source },
              },
              {
                key: `${store.metadataPayloadKey}.pageNumber`,
                match: { value: pageNumber },
              },
            ],
          },
          limit: 1000,
          offset,
          with_payload: [
            store.metadataPayloadKey,
            store.contentPayloadKey,
          ],
          with_vector: false,
        });

        for (const point of result.points) {
          const metadata = point.payload?.[store.metadataPayloadKey];
          const pageContent = point.payload?.[store.contentPayloadKey];
          if (typeof pageContent === "string") {
            chunks.push({
              content: pageContent,
              index:
                metadata &&
                typeof metadata === "object" &&
                "chunkIndex" in metadata &&
                typeof metadata.chunkIndex === "number"
                  ? metadata.chunkIndex
                  : Number.MAX_SAFE_INTEGER,
              id: String(point.id),
            });
          }
        }

        offset = result.next_page_offset ?? undefined;
      } while (offset !== undefined);

      chunks.sort(
        (left, right) =>
          left.index - right.index || left.id.localeCompare(right.id),
      );

      if (chunks.length > 0) {
        expandedPages.push(
          new Document({
            pageContent: joinOverlappingChunks(
              chunks.map((chunk) => chunk.content),
            ),
            metadata: { source, pageNumber },
          }),
        );
      }
    }
  }

  return expandedPages.length > 0 ? expandedPages : documents;
}

export const vectorStoreCollectionName = collectionName;
export const hybridVectorStoreCollectionName = hybridCollectionName;
