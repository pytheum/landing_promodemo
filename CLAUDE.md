# Ephemeris — Workbench Prototype

Bloomberg Terminal for prediction markets (Kalshi + Polymarket). This repo holds the **vision prototype** for the YC application — landing page + interactive workbench UI. Full data collection has **not** started; everything shown is illustrative.

## Directory

```
.
├── 02 Landing Light.html          Swiss-glass light landing page
├── 04 Product Demo - final.html   Dark workbench UI (keeper — use this one)
├── 04 Product Demo v2 (1).html    Original workbench, pre-cleanup (reference)
├── 04 Product Demo - banner.html  Disclaimer variant: top strip (superseded)
├── 04 Product Demo - pill.html    Disclaimer variant: bottom-right pill (superseded)
├── 04 Product Demo - modal.html   Disclaimer variant: modal on load (superseded)
├── workbench/
│   └── context-kinds.js           Kind-aware right pane (Dota / NFL / NBA / soccer)
├── archive/                       Older variants (swiss-glass-*, variant-a/b/c/d, etc.)
├── stack.md                       Asset/demo tooling stack + shoot plan for YC app
└── positioning.md                 Product positioning + competitive landscape
```

## Running locally

Open via a local server — **not** `file://` — or the `workbench/context-kinds.js` load may be blocked:

```bash
python3 -m http.server 8787
open "http://localhost:8787/04%20Product%20Demo%20-%20final.html"
open "http://localhost:8787/02%20Landing%20Light.html"
```

## Workbench: what it shows

- **Top bar:** brand, ⌘K search palette, minimal user glyph
- **Category rail:** All / Econ / Politics / Crypto / Sports / Climate / Science / Culture / Geopolitics
- **Left pane (Query):** saved queries list + contract form (symbol, date range, cadence, context toggles) + Run button
- **Center pane:** symbol + question headline (+ outcome ladder for multi-outcome markets) + tabs (Table / Chart / Raw) + price chart with cursor annotations + volume density + scrubber (YouTube-style drag, rAF play sweep)
- **Right pane:** kind-aware context
  - **econ** → headlines, Reddit, polling, on-chain
  - **esports (Dota)** → full minimap with towers (HP states), heroes (HP rings + trails), Roshan pit + net worth bar + hero list
  - **sports_trad (NFL)** → full field with 20-player formation, ball + trail, weather, injuries
  - **nba** → full court (both baskets), 10 players, shot chart, on-floor starters
  - **football (soccer)** → full pitch with 22-player 4-3-3, xG, match stats
- **Status bar:** workspace · query · joined · dataset

## Kind-aware behaviour

`window.CURRENT_KIND` drives:
- Chart x-axis labels (`KIND_AXIS`)
- Chart annotations (`KIND_ANNOTATIONS`)
- Cursor time format (`fmtCursor(idx)`) — days for econ, mm:ss for esports, Q# mm:ss for sports
- Scrubber event ticks
- Right pane renderer (`window.ContextKinds.render(kind, idx, {N})`)

## Saved queries

Defined in `queries` object inside `04 Product Demo - final.html`. Each query has:

- `sym`, `label`, `rows`, `cad`, `kind`
- `question` — natural-language market headline
- `resolution` — resolution rule (binary / multi-outcome + venue)
- `outcomes?` — optional array `[{name, prob}]` for multi-outcome markets (NYC mayor, UCL result, Dota GF)

## Disclaimer

The workbench shows a **prototype modal on first load** + a **persistent banner** along the top. Copy: "Archive not yet online. All values shown are illustrative. Full data collection begins Q3 2026." Clicking the banner reopens the modal.

## Known limitations of the prototype

- 260 display ticks regardless of event duration. Real product needs adaptive aggregation (tick-level for Dota, hourly for 4-month FOMC windows).
- Chart shows single outcome price; multi-outcome markets (NYC mayor, UCL) only show the primary outcome's line on the chart — the outcome ladder is a sidebar, not multiple chart lines.
- Command palette hits are hardcoded.
- Live-tail and "wire→disk" latency claims have been removed — prototype does not measure real latency.
- EVENTS array (econ scrubber ticks for the default econ pane) is hardcoded for FOMC.

## Conventions

- Font: Alliance No.1 (fallback Inter) + JetBrains Mono for tabular / labels
- Palette: `--ink #e8ecef`, `--paper #0a0c0e`, `--cyan #7fc8ff`, `--green #52e9a7`, `--red #ff7a7a`, `--amber #ffb95e`, `--gold #d5b65a`
- All maps are **schematic SVG** (no external tiles, no logos, no team images). Radiant green / Dire red / KC red / BUF cyan / LAL gold / BOS green / RMA cyan / MCI red.
- Landing page uses Swiss-glass light theme (ruled bands, 12-col grid, 300-weight display, mono eyebrow labels).

## Local tooling

- See `stack.md` for the asset + demo tooling stack (Screen Studio, CleanShot X, Shots.so, Ideogram, etc.)
- See `positioning.md` for the YC positioning + competitive landscape
