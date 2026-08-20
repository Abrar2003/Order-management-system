# OMS Assistant

OMS Assistant is an authenticated, read-only chat interface for questions across OMS business data. It uses Google Gemini's Interactions API through `@google/genai` for interpretation and answer generation, while the backend retains control of authentication, write prevention, query validation, execution, conversation ownership, and auditing. The default model is `gemini-3.7-flash`.

## Security and data flow

1. An authenticated browser sends a plain-text question and, for a follow-up, a server-issued `conversationId`.
2. The backend verifies the `oms_assistant.view` permission and applies a per-user rate limit.
3. The backend sends the question and a curated OMS schema catalogue to Gemini. It never sends cookies, JWTs, authorization headers, database URIs, API keys, or unrestricted user records.
4. Gemini can request backend-generated schema metadata, a general read-only aggregation, or one of the approved deterministic business analyses.
5. The backend recursively validates database requests and executes them through `OMS_CHAT_MONGO_URI`; schema inspection never reads records.
6. The bounded loop can investigate in several steps. Forecast arithmetic remains in backend code, while Gemini plans and summarizes the validated evidence.
7. The browser receives the answer, compact factual/forecast metadata, and optional supporting rows. It never receives aggregation pipelines, hidden reasoning, or provider response IDs.

All fields in OMS business collections are readable. The schema catalogue advertises the common collections `orders`, `items`, `qcs`, `inspections`, `samples`, `brands`, and `vendors`; other non-system collections can be queried by exact name. Authentication, users, role permissions, sessions, security logs, assistant state, audit internals, and MongoDB system collections remain denied.

The validator accepts aggregation only. It rejects writes, raw commands, JavaScript execution, prototype-pollution keys, unsafe collection/field names, and unsupported stages/operators. `$lookup` pipelines receive the same recursive write-safety validation. The enforced ceilings are:

- 12 model-generated aggregation stages, including nested stages
- 100 returned rows
- 20 entries per nested/supporting result array (aggregate counts/groups should run before this cap)
- 8 seconds of MongoDB execution time
- `allowDiskUse: false`
- at most 8 model tool iterations and 8 model-requested tool calls
- at most 10 database calls including bounded server-side entity resolution (schema inspection does not consume a database call)
- bounded question and generated-pipeline sizes
- an overall abort timeout for Gemini calls, with at most two retries for transient rate limits, network failures, and upstream 5xx responses

`backend/services/omsAiProvider.service.js` is the only Gemini-specific layer. It uses `ai.interactions.create`, forces `store: false` on every request, translates OMS tool declarations and results, normalizes Gemini output, and maps SDK failures to provider-independent safe categories. The active stateless loop replays the complete in-request Gemini step history required for function calling, but never persists raw steps or hidden reasoning. OMS remains the authority for bounded cross-request conversation history. High thinking is used and thinking summaries are disabled. There is no automatic Groq fallback.

Dates are interpreted in `Asia/Kolkata`. “Last month” means the previous calendar month, not the previous 30 days. Business definitions and legacy aliases in the schema catalogue are based on the Mongoose models; for example, missing PIS barcode reports account for packaging mode, the legacy/master barcode aliases, and `barcode_exempted`.

## Deterministic forecasting

`analyze_oms_business_data` exposes a strict analysis enum for historical inspection lead time, open-order inspection dates, ready CBM by brand, vendor next-shipment readiness, and brand-level next-container vendor comparison. The vendor forecast requires a vendor; the brand comparison derives and ranks vendors from open orders for the resolved brand. `omsForecast.service.js` owns all calculations; the model cannot invent dates, confidence percentages, or CBM formulas.

Historical lead time is the calendar-day difference between PO order date and the first successful completed inspection for the same PO/item. Evidence requires a completed/packed/shipped order state and a positive passed quantity. Rejected, transferred, reworked, zero-pass, future, negative, and over-two-year samples are excluded. Severe outliers use the 1.5×IQR rule and are counted in metadata rather than silently disappearing.

The fallback order is: same item and vendor, same item across vendors, same product type and vendor, vendor-wide history, then the available OMS baseline. Each level requires at least three valid samples. Statistics include mean, median/P50, P75, P90, min/max, standard deviation, IQR, outlier count, and recent-12-month median/trend.

Shipment readiness is calculated separately per brand. Current ready CBM is inspected/passed but unshipped quantity, using the existing packaging-aware CBM service and stored PO CBM fallback. Open quantities are forecast with historical lead time and effective revised/original ETD; P75 is the planning date and P90 supplies the conservative window end. The service accumulates CBM by date until the configurable target is reached. If no target is supplied, `OMS_CHAT_CONTAINER_TARGET_CBM` is used, defaulting to 65 CBM.

Confidence is deterministic: sample depth, fallback specificity, historical dispersion, recency, missing evidence, and CBM evidence coverage contribute to the score. Labels are High, Moderate, or Low; High additionally requires at least five samples and strong evidence coverage. A readiness forecast is not a promise that a container will actually depart.

## API contract

The router is mounted at both prefixes used by this project:

```text
POST /oms-chat/ask
POST /api/oms-chat/ask
```

The frontend's shared API client normally calls `/oms-chat/ask`; nginx or the API base URL determines whether the public request uses the `/api` alias.

Request:

```json
{
  "message": "How many containers were shipped last month?",
  "conversationId": "optional server-issued identifier"
}
```

Successful response:

```json
{
  "success": true,
  "answer": "Concise answer based on the query result.",
  "conversationId": "server-issued identifier",
  "metadata": {
    "dateRange": {
      "start": "2026-05-31T18:30:00.000Z",
      "end": "2026-06-30T18:30:00.000Z",
      "timezone": "Asia/Kolkata"
    },
    "filters": {},
    "returnedRows": 0,
    "truncated": false,
    "answerType": "forecast",
    "analysisType": "vendor_next_shipment_forecast",
    "confidence": { "label": "moderate", "score": 68 },
    "forecast": {
      "earliestDate": "2026-09-05",
      "planningDate": "2026-09-08",
      "windowStart": "2026-09-05",
      "windowEnd": "2026-09-12"
    },
    "evidence": {
      "historicalSampleCount": 8,
      "leadTimeSource": "same_item_same_vendor"
    },
    "partialResults": false,
    "toolCallCount": 1
  },
  "rows": []
}
```

`dateRange` and `filters` may be empty when they do not apply. `rows` contains no more than 100 supporting records. Answers and rows are rendered as text/React data, never as model-provided HTML.
When a comparison spans multiple date windows or tool calls, `dateRange` is the outer coverage envelope; the answer can still name the individual periods.

Invalid input, authentication, permission, rate-limit, configuration, upstream, validation, and timeout failures return a non-2xx response with a safe message. An expected analytics input mismatch is returned only to Gemini as a bounded safe function result so it can correct its analysis choice; unsafe tool requests and execution failures still fail the request. Responses do not include provider payloads, credentials, internal pipelines, stack traces, or another user's conversation state. A missing or foreign `conversationId` is not accepted as a continuation.

Conversation state also stores a one-way fingerprint of the owner’s current role and profile scope. A profile change invalidates the old continuation so stale context is not reused.

## Permission and user data scope

Both the page and API require:

```text
oms_assistant.view
```

The frontend check only controls navigation and routing; the backend permission middleware is the security boundary. Effective permissions come from the existing role-permission service and can be managed through the OMS permission-management screen/API.

The `oms_assistant.view` permission controls access to the assistant itself. Once granted, assistant queries are not narrowed by the user's application brand or vendor scope; the dedicated MongoDB credential remains read-only.

## Backend-only environment variables

Set the key and read-only database URI in `backend/.env.production`. The model override is optional:

```env
GEMINI_API_KEY=<secret Gemini API key>
OMS_CHAT_LLM_MODEL=gemini-3.7-flash
OMS_CHAT_MONGO_URI=mongodb+srv://oms_chat_reader:<percent-encoded-password>@cluster.example.mongodb.net/OMS?retryWrites=false
OMS_CHAT_CONTAINER_TARGET_CBM=65
```

Requirements:

- Do not prefix these names with `VITE_` or place them in `client/OMS/.env.production`.
- `OMS_CHAT_MONGO_URI` must use a separate database user with only the built-in `read` role on the OMS database.
- `OMS_CHAT_CONTAINER_TARGET_CBM` is optional and must be a positive CBM value; 65 is the documented fallback when no formal target is configured.
- It must not reuse the application credential or `MONGO_URI`. The backend has no fallback to `MONGO_URI`.
- The URI must select the intended OMS database. Percent-encode reserved characters in the password.
- Keep `backend/.env.production` outside source control with mode `600` on the VPS.

The application connection may store server-owned conversation ownership/state and security audit metadata. That does not grant the assistant query tool write access to OMS business collections; all business-data queries use the separate read-only connection.

## Create the read-only MongoDB user

Use a database administrator session that is separate from both application credentials. Replace `OMS` only if the production database has a different exact, case-sensitive name.

### MongoDB Atlas

In Atlas, open **Security > Database Access**, add a new password user named `oms_chat_reader`, and grant one **Specific Privilege**:

| Role | Database |
|---|---|
| `read` | `OMS` |

Do not grant `readWrite`, `readAnyDatabase`, Atlas admin, or a project role. Restrict Atlas network access to the VPS egress IP, generate a separate strong password, and construct an SRV URI whose path is `/OMS`.

### Self-managed MongoDB

Connect as a user allowed to manage users, then run:

```javascript
use admin
db.createUser({
  user: "oms_chat_reader",
  pwd: passwordPrompt(),
  roles: [
    { role: "read", db: "OMS" }
  ]
})
```

Use a URI such as:

```text
mongodb://oms_chat_reader:<percent-encoded-password>@mongo.example.net:27017/OMS?authSource=admin&retryWrites=false
```

If the user already exists, inspect and correct its grants rather than creating a duplicate:

```javascript
use admin
db.updateUser("oms_chat_reader", {
  roles: [
    { role: "read", db: "OMS" }
  ]
})
```

## Verify the database credential

Export the URI only in the administrative shell used for this check; do not paste it into tickets, logs, or chat:

```bash
read -rsp "OMS chat Mongo URI: " OMS_CHAT_MONGO_URI
export OMS_CHAT_MONGO_URI
echo
```

Confirm an approved read succeeds:

```bash
mongosh "$OMS_CHAT_MONGO_URI" --quiet --eval \
  'const row = db.orders.findOne({}, {_id: 1, order_id: 1}); printjson(row);'
```

An empty result is acceptable on an empty database; authentication and command execution must succeed.

Then confirm a write is denied. The probe removes its own record if a dangerous misconfiguration unexpectedly permits the insert:

```bash
mongosh "$OMS_CHAT_MONGO_URI" --quiet --eval '
const probe = db.getCollection("__oms_chat_write_probe");
try {
  const inserted = probe.insertOne({created_at: new Date()});
  probe.deleteOne({_id: inserted.insertedId});
  print("FAIL: write succeeded; remove this credential from OMS immediately");
  quit(2);
} catch (error) {
  if (error.code === 13 || /not authorized/i.test(String(error.message))) {
    print("PASS: write denied");
    quit(0);
  }
  print(error);
  quit(3);
}'
```

The expected output is `PASS: write denied`. Do not deploy the credential if the command reports that the write succeeded.

## Auditing and operations

Each authenticated assistant execution records the user ID, timestamp, question, selected reporting collection, stage count, query duration, returned row count, truncation flag, answer type, forecast confidence label, tool-call count, analysis type, and a success/failure category where those values are available. Requests rejected before execution, such as authentication or permission failures, follow the application's existing security logging policy. Audit records omit credentials, authorization data, provider payloads, generated pipelines, hidden reasoning, and complete result documents.

Every `/oms-chat/ask` response also has an `X-Request-Id` header. Failed responses include the same `requestId` and a safe `errorCode`. Backend output contains ordered `[oms-assistant]` JSON records for route checks, rate limiting, request validation, conversation state, entity resolution, read-only queries, tool/forecast execution, Gemini attempts and retries, answer validation, persistence, and completion. Find one execution with:

```bash
pm2 logs oms-backend --lines 1000 | grep '<request-id>'
```

Failure records include the server-side category, HTTP/provider status, message, and stack. They intentionally exclude credentials, authorization headers, provider bodies, MongoDB pipelines, hidden prompts/reasoning, and result documents.

Operational caveats:

- Questions and the bounded query results needed to answer them are processed by Gemini. Do not enter unrelated secrets or personal data in questions.
- Business fields are readable by default; authentication, security, assistant-state, audit, and MongoDB system collections remain blocked.
- A maximum of 100 supporting rows is for chat analysis, not bulk export. Use existing OMS export routes for complete datasets.
- Gemini or read-replica/database unavailability produces a safe failure; the assistant does not silently switch providers or use the application's write credential. When a transient Gemini failure happens after a deterministic forecast has completed, the backend can return a clearly marked partial forecast summary from that completed calculation.
- Conversation continuation is backend-owned and expires; it is not a permanent report archive.
- The per-user limiter uses an atomic MongoDB bucket in the primary application database, so the 10-requests-per-5-minutes ceiling is shared across PM2 instances.

## Production deployment and verification

1. Create and verify the read-only MongoDB user using the checks above.
2. Before promoting the commit, run the feature tests and production frontend build:

   ```bash
   cd backend
   npm test

   cd ../client/OMS
   npm test
   npm run build
   ```

3. Add the required backend-only variables and optional container target to `/var/www/order-management-system/backend/.env.production`, validate the backend environment, then secure the file:

   ```bash
   cd /var/www/order-management-system/backend
   NODE_ENV=production npm run check:env
   chmod 600 /var/www/order-management-system/backend/.env.production
   ```

4. Deploy the application:

   ```bash
   cd /var/www/order-management-system
   bash deploy/scripts/deploy_vps.sh
   ```

5. If environment values changed without a code deployment, reload the backend with the updated environment:

   ```bash
   cd /var/www/order-management-system
   pm2 reload deploy/pm2/ecosystem.config.cjs --only oms-backend --update-env
   ```

6. Verify process and general API health:

   ```bash
   pm2 status
   curl --fail https://api.ghouse-sourcing.com/healthz
   pm2 logs oms-backend --lines 100
   ```

7. Sign in with a user whose effective permissions include `oms_assistant.view`, open `/oms-assistant`, ask an example question, and verify that the answer shows metadata/supporting rows without a pipeline.
8. Optionally verify the API with a cookie jar from an authenticated OMS session:

   ```bash
   curl --fail-with-body \
     --cookie /secure/path/oms.cookies \
     --header "Content-Type: application/json" \
     --data '{"message":"How many containers were shipped last month?"}' \
     https://api.ghouse-sourcing.com/api/oms-chat/ask
   ```

9. Verify a user without `oms_assistant.view` receives `403`, and inspect the OMS security audit destination for the successful assistant request. Do not inspect or copy production result rows into deployment logs.
