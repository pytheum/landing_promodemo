# Pytheum — Asset & Demo Stack

One-time YC application sprint: shoot a demo video and capture landing-page assets from the existing HTML prototypes. The workbench demo is a **vision artifact**, not a live product — full data collection hasn't started. Voiceover should note this honestly.

## What we're shooting (one-time, for the application)

1. **60-second workbench demo video** — recorded from `04 Product Demo v2 (1).html`
2. **Landing page screenshots / OG image** — captured from `02 Landing Light.html`
3. **3–5 hero screenshots** for investor deck / Twitter

## Recommended stack

### Demo video (priority 1)
- **Screen Studio** (Mac, $89 one-time or subscription) — auto-zoom on clicks, smooth cursor, rounded window chrome. Used in ~60% of recent YC Launch videos. This is the single highest-leverage purchase.
- **Descript** ($15/mo) — for narration: word-level edits, auto-transcription, clean filler-word removal. Pairs with Screen Studio footage.

Alternative if not on Mac: **Tella** ($20/mo) — cross-platform.

### Screenshots & mockups
- **CleanShot X** ($10/mo or $29 one-time, Mac) — scroll capture, annotations, blur. Standard YC tool.
- **Shots.so** ($9/mo) — angled 3D mockups. The look you see on every Launch YC page.
- **Playwright** (free) — script pixel-perfect 1440×900 / 1728×1080 captures of both HTML files. Reproducible.

### Landing page imagery
- **Ideogram 2.0** ($8–20/mo) — OG hero with Pytheum wordmark. Better than Midjourney/DALL-E for typography.
- **Satori** (free, Vercel) — JSX → PNG for per-page OG images if we want programmatic.
- **Lucide Icons** (free) — already fintech-appropriate, matches Linear/Vercel/Supabase aesthetic.

### Optional (later, not for application)
- **Arcade** ($32+/mo) — interactive click-through tour embedded on landing page. Skip for application, revisit at launch.
- **Recraft V3** ($10–30/mo) — editable SVG illustrations for brand consistency.
- **Midjourney v7** ($30/mo) — hero atmosphere art.
- **Framer** ($20/mo) — if we ever rebuild landing outside HTML.

## Shoot plan for the application

**Video (60–90s, Screen Studio):**
1. Open workbench full-screen at 1728px.
2. Hover `FOMC_cuts_2026` in saved queries.
3. Show chart with cursor annotations (Bloomberg FOMC, NFP miss).
4. Click Play Sweep — let the playhead scrub across Jan→Apr.
5. Switch to Table tab — show 287k rows, tick flashes.
6. Switch to Raw tab — show JSONL with context fields.
7. Open ⌘K palette — show cross-venue search.
8. Switch category to Sports or Esports — show kind-specific context pane.
9. End on the latency pip + status bar ("wire→disk 318ms").

**Voiceover opener:** "Pytheum is what a Bloomberg Terminal for prediction markets looks like. Here's the workbench we've built; full archive begins [month]."

**Landing captures:**
- Full-page scroll screenshot at 1440px (hero → stats → ASCII → thesis → coverage → FAQ → end CTA).
- Hero-only crop for OG image (1200×630).
- Sample terminal card crop (Coverage section) for Twitter.

## Cost summary
- One-time: Screen Studio ($89) + CleanShot X ($29) = **$118**
- Monthly (only during sprint): Descript + Shots.so + Ideogram ≈ **$40–50/mo**
- Total for application: **~$170**

## What to skip
- **Loom** — looks dated for public launch videos.
- **DALL-E** — beaten by Ideogram on text, Recraft on vectors.
- **Webflow** — Framer won in 2025 among YC.
