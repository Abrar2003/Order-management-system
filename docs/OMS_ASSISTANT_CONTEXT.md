# OMS Assistant: AI Change Context

Use this file when changing the OMS Assistant. It explains the current implementation, its supported behaviour, and the safe place to make each kind of change. Source code is the authority if this file ever disagrees with it. `docs/OMS_ASSISTANT.md` remains the deployment and operations guide; `docs/OMS_SOURCE_TREE.md` is the repository-wide file tree.

The versioned Knowledge Base in `docs/OMS_KNOWLEDGE_BASE.md` is wired into the Assistant as a canonical-first selection layer. Knowledge Base V2 now maps all 74 audited OMS capability groups and is ready for the next capability-execution integration phase. This does **not** mean the Assistant can execute all 74 capabilities: the catalog remains static metadata, and only an explicit server-side adapter registry can execute a capability.

## What it is

OMS Assistant is an authenticated, read-only reporting chat for OMS data. The browser sends a plain-language question to the Express backend. The backend, not the model, owns authentication, permission checks, conversation ownership, rate limiting, database access, validation, audit logging, and every response sent to the browser.

It uses Google Gemini's **Interactions API** through `@google/genai` as a bounded planner and synthesizer. The primary model is `gemini-3.7-flash`. Four backend-owned tools are available: `use_oms_capability` executes allowlisted canonical reports, `inspect_oms_schema` returns catalogue and Knowledge Base metadata without record values, `query_oms_database` runs a validated supplemental aggregation, and `analyze_oms_business_data` runs a strict enum of deterministic lead-time/readiness analyses. Gemini never receives application credentials, cookies, JWTs, database URIs, or direct database access.

```text
React chat page
    -> POST /oms-chat/ask
    -> request trace -> audit -> auth -> oms_assistant.view -> per-user rate limit
    -> controller validates the request body
    -> service resolves entities/date and preselects relevant Knowledge Base capabilities
    -> Gemini Interactions API (only when no deterministic report handles it)
    -> bounded capability/schema/query/analytics investigation loop
    -> validated aggregation on a separate read-only MongoDB connection
    -> backend forecast calculations where requested
    -> answer + bounded supporting rows + factual/forecast metadata
    -> React renders Markdown as text/components, never raw HTML
```

## What users can ask

The assistant is intended for factual OMS reporting, including orders, shipments, items, PIS/barcode state, QC, inspections, samples, brands, and vendors. It can aggregate, count, filter, sort, and make safe bounded lookups. It interprets business dates in `Asia/Kolkata`; "last month" is the previous calendar month.

The common schema catalogue advertises the physical collections `orders`, `items`, `qcs`, `inspections`, `samples`, `brands`, and `vendors`. Other exact non-system collection names are technically readable too. The catalogue is guidance for the model, not a field allow-list: the validator permits safe field paths in readable collections.

Before consulting Gemini, the service resolves question entities against live brand, item, vendor, and order data. This turns matching item descriptions, barcodes, brands, vendor codes/names, order IDs, containers, and common date phrases into explicit context. It asks for clarification when a brand name collides with an item description.

Two report families have programmatic answers instead of relying on model prose:

- Shipment quantity, shipment count, or shipped-order questions that include a resolved brand, item, vendor, PO, or container.
- PO/container CBM breakdown questions mentioning CBM, a PO/order, and a container/stuffing. The service groups shipment rows and uses the existing `shipmentCbmAllocation.service` calculation.

Everything else goes through bounded Gemini tool calling. The model must use validated queries for factual numbers/records and the forecasting service for predictions; it must not invent either.

Forecasting supports historical inspection lead time, open-order readiness, brand-ready CBM, a vendor's likely next shipment readiness, and brand-level vendor comparison for the next container. The vendor forecast requires a resolved vendor; the brand comparison requires a resolved brand. Current ready CBM always comes from the canonical Packed Goods capability; candidate brands/vendors are the union of Packed Goods and open-order evidence. Open POs provide only possible future contribution. The forecast returns the first cumulative date that reaches the configured container target and the written answer distinguishes stored facts, derived arithmetic, forecasts, and unknowns.

The assistant does **not** write OMS data, create reports/files, expose aggregation pipelines, or serve as a bulk export. It returns at most 100 top-level supporting rows, with nested arrays capped at 20 entries. Use the existing OMS export/report routes for full datasets.

## Knowledge-aware canonical-first flow

`searchCapabilities()` ranks V2 catalog entries deterministically, but the current Assistant preselection passes through only `existing_assistant_feature`/`ready` entries. `not_ready`, business-blocked, export/presentation, and unsafe entries are not advertised as executable paths. Only a compact selected subset is included in system instructions; the full 74-capability catalog is never sent on every turn. Search exposes audited ambiguity candidates and separate architectural recommendation/runtime readiness metadata for the next phase.

`backend/services/omsCapabilityExecution.service.js` owns the explicit registry. `packed_goods` calls the same `packedGoods.service.js` builder used by its API and export. `monthly_shipments` calls the existing `monthlyShipmentsReport.service.js`. Both run against models bound to the separate read-only Assistant connection. Adapter filters and operations are allowlisted, grouping/metrics/sorting are server-side, and output is bounded to 100 rows/groups with safe provenance and warnings.

For obvious Packed Goods or Monthly Shipments intent, a raw-query attempt is redirected internally: the canonical adapter runs first, and the model may ask for a raw query only for missing supplemental detail. No-match questions retain the existing schema and raw-Mongo route. Capability results are not cached, so reports retain current application freshness.

Audit/log metadata distinguishes entity-resolution queries, capability calls, raw database tool calls, analytics calls, schema calls, invalid calls, capabilities used, and internal database-operation counts. It never records capability result documents.

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
| Provider | Google Gemini through `@google/genai`; no automatic Groq fallback |
| Model | `gemini-3.7-flash` by default; override with `OMS_CHAT_LLM_MODEL` |
| Model timeout | 90 seconds; transient 429/5xx/network Gemini failures retry up to twice |
| Model investigation | At most 8 tool iterations and 8 total tool calls; at most 2 recoverable analytics corrections and 2 recoverable capability corrections |
| Total database calls | At most 10 including entity resolution; schema inspection uses none |
| Aggregation | Max 12 user stages (including lookup stages), lookup nesting depth 2, max 10,000 skip |
| Database | Separate `OMS_CHAT_MONGO_URI`, 8-second query timeout, `allowDiskUse: false`, 100 returned rows / 128 KiB serialized result |

When a limit is reached after useful evidence was collected, the service removes tools and requests one final best-evidence answer. It marks `partialResults` instead of discarding the completed work.

## Security boundaries that must remain intact

- The frontend permission check only hides/protects the route. The backend route middleware is the security boundary.
- The chat database URI must be different from `MONGO_URI`, select a database, and use a MongoDB user with only `read` access. There is deliberately no fallback to the application connection.
- Denied collections include users, sessions, role/permission data, security logs, assistant state, audit/internal collections, and `system.*`. The definitive list is `DENIED_COLLECTIONS` in `backend/services/omsChatCatalog.service.js`.
- The query validator rejects write stages/commands, JavaScript execution, prototype-pollution keys, dangerous operators, unsafe output names, unknown tool arguments, over-large JSON, and unshaped/raw-document output. Any validator relaxation is a security change, not a harmless capability change.
- The backend appends generated normalization fields such as `__oms_vendor_name`, `__oms_vendor_names`, and `__oms_has_pis_file` after validating model-provided stages. They handle legacy vendor shapes and PIS-file presence; do not expose them as arbitrary client-controlled fields.
- Answers are rejected if they contain provider IDs, tool/pipeline details, prompts, secret environment variable names, or other server-only patterns.
- Security audit records save question text and query summary metadata, but not pipelines, credentials, provider payloads, or result documents.

Every Gemini request explicitly sets `store: false`. `omsAiProvider.service.js` carries the active interaction steps in memory and replays them on each stateless turn, including function calls and any opaque thought steps required for continuity. A final text turn or a valid function-call turn is successful; an interaction response ID is optional in this stateless flow, but every function call must have its provider-issued call ID. Raw steps and reasoning are discarded after the request; only the existing bounded user/assistant text history is persisted by OMS. Local response-schema failures are not retried; only transient upstream/network failures are.

Expected analytics and capability validation errors return compact, safe function results so Gemini can correct an approved request. Capability failures such as unknown ID, non-eligible capability, unsupported filter/group/metric, and excessive limit are recoverable and bounded to two corrections. Invalid tool JSON, unsupported tool names, unsafe raw queries, and non-recoverable execution failures remain fatal.

## Forecast definitions

- A historical lead-time sample is calendar days from PO `order_date` to the first successful `Inspection Done` record for the PO/item. The record must have a positive passed quantity and the order must be inspection-complete, partially shipped, shipped, or otherwise have packed/shipped evidence.
- Rejected, transferred, reworked, zero-pass, negative, future, and over-730-day records are invalid. Multiple valid inspections for one PO/item are de-duplicated to the earliest successful inspection.
- Obvious outliers use the deterministic 1.5×IQR rule. Statistics retain original count, used count, outlier count, median/P50, P75, P90, mean, range, standard deviation, IQR, and recent-12-month median/trend.
- Every fallback level needs at least three samples: same item+vendor, same item across vendors, same product type+vendor, vendor-wide, then available OMS baseline. No unsupported "similar item" relationship is invented.
- Current ready CBM is the grouped result of `packedGoods.service.js`; packed quantity comes from `deriveOrderProgress`, and measurement-based CBM is preferred before the documented stored `total_po_cbm` fallback. Pending inspection quantity can contribute later only when its CBM can be calculated by `shipmentCbmAllocation.service.js` or prorated from stored `total_po_cbm`.
- The brand-level vendor comparison returns each candidate's ready, remaining, and projected CBM; first forecast threshold date; contributing orders; and deterministic confidence/evidence. It uses the same configurable target as all other shipment forecasts.
- Forecast earliest dates use historical median; planning uses the later of historical P75 and effective revised/original ETD; P90 supplies the conservative window end. The container target comes from the request or `OMS_CHAT_CONTAINER_TARGET_CBM`, with a documented 65-CBM fallback.
- Confidence score components are sample depth (35), fallback specificity (30), consistency/dispersion (20), recency (10), and completeness (5). Brand shipment confidence also weights evidence by forecast CBM coverage. High requires score ≥75, at least five samples, and at least 80% evidence coverage; Moderate is ≥50; otherwise Low.

## File map

| Need to change | Primary file(s) | Notes |
| --- | --- | --- |
| Chat page, examples, rendering, metadata/supporting rows | `client/OMS/src/pages/OmsAssistant.jsx` | Uses `react-markdown` + `remark-gfm`; raw HTML is not enabled. |
| Chat UI state | `client/OMS/src/utils/omsAssistantState.js` | In-memory only; refresh starts a new UI conversation. |
| Route and navbar visibility | `client/OMS/src/App.jsx`, `client/OMS/src/components/Navbar.jsx` | Page is lazy-loaded at `/oms-assistant`. |
| HTTP endpoint and safe public errors | `backend/routers/omsChat.routes.js`, `backend/controllers/omsChat.controller.js` | Mounted at both `/oms-chat` and `/api/oms-chat`. |
| Core prompt, entity/date resolution, deterministic reports, conversation loop | `backend/services/omsChat.service.js` | Main behaviour file. |
| Static OMS domains, 74 audited capabilities, definitions, ambiguities, status, and deterministic search | `backend/knowledge/omsKnowledgeBase.*`, `backend/services/omsKnowledgeBase.service.js` | Catalog `2.0.0`; never dynamically executes source metadata. |
| Capability validation, explicit adapters, bounded grouping, and safe provenance | `backend/services/omsCapabilityExecution.service.js` | Only `packed_goods` and `monthly_shipments` have registered capability adapters. |
| Shared Packed Goods canonical dataset | `backend/services/packedGoods.service.js` | Used unchanged by the API, export, Assistant, and forecast input. |
| Gemini initialization, stateless Interactions requests, response normalization, and provider retries/errors | `backend/services/omsAiProvider.service.js` | Always enforces `store: false`; does not access MongoDB. |
| Correlated structured lifecycle/error logs | `backend/services/omsChatLogger.service.js` | Every request uses one `request_id`; logs omit credentials, provider payloads, query pipelines, and result documents. |
| Collection catalogue, Knowledge Base definitions/relationships given to the model | `backend/services/omsChatCatalog.service.js` | Returns no record values or source file paths. |
| Aggregation validation, normalization stages, read-only Mongo connection, result limits | `backend/services/omsChatQuery.service.js` | Treat changes here as security-sensitive. |
| Historical lead-time, confidence, PO readiness, brand CBM timeline, controlled analytics queries | `backend/services/omsForecast.service.js` | Deterministic and reusable; keep model arithmetic out of this path. |
| Conversation TTL/history model | `backend/models/omsChatConversation.model.js` | Stored in the primary application database. |
| Per-user limiter | `backend/middlewares/omsChatRateLimit.middleware.js`, `backend/models/omsChatRateBucket.model.js` | TTL bucket model. |
| Permission module and role lock | `backend/helpers/permissions.js`, `backend/helpers/userRole.js` | `oms_assistant.view` is locked to admin-like roles. |
| Feature tests | `backend/tests/omsCapabilityExecution.test.js`, `backend/tests/omsKnowledgeBase.test.js`, `backend/tests/omsAiProvider.test.js`, `backend/tests/omsChat.test.js`, `backend/tests/omsForecast.test.js`, `client/OMS/src/utils/omsAssistantState.test.js` | Provider mocks never call live Gemini; fixtures prove report/capability/forecast equivalence. |

## How a request is coded

1. `OmsAssistant.jsx` posts `{ message, conversationId? }` with the shared Axios client. It stores the returned server `conversationId` for the next question.
2. `omsChat.routes.js` assigns a request ID, starts ordered JSON lifecycle logging, records audit metadata, authenticates the user, checks `oms_assistant.view`, then rate-limits the request.
3. The controller allows only `message` and `conversationId`, limits the body, maps internal errors to safe public messages/codes, and returns the request ID for log correlation without exposing stacks or provider payloads.
4. `askOmsAssistant()` validates the question/configuration, creates or verifies a user-owned conversation, resolves live entities/date phrases, and preselects a small ranked Knowledge Base subset.
5. If a deterministic shipment/CBM handler applies, it returns its programmatic answer. Otherwise the provider sends Gemini the system instructions, recent text history, resolved context, compact capability context, and four bounded tool definitions with `store: false` and high thinking.
6. The service iterates at most eight times. Canonical capabilities go through the explicit adapter registry; schema arguments are restricted to catalogued business collections; supplemental aggregations go through `executeOmsQuery()`; controlled analytics use the same query executor and canonical Packed Goods readiness.
7. The model receives only safe Knowledge Base/schema metadata, bounded capability/query rows, or compact analysis results. If a clearly canonical question first requests raw MongoDB, the server executes the canonical capability and returns recoverable guidance. If the budget is exhausted, a final turn sets `tool_choice: "none"` so Gemini must synthesize completed evidence.
8. The service saves compact history with optimistic revision checking and returns safe factual/forecast metadata. The page renders the complete answer, optional forecast pills, and optional supporting rows.

## Where to make common changes

| Desired change | Change here | Keep in mind |
| --- | --- | --- |
| Reword the assistant's general behaviour or business definitions | `buildSystemInstructions()` in `omsChat.service.js` | Keep the "read-only, factual answers require tool, do not reveal internals" rules. |
| Add a collection/field/relationship the model should understand | `omsChatCatalog.service.js` and relevant Mongoose model | The catalogue asserts that listed physical fields still exist. Add a test for the report. |
| Add a reliable, repeatable report format | Add a small recognizer/handler near the existing deterministic shipment helpers in `omsChat.service.js` | Reuse `executeOmsQuery`; do not put MongoDB access in the controller or frontend. |
| Make a canonical OMS report Assistant-callable | Classify it in `omsKnowledgeBase.catalog.js`, then add one explicit adapter in `omsCapabilityExecution.service.js` | Reuse/extract the canonical service; never dynamically load a catalog path or import a controller. |
| Change Packed Goods semantics or filters | `packedGoods.service.js` plus controller/capability regression tests | API, export, Assistant, and forecast must keep using the same builder. |
| Change lead-time, confidence, ready-CBM, or shipment forecast rules | `omsForecast.service.js` and `omsForecast.test.js` | Reuse order-status and CBM helpers; add deterministic fixtures before changing the prompt. |
| Add a controlled analytical capability | `ANALYSIS_TYPES`, validator, and runner in `omsForecast.service.js`; tool schema in `omsChat.service.js` | Keep a strict enum and fixed backend-built pipelines. |
| Support more aggregation syntax | `omsChatQuery.service.js` | Add the narrowest validator rule and a rejection/acceptance test. Do not enable writes, JS, raw commands, or unbounded output. |
| Change visible wording, examples, table presentation, or loading state | `OmsAssistant.jsx` | Preserve the 2,000 character client maximum and safe Markdown rendering. |
| Change access or role policy | `permissions.js` / `userRole.js` plus route tests | Do not rely solely on hiding the navbar item. |
| Change request/database/provider limits | Constants in `omsChat.service.js`, `omsChatQuery.service.js`, controller, or limiter middleware | Update this document and tests with the code. |
| Change model/provider configuration or Gemini transport behavior | `omsAiProvider.service.js` | Credentials stay backend-only; no `VITE_` variables. |

## Configuration and verification

The backend needs these production-only environment variables:

```env
GEMINI_API_KEY=<Gemini API key>
OMS_CHAT_LLM_MODEL=gemini-3.7-flash
OMS_CHAT_MONGO_URI=mongodb+srv://oms_chat_reader:<encoded-password>@cluster.example.mongodb.net/OMS?retryWrites=false
OMS_CHAT_CONTAINER_TARGET_CBM=65
```

`OMS_CHAT_LLM_MODEL` is optional. `OMS_CHAT_MONGO_URI` must be a different, read-only credential from the application `MONGO_URI`. Never put any of these in the frontend environment. There is no automatic Groq fallback; transient Gemini errors receive only the bounded same-provider retries described above.

Run the focused checks after assistant work:

```bash
cd backend
node --test tests/omsKnowledgeBase.test.js
node --test tests/omsCapabilityExecution.test.js
node --test tests/omsAiProvider.test.js
node --test tests/omsChat.test.js
node --test tests/omsForecast.test.js
npm test

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
