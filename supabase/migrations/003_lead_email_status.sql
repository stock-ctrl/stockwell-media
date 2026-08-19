-- Track whether the lead email actually went out, so a silent SMTP failure is
-- visible in the table rather than only in the function logs.
-- Values: 'sent' | 'failed:<reason>' | 'skipped:no-credentials'
-- Applied to project gzcfawhglecmfxnwfjej on 2026-08-19.

ALTER TABLE public.stockwell_leads
    ADD COLUMN IF NOT EXISTS email_status text;
