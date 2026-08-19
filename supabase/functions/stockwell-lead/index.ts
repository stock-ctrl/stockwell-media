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
// Every lead is (a) stored, (b) texted to Stock via the outbox, and (c) emailed
// to the Stockwell inbox over Gmail SMTP. The email is best-effort: it runs after
// the lead is safely stored, and its outcome is recorded in email_status.

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

// ---- Gmail SMTP over TLS, ported from plungehouse-ingest/lib/email.js ----
// Deno has no net.connect, so this is Deno.connectTls with the same AUTH LOGIN
// conversation. Credentials come from stockwell_secrets (service-role only),
// NOT app_state: that table is readable with the publishable key that ships in
// the public dashboards.

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;
const SMTP_TIMEOUT_MS = 20_000;

async function loadSmtpCreds(): Promise<{ user: string; pass: string } | null> {
    try {
        const res = await pgrest("stockwell_secrets?select=key,value&key=in.(stockwell_smtp_user,stockwell_smtp_pass)");
        const rows: Array<{ key: string; value: string }> = await res.json();
        const user = rows.find((r) => r.key === "stockwell_smtp_user")?.value;
        const pass = rows.find((r) => r.key === "stockwell_smtp_pass")?.value;
        return user && pass ? { user, pass } : null;
    } catch (err) {
        console.error(`could not load SMTP credentials: ${err?.message ?? err}`);
        return null;
    }
}

async function sendEmail(
    { to, replyTo, subject, text, user, pass }:
    { to: string; replyTo?: string; subject: string; text: string; user: string; pass: string },
): Promise<void> {
    const conn = await Deno.connectTls({ hostname: SMTP_HOST, port: SMTP_PORT });
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const buf = new Uint8Array(8192);

    const readReply = async (): Promise<string> => {
        let out = "";
        while (true) {
            const n = await Promise.race([
                conn.read(buf),
                new Promise<never>((_, rej) => setTimeout(() => rej(new Error("SMTP read timeout")), SMTP_TIMEOUT_MS)),
            ]);
            if (n === null) break;
            out += dec.decode(buf.subarray(0, n as number));
            // A reply is complete when its LAST line is "<code> " (space, not dash).
            const lines = out.split("\r\n").filter(Boolean);
            const last = lines[lines.length - 1];
            if (last && /^\d{3} /.test(last)) break;
        }
        return out;
    };

    const cmd = async (line: string | null, expect: number[]): Promise<string> => {
        if (line !== null) await conn.write(enc.encode(`${line}\r\n`));
        const reply = await readReply();
        const lines = reply.split("\r\n").filter(Boolean);
        const code = Number(lines[lines.length - 1]?.slice(0, 3));
        if (expect.length && !expect.includes(code)) {
            throw new Error(`SMTP rejected "${line?.slice(0, 20) ?? "(greeting)"}": ${reply.trim().slice(0, 160)}`);
        }
        return reply;
    };

    try {
        await cmd(null, [220]);
        await cmd("EHLO stockwell-lead", [250]);
        await cmd("AUTH LOGIN", [334]);
        await cmd(btoa(user), [334]);
        await cmd(btoa(pass), [235]);
        await cmd(`MAIL FROM:<${user}>`, [250]);
        await cmd(`RCPT TO:<${to}>`, [250, 251]);
        await cmd("DATA", [354]);

        const headers = [
            `From: Stockwell Website <${user}>`,
            `To: ${to}`,
            replyTo ? `Reply-To: ${replyTo}` : "",
            `Subject: ${subject}`,
            `Date: ${new Date().toUTCString()}`,
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: 8bit",
        ].filter(Boolean).join("\r\n");
        // Dot-stuff lines starting with "." per RFC 5321.
        const body = text.replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
        await cmd(`${headers}\r\n\r\n${body}\r\n.`, [250]);
        await cmd("QUIT", [221]);
    } finally {
        try { conn.close(); } catch { /* already closed */ }
    }
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

    // Email last: the lead is already stored and the text already queued, so a
    // Gmail outage degrades to "texted but not emailed" rather than a lost lead.
    let emailStatus = "skipped:no-credentials";
    try {
        const creds = await loadSmtpCreds();
        if (creds) {
            await sendEmail({
                to: STOCK_EMAIL,
                replyTo: lead.email,
                subject: lead.inquiry_mode === "private"
                    ? `Private inquiry from ${lead.name}`
                    : `New lead: ${lead.name}${lead.business ? ` (${lead.business})` : ""}`,
                text: buildMessage(lead),
                user: creds.user,
                pass: creds.pass,
            });
            emailStatus = "sent";
        }
    } catch (err) {
        emailStatus = `failed:${String(err?.message ?? err).slice(0, 120)}`;
        console.error(`lead #${row.id} email failed: ${emailStatus}`);
    }
    try {
        await pgrest(`stockwell_leads?id=eq.${row.id}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ email_status: emailStatus }),
        });
    } catch { /* status is cosmetic; never fail the request over it */ }

    return json({ ok: true, id: row.id, alerted: outboxId !== null, email: emailStatus }, 200, origin);
});
