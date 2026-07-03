# QC Thumbnail Backfill

This one-off worker generates WebP thumbnails for existing QC gallery images stored in Wasabi/S3. Run it as a separate controlled background process, not inside the normal Express API process.

## 1. Dependency

`sharp` is already listed in `backend/package.json`. If production dependencies were installed before that dependency existed, reinstall from the backend directory:

```bash
cd backend
npm install
```

If you only need to add Sharp manually:

```bash
cd backend
npm install sharp
```

## 2. Dry Run 25 Records

```bash
cd backend
node scripts/backfill-qc-thumbnails.js --dry-run --limit=25 --verbose
```

## 3. Live Test 25 or 100 Records

```bash
cd backend
node scripts/backfill-qc-thumbnails.js --limit=25 --concurrency=2 --verbose
```

```bash
cd backend
node scripts/backfill-qc-thumbnails.js --limit=100 --concurrency=2 --verbose
```

## 4. Verify Wasabi and MongoDB

Check Wasabi for deterministic thumbnail keys beside the source image, for example:

```text
qc-images/<source-file>.jpg
qc-images/thumbnails/<source-file>.webp
```

Then verify MongoDB metadata on the same QC document:

```javascript
db.qcs.findOne(
  { "qc_images.thumbnail_key": { $exists: true, $ne: "" } },
  { "qc_images.$": 1 }
)
```

Expected fields include `thumbnail_key`, `thumbnail_url`, `thumbnail_generated_at`, `thumbnail_status`, and `thumbnail_attempts`.

## 5. Full Migration

Start conservatively:

```bash
cd backend
node scripts/backfill-qc-thumbnails.js --concurrency=3 --batch-size=100
```

Optional lower-load mode:

```bash
cd backend
node scripts/backfill-qc-thumbnails.js --concurrency=2 --batch-size=50 --delay-ms=100 --batch-delay-ms=1000
```

## 6. Run in Background

Using `nohup`:

```bash
cd backend
nohup node scripts/backfill-qc-thumbnails.js --concurrency=3 --batch-size=100 > qc-thumbnail-backfill.log 2>&1 &
echo $! > qc-thumbnail-backfill.pid
```

Using PM2 as a one-off worker with no automatic restart:

```bash
cd backend
pm2 start scripts/backfill-qc-thumbnails.js --name qc-thumbnail-backfill --no-autorestart -- --concurrency=3 --batch-size=100
```

## 7. Monitor Logs

```bash
tail -f backend/qc-thumbnail-backfill.log
```

With PM2:

```bash
pm2 logs qc-thumbnail-backfill
```

## 8. Stop Safely

For `nohup`:

```bash
kill -INT "$(cat backend/qc-thumbnail-backfill.pid)"
```

With PM2:

```bash
pm2 sendSignal SIGINT qc-thumbnail-backfill
```

The script finishes in-flight work, closes MongoDB, and can be resumed later.

## 9. Resume or Retry Failed Images

Resume missing thumbnails:

```bash
cd backend
node scripts/backfill-qc-thumbnails.js --concurrency=3 --batch-size=100
```

Retry only images previously marked failed:

```bash
cd backend
node scripts/backfill-qc-thumbnails.js --retry-failed --concurrency=2
```

Target a single QC or inspection record for testing:

```bash
cd backend
node scripts/backfill-qc-thumbnails.js --inspection-id=<mongo-object-id> --limit=25 --concurrency=1 --verbose
```
