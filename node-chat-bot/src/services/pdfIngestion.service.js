import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import {
  getVectorStore,
  vectorStoreTableName,
} from "../models/vectorStore.model.js";

export async function ingestPdf(file) {
  const pdf = new Blob([file.buffer], { type: "application/pdf" });
  const loader = new PDFLoader(pdf, { splitPages: true });
  const pages = await loader.load();

  if (pages.length === 0 || pages.every((page) => !page.pageContent.trim())) {
    const error = new Error("The PDF contains no readable text.");
    error.status = 400;
    throw error;
  }

  const documents = pages
    .filter((page) => page.pageContent.trim())
    .map((page) => ({
      ...page,
      metadata: {
        source: file.originalname,
        ...(Number.isInteger(page.metadata.loc?.pageNumber)
          ? { pageNumber: page.metadata.loc.pageNumber }
          : {}),
      },
    }));
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  const chunks = await splitter.splitDocuments(documents);
  const vectorStore = await getVectorStore({ createIfMissing: true });

  await vectorStore.addDocuments(chunks);

  return {
    message: "PDF ingested successfully.",
    filename: file.originalname,
    pages: documents.length,
    chunks: chunks.length,
    table: vectorStoreTableName,
  };
}
