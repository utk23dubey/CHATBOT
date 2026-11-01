import "dotenv/config";
import app from "./src/app.js";
import { setupChatMemory } from "./src/services/chatGraph.service.js";

const port = process.env.PORT || 3000;

try {
  await setupChatMemory();
  app.listen(port, () => {
    console.log(`Chat server listening on port ${port}`);
  });
} catch (error) {
  console.error("Failed to initialize PostgreSQL chat persistence:", error);
  process.exitCode = 1;
}
