# Redis Cache And Background Jobs

The backend can use Redis for short-lived API cache and BullMQ for background jobs.
Both are optional. If Redis is disabled or unavailable, API requests continue without
cache/job acceleration where possible.

## Environment

```bash
REDIS_CACHE_ENABLED=true
REDIS_JOBS_ENABLED=true
REDIS_URL=redis://127.0.0.1:6379
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false

PM2_WEB_INSTANCES=2
PM2_WORKER_INSTANCES=1

CACHE_TTL_SHORT_SECONDS=60
CACHE_TTL_MEDIUM_SECONDS=300
CACHE_TTL_LONG_SECONDS=900

ORDER_IMPORT_WORKER_CONCURRENCY=1
FILE_WORKER_CONCURRENCY=1
CALENDAR_WORKER_CONCURRENCY=1
CBM_WORKER_CONCURRENCY=2
IMAGE_WORKER_CONCURRENCY=1
```

`REDIS_URL` is preferred when present. Use `rediss://` or `REDIS_TLS=true` for
remote TLS Redis.

## Ubuntu Redis Setup

```bash
sudo apt update
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
redis-cli ping
```

## Production Notes

- Bind Redis to localhost when Redis runs on the same VPS.
- Do not expose port `6379` publicly.
- Use a password and TLS for remote Redis.
- Add a firewall rule that blocks public Redis access.

## PM2 Processes

The web backend runs clustered as `oms-backend`; the worker runs separately as
`oms-worker` in fork mode. Scale web instances with `PM2_WEB_INSTANCES`. Keep
`PM2_WORKER_INSTANCES=1` unless you intentionally want multiple BullMQ workers.

Expected PM2 shape:

```text
oms-backend x 2
oms-worker  x 1
```

## Job Status APIs

Authenticated `admin`, `manager`, and `dev` users can inspect jobs:

```text
GET  /jobs/:queueName/:jobId
GET  /jobs/:queueName
POST /jobs/:queueName/:jobId/retry
```

The same routes are also mounted under `/api/jobs`.

Common queue names:

```text
orderImportQueue
fileProcessingQueue
calendarSyncQueue
cbmRecalcQueue
imageProcessingQueue
```

## Async Modes

Total PO CBM recalculation:

```text
POST /orders/recalculate-total-po-cbm?async=true
```

Calendar resync:

```text
POST /orders/re-sync?async=true
```

PIS spreadsheet conversion/upload:

```text
POST /items/:itemId/pis-upload?async=true
```

When Redis jobs are disabled or enqueueing fails, these endpoints fall back to
the existing synchronous behavior where possible.
