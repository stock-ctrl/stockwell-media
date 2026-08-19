-- stockwell_leads: inbound leads from the Stockwell Media Co website contact
--   form (stock-ctrl.github.io/stockwell-media/website/contact.html).
--
-- Written ONLY by the public `stockwell-lead` edge function using the service
-- role. RLS is on with NO policies, so the anon key cannot read or write it:
-- rows hold a prospect's name, email, phone and message.
--
-- The edge function also enqueues a plungehouse_outbox row per lead, which the
-- M3 poller delivers to Stock as an iMessage; outbox_id links the two.
--
-- Applied to project gzcfawhglecmfxnwfjej on 2026-08-19.

CREATE TABLE IF NOT EXISTS public.stockwell_leads (
    id           bigserial   PRIMARY KEY,
    created_at   timestamptz NOT NULL DEFAULT now(),
    name         text        NOT NULL,
    business     text,
    email        text        NOT NULL,
    phone        text,
    need         text,
    message      text,
    inquiry_mode text        NOT NULL DEFAULT 'standard',  -- standard | private
    source       text        NOT NULL DEFAULT 'website',
    user_agent   text,
    ip_hash      text,        -- salted hash, for rate limiting only
    outbox_id    bigint       -- plungehouse_outbox row that alerted Stock
);

CREATE INDEX IF NOT EXISTS idx_stockwell_leads_created
    ON public.stockwell_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stockwell_leads_ip
    ON public.stockwell_leads (ip_hash, created_at DESC);

ALTER TABLE public.stockwell_leads ENABLE ROW LEVEL SECURITY;
