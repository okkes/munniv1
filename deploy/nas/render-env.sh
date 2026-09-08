#!/usr/bin/env bash
# Render an env TEMPLATE into a real .env for a NAS bundle.
#   render-env.sh TEMPLATE OUTPUT
# Placeholder values come from $SECRETS_JSON (the workflow passes
# toJSON(secrets)) and, second in line, $VARS_JSON (toJSON(vars)) — keyed
# by the placeholder name itself, so adding a key needs no workflow
# change: template placeholder + same-named GitHub secret/variable and
# this script picks it up. Used by the live channels (deploy/env/.env.nas)
# and the iac channels (infra/rendered/<stack>/.env.<stack>, which also
# reference ${VITE_*} VARIABLES the logto/glitchtip modules wrote back).
set -euo pipefail

TEMPLATE="$1"; OUTPUT="$2"
: "${SECRETS_JSON:?pass the secrets context as SECRETS_JSON}"
# NOT ${VARS_JSON:-{}}: the first } would close the expansion and leave a
# stray brace glued onto the JSON
if [ -z "${VARS_JSON:-}" ]; then VARS_JSON='{}'; fi
export VARS_JSON

# every ${NAME} placeholder the template mentions
mapfile -t NAMES < <(grep -o '\${[A-Z][A-Z0-9_]*}' "$TEMPLATE" | tr -d '${}' | sort -u)

VARLIST=""
for name in "${NAMES[@]}"; do
  value=$(SECRET_KEY="$name" node -pe 'const s = JSON.parse(process.env.SECRETS_JSON); const v = JSON.parse(process.env.VARS_JSON); s[process.env.SECRET_KEY] ?? v[process.env.SECRET_KEY] ?? ""')
  export "$name"="$value"
  VARLIST="$VARLIST \${$name}"
done

envsubst "$VARLIST" < "$TEMPLATE" > "$OUTPUT"

# a stack cannot run without these — fail loudly, not at 3am on the NAS.
# Only enforced when the template actually references the name (the iac
# templates bake DOMAIN at render time, so NAS_DOMAIN never appears there).
for required in NAS_GHCR_PAT NAS_POSTGRES_PASSWORD NAS_DOMAIN; do
  printf '%s\n' "${NAMES[@]}" | grep -qx "$required" || continue
  if [ -z "${!required:-}" ]; then
    echo "::error::required secret $required is missing or empty" >&2
    exit 1
  fi
done

# optional values may be empty (the feature just stays off) — but say so
for name in "${NAMES[@]}"; do
  [ -z "${!name}" ] && echo "note: $name is empty — its feature stays disabled"
done

echo "rendered $OUTPUT from $TEMPLATE (${#NAMES[@]} placeholders)"
