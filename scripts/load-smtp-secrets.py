#!/usr/bin/env python3
"""Load the Gmail SMTP credentials the stockwell-lead edge function needs.

Reads GMAIL_USER / GMAIL_APP_PASSWORD out of the plungehouse-ingest .env (the
same app password already used by the outbox email fallback) and upserts them
into stockwell_secrets in the hub project.

The .env is PARSED, never sourced: it contains a multi-line service-account
private key that breaks `. file` in a shell. Values are never printed.

    python3 ~/Code/stockwell-media/scripts/load-smtp-secrets.py
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

ENV_FILE = os.environ.get("ENV_FILE", os.path.expanduser("~/Code/plungehouse-ingest/.env"))
WANTED = ("GMAIL_USER", "GMAIL_APP_PASSWORD", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
HUB_REF = "gzcfawhglecmfxnwfjej"


def parse_env(path):
    """Pull just the keys we need. Single-line assignments only, which is what
    all four are; a multi-line PEM elsewhere in the file is simply ignored."""
    if not os.path.exists(path):
        sys.exit(f"No env file at {path}")
    found = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            m = re.match(r'^\s*(' + "|".join(WANTED) + r')\s*=\s*(.*)$', line)
            if not m:
                continue
            key, val = m.group(1), m.group(2).strip()
            if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
                val = val[1:-1]
            if val:
                found[key] = val
    return found


env = parse_env(ENV_FILE)
missing = [k for k in WANTED if k not in env]
if missing:
    sys.exit(f"Missing from {ENV_FILE}: {', '.join(missing)}")

if HUB_REF not in env["SUPABASE_URL"]:
    sys.exit(f"Refusing to run: that .env points at {env['SUPABASE_URL']}, not the hub project.")

rows = [
    {"key": "stockwell_smtp_user", "value": env["GMAIL_USER"]},
    {"key": "stockwell_smtp_pass", "value": env["GMAIL_APP_PASSWORD"]},
]
key = env["SUPABASE_SERVICE_ROLE_KEY"]
req = urllib.request.Request(
    env["SUPABASE_URL"].rstrip("/") + "/rest/v1/stockwell_secrets",
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
        print(f"Loaded {len(rows)} secrets into stockwell_secrets (HTTP {r.status}).")
except urllib.error.HTTPError as e:
    # Status and body only; never the values we tried to send.
    sys.exit(f"FAILED HTTP {e.code}: {e.read().decode()[:300]}")

print("\nNow test it:")
print("  curl -s -X POST https://gzcfawhglecmfxnwfjej.supabase.co/functions/v1/stockwell-lead \\")
print('    -H "Content-Type: application/json" -H "Origin: https://stock-ctrl.github.io" \\')
print("""    -d '{"name":"Email test","email":"you@example.com","message":"testing"}'""")
print('Expect "email":"sent" in the response.')
