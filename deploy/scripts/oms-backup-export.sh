#!/usr/bin/env bash
set -euo pipefail

readonly LOCAL_BACKUP_DIR="/var/backups/oms-mongo"
readonly WASABI_BACKUP_DIR="wasabi:ghs-2/oms-mongodb-backups"
readonly STAGING_DIR="/home/abrar/oms-backup-downloads"
readonly DOWNLOAD_USER="abrar"
readonly PATH="/usr/bin:/bin"

is_valid_backup_name() {
  [[ "$1" =~ ^oms-[0-9]{4}-[0-9]{2}-[0-9]{2}(-latest|-[0-9]{2}-[0-9]{2})\.archive\.gz$ ]]
}

prepare_staging_dir() {
  install -d -m 0700 -o "$DOWNLOAD_USER" -g "$DOWNLOAD_USER" "$STAGING_DIR"
  find "$STAGING_DIR" -xdev -type f -name 'oms-*.archive.gz' -mmin +240 -delete
}

list_backups() {
  local file name

  for file in "$LOCAL_BACKUP_DIR"/oms-*.archive.gz; do
    [[ -f "$file" ]] || continue
    name="$(basename "$file")"
    is_valid_backup_name "$name" || continue
    printf 'local\t%s\n' "$name"
  done

  rclone lsf "$WASABI_BACKUP_DIR" --files-only | while IFS= read -r name; do
    is_valid_backup_name "$name" || continue
    printf 'wasabi\t%s\n' "$name"
  done
}

stage_backup() {
  local source="$1"
  local name="$2"
  local target="$STAGING_DIR/$name"
  local temporary="$STAGING_DIR/.${name}.partial"

  is_valid_backup_name "$name" || {
    echo "Invalid backup name." >&2
    exit 2
  }
  prepare_staging_dir
  rm -f -- "$target" "$temporary"

  case "$source" in
    local)
      [[ -f "$LOCAL_BACKUP_DIR/$name" ]] || {
        echo "Local backup not found: $name" >&2
        exit 3
      }
      install -m 0600 -o "$DOWNLOAD_USER" -g "$DOWNLOAD_USER" \
        "$LOCAL_BACKUP_DIR/$name" "$target"
      ;;
    wasabi)
      if ! rclone copyto "$WASABI_BACKUP_DIR/$name" "$temporary" \
        || ! install -m 0600 -o "$DOWNLOAD_USER" -g "$DOWNLOAD_USER" "$temporary" "$target"; then
        rm -f -- "$temporary"
        exit 1
      fi
      rm -f -- "$temporary"
      ;;
    *)
      echo "Source must be local or wasabi." >&2
      exit 2
      ;;
  esac

  printf '%s\n' "$target"
}

cleanup_backup() {
  local name="$1"
  is_valid_backup_name "$name" || exit 2
  rm -f -- "$STAGING_DIR/$name"
}

case "${1:-}" in
  list)
    [[ "$#" -eq 1 ]] || exit 2
    list_backups
    ;;
  stage)
    [[ "$#" -eq 3 ]] || exit 2
    stage_backup "$2" "$3"
    ;;
  cleanup)
    [[ "$#" -eq 2 ]] || exit 2
    cleanup_backup "$2"
    ;;
  *)
    echo "Usage: oms-backup-export {list|stage <local|wasabi> <backup-name>|cleanup <backup-name>}" >&2
    exit 2
    ;;
esac
