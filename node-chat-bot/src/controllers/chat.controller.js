import { randomUUID } from "node:crypto";
import { createChatGraph, getChatModel } from "../services/chatGraph.service.js";
import { ingestPdf } from "../services/pdfIngestion.service.js";

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

export async function uploadPdf(req, res, next) {
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
        "Upload a PDF as the 'file' multipart field or send the raw PDF as the request body.",
    });
  }

  if (!file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    return res.status(400).json({ error: "The uploaded file is not a valid PDF." });
  }

  try {
    const result = await ingestPdf(file);
    return res.status(201).json(result);
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
}

export async function chat(req, res, next) {
  const { query, model, threadId } = req.body ?? {};

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
    res.cookie(THREAD_COOKIE_NAME, conversationId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    try {
      const graph = createChatGraph(selectedChatModel);
      const config = { configurable: { thread_id: conversationId } };
      const stream = await graph.stream(
        {
          query: query.trim(),
          documents: [],
          documentsSatisfied: false,
          webResults: [],
          answer: "",
        },
        { ...config, streamMode: "custom" },
      );

      for await (const chunk of stream) {
        if (res.destroyed) {
          break;
        }

        if (typeof chunk?.token === "string" && chunk.token.length > 0) {
          sendEvent(res, "token", { token: chunk.token });
        }
      }

      if (res.destroyed) {
        return;
      }

      const { values: result } = await graph.getState(config);
      sendEvent(res, "complete", {
        answer: result.answer,
        model: selectedChatModel.model,
        threadId: conversationId,
        contextMode: result.documentsSatisfied
          ? "pdf"
          : result.webResults.length > 0
            ? "web"
            : "llm",
        ...(result.documentsSatisfied
          ? {
              chunks: result.documents.map((document) => ({
                source: document.metadata.source || null,
                ...(Number.isInteger(document.metadata.pageNumber)
                  ? { pageNumber: document.metadata.pageNumber }
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
  } catch (error) {
    return next(error);
  }
}
