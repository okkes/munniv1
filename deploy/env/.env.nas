# Production .env TEMPLATE for the NAS — rendered by CI (deploy-nas.yml)
# and shipped inside the deploy bundle. NAS_* placeholders are filled
# from the same-named GitHub repository secrets; everything else is a
# plain (non-secret) value maintained here in git.
#
# ⚠ The rendered file OVERWRITES /volume1/docker/munni/.env on every
#   master deploy — never edit .env on the NAS by hand. Change this
#   template (non-secrets) or the GitHub secret (secrets) instead.
#
# Adding a key: put it here (placeholder if secret), create the NAS_*
# secret, done — the render step discovers placeholders automatically.

# --- domains / registry -------------------------------------------------
DOMAIN=${NAS_DOMAIN}
REGISTRY=ghcr.io/okkes
TAG=latest
# fine-grained PAT with read:packages only; update.sh re-logs-in each run
GHCR_USER=okkes
GHCR_PAT=${NAS_GHCR_PAT}

# --- postgres (shared instance: munni + logto + glitchtip databases) -----
POSTGRES_PASSWORD=${NAS_POSTGRES_PASSWORD}

# --- logto ----------------------------------------------------------------
LOGTO_API_RESOURCE=https://munni-api.${NAS_DOMAIN}
# account deletion: a Machine-to-machine Logto app with the Management
# API role — without it deletions skip the Logto identity (logged)
LOGTO_M2M_APP_ID=${NAS_LOGTO_M2M_APP_ID}
LOGTO_M2M_APP_SECRET=${NAS_LOGTO_M2M_APP_SECRET}

# --- glitchtip -------------------------------------------------------------
GLITCHTIP_SECRET_KEY=${NAS_GLITCHTIP_SECRET_KEY}
GLITCHTIP_EMAIL_URL=${NAS_GLITCHTIP_EMAIL_URL}
API_SENTRY_DSN=${NAS_API_SENTRY_DSN}

# --- gocardless bank account data ------------------------------------------
GOCARDLESS_SECRET_ID=${NAS_GOCARDLESS_SECRET_ID}
GOCARDLESS_SECRET_KEY=${NAS_GOCARDLESS_SECRET_KEY}

# --- admin (comma-separated OIDC subs allowed into the admin area) ---------
ADMIN_SUBS=${NAS_ADMIN_SUBS}

# --- pgadmin ----------------------------------------------------------------
PGADMIN_EMAIL=admin@${NAS_DOMAIN}
PGADMIN_PASSWORD=${NAS_PGADMIN_PASSWORD}

# --- backups -----------------------------------------------------------------
BACKUP_DIR=/volume1/backups/munni

# --- web push (per-environment VAPID pair; replacing it kills existing
#     subscriptions, so it lives in secrets, not here) ----------------------
PUSH_VAPID_PUBLIC_KEY=${NAS_PUSH_VAPID_PUBLIC_KEY}
PUSH_VAPID_PRIVATE_KEY=${NAS_PUSH_VAPID_PRIVATE_KEY}
PUSH_VAPID_SUBJECT=mailto:admin@${NAS_DOMAIN}

# --- native app push (Firebase service-account JSON, one line) -------------
FCM_SERVICE_ACCOUNT_JSON='${NAS_FCM_SERVICE_ACCOUNT_JSON}'

# --- logo.dev brand search ---------------------------------------------------
LOGODEV_SECRET_KEY=${NAS_LOGODEV_SECRET_KEY}
LOGODEV_PUBLIC_TOKEN=${NAS_LOGODEV_PUBLIC_TOKEN}

# --- watch-folder importer (empty sub = feature off) ------------------------
IMPORT_WATCH_OWNER_SUB=${NAS_IMPORT_WATCH_OWNER_SUB}
IMPORT_WATCH_HOST_DIR=./import-watch

# --- Enable Banking (optional second bank-data provider) --------------------
ENABLEBANKING_APPLICATION_ID=${NAS_ENABLEBANKING_APPLICATION_ID}
ENABLEBANKING_PRIVATE_KEY_PEM='${NAS_ENABLEBANKING_PRIVATE_KEY_PEM}'
