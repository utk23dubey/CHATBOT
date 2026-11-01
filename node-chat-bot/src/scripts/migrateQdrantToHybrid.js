import "dotenv/config";
import { Document } from "@langchain/core/documents";
import {
  addHybridDocuments,
  getVectorStore,
  hybridVectorStoreCollectionName,
  vectorStoreCollectionName,
} from "../models/vectorStore.model.js";

const batchSize = 64;

async function migrate() {
  const vectorStore = await getVectorStore();
  if (!vectorStore) {
    throw new Error(
      `Dense Qdrant collection '${vectorStoreCollectionName}' was not found. Set QDRANT_COLLECTION to the collection to backfill.`,
    );
  }

  const sourceCount = (
    await vectorStore.client.count(vectorStore.collectionName, { exact: true })
  ).count;
  let offset;
  let migrated = 0;
  do {
    const result = await vectorStore.client.scroll(vectorStore.collectionName, {
      limit: batchSize,
      offset,
      with_payload: [
        vectorStore.metadataPayloadKey,
        vectorStore.contentPayloadKey,
      ],
      with_vector: false,
    });
    const documents = [];
    const ids = [];

    for (const point of result.points) {
      const payload = point.payload;
      const content = payload?.[vectorStore.contentPayloadKey];
      const metadata = payload?.[vectorStore.metadataPayloadKey];
      if (typeof content !== "string" || !metadata || typeof metadata !== "object") {
        throw new Error(
          `Dense collection point '${point.id}' is missing document content or metadata.`,
        );
      }
      documents.push(new Document({ pageContent: content, metadata }));
      ids.push(point.id);
    }

    if (documents.length > 0) {
      await addHybridDocuments(documents, { ids });
      migrated += documents.length;
      console.log(
        `Backfilled ${migrated} points from '${vectorStoreCollectionName}' to '${hybridVectorStoreCollectionName}'.`,
      );
    }
    offset = result.next_page_offset ?? undefined;
  } while (offset !== undefined);

  const hybridCount = (
    await vectorStore.client.count(hybridVectorStoreCollectionName, {
      exact: true,
    })
  ).count;
  if (hybridCount < sourceCount) {
    throw new Error(
      `Hybrid backfill is incomplete: dense collection has ${sourceCount} points, but hybrid collection has ${hybridCount}.`,
    );
  }

  console.log(
    `Backfill complete: processed ${migrated} points. Dense collection has ${sourceCount}; hybrid collection has ${hybridCount}.`,
  );
}

migrate().catch((error) => {
  console.error("Qdrant hybrid backfill failed:", error);
  process.exitCode = 1;
});
