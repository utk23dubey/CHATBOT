# PDF RAG Chatbot

An Express API for chatting with OpenAI, Gemini, or a local Ollama model. Uploaded documents are split into searchable chunks and stored in Qdrant Cloud with dense semantic and sparse keyword vectors. For each chat request, the LangGraph workflow retrieves hybrid candidates, optionally reranks them, evaluates whether the retrieved passages answer the question, then routes unanswered questions either to Tavily web search or directly to the chat model when general knowledge is sufficient.

## Requirements

- Node.js 22.13 or newer is recommended.
- API keys for the providers you plan to use:
  - `OPENAI_API_KEY` for OpenAI chat and PDF-context evaluation.
  - `GOOGLE_API_KEY` for Gemini chat.
  - Ollama installed and running locally for Ollama chat; no API key is required.
  - `TAVILY_API_KEY` for web-search fallback.
  - `QDRANT_URL` and `QDRANT_API_KEY` for Qdrant Cloud vector storage.
  - `DATABASE_URL` for PostgreSQL-backed LangGraph checkpoints, chat history, and the dedicated `chatbot_users` auth table.
  - `JWT_SECRET` for signing authentication tokens; generate a long random value and keep it private.
  - `LANGSMITH_API_KEY` to send traces to LangSmith (optional).

## Setup

1. Install the dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` in the project root, then set the keys you need. In PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

   Leave out provider keys you do not use. Set `QDRANT_URL` and `QDRANT_API_KEY` from your Qdrant Cloud cluster, and optionally set `QDRANT_COLLECTION`. To use Ollama, start its local service and pull the default model with `ollama pull llama3.2:3b`; you can set `OLLAMA_CHAT_MODEL` to a different installed model. `TAVILY_API_KEY` is required when the graph needs web search. Confirm that configured model IDs are available to your provider account.

    Set `DATABASE_URL` to your PostgreSQL connection URL in the form `postgresql://USER:PASSWORD@HOST:5432/DATABASE`. Replace the example password with the real database password; URL-encode special characters in the username or password (for example, `@` as `%40`).

   Set `JWT_SECRET` to a long random value used to sign authentication tokens (for example, generate one with `openssl rand -base64 48`). `JWT_EXPIRES_IN` sets the token lifetime and defaults to `7d` when omitted. Keep `JWT_SECRET` private; changing it invalidates all previously issued tokens. The dedicated `chatbot_users` table is created automatically at startup; to initialize it without starting the server, run `npm run db:init-users`. An unrelated pre-existing `users` table is neither used nor modified by this app, and any rows in an old `users` table are NOT migrated — those accounts must be recreated through `/register`.

   LangSmith tracing is enabled by `LANGSMITH_TRACING=true`. Set `LANGSMITH_API_KEY` to your LangSmith API key and choose a `LANGSMITH_PROJECT` name; traces are then sent automatically by LangChain. `LANGSMITH_ENDPOINT` is optional and is only needed for a non-default LangSmith region. Use the API endpoint (for example, `https://apac.api.smith.langchain.com` for APAC), not the LangSmith web-app host. Without an API key, LangSmith tracing will not be available.

3. If you have existing vectors in LanceDB, migrate the active table before starting the API:

   ```sh
   npm run migrate:lancedb
   ```

   `LANCEDB_PATH` and `LANCEDB_TABLE` select the source, defaulting to `./lancedb_data` and `pdf_documents_hf_minilm`. The source vectors must have the same dimensions as `HUGGINGFACE_EMBEDDING_MODEL`; the migration preserves their embeddings and page metadata. The script can be rerun safely. Keep the LanceDB files until you have verified the migrated collection.

4. If `QDRANT_COLLECTION` already contains documents, backfill it into the hybrid collection before switching to hybrid retrieval. Skip this step when starting with an empty Qdrant collection:

   ```sh
   npm run migrate:qdrant-hybrid
   ```

   This step is safe to rerun and verifies that the hybrid collection contains at least as many points as the dense source.

5. Start the server:

   ```sh
   npm start
   ```

   The server listens on port `3000` by default, or the port specified by `PORT`.

6. To bundle the application source:

   ```sh
   npm run build
   node dist/index.js
   ```

   The bundle is written to `dist/index.js`. Runtime dependencies remain external, so install production dependencies and run the command from the project root (where `.env` is located).

Keep `.env` private and do not commit API keys.

### LangSmith

After starting the server with LangSmith configured, send a chat request and open the configured project in LangSmith to inspect the trace, including the graph and its model calls. The trace may contain user prompts, conversation history, retrieved PDF excerpts, and model outputs; use an appropriately access-controlled project and avoid sending sensitive data if that is not acceptable.

## API

`/chat` and `/upload` are protected: every request must include an `Authorization: Bearer <token>` header with the JWT returned by `/login`. Missing, expired, or invalid tokens receive `401`. Registration and login are public. All errors use the JSON shape `{ "error": "<human-readable message>" }`.

### `POST /register`

Creates a user account. `name`, `password`, `email`, `mobileNumber`, and `country` are required strings. Any `role` value supplied by the client is ignored: public registration always creates a regular user with the `"user"` role. Elevated roles must be assigned through a separate administrative process, never through this endpoint. Passwords must be 8–128 characters, are hashed with bcrypt before storage, and are never logged or returned. Email addresses are trimmed, lowercased, and must be unique.

```sh
curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Ada Lovelace\",\"email\":\"ada@example.com\",\"password\":\"correct-horse-battery\",\"mobileNumber\":\"+15551234567\",\"country\":\"US\"}"
```

Success (`201`):

```json
{
  "user": {
    "id": 1,
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "role": "user",
    "mobileNumber": "+15551234567",
    "country": "US"
  }
}
```

Validation errors return `400`; a duplicate email returns `409`.

### `POST /login`

Verifies the password and issues a signed JWT.

```sh
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"ada@example.com\",\"password\":\"correct-horse-battery\"}"
```

Success (`200`):

```json
{
  "token": "<signed JWT>",
  "user": {
    "id": 1,
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "role": "user",
    "mobileNumber": "+15551234567",
    "country": "US"
  }
}
```

Invalid credentials return `401`. Send the token on protected endpoints as `Authorization: Bearer <token>`; it expires after `JWT_EXPIRES_IN` (default `7d`).

### `POST /upload`

Ingest a PDF, DOCX, CSV, XLS, or XLSX file into the configured Qdrant collection. Send the file as multipart form data in the `file` field:

```sh
curl -X POST http://localhost:3000/upload \
  -H "Authorization: Bearer $JWT" \
  -F "file=@./document.pdf"
```

The endpoint also accepts a raw PDF as the request body; optionally provide its name with the `x-filename` header. Raw request bodies are supported only for PDFs. Uploads are limited to 20 MB. PDF responses retain the filename, page and chunk counts, and Qdrant collection name; other formats return the filename, chunk count, and collection name.

Ingestion extracts PDF pages, DOCX text, CSV rows, and Excel workbook sheets. Text is split into chunks of 1,000 characters with 200 characters of overlap. Each chunk is stored in both the existing dense-only collection (`QDRANT_COLLECTION`) and a hybrid collection (`QDRANT_HYBRID_COLLECTION`) with source and document metadata. The hybrid collection stores the existing Hugging Face dense embedding plus a deterministic sparse keyword vector; Qdrant's IDF modifier weights sparse terms. Both collections are dual-written so `QDRANT_SEARCH_MODE=dense` remains an immediate rollback option. PDF page metadata and page expansion are preserved; non-PDF files are retrieved as indexed chunks. New embeddings and the optional reranker model download on first use.

Hybrid retrieval prefetches dense and sparse matches from the hybrid collection and fuses them using Qdrant Reciprocal Rank Fusion (RRF). If the hybrid collection does not exist yet, retrieval temporarily falls back to the existing dense collection. Backfill existing points before enabling hybrid results:

```sh
npm run migrate:qdrant-hybrid
```

The backfill reads all payloads from `QDRANT_COLLECTION`, re-embeds the text, and upserts matching point IDs into `QDRANT_HYBRID_COLLECTION`. It is safe to rerun. Keep the dense collection until hybrid results have been evaluated. Configure candidate and final result counts with `QDRANT_RETRIEVAL_CANDIDATES` (default 24) and `QDRANT_RETRIEVAL_LIMIT` (default 8).

Optional cross-encoder reranking runs after RRF and before PDF page expansion. Set `RERANKER_MODEL` to a compatible Hugging Face sequence-classification cross-encoder (for example, `Xenova/ms-marco-MiniLM-L-6-v2`); its model files download on first use. `RERANKER_CANDIDATES` controls the maximum number of fused candidates scored (default 24). Leave `RERANKER_MODEL` empty to disable reranking. Set `QDRANT_SEARCH_MODE=dense` to roll back retrieval without changing stored data.

Conversation state is persisted by LangGraph's PostgreSQL checkpointer using `DATABASE_URL`. The server creates or migrates the checkpointer tables at startup. The latest 20 user/assistant messages per thread are retained as model context, including across server restarts. Chat text is redacted before it is stored in the checkpoint history. Existing data in `chat_history.sqlite` is left untouched but is not automatically imported.

Chat queries, extracted document text, and document filenames are redacted for common email, phone, government-ID, payment-card, medical-ID, date-of-birth, labeled name, and labeled address patterns before model use or persistence. This pattern-based filtering is a safeguard, not complete PHI detection or a guarantee of HIPAA compliance; review redacted output and do not send data that must not be processed.

### `POST /chat`

Send a JSON request with a non-empty `query`. The optional `model` can be `openai`, `gemini`, `ollama`, a `gpt-*` model ID, or a `gemini-*` model ID. Selecting `ollama` uses `llama3.2:3b` by default, or the model configured in `OLLAMA_CHAT_MODEL`. The API returns a `threadId` and also stores it in an HTTP-only cookie so browser/API clients that retain cookies can continue the same conversation without sending the ID each time. To select a conversation explicitly, send the `threadId` returned by a previous response.

```sh
curl -N -b chat-cookies.txt -c chat-cookies.txt \
  -X POST http://localhost:3000/chat \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"What does the document say about compliance?\",\"model\":\"openai\"}"
```

If `model` is omitted, the server uses `DEFAULT_CHAT_MODEL`. The endpoint responds with Server-Sent Events: `token` events stream generated text, followed by a `complete` event containing the full `answer`, selected `model`, `threadId`, and `contextMode` (`pdf`, `document`, `web`, or `llm`). Document-grounded completions include `chunks` with source and page details; web-grounded completions include Tavily `sources`. An `error` event is sent if processing fails after the response begins.

## Request flow

The chat graph retrieves dense semantic and sparse keyword candidates from the hybrid Qdrant collection and fuses them with Reciprocal Rank Fusion. If configured, a local cross-encoder reranks the candidates. Retrieved PDF chunks expand to their full indexed pages before an OpenAI evaluator checks whether the document context answers the query. Sufficient context goes to answer generation. Otherwise, explicit web-search requests and clearly time-sensitive topics such as weather, temperatures, current prices, and latest news route directly to Tavily; the selected chat model classifies other queries. General questions go directly to the model. The selected OpenAI, Gemini, or Ollama chat model generates the final answer from the chosen context and conversation history.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#f2f0ff', 'primaryTextColor': '#000000', 'secondaryTextColor': '#000000', 'tertiaryTextColor': '#000000', 'lineColor': '#000000', 'primaryBorderColor': '#000000'}}}%%
flowchart TD
    START([Start]) --> RETRIEVE[Retrieve PDF chunks from Qdrant]
    RETRIEVE --> HAS_DOCS{Any chunks found?}
    HAS_DOCS -- No --> ROUTE{Needs web search?}
    HAS_DOCS -- Yes --> EVALUATE[Evaluate PDF context with OpenAI]
    EVALUATE --> SUFFICIENT{Enough to answer?}
    SUFFICIENT -- Yes --> PDF_ANSWER[Generate answer from PDF context]
    SUFFICIENT -- No --> ROUTE
    ROUTE -- Yes --> WEB[Search the web with Tavily]
    ROUTE -- No --> LLM_ANSWER[Generate answer from general knowledge]
    WEB --> WEB_ANSWER[Generate answer from web results]
    PDF_ANSWER --> END([Return answer and PDF chunks])
    WEB_ANSWER --> WEB_END([Return answer and web sources])
    LLM_ANSWER --> LLM_END([Return direct answer])
```

The same graph is available as a standalone [Mermaid chart](./langgraph.mmd).

## MVC layout

| Path | Responsibility |
| --- | --- |
| `index.js` | Loads environment variables and starts the HTTP server. |
| `src/app.js` | Configures Express middleware, auth/chat routes, and error handling. |
| `src/routes/auth.routes.js` | Defines the public `/register` and `/login` endpoints. |
| `src/controllers/auth.controller.js` | Validates registration/login input and formats safe user responses. |
| `src/services/auth.service.js` | Hashes/verifies passwords with bcrypt, signs/verifies JWTs, and initializes the `chatbot_users` table. |
| `src/models/user.model.js` | Owns the dedicated PostgreSQL `chatbot_users` table with idempotent setup, a schema check, and user queries. |
| `src/middleware/auth.middleware.js` | Requires a valid Bearer token on protected routes. |
| `src/scripts/initUsersTable.js` | Creates the `chatbot_users` table without starting the server (`npm run db:init-users`). |
| `src/routes/chat.routes.js` | Defines the protected `/chat` and `/upload` endpoints and PDF body parsing. |
| `src/controllers/chat.controller.js` | Validates requests, invokes services, and formats responses. |
| `src/services/pdfIngestion.service.js` | Loads, splits, and ingests supported document formats. |
| `src/models/vectorStore.model.js` | Connects to dense and hybrid Qdrant collections; creates sparse vectors and performs RRF retrieval. |
| `src/services/reranker.service.js` | Optionally reranks hybrid candidates with a local cross-encoder. |
| `src/scripts/migrateLanceDbToQdrant.js` | Migrates the configured LanceDB table into Qdrant Cloud. |
| `src/scripts/migrateQdrantToHybrid.js` | Backfills existing dense Qdrant points into the hybrid collection. |
| `src/services/chatGraph.service.js` | Builds the LangGraph workflow and persists thread state with the PostgreSQL checkpointer. |
| `src/middleware/errorHandler.js` | Converts request errors into HTTP responses. |

## Notes

- LanceDB is used only as a migration source; the application stores and searches document vectors in Qdrant Cloud.
- User credentials are stored as bcrypt hashes in the dedicated PostgreSQL `chatbot_users` table (created idempotently at startup, with a schema check that fails clearly if that name is taken by an incompatible table). JWTs are signed with `JWT_SECRET` and sent as Bearer tokens; never log passwords or tokens. A pre-existing `users` table is never read, written, or migrated; old rows there are not imported.
- Chat history is persisted per `threadId` by the PostgreSQL checkpointer. The HTTP-only `chat_thread_id` cookie lasts seven days; clients that do not retain cookies should send the returned `threadId` on each request. Protect the PostgreSQL database and its backups as sensitive data.
- The document-sufficiency check always uses OpenAI when PDF chunks are retrieved, regardless of the answer model. `OPENAI_API_KEY` is required for this evaluation even if Gemini is selected for answer generation.
