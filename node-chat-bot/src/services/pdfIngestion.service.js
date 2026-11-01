import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import mammoth from "mammoth";
import * as XLSX from "@e965/xlsx";
import { redactSensitiveData } from "../middleware/sensitiveData.middleware.js";
import {
  getVectorStore,
  vectorStoreCollectionName,
} from "../models/vectorStore.model.js";

const DOCUMENT_TYPES = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".csv": "csv",
  ".xls": "excel",
  ".xlsx": "excel",
};

function createBadRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (insideQuotes) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        insideQuotes = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      insideQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      row.push(field);
      if (row.some((cell) => cell.trim())) {
        rows.push(row);
      }
      row = [];
      field = "";
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
    } else {
      field += character;
    }
  }

  if (insideQuotes) {
    throw createBadRequest("The CSV file contains an unterminated quoted field.");
  }

  row.push(field);
  if (row.some((cell) => cell.trim())) {
    rows.push(row);
  }
  return rows;
}

async function loadDocuments(file, extension, documentType) {
  if (documentType === "pdf") {
    const pdf = new Blob([file.buffer], { type: "application/pdf" });
    const loader = new PDFLoader(pdf, { splitPages: true });
    const pages = await loader.load();
    return pages
      .filter((page) => page.pageContent.trim())
      .map((page) => ({
        pageContent: page.pageContent,
        metadata: {
          documentType,
          ...(Number.isInteger(page.metadata.loc?.pageNumber)
            ? { pageNumber: page.metadata.loc.pageNumber }
            : {}),
        },
      }));
  }

  if (documentType === "docx") {
    if (
      file.buffer.length < 30 ||
      !file.buffer
        .subarray(0, 4)
        .equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    ) {
      throw createBadRequest("The uploaded DOCX file is not a valid Word document.");
    }
    let result;
    try {
      result = await mammoth.extractRawText({ buffer: file.buffer });
    } catch {
      throw createBadRequest("Unable to read the DOCX file. Confirm it is a valid Word document.");
    }
    return result.value.trim()
      ? [{ pageContent: result.value, metadata: { documentType } }]
      : [];
  }

  if (documentType === "csv") {
    const rows = parseCsv(file.buffer.toString("utf8").replace(/^\uFEFF/, ""));
    const content = rows.map((cells) => cells.join(" | ")).join("\n");
    return content.trim()
      ? [{ pageContent: content, metadata: { documentType } }]
      : [];
  }

  const isLegacyExcel = extension === ".xls";
  const hasExcelSignature = isLegacyExcel
    ? file.buffer.length >= 8 &&
      file.buffer
        .subarray(0, 8)
        .equals(Buffer.from("D0CF11E0A1B11AE1", "hex"))
    : file.buffer.length >= 30 &&
      file.buffer
        .subarray(0, 4)
        .equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (!hasExcelSignature) {
    throw createBadRequest("The uploaded spreadsheet is not a valid Excel file.");
  }

  let workbook;
  try {
    workbook = XLSX.read(file.buffer, { type: "buffer" });
  } catch {
    throw createBadRequest("Unable to read the Excel file. Confirm it is a valid spreadsheet.");
  }
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
    });
    const pageContent = rows
      .map((row) => row.map((cell) => String(cell)).join(" | "))
      .join("\n");
    return new Document({
      pageContent,
      metadata: { documentType, sheetName },
    });
  }).filter((document) => document.pageContent.trim());
}

export async function ingestDocument(file) {
  const extension = file.originalname
    .slice(file.originalname.lastIndexOf("."))
    .toLowerCase();
  const documentType = DOCUMENT_TYPES[extension];
  if (!documentType) {
    throw createBadRequest(
      "Unsupported file type. Upload a PDF, DOCX, CSV, XLS, or XLSX file.",
    );
  }

  if (documentType === "pdf" && !file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw createBadRequest("The uploaded file is not a valid PDF.");
  }

  const loadedDocuments = await loadDocuments(file, extension, documentType);
  if (loadedDocuments.length === 0) {
    throw createBadRequest(
      documentType === "pdf"
        ? "The PDF contains no readable text."
        : `The ${documentType.toUpperCase()} file contains no readable text.`,
    );
  }

  const source = redactSensitiveData(file.originalname);
  const documents = loadedDocuments.map((document) => ({
    ...document,
    pageContent: redactSensitiveData(document.pageContent),
    metadata: {
      ...document.metadata,
      source,
      ...(typeof document.metadata.sheetName === "string"
        ? { sheetName: redactSensitiveData(document.metadata.sheetName) }
        : {}),
    },
  }));
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  const chunks = await splitter.splitDocuments(documents);
  const pageChunkIndexes = new Map();
  for (const chunk of chunks) {
    const key = `${chunk.metadata.source}:${chunk.metadata.pageNumber ?? chunk.metadata.sheetName ?? "document"}`;
    const chunkIndex = pageChunkIndexes.get(key) || 0;
    chunk.metadata.chunkIndex = chunkIndex;
    pageChunkIndexes.set(key, chunkIndex + 1);
  }
  const vectorStore = await getVectorStore({ createIfMissing: true });

  await vectorStore.addDocuments(chunks);

  return documentType === "pdf"
    ? {
        message: "PDF ingested successfully.",
        filename: source,
        pages: documents.length,
        chunks: chunks.length,
        collection: vectorStoreCollectionName,
        table: vectorStoreCollectionName,
      }
    : {
        message: `${documentType.toUpperCase()} ingested successfully.`,
        filename: source,
        chunks: chunks.length,
        collection: vectorStoreCollectionName,
        table: vectorStoreCollectionName,
      };
}

export const ingestPdf = ingestDocument;
