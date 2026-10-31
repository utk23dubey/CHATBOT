import { Document } from "@langchain/core/documents";
import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/huggingface_transformers";
import { QdrantVectorStore } from "@langchain/qdrant";

const collectionName =
  process.env.QDRANT_COLLECTION || "pdf_documents_hf_minilm";
const metadataPayloadKey = "metadata";
const contentPayloadKey = "content";
let vectorStore;
let collectionCheckPromise;
let collectionCreatePromise;
let payloadIndexPromise;
let collectionReady = false;

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
  return new HuggingFaceTransformersEmbeddings({
    model:
      process.env.HUGGINGFACE_EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2",
    batchSize: 32,
  });
}

export async function getVectorStore({ createIfMissing = false } = {}) {
  if (!vectorStore) {
    const qdrantConfig = getQdrantConfig();
    vectorStore = new QdrantVectorStore(createEmbeddings(), {
      ...qdrantConfig,
      collectionName,
      metadataPayloadKey,
      contentPayloadKey,
    });
  }

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
