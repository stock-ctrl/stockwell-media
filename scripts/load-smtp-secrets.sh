#!/usr/bin/env bash
# Load the Gmail SMTP credentials the stockwell-lead edge function needs.
#
# Reads GMAIL_USER / GMAIL_APP_PASSWORD out of the plungehouse-ingest .env (the
# same app password already used by the outbox email fallback) and upserts them
# into stockwell_secrets in the hub project, using that project's service role
# key from the same file.
#
# Values are never printed. Run it once; re-run to rotate.
#
#   bash ~/Code/stockwell-media/scripts/load-smtp-secrets.sh

set -euo pipefail

ENV_FILE="${ENV_FILE:-$HOME/Code/plungehouse-ingest/.env}"
[ -f "$ENV_FILE" ] || { echo "No env file at $ENV_FILE" >&2; exit 1; }

set -a; . "$ENV_FILE"; set +a

: "${GMAIL_USER:?GMAIL_USER missing from $ENV_FILE}"
: "${GMAIL_APP_PASSWORD:?GMAIL_APP_PASSWORD missing from $ENV_FILE}"
: "${SUPABASE_URL:?SUPABASE_URL missing from $ENV_FILE}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY missing from $ENV_FILE}"

case "$SUPABASE_URL" in
    *gzcfawhglecmfxnwfjej*) ;;
    *) echo "Refusing to run: $ENV_FILE points at $SUPABASE_URL, not the hub project." >&2; exit 1 ;;
esac

python3 - <<'PY'
import json, os, urllib.request, urllib.error

url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/stockwell_secrets"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
rows = [
    {"key": "stockwell_smtp_user", "value": os.environ["GMAIL_USER"]},
    {"key": "stockwell_smtp_pass", "value": os.environ["GMAIL_APP_PASSWORD"]},
]

req = urllib.request.Request(
    url,
    data=json.dumps(rows).encode(),
    method="POST",
    headers={
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    },
)
try:
    with urllib.request.urlopen(req) as r:
        print(f"Loaded {len(rows)} secret(s). HTTP {r.status}")
except urllib.error.HTTPError as e:
    # Print the status and body but never the values we tried to send.
    print(f"FAILED HTTP {e.code}: {e.read().decode()[:300]}")
    raise SystemExit(1)
PY

echo "Done. Test with:"
echo '  curl -s -X POST https://gzcfawhglecmfxnwfjej.supabase.co/functions/v1/stockwell-lead \'
echo '    -H "Content-Type: application/json" -H "Origin: https://stock-ctrl.github.io" \'
echo "    -d '{\"name\":\"Email test\",\"email\":\"you@example.com\",\"message\":\"testing\"}'"
echo 'Expect "email":"sent" in the response.'
