import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = resolve(
  process.env.CHAT_HISTORY_DB_PATH || "./chat_history.sqlite",
);
const MAX_HISTORY_MESSAGES = 20;

mkdirSync(dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS chat_messages_thread_id_id
    ON chat_messages (thread_id, id);
`);

const insertExchange = database.prepare(`
  INSERT INTO chat_messages (thread_id, role, content)
  VALUES (?, 'user', ?), (?, 'assistant', ?)
`);
const selectRecentMessages = database.prepare(`
  SELECT role, content
  FROM (
    SELECT id, role, content
    FROM chat_messages
    WHERE thread_id = ?
    ORDER BY id DESC
    LIMIT ?
  )
  ORDER BY id ASC
`);

export function getChatHistory(threadId) {
  return selectRecentMessages
    .all(threadId, MAX_HISTORY_MESSAGES)
    .map(({ role, content }) => ({
      role: role === "user" ? "human" : "assistant",
      content,
    }));
}

export function saveChatExchange(threadId, query, answer) {
  insertExchange.run(threadId, query, threadId, answer);
}
