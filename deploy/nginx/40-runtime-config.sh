#!/bin/sh
# Render /runtime-config.js from MUNNI_* container env vars at startup
# (nginx:alpine runs /docker-entrypoint.d/*.sh before serving). This is
# what lets ONE public web/admin image serve every stack: the app prefers
# window.__MUNNI_CONFIG__ over its baked Vite env (apps/*/src config).
# No MUNNI_* vars set -> an empty overlay -> the baked config wins, so
# the live stacks behave exactly as before this file existed.
set -eu
OUT="/usr/share/nginx/html/runtime-config.js"
[ -w "$(dirname "$OUT")" ] || { echo "40-runtime-config: $OUT not writable — skipping" >&2; exit 0; }

json=""
for name in API_URL LOGTO_ENDPOINT LOGTO_APP_ID LOGTO_RESOURCE GLITCHTIP_DSN CHANNEL NATIVE_SCHEME PUBLIC_ORIGIN; do
  eval "val=\${MUNNI_${name}:-}"
  [ -n "$val" ] || continue
  esc=$(printf '%s' "$val" | sed 's/\\/\\\\/g; s/"/\\"/g')
  json="${json}${json:+,}\"${name}\":\"${esc}\""
done

printf 'window.__MUNNI_CONFIG__={%s};\n' "$json" > "$OUT"
echo "40-runtime-config: rendered $OUT ($([ -n "$json" ] && echo 'overlay active' || echo 'empty — baked config applies'))"

# The baked CSP allows img-src 'self' data: blob: https: — enough for every
# https deployment, but a plain-http API origin (the LOCAL twin) serves the
# vendored institution logos from http://localhost:<api-port>, which that
# policy blocks (34 blank bank logos, found live 2026-08-27). When THIS
# deployment's API is http, admit exactly that one origin.
SNIPPET="/etc/nginx/snippets/security-headers.conf"
case "${MUNNI_API_URL:-}" in
  http://*)
    if [ -w "$SNIPPET" ] && ! grep -q "img-src 'self' data: blob: https: ${MUNNI_API_URL}" "$SNIPPET"; then
      sed -i "s|img-src 'self' data: blob: https:|img-src 'self' data: blob: https: ${MUNNI_API_URL}|" "$SNIPPET"
      echo "40-runtime-config: CSP img-src extended with ${MUNNI_API_URL} (http deployment)"
    fi
    ;;
esac
