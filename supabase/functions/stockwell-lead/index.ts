// stockwell-lead — inbound contact form for the Stockwell Media Co website.
//
// The site is static (GitHub Pages), so it POSTs here. This function stores the
// lead in stockwell_leads and enqueues a plungehouse_outbox row that the M3
// poller texts to Stock (any `kind` is picked up; deliver_after NULL = now).
//
// verify_jwt is off by design: the form is public. Abuse control is a honeypot
// field, length caps, and per-IP + global rate limits, because every accepted
// lead rings Stock's phone.
//
// No email is sent here by choice. recipients[].email is still populated so the
// existing outbox-fallback cron can email the lead IF the M3 never delivers it.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STOCK_IMESSAGE = "+18167972739";
const STOCK_EMAIL = "stockwellmediaco@gmail.com";

const ALLOWED_ORIGINS = [
    "https://stock-ctrl.github.io",
    "http://localhost:8099",
    "http://127.0.0.1:8099",
];

// Per-IP and site-wide ceilings over the trailing hour. The global cap is the
// one that actually protects Stock's phone from a distributed flood.
const MAX_PER_IP_HOUR = 3;
const MAX_TOTAL_HOUR = 20;

const FALLBACK_GRACE_MIN = 30;

const MAX_LEN: Record<string, number> = {
    name: 120, business: 160, email: 200, phone: 40, need: 120, message: 4000,
};

function corsHeaders(origin: string | null): Record<string, string> {
    const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
        "Vary": "Origin",
    };
}

function json(body: unknown, status: number, origin: string | null) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
}

async function pgrest(path: string, init: RequestInit = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...init,
        headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
            ...(init.headers ?? {}),
        },
    });
    if (!res.ok) {
        throw new Error(`Supabase ${init.method ?? "GET"} ${path}: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return res;
}

// Salted so the table never holds a raw visitor IP; only used to count repeats.
async function hashIp(ip: string): Promise<string> {
    const data = new TextEncoder().encode(`stockwell-lead:${ip}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function countSince(iso: string, ipHash?: string): Promise<number> {
    const filter = ipHash ? `&ip_hash=eq.${ipHash}` : "";
    const res = await pgrest(`stockwell_leads?select=id&created_at=gte.${iso}${filter}`, {
        headers: { Prefer: "count=exact", Range: "0-0" },
    });
    const range = res.headers.get("content-range") ?? "";
    return Number(range.split("/")[1] ?? 0);
}

function clean(v: unknown, field: string): string {
    if (typeof v !== "string") return "";
    return v.trim().slice(0, MAX_LEN[field] ?? 200);
}

function buildMessage(lead: Record<string, string>): string {
    const label = lead.inquiry_mode === "private" ? "PRIVATE INQUIRY" : "New Stockwell lead";
    const header = `${label}: ${lead.name}${lead.business ? ` (${lead.business})` : ""}`;
    const detail = [
        lead.email ? `Email: ${lead.email}` : "",
        lead.phone ? `Phone: ${lead.phone}` : "",
        lead.need ? `Wants: ${lead.need}` : "",
    ].filter(Boolean).join("\n");
    // Blocks are joined with a blank line, so each block is filtered first and
    // the separators survive.
    const body = lead.message
        ? (lead.message.length > 600 ? `${lead.message.slice(0, 600)}…` : lead.message)
        : "";
    return [header, detail, body].filter(Boolean).join("\n\n");
}

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);

    let payload: Record<string, unknown>;
    try {
        payload = await req.json();
    } catch {
        return json({ error: "Invalid JSON" }, 400, origin);
    }

    // Honeypot: a real person never fills a field they cannot see.
    if (clean(payload.company_website, "name")) {
        return json({ ok: true }, 200, origin); // look successful to the bot
    }

    const lead = {
        name: clean(payload.name, "name"),
        business: clean(payload.business, "business"),
        email: clean(payload.email, "email"),
        phone: clean(payload.phone, "phone"),
        need: clean(payload.need, "need"),
        message: clean(payload.message, "message"),
        inquiry_mode: payload.inquiry_mode === "private" ? "private" : "standard",
    };

    if (!lead.name || !lead.email) return json({ error: "Name and email are required." }, 400, origin);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) return json({ error: "That email address does not look right." }, 400, origin);

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const ipHash = await hashIp(ip);
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();

    try {
        const [mine, all] = await Promise.all([countSince(hourAgo, ipHash), countSince(hourAgo)]);
        if (mine >= MAX_PER_IP_HOUR || all >= MAX_TOTAL_HOUR) {
            return json({ error: "We already have your note. Call or email us directly if it is urgent." }, 429, origin);
        }
    } catch (err) {
        console.error(`rate-limit check failed, allowing through: ${err?.message ?? err}`);
    }

    // Store before alerting: a saved lead with a failed text can be recovered,
    // a text about a lead we never kept cannot.
    const insert = await pgrest("stockwell_leads", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
            ...lead,
            user_agent: (req.headers.get("user-agent") ?? "").slice(0, 400),
            ip_hash: ipHash,
        }),
    });
    const row = (await insert.json())[0];

    let outboxId: number | null = null;
    try {
        // fallback_after is NOT NULL with no default; omitting it fails the insert.
        const enqueued = await pgrest("plungehouse_outbox", {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({
                kind: "stockwell_lead",
                body: buildMessage(lead),
                recipients: [{ name: "Stock", imessage: STOCK_IMESSAGE, email: STOCK_EMAIL }],
                fallback_after: new Date(Date.now() + FALLBACK_GRACE_MIN * 60_000).toISOString(),
            }),
        });
        outboxId = (await enqueued.json())[0]?.id ?? null;
        if (outboxId) {
            await pgrest(`stockwell_leads?id=eq.${row.id}`, {
                method: "PATCH",
                headers: { Prefer: "return=minimal" },
                body: JSON.stringify({ outbox_id: outboxId }),
            });
        }
    } catch (err) {
        // The lead is already saved; a failed alert must not lose it.
        console.error(`lead #${row.id} saved but alert enqueue failed: ${err?.message ?? err}`);
    }

    return json({ ok: true, id: row.id, alerted: outboxId !== null }, 200, origin);
});
