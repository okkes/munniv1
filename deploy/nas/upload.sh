#!/usr/bin/env bash
# Upload files to a Synology NAS via the FileStation Web API.
#   upload.sh FILE [FILE...]
# Reads SYNOLOGY_URL / SYNOLOGY_USER / SYNOLOGY_PASS / SYNOLOGY_PATH from
# the environment. VERSION is uploaded LAST so the NAS poller never sees a
# new version stamp before the bundle it points at has landed.
set -euo pipefail

: "${SYNOLOGY_URL:?}" "${SYNOLOGY_USER:?}" "${SYNOLOGY_PASS:?}" "${SYNOLOGY_PATH:?}"
URL="${SYNOLOGY_URL%/}"

login() {
  local resp sid
  resp=$(curl -sS "$URL/webapi/auth.cgi" \
    --data-urlencode "api=SYNO.API.Auth" \
    --data-urlencode "version=6" \
    --data-urlencode "method=login" \
    --data-urlencode "account=$SYNOLOGY_USER" \
    --data-urlencode "passwd=$SYNOLOGY_PASS" \
    --data-urlencode "session=FileStation" \
    --data-urlencode "format=sid")
  if ! echo "$resp" | grep -q '"success":true'; then
    echo "Synology login failed: $resp" >&2
    exit 1
  fi
  sid=$(echo "$resp" | sed -n 's/.*"sid" *: *"\([^"]*\)".*/\1/p')
  [ -n "$sid" ] || { echo "no sid in login response" >&2; exit 1; }
  echo "$sid"
}

logout() {
  curl -sS "$URL/webapi/auth.cgi" \
    --data-urlencode "api=SYNO.API.Auth" \
    --data-urlencode "version=6" \
    --data-urlencode "method=logout" \
    --data-urlencode "session=FileStation" \
    --data-urlencode "_sid=$1" >/dev/null || true
}

upload_one() {
  local sid="$1" file="$2" resp
  # _sid must ride the query string: as a multipart field the API answers
  # error 119 (SID not found)
  resp=$(curl -sS "$URL/webapi/entry.cgi?_sid=$sid" \
    -F "api=SYNO.FileStation.Upload" \
    -F "version=2" \
    -F "method=upload" \
    -F "path=$SYNOLOGY_PATH" \
    -F "create_parents=true" \
    -F "overwrite=true" \
    -F "file=@$file;filename=$(basename "$file")")
  if ! echo "$resp" | grep -q '"success":true'; then
    echo "upload of $(basename "$file") failed: $resp" >&2
    logout "$sid"
    exit 1
  fi
  echo "uploaded $(basename "$file")"
}

SID=$(login)
trap 'logout "$SID"' EXIT
for f in "$@"; do
  upload_one "$SID" "$f"
done
