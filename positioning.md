# Pytheum — Positioning & Competitive Landscape

## Current framing (working)

> **Bloomberg Terminal for prediction markets.**

Every contract on Kalshi and Polymarket, every tick, every surrounding signal. Archived in real time, served as history, forever.

**Why this framing works:**
- Bloomberg is universally understood by the YC/investor audience — no explanation needed.
- "Prediction markets" is the narrower, surprising part that gets attention.
- Positions us as infrastructure/data, not a consumer app or trader.

**Alternative frames considered:**
- "TradingView × event-study research for prediction markets" — too niche, loses the investor shorthand.
- "The archive of prediction markets" — accurate but passive; we are also a live product.
- "Refinitiv / Koyfin for event markets" — Koyfin/Refinitiv are narrower than Bloomberg in brand recognition.

## Close products / competitive landscape

Partial analogs exist. Nobody does the combination (prediction markets + multi-source context + scrubbable UI).

### Closest UX cousin
- **TradingView Replay** — scrub a chart as if watching prices appear live. Bars only. No news/social/polling layer synced to cursor. Stocks/crypto, not prediction markets.

### Price-only historical tools
- **Bloomberg Terminal (HDS, TOPS, event study commands)** — historical tick data + event impact analysis, but as queries, not a scrubbable timeline. Also no prediction market coverage.
- **FactSet / Refinitiv Eikon** — similar to Bloomberg. Institutional, no prediction markets.
- **Koyfin** — historical charts + news overlays, but not time-synced or scrubbable.
- **ThinkorSwim OnDemand** — replay trading workflow. Stocks/options only. No context layer.

### Context-data vendors (the data, not the UI)
- **RavenPack** — timestamped news + sentiment + prices for quantitative backtesting. Dataset, not UI.
- **Dow Jones Newswires** — wire archive, research tool.
- **AlphaSense** — AI search over filings/news. No scrubbable timeline, no prediction markets.
- **GDELT** — open-access global event database. Research tool, not a product.
- **Meltwater** — social listening, not synced to prices.

### Sports-specific replay
- **NBA.com stats, Sportradar** — play-by-play replay with game state. No market prices, no news/social context layered in.
- **DraftKings / FanDuel / ESPN BET dashboards** — live odds + game state, but no historical scrubbable archive with full context.

### Prediction market native
- **Kalshi's and Polymarket's own charts** — price history only, no context layer.
- **Metaforecast, Manifold, Metaculus** — aggregator / forecasting sites. No replay, no context archive.
- **Polymarket Analytics (third-party dashboards)** — price-focused, shallow coverage.

## Key differentiators

1. **Asset class nobody covers.** Kalshi + Polymarket crossed $10B volume in 2025. Every major bank has a desk. No Bloomberg, no Refinitiv, no Koyfin, no dedicated tick vendor.
2. **Multi-source context synced to the cursor.** News + Reddit + X + polls + on-chain + weather + sports telemetry — all keyed to the same timestamp. Nobody else joins this many sources for any market.
3. **History as moat.** Starting the archive in Q3 2026 means a 2028 competitor can never recover the intervening window. Time compounds into a defensible position.
4. **Schematic context panes per contract kind.** Esports (Dota minimap + hero positions + towers + HP), sports (NFL field + formation, NBA full court + shot chart, soccer pitch + 22 players), econ (headlines + polling + on-chain). Same workbench, kind-aware right pane.

## One-line pitch variations

- Full: "Pytheum is the Bloomberg Terminal for prediction markets — every tick, every surrounding signal, archived in real time."
- Short: "Bloomberg Terminal for prediction markets."
- Dev/engineer: "Timestamped tick archive for Kalshi and Polymarket, joined to the news, social, polling, and telemetry around each tick."
- Investor (moat-first): "The archive nobody is keeping. Every day it runs, it becomes harder to replicate."

## Competitive framing for the YC application

When asked "who are your competitors?":

> "TradingView Replay × Bloomberg event studies × prediction markets. No product combines the three for this asset class. TradingView is the UX cousin. Bloomberg is the analytical cousin. Pytheum is the only one that fuses them for event contracts."

When asked "why hasn't Bloomberg built this?":

> "Asset class is too small for them today. It won't be in 18 months. We'd rather own the archive than ship a feature on top of somebody else's data."
