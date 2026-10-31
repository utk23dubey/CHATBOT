PDF RAG Chatbot 

<img width="1860" height="765" alt="image" src="https://github.com/user-attachments/assets/a74feaa8-f102-4f6a-a56c-f21111178835" />


An Express API for chatting with OpenAI, Gemini, or a local Ollama model. Uploaded PDFs are split into searchable chunks . Search in Quadrant for Embeddings. For each chat request, the LangGraph workflow tries the PDF store first, evaluates whether retrieved passages answer the question, then routes unanswered questions either to Tavily web search or directly to the chat model when general knowledge is sufficient.

Requirements
Node.js 22 or newer is recommended.
API keys for the providers you plan to use:
OPENAI_API_KEY for OpenAI chat and PDF-context evaluation.
GOOGLE_API_KEY for Gemini chat.
Ollama installed and running locally for Ollama chat; no API key is required.
TAVILY_API_KEY for web-search fallback.
LANGSMITH_API_KEY to send traces to LangSmith (optional).
Setup
Install the dependencies:

npm install
Copy .env.example to .env in the project root, then set the keys you need. In PowerShell:

Copy-Item .env.example .env
Leave out provider keys you do not use. To use Ollama, start its local service and pull the default model with ollama pull llama3.2:3b; you can set OLLAMA_CHAT_MODEL to a different installed model. TAVILY_API_KEY is required when the graph needs web search. Confirm that configured model IDs are available to your provider account.

LangSmith tracing is enabled by LANGSMITH_TRACING=true. Set LANGSMITH_API_KEY to your LangSmith API key and choose a LANGSMITH_PROJECT name; traces are then sent automatically by LangChain. LANGSMITH_ENDPOINT is optional and is only needed for a non-default LangSmith region. Use the API endpoint (for example, https://apac.api.smith.langchain.com for APAC), not the LangSmith web-app host. Without an API key, LangSmith tracing will not be available.

Start the server:

npm start
The server listens on port 3000 by default, or the port specified by PORT.

To bundle the application source:

npm run build
node dist/index.js
The bundle is written to dist/index.js. Runtime dependencies remain external, so install production dependencies and run the command from the project root (where .env is located).

Keep .env private and do not commit API keys.

LangSmith
After starting the server with LangSmith configured, send a chat request and open the configured project in LangSmith to inspect the trace, including the graph and its model calls. The trace may contain user prompts, conversation history, retrieved PDF excerpts, and model outputs; use an appropriately access-controlled project and avoid sending sensitive data if that is not acceptable.

API
POST /upload
Ingest a PDF into LanceDB. The file can be sent as multipart form data in the file field:

curl -X POST http://localhost:3000/upload \
  -F "file=@./document.pdf"
The endpoint also accepts the raw PDF as the request body; optionally provide its name with the x-filename header. Uploads are limited to 20 MB. The response includes the filename, page and chunk counts, and LanceDB table name.

Ingestion extracts PDF pages, splits their text into chunks of 1,000 characters with 200 characters of overlap, creates local Hugging Face embeddings, and writes the chunks and scalar source/page metadata to LanceDB. The embedding model is downloaded on first use. LanceDB data is stored under LANCEDB_PATH; re-ingest documents if you change the embedding model.

POST /chat
Send a JSON request with a non-empty query. The optional model can be openai, gemini, ollama, a gpt-* model ID, or a gemini-* model ID. Selecting ollama uses llama3.2:3b by default, or the model configured in OLLAMA_CHAT_MODEL. The API returns a threadId and also stores it in an HTTP-only cookie so browser/API clients that retain cookies can continue the same conversation without sending the ID each time. To select a conversation explicitly, send the threadId returned by a previous response.

curl -N -b chat-cookies.txt -c chat-cookies.txt \
  -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"What does the document say about compliance?\",\"model\":\"openai\"}"
If model is omitted, the server uses DEFAULT_CHAT_MODEL. The endpoint responds with Server-Sent Events: after the model finishes generating, a token event contains the full answer, followed by a complete event containing the full answer, selected model, threadId, and contextMode (pdf, web, or llm). PDF-grounded completions include chunks with source and page details; web-grounded completions include Tavily sources. An error event is sent if processing fails after the response begins.

Request flow
The chat graph retrieves candidate chunks from LanceDB. If there are matches, the graph expands them to their full indexed PDF pages and asks an OpenAI evaluator whether the PDF context answers the query. Sufficient context goes to answer generation. Otherwise, the selected chat model classifies whether web search is needed: current or specific external facts go to Tavily, while general questions go directly to the model. The selected OpenAI, Gemini, or Ollama chat model generates the final answer from the chosen context and conversation history.

<img width="2023" height="3383" alt="diagram (4)" src="https://github.com/user-attachments/assets/5ed994b9-207d-48e5-8617-f11d7a285619" />



The same graph is available as a standalone Mermaid chart.

MVC layout
Path	Responsibility
index.js	Loads environment variables and starts the HTTP server.
src/app.js	Configures Express middleware, routes, and error handling.
src/routes/chat.routes.js	Defines the /chat and /upload endpoints and PDF body parsing.
src/controllers/chat.controller.js	Validates requests, invokes services, and formats responses.
src/services/pdfIngestion.service.js	Loads, splits, and ingests PDF pages.
src/services/chatGraph.service.js	Builds the LangGraph workflow and selects chat models.
src/models/vectorStore.model.js	Connects to LanceDB and configures embeddings and page expansion.
src/middleware/errorHandler.js	Converts request errors into HTTP responses.
Notes
The LanceDB database is local and file-backed; a separate vector-database server is not required.
The API keeps conversation history per threadId in memory. The HTTP-only chat_thread_id cookie lasts seven days, but history is shared only by requests handled by the same server process and is cleared when that process restarts. Clients that do not retain cookies should send the returned threadId on each request.
The document-sufficiency check always uses OpenAI when PDF chunks are retrieved, regardless of the answer model. OPENAI_API_KEY is required for this evaluation even if Gemini is selected for answer generation.
