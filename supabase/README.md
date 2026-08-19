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

No email is sent on the happy path, by choice. `recipients[].email` is still
populated so the existing outbox-fallback cron in `plungehouse-ingest` emails
the lead if the M3 never delivers it. Note that cron only runs in the morning
window, evening, and Sunday, so that safety net is not immediate.

## Redeploying

Deployed via the Supabase MCP `deploy_edge_function` (no CLI installed on this
machine). `verify_jwt` must stay `false`: the form is public. Keep this copy in
sync by hand when the deployed version changes.

## Reading leads

    select * from stockwell_leads order by created_at desc;

RLS is on with no policies, so the anon key can neither read nor write it.
Verified: anon SELECT returns `[]`, anon INSERT returns 42501.
