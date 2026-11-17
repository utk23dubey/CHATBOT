import "dotenv/config";
import { closeUserPool } from "../models/user.model.js";
import { setupAuthDatabase } from "../services/auth.service.js";

try {
  await setupAuthDatabase();
  console.log("chatbot_users table is ready.");
} catch (error) {
  console.error("Failed to initialize chatbot_users table:", error);
  process.exitCode = 1;
} finally {
  await closeUserPool();
}
