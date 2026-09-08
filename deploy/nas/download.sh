#!/usr/bin/env bash
# Download a file from the Synology NAS via the FileStation Web API.
#   download.sh REMOTE_PATH LOCAL_PATH
# Reads SYNOLOGY_URL / SYNOLOGY_USER / SYNOLOGY_PASS from the env.
# Companion to upload.sh — used by the NAS-diagnostics workflow to pull
# deploy.log without SSH.
set -euo pipefail

: "${SYNOLOGY_URL:?}" "${SYNOLOGY_USER:?}" "${SYNOLOGY_PASS:?}"
URL="${SYNOLOGY_URL%/}"
REMOTE="$1"; LOCAL="$2"

resp=$(curl -sS "$URL/webapi/auth.cgi" \
  --data-urlencode "api=SYNO.API.Auth" \
  --data-urlencode "version=6" \
  --data-urlencode "method=login" \
  --data-urlencode "account=$SYNOLOGY_USER" \
  --data-urlencode "passwd=$SYNOLOGY_PASS" \
  --data-urlencode "session=FileStation" \
  --data-urlencode "format=sid")
echo "$resp" | grep -q '"success":true' || { echo "Synology login failed: $resp" >&2; exit 1; }
SID=$(echo "$resp" | sed -n 's/.*"sid" *: *"\([^"]*\)".*/\1/p')
trap 'curl -sS "$URL/webapi/auth.cgi?api=SYNO.API.Auth&version=6&method=logout&session=FileStation&_sid='"$SID"'" >/dev/null || true' EXIT

# a trailing slash lists the folder (names, sizes, mtimes) instead of
# downloading — used to see what a deploy actually left on the NAS
if [ "${REMOTE%/}" != "$REMOTE" ]; then
  FOLDER=$(printf '%s' "$REMOTE" | sed 's:/*$::')
  curl -sS -G "$URL/webapi/entry.cgi" \
    --data-urlencode "api=SYNO.FileStation.List" \
    --data-urlencode "version=2" \
    --data-urlencode "method=list" \
    --data-urlencode "folder_path=$FOLDER" \
    --data-urlencode "additional=[\"size\",\"time\"]" \
    --data-urlencode "_sid=$SID" \
    -o "$LOCAL"
else
  curl -sS -G "$URL/webapi/entry.cgi" \
    --data-urlencode "api=SYNO.FileStation.Download" \
    --data-urlencode "version=2" \
    --data-urlencode "method=download" \
    --data-urlencode "path=$REMOTE" \
    --data-urlencode "mode=download" \
    --data-urlencode "_sid=$SID" \
    -o "$LOCAL"
fi

# a JSON or HTML body instead of file content means the API refused
# (bad path / permission / DSM 404 page)
if head -c 1 "$LOCAL" | grep -q '{' && grep -q '"success":false' "$LOCAL" 2>/dev/null; then
  echo "download of $REMOTE failed: $(cat "$LOCAL")" >&2
  exit 1
fi
if head -c 15 "$LOCAL" | grep -qi '<!DOCTYPE\|<html'; then
  echo "download of $REMOTE returned an HTML error page (path wrong or file missing)" >&2
  exit 1
fi
echo "downloaded $REMOTE -> $LOCAL ($(wc -c <"$LOCAL") bytes)"
