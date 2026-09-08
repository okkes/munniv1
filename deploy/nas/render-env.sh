#!/usr/bin/env bash
# Render deploy/env/.env.nas into a real .env for the NAS bundle.
#   render-env.sh TEMPLATE OUTPUT
# Placeholder values come from $SECRETS_JSON (the workflow passes
# toJSON(secrets)), keyed by the placeholder name itself — so adding a
# key needs no workflow change: template placeholder + same-named GitHub
# secret and this script picks it up.
set -euo pipefail

TEMPLATE="$1"; OUTPUT="$2"
: "${SECRETS_JSON:?pass the secrets context as SECRETS_JSON}"

# every ${NAS_*} placeholder the template mentions
mapfile -t NAMES < <(grep -o '\${NAS_[A-Z0-9_]*}' "$TEMPLATE" | tr -d '${}' | sort -u)

VARLIST=""
for name in "${NAMES[@]}"; do
  value=$(SECRET_KEY="$name" node -pe 'JSON.parse(process.env.SECRETS_JSON)[process.env.SECRET_KEY] ?? ""')
  export "$name"="$value"
  VARLIST="$VARLIST \${$name}"
done

envsubst "$VARLIST" < "$TEMPLATE" > "$OUTPUT"

# the stack cannot run without these two — fail loudly, not at 3am on the NAS
for required in NAS_GHCR_PAT NAS_POSTGRES_PASSWORD NAS_DOMAIN; do
  if [ -z "${!required:-}" ]; then
    echo "::error::required secret $required is missing or empty" >&2
    exit 1
  fi
done

# optional secrets may be empty (the feature just stays off) — but say so
for name in "${NAMES[@]}"; do
  [ -z "${!name}" ] && echo "note: $name is empty — its feature stays disabled"
done

echo "rendered $OUTPUT from $TEMPLATE (${#NAMES[@]} placeholders)"
