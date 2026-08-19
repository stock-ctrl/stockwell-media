# Stockwell backend

The website is static (GitHub Pages), so the contact form posts to a Supabase
edge function instead of a server.

**Project:** `gzcfawhglecmfxnwfjej` (the hub, same project that holds
`plungehouse_outbox`). It lives here rather than in `stockwell-data` so the
function's own service-role key reaches both the leads table and the outbox,
with no cross-project secret to manage.

## Flow

1. `website/contact.html` POSTs JSON to
   `https://gzcfawhglecmfxnwfjej.supabase.co/functions/v1/stockwell-lead`
2. The function validates, rate limits, and stores the lead in `stockwell_leads`
3. It enqueues a `plungehouse_outbox` row (`kind = 'stockwell_lead'`)
4. The M3 poller (`~/outbox-poller`, launchd `com.stockwell.outbox-poller`,
   every 5 min) texts it to Stock and marks the row `sent`
5. It emails the lead to `stockwellmediaco@gmail.com` over Gmail SMTP, with
   `Reply-To` set to the prospect so a reply goes straight back to them

The email runs LAST and is best effort: the lead is already stored and the text
already queued, so a Gmail outage degrades to "texted but not emailed" instead
of a lost lead. The outcome is written to `stockwell_leads.email_status`
(`sent` | `failed:<reason>` | `skipped:no-credentials`).

`recipients[].email` is also populated so the existing outbox-fallback cron in
`plungehouse-ingest` emails the lead if the M3 never delivers the text. That
cron only runs in the morning window, evening, and Sunday, so treat it as a
backstop rather than a fast safety net.

## SMTP credentials

The sender is ported from `plungehouse-ingest/lib/email.js` (zero dependency
Gmail SMTP, AUTH LOGIN over TLS on 465) to Deno. It reads two rows from
`stockwell_secrets`:

    stockwell_smtp_user   ricocurtis.ops@gmail.com
    stockwell_smtp_pass   that account's Gmail app password

They live there rather than in `app_state` on purpose: `app_state` is readable
with the publishable key that ships in the public dashboards, so a password in
it would be world readable. `stockwell_secrets` is RLS-on with no policies.

With the rows absent the function still stores and texts the lead, and records
`skipped:no-credentials`. Load them with:

    python3 scripts/load-smtp-secrets.py

That script PARSES the plungehouse-ingest `.env` rather than sourcing it: the
file holds a multi-line service-account private key that breaks `. file` in a
shell. It never prints the values and refuses to run if the file points at a
project other than the hub.

## Redeploying

Deployed via the Supabase MCP `deploy_edge_function` (no CLI installed on this
machine). `verify_jwt` must stay `false`: the form is public. Keep this copy in
sync by hand when the deployed version changes.

## Reading leads

    select * from stockwell_leads order by created_at desc;

RLS is on with no policies, so the anon key can neither read nor write it.
Verified: anon SELECT returns `[]`, anon INSERT returns 42501.
