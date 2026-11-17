import "dotenv/config";
import app from "./src/app.js";
import { setupAuthDatabase } from "./src/services/auth.service.js";
import { setupChatMemory } from "./src/services/chatGraph.service.js";

const port = process.env.PORT || 3000;

try {
  await Promise.all([setupChatMemory(), setupAuthDatabase()]);
  app.listen(port, () => {
    console.log(`Chat server listening on port ${port}`);
  });
} catch (error) {
  console.error(
    "Failed to initialize PostgreSQL persistence (chat checkpoints and users):",
    error,
  );
  process.exitCode = 1;
}
