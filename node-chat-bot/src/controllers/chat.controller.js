import { randomUUID } from "node:crypto";
import { createChatGraph, getChatModel } from "../services/chatGraph.service.js";
import { ingestDocument } from "../services/pdfIngestion.service.js";
import {
  getChatHistory,
  saveChatExchange,
} from "../models/chatHistory.model.js";

const THREAD_COOKIE_NAME = "chat_thread_id";

function getThreadIdFromCookie(req) {
  const cookieHeader = req.get("cookie");
  if (!cookieHeader) {
    return undefined;
  }

  const threadCookie = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${THREAD_COOKIE_NAME}=`));

  if (!threadCookie) {
    return undefined;
  }

  try {
    const threadId = decodeURIComponent(
      threadCookie.slice(THREAD_COOKIE_NAME.length + 1),
    );
    return threadId.length > 0 && threadId.length <= 128
      ? threadId
      : undefined;
  } catch {
    return undefined;
  }
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function startEventStream(res) {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
}

async function streamChatResponse({
  res,
  graph,
  config,
  input,
  threadId,
  model,
}) {
  try {
    const stream = await graph.stream(input, {
      ...config,
      streamMode: ["custom", "updates"],
    });

    for await (const [mode, chunk] of stream) {
      if (res.destroyed) {
        return;
      }

      if (mode === "custom" && typeof chunk?.token === "string") {
        sendEvent(res, "token", { token: chunk.token });
        continue;
      }

    }

    if (res.destroyed) {
      return;
    }

    const { values: result } = await graph.getState(config);
    saveChatExchange(threadId, result.query, result.answer);
    sendEvent(res, "complete", {
      answer: result.answer,
      model: getChatModel(model).model,
      threadId,
      contextMode: result.documentsSatisfied
        ? result.documents.some(
            (document) =>
              document.metadata.documentType &&
              document.metadata.documentType !== "pdf",
          )
          ? "document"
          : "pdf"
        : result.webResults.length > 0
          ? "web"
          : "llm",
      ...(result.documentsSatisfied
        ? {
            chunks: result.documents.map((document) => ({
              source: document.metadata.source || null,
              ...(typeof document.metadata.documentType === "string"
                ? { documentType: document.metadata.documentType }
                : {}),
              ...(Number.isInteger(document.metadata.pageNumber)
                ? { pageNumber: document.metadata.pageNumber }
                : {}),
              ...(typeof document.metadata.sheetName === "string"
                ? { sheetName: document.metadata.sheetName }
                : {}),
              content: document.pageContent,
            })),
          }
        : result.webResults.length > 0
          ? {
              sources: result.webResults.map((item) => ({
                title: item.title,
                url: item.url,
                content: item.content,
              })),
            }
          : {}),
    });
    return res.end();
  } catch (error) {
    console.error("Chat stream failed:", error);
    if (!res.destroyed) {
      sendEvent(res, "error", {
        error: error instanceof Error ? error.message : "Chat request failed.",
      });
      return res.end();
    }
  }
}

export async function uploadDocument(req, res, next) {
  const file =
    req.file ||
    (Buffer.isBuffer(req.body)
      ? {
          buffer: req.body,
          originalname: req.get("x-filename") || "upload.pdf",
        }
      : undefined);

  if (!file) {
    return res.status(400).json({
      error:
        "Upload a PDF, DOCX, CSV, XLS, or XLSX file in the 'file' multipart field. Raw request bodies are supported for PDFs.",
    });
  }

  try {
    const result = await ingestDocument(file);
    return res.status(201).json(result);
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
}

export async function chat(req, res, next) {
  const { query, model, threadId, clientMessageId } = req.body ?? {};

  if (typeof query !== "string" || query.trim().length === 0) {
    return res.status(400).json({
      error: "The 'query' field must be a non-empty string.",
    });
  }

  if (model !== undefined && typeof model !== "string") {
    return res.status(400).json({ error: "The 'model' field must be a string." });
  }

  if (
    threadId !== undefined &&
    (typeof threadId !== "string" ||
      threadId.trim().length === 0 ||
      threadId.length > 128)
  ) {
    return res.status(400).json({
      error: "The 'threadId' field must be a non-empty string of at most 128 characters.",
    });
  }

  if (
    clientMessageId !== undefined &&
    (typeof clientMessageId !== "string" ||
      clientMessageId.length === 0 ||
      clientMessageId.length > 128)
  ) {
    return res.status(400).json({
      error: "The 'clientMessageId' field must be a non-empty string of at most 128 characters.",
    });
  }

  const selectedChatModel = getChatModel(model?.trim());
  if (!selectedChatModel) {
    return res.status(400).json({
      error:
        "Choose 'openai', 'gemini', 'ollama', a gpt-* model, or a gemini-* model.",
    });
  }

  try {
    const conversationId =
      threadId?.trim() || getThreadIdFromCookie(req) || 'user-chat-1';
    const modelChoice =
      model?.trim() || process.env.DEFAULT_CHAT_MODEL || "gpt-4o-mini";
    res.cookie(THREAD_COOKIE_NAME, conversationId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    startEventStream(res);
    if (clientMessageId) {
      sendEvent(res, "user_message", {
        messageId: clientMessageId,
        text: query.trim(),
      });
    }
    const graph = createChatGraph(selectedChatModel);
    const config = { configurable: { thread_id: conversationId } };
    return await streamChatResponse({
      res,
      graph,
      config,
      input: {
        query: query.trim(),
        chatHistory: getChatHistory(conversationId),
        documents: [],
        documentsSatisfied: false,
        requiresWebSearch: false,
        webResults: [],
        answer: "",
      },
      threadId: conversationId,
      model: modelChoice,
    });
  } catch (error) {
    return next(error);
  }
}
