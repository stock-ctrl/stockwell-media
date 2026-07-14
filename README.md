# Stockwell Media Co — Website

Marketing site for Stockwell Media Co. Static HTML/CSS/JS (no build step). Migrated out of Claude Design into this repo on 2026-07-13 for full control + model choice + real deployment.

## Structure

```
stockwell-media/
├── styles.css              # entry stylesheet (just @imports colors_and_type.css)
├── colors_and_type.css     # BRAND SOURCE OF TRUTH — color + type tokens
├── website/
│   ├── index.html          # homepage (NEW hero + realistic estimator + live material pricing)
│   ├── services.html       # 3 pillars (original — pending polish pass)
│   ├── about.html          # story + values (original — pending polish pass)
│   ├── contact.html        # contact form (demo submit — NOT wired to a backend yet)
│   ├── site.css            # site layout styles
│   └── tweaks.js           # OLD Claude Design editor panel — UNUSED, archival only
└── assets/logos/favicon.svg
```

## Preview locally

```bash
cd stockwell-media
python3 -m http.server 8080
# open http://localhost:8080/website/index.html
```

Fonts (Google), icons (Lucide), and the estimator aerial (Unsplash) load from CDNs, so preview online.

## Brand (source of truth = `colors_and_type.css`)

- **Colors:** Forest `#1b3221` (primary), Sage `#5a8040` / `#a8c994` (accent), Cream `#f4efe4` / Paper `#f6f0e3` (ground), Ink `#0d1410` (deepest). **No amber, no red/yellow status colors** — state is shown with forest/sage contrast.
- **Type:** Jost (display + body), Spectral (editorial serif — used for the Private Client world), JetBrains Mono (labels/eyebrows/spec).
- **Voice:** straight, sharp, plain English. **No em dashes** (commas/colons/periods). No emoji.
- **Positioning:** serious systems studio. Dashboards + daily briefs lead; the trades estimator is a proof point, not the identity.

> Note: the original Claude Design project also has a `README.md` / `SKILL.md`, but they're **stale** (old Inter Tight / amber / trades-platform positioning). They were intentionally NOT imported. A fresh Stockwell brand skill for Claude Code is planned.

## Status / TODO

- [x] Homepage: new hero (daily-brief dashboard), realistic photo estimator with live material pricing, anti-slop pass (em dashes, thinned eyebrows, inline automation list).
- [ ] Apply the same polish pass to services / about / contact (em dashes, positioning).
- [ ] Wire the contact form to a real inbox/CRM (currently a demo that just shows a success card).
- [ ] Swap the estimator aerial for a real job photo (or self-host the image).
- [ ] Build a Stockwell Media brand skill for consistency.
- [ ] Deploy (Vercel → stockwellmedia.co).
