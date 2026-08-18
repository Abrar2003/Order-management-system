# OMS Assistant: AI Change Context

Use this file when changing the OMS Assistant. It explains the current implementation, its supported behaviour, and the safe place to make each kind of change. Source code is the authority if this file ever disagrees with it. `docs/OMS_ASSISTANT.md` remains the deployment and operations guide; `docs/OMS_SOURCE_TREE.md` is the repository-wide file tree.

## What it is

OMS Assistant is an authenticated, read-only reporting chat for OMS data. The browser sends a plain-language question to the Express backend. The backend, not the model, owns authentication, permission checks, conversation ownership, rate limiting, database access, validation, audit logging, and every response sent to the browser.

It uses Groq's OpenAI-compatible **Responses API** with a single tool, `query_oms_database`. Groq can decide which safe aggregation to run and turns the validated result into a concise answer. It never receives application credentials, cookies, JWTs, database URIs, or direct database access.

```text
React chat page
    -> POST /oms-chat/ask
    -> audit -> auth -> oms_assistant.view -> per-user rate limit
    -> controller validates the request body
    -> service resolves entities/date and handles supported deterministic reports
    -> Groq Responses API (only when no deterministic report handles it)
    -> validated aggregation on a separate read-only MongoDB connection
    -> answer + bounded supporting rows + metadata
    -> React renders Markdown as text/components, never raw HTML
```

## What users can ask

The assistant is intended for factual OMS reporting, including orders, shipments, items, PIS/barcode state, QC, inspections, samples, brands, and vendors. It can aggregate, count, filter, sort, and make safe bounded lookups. It interprets business dates in `Asia/Kolkata`; "last month" is the previous calendar month.

The common schema catalogue advertises the physical collections `orders`, `items`, `qcs`, `inspections`, `samples`, `brands`, and `vendors`. Other exact non-system collection names are technically readable too. The catalogue is guidance for the model, not a field allow-list: the validator permits safe field paths in readable collections.

Before consulting Groq, the service resolves question entities against live brand, item, vendor, and order data. This turns matching item descriptions, barcodes, brands, vendor codes/names, order IDs, containers, and common date phrases into explicit context. It asks for clarification when a brand name collides with an item description.

Two report families have programmatic answers instead of relying on model prose:

- Shipment quantity, shipment count, or shipped-order questions that include a resolved brand, item, vendor, PO, or container.
- PO/container CBM breakdown questions mentioning CBM, a PO/order, and a container/stuffing. The service groups shipment rows and uses the existing `shipmentCbmAllocation.service` calculation.

Everything else goes through Groq tool calling. The model must call the tool for factual numbers or records; it must not invent them.

The assistant does **not** write OMS data, create reports/files, expose aggregation pipelines, or serve as a bulk export. It returns at most 100 top-level supporting rows, with nested arrays capped at 20 entries. Use the existing OMS export/report routes for full datasets.

## Runtime behaviour and limits

| Concern | Current behaviour |
| --- | --- |
| Question | Plain text, 1-2,000 characters; whole JSON body capped at 8 KiB |
| Conversation | Server-issued UUID, user-owned, access-fingerprint bound, expires after 24 hours |
| Follow-up context | Last 8 text messages (four user/assistant turns), each capped at 8,000 chars |
| Access fingerprint | SHA-256 of role, QC flag, brand scope, allowed brands, and allowed vendors; a profile/scope change invalidates the old conversation |
| Permissions | Both UI and API require `oms_assistant.view`; manager/admin-like roles are the only roles that can be granted it |
| Scope | After access is granted, assistant business queries are not narrowed to the user's brand/vendor scope |
| Rate limit | 10 requests per user per fixed 5-minute MongoDB bucket, shared across instances |
| Model | `openai/gpt-oss-120b` by default; override with `OMS_CHAT_LLM_MODEL` |
| Model timeout | 90 seconds; transient 429/5xx Groq responses retry up to twice |
| Model tool calls | At most 4 model-requested query calls per question |
| Aggregation | Max 12 user stages (including lookup stages), lookup nesting depth 2, max 10,000 skip |
| Database | Separate `OMS_CHAT_MONGO_URI`, 8-second query timeout, `allowDiskUse: false`, 100 returned rows / 128 KiB serialized result |

Entity resolution performs its own safe queries before a model call. Therefore the "four tool calls" row is specifically the Groq tool-call limit, not a total database-query count for the HTTP request. This is more current than the older two-call wording in `docs/OMS_ASSISTANT.md`.

## Security boundaries that must remain intact

- The frontend permission check only hides/protects the route. The backend route middleware is the security boundary.
- The chat database URI must be different from `MONGO_URI`, select a database, and use a MongoDB user with only `read` access. There is deliberately no fallback to the application connection.
- Denied collections include users, sessions, role/permission data, security logs, assistant state, audit/internal collections, and `system.*`. The definitive list is `DENIED_COLLECTIONS` in `backend/services/omsChatCatalog.service.js`.
- The query validator rejects write stages/commands, JavaScript execution, prototype-pollution keys, dangerous operators, unsafe output names, unknown tool arguments, over-large JSON, and unshaped/raw-document output. Any validator relaxation is a security change, not a harmless capability change.
- The backend appends generated normalization fields such as `__oms_vendor_name`, `__oms_vendor_names`, and `__oms_has_pis_file` after validating model-provided stages. They handle legacy vendor shapes and PIS-file presence; do not expose them as arbitrary client-controlled fields.
- Answers are rejected if they contain provider IDs, tool/pipeline details, prompts, secret environment variable names, or other server-only patterns.
- Security audit records save question text and query summary metadata, but not pipelines, credentials, provider payloads, or result documents.

## File map

| Need to change | Primary file(s) | Notes |
| --- | --- | --- |
| Chat page, examples, rendering, metadata/supporting rows | `client/OMS/src/pages/OmsAssistant.jsx` | Uses `react-markdown` + `remark-gfm`; raw HTML is not enabled. |
| Chat UI state | `client/OMS/src/utils/omsAssistantState.js` | In-memory only; refresh starts a new UI conversation. |
| Route and navbar visibility | `client/OMS/src/App.jsx`, `client/OMS/src/components/Navbar.jsx` | Page is lazy-loaded at `/oms-assistant`. |
| HTTP endpoint and safe public errors | `backend/routers/omsChat.routes.js`, `backend/controllers/omsChat.controller.js` | Mounted at both `/oms-chat` and `/api/oms-chat`. |
| Core prompt, entity/date resolution, deterministic reports, conversation loop | `backend/services/omsChat.service.js` | Main behaviour file. |
| Collection catalogue, business definitions/data relationships given to the model | `backend/services/omsChatCatalog.service.js` | Update this when a model/schema relationship changes. |
| Aggregation validation, normalization stages, read-only Mongo connection, result limits | `backend/services/omsChatQuery.service.js` | Treat changes here as security-sensitive. |
| Conversation TTL/history model | `backend/models/omsChatConversation.model.js` | Stored in the primary application database. |
| Per-user limiter | `backend/middlewares/omsChatRateLimit.middleware.js`, `backend/models/omsChatRateBucket.model.js` | TTL bucket model. |
| Permission module and role lock | `backend/helpers/permissions.js`, `backend/helpers/userRole.js` | `oms_assistant.view` is locked to admin-like roles. |
| Feature tests | `backend/tests/omsChat.test.js`, `client/OMS/src/utils/omsAssistantState.test.js` | Backend tests cover security and report behaviour. |

## How a request is coded

1. `OmsAssistant.jsx` posts `{ message, conversationId? }` with the shared Axios client. It stores the returned server `conversationId` for the next question.
2. `omsChat.routes.js` logs success/failure metadata, authenticates the user, checks `oms_assistant.view`, then rate-limits the request.
3. The controller allows only `message` and `conversationId`, limits the body, maps internal errors to safe public messages, and removes internal audit data from the HTTP response.
4. `askOmsAssistant()` validates the question/configuration, creates or verifies a user-owned conversation, then resolves live entities and simple date phrases.
5. If a deterministic shipment/CBM handler applies, it returns its programmatic answer. Otherwise Groq receives the system instructions, recent text-only history, current question, resolved context, and the one read-only tool definition.
6. Each tool call is parsed from JSON and executed by `executeOmsQuery()`. The model gets only returned rows and safe metadata, then gives its final answer.
7. The service saves the compact conversation history with optimistic revision checking, merges bounded rows/metadata, and returns the response. The page renders the answer and optionally expandable supporting rows.

## Where to make common changes

| Desired change | Change here | Keep in mind |
| --- | --- | --- |
| Reword the assistant's general behaviour or business definitions | `buildSystemInstructions()` in `omsChat.service.js` | Keep the "read-only, factual answers require tool, do not reveal internals" rules. |
| Add a collection/field/relationship the model should understand | `omsChatCatalog.service.js` and relevant Mongoose model | The catalogue asserts that listed physical fields still exist. Add a test for the report. |
| Add a reliable, repeatable report format | Add a small recognizer/handler near the existing deterministic shipment helpers in `omsChat.service.js` | Reuse `executeOmsQuery`; do not put MongoDB access in the controller or frontend. |
| Support more aggregation syntax | `omsChatQuery.service.js` | Add the narrowest validator rule and a rejection/acceptance test. Do not enable writes, JS, raw commands, or unbounded output. |
| Change visible wording, examples, table presentation, or loading state | `OmsAssistant.jsx` | Preserve the 2,000 character client maximum and safe Markdown rendering. |
| Change access or role policy | `permissions.js` / `userRole.js` plus route tests | Do not rely solely on hiding the navbar item. |
| Change request/database/provider limits | Constants in `omsChat.service.js`, `omsChatQuery.service.js`, controller, or limiter middleware | Update this document and tests with the code. |
| Change model/provider configuration | `getGroqConfiguration()` and `createResponse()` in `omsChat.service.js` | Credentials stay backend-only; no `VITE_` variables. |

## Configuration and verification

The backend needs these production-only environment variables:

```env
GROQ_API_KEY=<Groq API key>
OMS_CHAT_LLM_MODEL=openai/gpt-oss-120b
OMS_CHAT_MONGO_URI=mongodb+srv://oms_chat_reader:<encoded-password>@cluster.example.mongodb.net/OMS?retryWrites=false
```

`OMS_CHAT_LLM_MODEL` is optional. `OMS_CHAT_MONGO_URI` must be a different, read-only credential from the application `MONGO_URI`. Never put any of these in the frontend environment.

Run the focused checks after assistant work:

```bash
cd backend
node --test tests/omsChat.test.js

cd ../client/OMS
node --test src/utils/omsAssistantState.test.js
npm run build
```

For database-user creation, deployment, and production smoke checks, use `docs/OMS_ASSISTANT.md`; do not copy real credentials or returned production data into prompts, tests, or logs.

## Practical change checklist

1. Identify whether the request is UI, prompt/catalogue, deterministic-report, validator, access, or operational configuration work.
2. Keep the change in the owning file listed above. Do not bypass the service/query layer with a new frontend database/report path.
3. For any new business calculation, state its assumptions and add a focused assertion in `backend/tests/omsChat.test.js`.
4. Preserve read-only isolation, server-owned conversations, bounded results, and public-error redaction.
5. Update this file only when the implementation contract changes; update `docs/OMS_ASSISTANT.md` when operations/deployment changes.
