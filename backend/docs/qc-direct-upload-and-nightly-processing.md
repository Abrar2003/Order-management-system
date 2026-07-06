# QC Direct Upload And Nightly Processing

## Architecture

```text
Browser
  -> compresses browser-supported QC images
  -> POST /qc-images/upload-session
  -> PUT directly to private Wasabi with the presigned URL
  -> POST /qc-images/upload-session/:uploadId/complete
  -> source image is visible as a temporary fallback

oms-qc-image-worker
  -> runs only during the 21:00-07:00 Asia/Kolkata window
  -> scans queued QC images every 10 minutes
  -> creates preview WebP and thumbnail WebP
  -> verifies both Wasabi objects with HEAD
  -> updates existing canonical key to preview
  -> deletes the temporary source after verification and DB update
```

Normal QC image upload bytes no longer pass through Express. Express only creates, refreshes, confirms, and cancels upload sessions.

## Wasabi CORS

Keep the bucket private. Do not use public ACLs.

Use explicit frontend origins only:

```json
[
  {
    "AllowedOrigins": [
      "https://YOUR_OMS_FRONTEND_DOMAIN",
      "http://localhost:5173"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": [
      "Content-Type",
      "Content-MD5",
      "x-amz-*"
    ],
    "ExposeHeaders": [
      "ETag",
      "x-amz-request-id"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

Remove local development origins from production buckets unless they are intentionally needed.

## Environment

Required existing values:

```bash
REDIS_JOBS_ENABLED=true
REDIS_URL=redis://127.0.0.1:6379/0
MONGO_URI=...
WASABI_ACCESS_KEY_ID=...
WASABI_SECRET_ACCESS_KEY=...
WASABI_BUCKET=...
WASABI_REGION=...
WASABI_ENDPOINT=...
CORS_ORIGINS=https://YOUR_OMS_FRONTEND_DOMAIN
```

QC image values:

```bash
QC_IMAGE_PROCESSING_TZ=Asia/Kolkata
QC_IMAGE_PROCESSOR_CONCURRENCY=2
QC_IMAGE_PROCESSOR_SCAN_INTERVAL_MS=600000
QC_IMAGE_WINDOW_START=21:00
QC_IMAGE_WINDOW_END=07:00
QC_IMAGE_DIRECT_UPLOAD_URL_TTL_SECONDS=900
QC_IMAGE_MAX_FILE_SIZE=12582912
QC_IMAGE_ENABLE_AVIF_UPLOADS=false
QC_IMAGE_PREVIEW_MAX_DIMENSION=1920
QC_IMAGE_PREVIEW_WEBP_QUALITY=82
QC_IMAGE_THUMBNAIL_MAX_DIMENSION=480
QC_IMAGE_THUMBNAIL_WEBP_QUALITY=72
```

Enable AVIF only after runtime conversion testing passes, and set the matching frontend build value:

```bash
VITE_QC_IMAGE_ENABLE_AVIF_UPLOADS=true
```

## PM2

The PM2 ecosystem now includes:

```bash
oms-backend
oms-worker
oms-qc-image-worker
```

Start/restart manually:

```bash
pm2 start deploy/pm2/ecosystem.config.cjs --only oms-qc-image-worker --update-env
pm2 restart deploy/pm2/ecosystem.config.cjs --only oms-qc-image-worker --update-env
pm2 logs oms-qc-image-worker
```

## Deploy

```bash
cd /var/www/order-management-system
APP_DIR=/var/www/order-management-system \
GIT_BRANCH=main \
BACKEND_ENV_FILE=/var/www/order-management-system/backend/.env.production \
FRONTEND_ENV_FILE=/var/www/order-management-system/client/OMS/.env.production \
bash deploy/scripts/deploy_vps.sh
```

The deploy script starts and verifies `oms-qc-image-worker` when `REDIS_JOBS_ENABLED=true`.

## Test Direct Upload

1. Open a QC detail page.
2. Select QC Images or Hardware Inspection.
3. Choose files.
4. Start upload.
5. Confirm browser devtools shows `PUT` requests going to Wasabi, not `/qc/:id/images`.
6. Confirm `/qc-images/upload-session/:uploadId/complete` succeeds.
7. Refresh QC details and verify the image appears before nightly processing.

## Test Retry

Use devtools throttling or temporarily block the Wasabi request. Failed files stay independent. Use `Retry failed uploads`; completed files are not restarted.

Retry waits are approximately 2s, 5s, and 10s. Expired presigned URLs refresh against the same upload session and source key.

## HEIC Validation

Run this on the Ubuntu VPS with a real iPhone HEIC file:

```bash
cd /var/www/order-management-system/backend
npm run validate:qc-heic -- /path/to/real-iphone-photo.heic
```

If this fails, the installed Sharp/libvips/libheif runtime cannot decode HEIC. Install or rebuild a libvips/libheif stack with HEIC enabled, then reinstall/rebuild Sharp. Do not treat HEIC processing as production-ready until this command passes with real portrait, large, corrupt, and live-photo/sequence fixtures.

## Legacy Thumbnail Backfill

Dry run:

```bash
cd /var/www/order-management-system/backend
node scripts/backfill-qc-thumbnails.js --dry-run --limit=25 --legacy-only --verbose
```

Full controlled migration:

```bash
cd /var/www/order-management-system/backend
node scripts/backfill-qc-thumbnails.js --legacy-only --concurrency=2 --batch-size=50 --delay-ms=100 --batch-delay-ms=1000
```

## Monitor Queue

```bash
pm2 logs oms-qc-image-worker
redis-cli llen bull:qc-image-processing:wait
redis-cli llen bull:qc-image-processing:failed
```

## Manual Retry

Failed direct-upload images keep `processing.status=failed` and a concise `processing.error`. Requeue by setting the image processing status back to `queued`; the worker scan will enqueue it during the nightly window.

```javascript
db.qcs.updateOne(
  { _id: ObjectId("<qcId>"), "qc_images._id": ObjectId("<imageId>") },
  {
    $set: {
      "qc_images.$.processing.status": "queued",
      "qc_images.$.processing.attempts": 0,
      "qc_images.$.processing.error": "",
      "qc_images.$.processing.lock_until": null
    }
  }
)
```

## Source Cleanup

Source objects are temporary. The worker deletes the source only after:

1. preview WebP upload succeeds
2. thumbnail WebP upload succeeds
3. both objects pass HEAD verification
4. MongoDB canonical fields are updated to the preview

If source deletion fails, processing remains `ready` and `storage.source_cleanup_status` stays `pending` for later cleanup.

## Rollback

1. Stop the image worker:

```bash
pm2 stop oms-qc-image-worker
```

2. Revert the frontend build to the previous deployment so uploads use `/qc/:id/images`.
3. Keep existing DB metadata; legacy `key`, `thumbnail_key`, `url`, comments, delete, selection, and download behavior remain compatible.
