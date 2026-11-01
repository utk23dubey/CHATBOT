import express from "express";
import multer from "multer";
import { chat, uploadDocument } from "../controllers/chat.controller.js";
import { redactChatQuery } from "../middleware/sensitiveData.middleware.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.post(
  "/upload",
  (req, res, next) => {
    if (req.is("multipart/form-data")) {
      return next();
    }

    return express.raw({
      type: () => true,
      limit: "20mb",
    })(req, res, next);
  },
  upload.single("file"),
  uploadDocument,
);

router.post("/chat", redactChatQuery, chat);

export default router;
