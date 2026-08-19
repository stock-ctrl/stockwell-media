-- stockwell_secrets: credentials the stockwell-lead edge function needs at
--   runtime (currently Gmail SMTP user + app password).
--
-- Deliberately NOT app_state. That table is readable with the publishable key
-- that ships in the public dashboards, so a password there would be world
-- readable. This one is RLS-on with NO policies, the same shape as
-- stockwell_leads, which is verified to block anon reads and writes.
--
-- Service role bypasses RLS, so the edge function reads it and nothing else can.
-- Applied to project gzcfawhglecmfxnwfjej on 2026-08-19.

CREATE TABLE IF NOT EXISTS public.stockwell_secrets (
    key        text        PRIMARY KEY,
    value      text        NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stockwell_secrets ENABLE ROW LEVEL SECURITY;

-- Expected keys (values loaded out of band, never committed):
--   stockwell_smtp_user  -> ricocurtis.ops@gmail.com
--   stockwell_smtp_pass  -> that account's Gmail app password
