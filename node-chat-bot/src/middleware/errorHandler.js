import multer from "multer";

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: error.message });
  }

  if (error.type === "entity.too.large") {
    return res
      .status(413)
      .json({ error: "The uploaded file exceeds the 20 MB limit." });
  }

  console.error("Request failed:", error);
  return res.status(error.status || 500).json({
    error: error instanceof Error ? error.message : "Request failed.",
  });
}
