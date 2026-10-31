import express from "express";
import chatRoutes from "./routes/chat.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import cors from "cors";

const app = express();
app.use(cors());

app.use((req, res, next) => {
  if (req.path === "/upload") {
    return next();
  }

  return express.json()(req, res, next);
});

app.use("/", chatRoutes);
app.use(errorHandler);

export default app;
