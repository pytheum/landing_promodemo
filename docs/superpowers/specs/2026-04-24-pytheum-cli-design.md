# Pytheum CLI — Design Spec

- **Date:** 2026-04-24
- **Status:** Draft (pending user review before plan writing)
- **Project:** `pytheum-cli` — new sibling repo to `landing_promodemo` (not coupled)
- **Scope:** v1 implementation — full REST + WebSocket data foundation for Kalshi and Polymarket, wrapped by a TUI-first interface with scriptable CLI commands

---

## 1. Goals and non-goals

### Goals

1. A keyboard-driven TUI lets a researcher browse both Kalshi and Polymarket using each venue's native taxonomy (category → event → market), open any market via URL paste, search across both venues, and watch live trades/orderbook via WebSockets.
2. A parallel set of scriptable CLI commands exposes the same operations to scripts and pipelines.
3. A **data foundation** that stores raw venue payloads alongside normalized domain models, so future collectors, notebooks, or web UIs can plug into the same seam without re-implementing venue clients.
4. A strong contract for WebSocket resilience: heartbeats, reconnect, gap detection where supported, REST backfill after reconnect, and visible freshness state on every display.
5. Terminal-portability: every critical action has a portable key-binding fallback; state is always conveyed by text label, not color alone.

### Non-goals for v1

- Sentiment / Reddit / news / social feeds of any kind.
- Full collector daemon (designed-for, not shipped — the App Services seam accommodates a future collector).
- Semantic embeddings for search — `EmbeddingAdapter` interface is defined so v2 can slot in.
- Authenticated trading / order placement on either venue.
- Kind-aware right pane (Dota minimap / NFL field / etc.) from the `demo.html` workbench vision.
- Chart annotations, scrubber playback, multi-line outcome-ladder charts.
- Cross-venue normalized volume score or arbitrage alerts.
- Workspaces / multi-tab views.
- Packaged distribution beyond `pip install -e .` / `uvx` — no homebrew / deb / etc. in v1.

---

## 2. Architecture — five layers

```
  ┌──────────────────────────────────────────────────────────────┐
  │  INTERFACES (siblings)                                       │
  │  ─────────────────                                           │
  │  TUI (Textual)       CLI (Typer)       [future: collector,  │
  │                                         notebook, web UI]    │
  └────────────────────────────┬─────────────────────────────────┘
                               │ (plug-and-play seam)
  ┌────────────────────────────▼─────────────────────────────────┐
  │  APP SERVICES                                                │
  │  ────────────                                                │
  │  BrowseService · SearchService · MarketSession ·             │
  │  WatchlistService · URLResolverService · ExportService       │
  └────────────────────────────┬─────────────────────────────────┘
                               │
  ┌────────────────────────────▼─────────────────────────────────┐
  │  NORMALIZED DATA LAYER                                       │
  │  ─────────────────────                                       │
  │  DuckDB (raw + normalized tables) · Models (pydantic v2) ·  │
  │  MarketRepository · TTL memory cache                         │
  └────────────────────────────┬─────────────────────────────────┘
                               │
  ┌────────────────────────────▼─────────────────────────────────┐
  │  VENUE CLIENTS                                               │
  │  ──────────────                                              │
  │  KalshiClient (.rest / .ws)    PolymarketClient (.rest.gamma│
  │                                 / .rest.clob / .rest.data /  │
  │                                 .ws)                         │
  └────────────────────────────┬─────────────────────────────────┘
                               │
  ┌────────────────────────────▼─────────────────────────────────┐
  │  CORE PRIMITIVES                                             │
  │  ────────────────                                            │
  │  AsyncRateLimiter · RetryPolicy · CircuitBreaker ·           │
  │  Pagination · Clock · Logging · Config                       │
  └──────────────────────────────────────────────────────────────┘
```

**Rule of strict direction:** every layer may only import from layers strictly below it. The TUI never imports from venue clients directly; app services never know about Textual; venue clients never know about DuckDB.

### Layer responsibilities

| Layer | Responsibility | Must not |
|---|---|---|
| Interfaces | Render, route user actions, format output | Touch raw venue payloads or HTTP/WS directly |
| App Services | Compose repositories + venue clients into venue-agnostic operations | Hold UI state, leak raw payloads |
| Normalized Data | Persist raw + normalized data, provide typed queries, cache hot reads | Talk to venue APIs directly |
| Venue Clients | Own REST and WS transport per venue; produce raw JSON and normalized models | Know about DuckDB, Textual, or Typer |
| Core Primitives | Cross-cutting infra (rate limit, retry, clock, logging, config) | Know about any specific venue |

### Python package layout

```
pytheum-cli/
├── pyproject.toml
├── README.md
├── uv.lock
├── .env.example
├── .gitignore
├── src/pytheum/
│   ├── __init__.py
│   ├── __main__.py
│   ├── core/                  # L1 primitives
│   │   ├── clock.py
│   │   ├── config.py
│   │   ├── logging.py
│   │   ├── rate_limit.py
│   │   ├── retry.py
│   │   ├── circuit_breaker.py
│   │   └── pagination.py
│   ├── venues/                # L2 venue clients
│   │   ├── kalshi/
│   │   │   ├── client.py
│   │   │   ├── rest.py
│   │   │   ├── ws.py
│   │   │   ├── auth.py        # RSA-PSS signing, stubbed in v1
│   │   │   ├── urls.py
│   │   │   └── normalizer.py
│   │   └── polymarket/
│   │       ├── client.py
│   │       ├── rest_gamma.py
│   │       ├── rest_clob.py
│   │       ├── rest_data.py
│   │       ├── ws.py
│   │       ├── urls.py
│   │       └── normalizer.py
│   ├── data/                  # L3 normalized data
│   │   ├── models.py          # pydantic v2
│   │   ├── storage.py         # DuckDB wrapper
│   │   ├── repository.py      # MarketRepository
│   │   ├── cache.py           # TTL memory cache
│   │   └── schema/            # DDL + migrations
│   ├── services/              # L4 app services
│   │   ├── browse.py
│   │   ├── search.py
│   │   ├── market_session.py
│   │   ├── watchlist.py
│   │   ├── url_resolver.py
│   │   └── export.py
│   ├── cli/                   # L5a Typer
│   │   ├── __init__.py
│   │   ├── markets.py
│   │   ├── events.py
│   │   ├── trades.py
│   │   ├── orderbook.py
│   │   ├── search_cmd.py
│   │   ├── open_cmd.py
│   │   ├── export_cmd.py
│   │   ├── fetch.py
│   │   ├── doctor.py
│   │   ├── watch.py
│   │   └── ui.py
│   └── tui/                   # L5b Textual
│       ├── app.py
│       ├── screens/
│       │   ├── home.py
│       │   ├── explorer.py
│       │   ├── market_detail.py
│       │   ├── search.py
│       │   └── help.py
│       ├── widgets/
│       │   ├── chart.py
│       │   ├── orderbook.py
│       │   ├── trades_tail.py
│       │   ├── freshness_badge.py
│       │   └── footer.py
│       └── theme.py
└── tests/
    ├── fixtures/
    │   ├── kalshi/
    │   └── polymarket/
    ├── venues/
    ├── data/
    ├── services/
    ├── cli/
    └── tui/
```

### Tooling

- **Python ≥ 3.12**
- **uv** for environments + lockfile (`uv sync`, `uv run`, `uvx`)
- **pyproject.toml** PEP 621, src-layout
- **ruff** (lint + format), **mypy** strict on `src/pytheum/`
- **pytest** + **pytest-asyncio** + **pytest-httpx** + **pytest-recording** (VCR) + **hypothesis**
- **Textual snapshot tests** for TUI regression

### Runtime dependencies

`httpx`, `websockets`, `pydantic >= 2`, `duckdb`, `pyarrow`, `rapidfuzz`, `typer`, `rich`, `textual`, `structlog`, `cryptography`, `tomli-w`, `platformdirs`.

---

## 3. Endpoint coverage matrix

### 3.1 Kalshi REST  (`https://api.elections.kalshi.com/trade-api/v2`)

| Resource | Coverage v1 | Endpoint |
|---|---|---|
| Series (category buckets) | ✅ list + detail | `GET /series`, `GET /series/{series_ticker}` |
| Events | ✅ list + detail (with nested markets) | `GET /events`, `GET /events/{event_ticker}` |
| Markets | ✅ list + detail | `GET /markets`, `GET /markets/{ticker}` |
| Orderbook snapshot | ✅ | `GET /markets/{ticker}/orderbook` |
| Trades (live window) | ✅ iterator | `GET /markets/trades?ticker=…` |
| Trades (historical) | ✅ iterator | `GET /historical/trades?ticker=…` |
| Candlesticks (1m / 1h / 1d) | ✅ | `GET /markets/{ticker}/candlesticks`, `GET /historical/candlesticks` |
| Historical cutoff | ✅ | `GET /historical/cutoff` — used to choose live vs historical endpoints |
| Categories | via `series.category` field — not a separate endpoint |
| URL resolution | `https://kalshi.com/markets/{series}/{event_ticker}/{market_ticker}` → `KalshiMarketRef` |

### 3.2 Kalshi WebSocket  (`wss://api.elections.kalshi.com/trade-api/ws/v2`)

| Channel | Coverage v1 | Notes |
|---|---|---|
| `trade` | ✅ | live trades per ticker |
| `orderbook_delta` | ✅ with `seq` gap detection | server emits `seq`; on gap → resub + REST snapshot backfill |
| `ticker` | ✅ | quote updates |
| `market_lifecycle` | ✅ | market open/close/settle events |
| `fill` (authenticated) | ❌ stubbed in v1 (auth deferred) | |
| Heartbeat | ✅ | server ping / client pong; 30s timeout → reconnect |
| Reconnect | ✅ | exponential backoff 1s → 30s, jitter |

### 3.3 Polymarket Gamma REST  (`https://gamma-api.polymarket.com`)

| Resource | Coverage v1 | Endpoint |
|---|---|---|
| Events | ✅ list + detail (by id or slug) | `GET /events`, `GET /events/{id}`, `GET /events/slug/{slug}` |
| Markets | ✅ list + detail | `GET /markets`, `GET /markets/{id}`, `GET /markets/slug/{slug}` |
| Tags (categories) | ✅ | `GET /tags` |
| Search | ✅ (used for fuzzy fallback augmentation) | `GET /search?q=…` |

### 3.4 Polymarket CLOB REST  (`https://clob.polymarket.com`)

| Resource | Coverage v1 | Endpoint |
|---|---|---|
| Orderbook | ✅ single + batch | `GET /book`, `GET /books` |
| Price | ✅ | `GET /price`, `GET /midpoint`, `GET /spread`, `GET /last-trade-price` |
| Tick size | ✅ | `GET /tick-size` |
| Price history | ✅ (intervals: 1h / 6h / 1d / 1w / 1m / all / max) | `GET /prices-history` |
| CLOB markets (cursor-paginated) | ✅ | `GET /markets`, `GET /sampling-markets` |

### 3.5 Polymarket Data REST  (`https://data-api.polymarket.com`)

| Resource | Coverage v1 | Endpoint |
|---|---|---|
| Trades | ✅ iterator | `GET /trades` |
| Open interest | ✅ | `GET /open-interest` |
| Live volume | ✅ | `GET /live-volume` |
| Positions | ❌ v2 (user-scoped, needs auth) | `GET /positions` |
| Activity | ❌ v2 | `GET /activity` |

### 3.6 Polymarket WebSocket  (`wss://ws-subscriptions-clob.polymarket.com/ws`)

| Channel | Coverage v1 | Notes |
|---|---|---|
| `market` public | ✅ | subscribe by `asset_ids` (token_ids) — emits `book`, `price_change`, `last_trade_price`, `tick_size_change` |
| `user` authenticated | ❌ stubbed in v1 (auth deferred) | |
| Heartbeat | ✅ | server pings; client pongs; 30s timeout → reconnect |
| Reconnect + gap | ✅ reconnect; gap detection via timestamp (no native seq #) | on reconnect → REST backfill: `GET /book?token_id=…` |

### 3.7 URL resolution

| Pattern | Resolves to |
|---|---|
| `kalshi.com/markets/{series}/{event}/{market}` | `Venue.KALSHI`, `ticker=market` |
| `kalshi.com/markets/{series}/{event}` | `Venue.KALSHI`, `event_ticker=event` |
| `polymarket.com/event/{event-slug}` | `Venue.POLYMARKET`, `event_slug=…` |
| `polymarket.com/event/{event-slug}/{market-slug}` | `Venue.POLYMARKET`, `event_slug`, `market_slug` |
| `polymarket.com/market/{condition-id}` | `Venue.POLYMARKET`, `condition_id=…` |
| raw Kalshi ticker (e.g. `FED-25DEC-T4.00`) | `Venue.KALSHI`, `ticker=…` |
| raw 66-char hex starting `0x` | `Venue.POLYMARKET`, `condition_id=…` |
| unmatched | `UnresolvedURL` error with the exact string echoed back to the user |

---

## 4. Data model

### 4.1 Normalized models (pydantic v2)

Every normalized row preserves the venue's native identifier(s) and links back to its raw payload.

```python
class Venue(StrEnum):
    KALSHI = "kalshi"
    POLYMARKET = "polymarket"

class Category(BaseModel):
    venue: Venue
    native_id: str          # e.g., Kalshi series_ticker "FED" or Polymarket tag_id
    native_label: str       # raw venue label — always shown to the user
    display_label: str      # best-effort normalized ("Economics")

class Event(BaseModel):
    venue: Venue
    native_id: str          # Kalshi event_ticker / Polymarket event id or slug
    title: str
    category: Category | None
    closes_at: datetime | None
    market_count: int
    aggregate_volume: Decimal | None
    raw_id: int             # FK → raw_rest
    schema_version: int

class Market(BaseModel):
    venue: Venue
    native_id: str          # Kalshi market ticker / Polymarket conditionId
    token_ids: list[str] = []   # Polymarket: YES/NO token_ids; Kalshi: []
    event_native_id: str | None
    title: str
    question: str
    status: Literal["open", "closed", "settled", "unopened", "paused"]
    yes_price: Decimal | None
    no_price: Decimal | None
    volume: Decimal | None          # native venue volume — NOT cross-venue normalized
    volume_metric: Literal["usd_24h", "usd_total", "contracts_24h", "unknown"]
    open_interest: Decimal | None
    liquidity: Decimal | None
    closes_at: datetime | None
    raw_id: int
    schema_version: int

class Trade(BaseModel):
    venue: Venue
    market_native_id: str
    price: Decimal
    size: Decimal
    side: Literal["buy", "sell"] | None
    timestamp: datetime
    raw_id: int
    schema_version: int

class OrderBook(BaseModel):
    venue: Venue
    market_native_id: str
    bids: list[tuple[Decimal, Decimal]]   # (price, size), sorted desc
    asks: list[tuple[Decimal, Decimal]]
    timestamp: datetime
    raw_id: int
    schema_version: int

class PricePoint(BaseModel):
    venue: Venue
    market_native_id: str
    timestamp: datetime
    yes_price: Decimal
    no_price: Decimal | None
    volume: Decimal | None
    interval: Literal["1m", "1h", "1d"]
    raw_id: int
    schema_version: int
```

### 4.2 Freshness / stream state enums

```python
class DataFreshness(StrEnum):
    """REST-derived data freshness. Every displayed object carries one."""
    LIVE        = "LIVE"        # just fetched (age < 5s)
    REFRESHING  = "REFRESHING"  # fetch in flight
    CACHED      = "CACHED"      # cache hit, age < TTL, not being refreshed
    STALE       = "STALE"       # cache hit, age > TTL, not being refreshed
    FAILED      = "FAILED"      # last attempt errored; cached value may still be shown

class StreamState(StrEnum):
    """WS subscription state."""
    CONNECTING   = "CONNECTING"
    LIVE         = "LIVE"
    RECONNECTING = "RECONNECTING"
    DISCONNECTED = "DISCONNECTED"
    FAILED       = "FAILED"
```

**Display rule:** state is conveyed by **text label**, always present; color is optional decoration.

Granularity:
- **List views** (explorer Markets column, search results, watchlist) show a single list-level freshness badge in the pane header (e.g., `Markets · [CACHED · 1m]`). Per-row badges are not rendered — too noisy.
- **Detail views** (market_detail) show one freshness badge per data source: `metadata [LIVE]`, `chart [CACHED · 30s]`, `orderbook [LIVE]` (WS-backed), `trades [LIVE]` (WS-backed).
- **Offline** or **FAILED** states are hoisted to a screen-level banner regardless of granularity.

---

## 5. Storage — DuckDB schema

Single embedded file at `~/.pytheum/pytheum.duckdb`. **Raw first, normalized second.**

### 5.1 Raw tables (append-only)

```sql
CREATE TABLE raw_rest (
    id             BIGINT PRIMARY KEY,
    venue          VARCHAR NOT NULL,
    endpoint       VARCHAR NOT NULL,          -- e.g., "kalshi:/markets/{ticker}"
    request_params JSON,
    received_ts    TIMESTAMPTZ NOT NULL,
    source_ts      TIMESTAMPTZ,               -- venue-provided if available
    schema_version INT NOT NULL,
    native_ids     JSON,                      -- list of native IDs present in payload
    payload        JSON NOT NULL,
    status_code    INT,
    duration_ms    INT
);

CREATE INDEX idx_raw_rest_venue_ep ON raw_rest(venue, endpoint, received_ts);
CREATE INDEX idx_raw_rest_native ON raw_rest USING INDEX (native_ids);

CREATE TABLE raw_ws (
    id             BIGINT PRIMARY KEY,
    venue          VARCHAR NOT NULL,
    channel        VARCHAR NOT NULL,          -- e.g., "kalshi:orderbook_delta"
    subscription   JSON,                      -- subscribe message
    received_ts    TIMESTAMPTZ NOT NULL,
    source_ts      TIMESTAMPTZ,
    sequence_no    BIGINT,                    -- nullable (Polymarket has none)
    schema_version INT NOT NULL,
    native_ids     JSON,
    payload        JSON NOT NULL
);

CREATE INDEX idx_raw_ws_venue_ch ON raw_ws(venue, channel, received_ts);
```

Raw tables are **never deleted** by v1 code; rotation/pruning is a later decision. Persistence is **opt-in** per request (`client.get(..., persist_raw=False)` for hot paths where throughput matters).

### 5.2 Normalized tables

```sql
CREATE TABLE categories (
    venue          VARCHAR NOT NULL,
    native_id      VARCHAR NOT NULL,
    native_label   VARCHAR NOT NULL,
    display_label  VARCHAR NOT NULL,
    raw_id         BIGINT,
    schema_version INT NOT NULL,
    updated_ts     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (venue, native_id)
);

CREATE TABLE events (
    venue              VARCHAR NOT NULL,
    native_id          VARCHAR NOT NULL,
    title              VARCHAR NOT NULL,
    category_venue     VARCHAR,
    category_native_id VARCHAR,
    closes_at          TIMESTAMPTZ,
    market_count       INT,
    aggregate_volume   DECIMAL(20,4),
    raw_id             BIGINT,
    schema_version     INT NOT NULL,
    updated_ts         TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (venue, native_id),
    FOREIGN KEY (category_venue, category_native_id) REFERENCES categories(venue, native_id)
);

CREATE TABLE markets (
    venue           VARCHAR NOT NULL,
    native_id       VARCHAR NOT NULL,
    token_ids       JSON,
    event_native_id VARCHAR,
    title           VARCHAR NOT NULL,
    question        VARCHAR,
    status          VARCHAR NOT NULL,
    yes_price       DECIMAL(10,6),
    no_price        DECIMAL(10,6),
    volume          DECIMAL(20,4),
    volume_metric   VARCHAR NOT NULL,
    open_interest   DECIMAL(20,4),
    liquidity       DECIMAL(20,4),
    closes_at       TIMESTAMPTZ,
    raw_id          BIGINT,
    schema_version  INT NOT NULL,
    updated_ts      TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (venue, native_id)
);

CREATE TABLE trades (
    venue            VARCHAR NOT NULL,
    market_native_id VARCHAR NOT NULL,
    price            DECIMAL(10,6) NOT NULL,
    size             DECIMAL(20,4) NOT NULL,
    side             VARCHAR,
    timestamp        TIMESTAMPTZ NOT NULL,
    raw_id           BIGINT,
    schema_version   INT NOT NULL
);

CREATE INDEX idx_trades_market_time ON trades(venue, market_native_id, timestamp);

CREATE TABLE orderbook_snaps (
    venue            VARCHAR NOT NULL,
    market_native_id VARCHAR NOT NULL,
    bids             JSON NOT NULL,
    asks             JSON NOT NULL,
    timestamp        TIMESTAMPTZ NOT NULL,
    raw_id           BIGINT,
    schema_version   INT NOT NULL
);

CREATE INDEX idx_book_market_time ON orderbook_snaps(venue, market_native_id, timestamp);

CREATE TABLE price_points (
    venue            VARCHAR NOT NULL,
    market_native_id VARCHAR NOT NULL,
    timestamp        TIMESTAMPTZ NOT NULL,
    yes_price        DECIMAL(10,6) NOT NULL,
    no_price         DECIMAL(10,6),
    volume           DECIMAL(20,4),
    interval         VARCHAR NOT NULL,
    raw_id           BIGINT,
    schema_version   INT NOT NULL,
    PRIMARY KEY (venue, market_native_id, interval, timestamp)
);
```

### 5.3 Search index

Built on top of the normalized tables, not a separate system:

```sql
CREATE VIEW searchable_markets AS
SELECT
    venue,
    native_id,
    title,
    question,
    event_native_id,
    -- concatenated searchable blob for rapidfuzz
    concat_ws(' | ', venue, native_id, title, question, coalesce(event_native_id, ''))
        AS search_blob
FROM markets;
```

Service-side search loads titles + tickers + aliases into memory, fuzzy-scores with `rapidfuzz`, and falls back to DuckDB `ILIKE` on the raw blob for exact substring.

### 5.4 Export

Export commands use DuckDB's native:
- `COPY (SELECT ...) TO '{path}' (FORMAT PARQUET)`
- `COPY (SELECT ...) TO '{path}' (FORMAT CSV, HEADER)`
- JSON via `to_json()` aggregation

No separate parquet/CSV writer code.

---

## 6. Auth model

### 6.1 Config slots (defined now, mostly inert in v1)

```toml
# ~/.pytheum/config.toml

[venues.kalshi]
api_key            = ""        # KALSHI-ACCESS-KEY header
private_key_path   = ""        # path to PEM, read lazily; RSA-PSS signing for /portfolio/*
base_url           = "https://api.elections.kalshi.com/trade-api/v2"
ws_url             = "wss://api.elections.kalshi.com/trade-api/ws/v2"
rate_limit_per_sec = 10

[venues.polymarket]
# Polymarket auth slots reserved for future trading features
funder_address     = ""
signer_private_key = ""        # reads from keyring if empty
gamma_url          = "https://gamma-api.polymarket.com"
clob_url           = "https://clob.polymarket.com"
data_url           = "https://data-api.polymarket.com"
ws_url             = "wss://ws-subscriptions-clob.polymarket.com/ws"
rate_limit_per_sec = 10

[storage]
duckdb_path        = "~/.pytheum/pytheum.duckdb"
watchlist_path    = "~/.pytheum/watchlist.toml"
exports_dir        = "~/.pytheum/exports"
logs_dir           = "~/.pytheum/logs"

[tui]
theme              = "dark"    # dark | light | high-contrast
```

Environment overrides via `PYTHEUM_*` prefix: `PYTHEUM_VENUES__KALSHI__API_KEY=…`.

### 6.2 v1 auth behavior

- **Public mode (default):** nothing to configure. Every public endpoint listed in §3 works out of the box.
- **Authenticated mode (reserved):** if `api_key` + `private_key_path` are set, Kalshi client attaches `KALSHI-ACCESS-KEY` / `KALSHI-ACCESS-SIGNATURE` / `KALSHI-ACCESS-TIMESTAMP` headers. The RSA-PSS signing code ships as a tested module (ported from algodawg patterns, rewritten) but no v1 user-facing command requires auth.

### 6.3 Secrets handling

- Secrets never logged (structlog processor scrubs known key names).
- `private_key_path` values are resolved relative to the config file; bare filenames are rejected.
- Keyring support (via `keyring` lib) is stubbed behind a `--keyring` flag; v1 reads from config/env only.

---

## 7. WebSocket resilience

All WS clients implement this contract:

| Requirement | Kalshi | Polymarket |
|---|---|---|
| Heartbeat | respond to server ping with pong; client-side 45s idle watchdog — any frame received resets it, expiry forces reconnect (exact venue ping cadence verified empirically during implementation) | same client-side contract: respond to pings, 45s idle watchdog |
| Reconnect policy | exponential backoff 1s → 30s, jitter ±20%, infinite retries; circuit breaker trips after 10 consecutive failures | same |
| Subscription replay | on reconnect, re-send all active subscriptions before emitting LIVE | same |
| Sequence-gap detection | `orderbook_delta.seq` — on gap → refetch full book via REST, emit `book_reset` event | no native seq — detect by `message_timestamp` regression; on gap → refetch via `GET /book` |
| Per-channel error handling | a single channel's error or malformed frame does not tear down the session | same |
| Freshness indicator | exposes `StreamState` per subscription | same |

### 7.1 WS event stream shape

Every venue WS exposes a uniform async iterator:

```python
async with client.ws.subscribe(channels=["trade", "orderbook_delta"], tickers=[...]) as stream:
    async for event in stream:
        # event: WSEvent with fields: venue, channel, native_ids, source_ts, received_ts,
        #        sequence_no?, payload (raw), normalized (Trade | OrderBook | ...), state
        ...
    # on exit, stream closes cleanly; state transitions emitted as events too
```

State-change events (CONNECTING → LIVE → RECONNECTING → LIVE) are in-band, not callbacks.

---

## 8. Search — hybrid deterministic

### 8.1 Fields indexed

Every market's `search_blob`, built at normalize time, contains: `title`, `question`, `venue`, `native_id` (ticker / conditionId), `event_native_id`, `event_title`, `category.native_label`, `category.display_label`, `tags[]`, `aliases[]`, `token_ids[]`, full market URL.

### 8.2 Query pipeline

1. **Exact match** — URL paste, full ticker, full conditionId, full token_id → bypass search, route to `URLResolverService`.
2. **Substring** — DuckDB `ILIKE` over `search_blob` (fast, deterministic).
3. **Fuzzy** — rapidfuzz `token_set_ratio` over `search_blob`; threshold 70.
4. **Merge and rank** — dedupe by `(venue, native_id)`; rank by: exact > substring > fuzzy score; within each tier sort by native volume desc.
5. **Filter** — optional `--venue` constraint applied after ranking.

### 8.3 Embedding adapter seam for v2

```python
class EmbeddingAdapter(Protocol):
    async def embed(self, text: str) -> list[float]: ...
    async def knn(self, query_vec: list[float], k: int) -> list[SearchHit]: ...
```

`SearchService` composes the deterministic pipeline + an optional `EmbeddingAdapter`. v1 ships the deterministic path and a `NullEmbeddingAdapter`.

---

## 9. Volume / ranking

- **Within a venue:** rank by the venue's native volume field. Expose `volume_metric` so the UI can label it honestly (`usd_24h` vs `usd_total` vs `contracts_24h`).
- **Across venues (search):** display each result alongside a venue badge + the native metric, each labeled. **No cross-venue normalized score.**
- **Fallback ladder** when volume is unavailable: `volume → open_interest → liquidity → "—"` (never fabricate).
- Event ranking: sum of child market volumes using the same metric; if children use mixed metrics (shouldn't happen within a venue but guard anyway), fall back to "—".

---

## 10. Categories — venue-native with normalization

- Kalshi: derived from `series.category` field.
- Polymarket: derived from `/tags` endpoint, filtered to user-visible top-level categories (excluding technical/internal tags).
- **Navigation uses the venue's native category list.** No forced cross-venue taxonomy.
- A best-effort `display_label` normalizes obvious synonyms for the "Categories" column, but the **`native_label` is always shown to the user** in the breadcrumb and in the market's metadata.
- Example: a market from Polymarket tag `"politics"` shows under `Politics` in the explorer, but the market-detail header says `category: politics (polymarket)`.

---

## 11. TUI specification

### 11.1 Screens

| Screen | Entry | Purpose |
|---|---|---|
| `home` | `pytheum` start, or `esc` from any top-level screen | Mode selector: Kalshi / Polymarket / Search / Paste URL / Watchlist |
| `explorer` | from `home` after venue pick | Miller columns: Categories → Events → Markets |
| `market_detail` | from explorer / search / URL paste | Full market view: metadata + chart + orderbook + live trades |
| `search` | `/` from home, or `:search <q>` anywhere | Flat cross-venue results with venue badges |
| `help` (overlay) | `?` anywhere | Full keymap with portable fallbacks |

### 11.2 Screen states

Every screen must handle:

| State | Behavior |
|---|---|
| **empty** | explicit message + a suggested next action ("No markets match this filter. Press `/` to broaden search.") |
| **loading** | inline spinner + source label ("Fetching from Kalshi…") |
| **error** | error message + retry instruction ("Couldn't reach Kalshi: connection timeout. Press `r` to retry, `esc` to go back.") |
| **offline** | banner at top: "OFFLINE — showing cached data (age: 2m)." Cached rows show `[CACHED · 2m]`. |
| **malformed URL** | (URL paste only) "Couldn't parse `<input>`. Supported patterns: kalshi.com/markets/…, polymarket.com/event/…, polymarket.com/market/…" |
| **empty watchlist** | "No markets saved yet. Open any market and press `s` to save." |

### 11.3 Keyboard map (v1)

Every action has at least one **portable** binding (works on any xterm-compatible terminal). Where a second binding exists, it is also bound — not a conditional fallback. `⌘K` is NOT bound; `ctrl+k` is universal and works on macOS too.

| Portable binding | Also bound | Action |
|---|---|---|
| `↑ ↓ ← →` | — | move in focused pane (4-directional) |
| `ctrl+u` `ctrl+d` | `shift+↑` `shift+↓` (terminal-dependent) | page up / page down |
| `alt+→` `alt+←` | `shift+→` `shift+←` (terminal-dependent) | big horizontal jump |
| `g` | `ctrl+a` | jump to top of pane |
| `G` | `ctrl+e` | jump to bottom of pane |
| `tab` / `shift+tab` | — | cycle panes forward / back |
| `ctrl+1` `ctrl+2` `ctrl+3` | — | focus pane 1 / 2 / 3 directly |
| `enter` | — | open / drill into selected |
| `space` | — | toggle · pause live stream |
| `esc` | `backspace` | go up one level / dismiss overlay |
| `/` | — | search within current pane |
| `ctrl+k` | — | global command palette |
| `:` | — | command mode |
| `?` | — | help overlay |
| `r` | — | refresh current view |
| `s` | — | save to watchlist |
| `d` | — | remove from watchlist |
| `e` | — | export dialog |
| `y` | — | yank ticker / URL / row JSON |
| `p` | — | pin market |
| `v` | — | cycle venue filter |
| `f` | — | open filters panel |
| `c` | — | cycle category |
| `t` | — | cycle time range |
| `z` | — | zen · maximize center pane |
| `x` | — | clear live-tail buffer |
| `n` / `N` | — | next / previous search result |
| `q` | — | quit |

Bindings marked "terminal-dependent" are offered best-effort; the portable binding is always available and is what the help overlay recommends.

**Every screen renders a persistent footer** listing the contextually valid shortcuts (~5–8 items). `?` opens the full map overlay.

### 11.4 Command mode `:`

Tab-completion supported. v1 commands:

| Command | Behavior |
|---|---|
| `:open <url>` | resolve URL and open market detail |
| `:search <query>` | open search screen with pre-filled query |
| `:export parquet [--out <path>]` | export current view to parquet (falls back to `~/.pytheum/exports/<timestamp>.parquet`) |
| `:export csv [--out <path>]` | same, CSV |
| `:export json [--out <path>]` | same, JSON lines |
| `:watch` | show watchlist screen |
| `:watch add` / `:watch remove` | manage current market's watchlist membership |
| `:refresh` | force refresh of current view |
| `:theme {dark\|light\|high-contrast}` | switch theme |
| `:venue {all\|kalshi\|polymarket}` | set venue filter |
| `:doctor` | run health checks inline |
| `:quit` / `:q` | quit |

### 11.5 Accessibility

- **State is always text.** `[LIVE]`, `[STALE · 2m]`, `[RECONNECTING · 3]`, `[FAILED]` — text label first; color is optional decoration.
- **Focus rings** on panes (border thickens/brightens; not color-only).
- **High-contrast theme** (`:theme high-contrast`) drops all tinted backgrounds in favor of white-on-black + bold text.
- **Persistent footer** on every screen — no shortcut is ever "discoverable only by accident."
- Chart / orderbook alternates: a `:chart ascii` command (deferred to phase 5) renders the last price curve as ASCII line art for screen-reader-ish contexts.

---

## 12. Scriptable CLI commands

All commands call the same App Services as the TUI. Non-TTY stdout → JSON lines; TTY stdout → Rich-rendered table.

| Command | Purpose |
|---|---|
| `pytheum` | launch TUI (alias for `pytheum ui`) |
| `pytheum ui` | launch TUI explicitly |
| `pytheum search <query> [--venue ...] [--limit N]` | cross-venue search |
| `pytheum open <url>` | resolve URL → market detail (TUI if TTY, JSON otherwise) |
| `pytheum markets list [--venue ...] [--category ...] [--event ...] [--status ...] [--limit N]` | list markets |
| `pytheum markets show <ticker-or-id>` | single market with freshness header |
| `pytheum events list [--venue ...] [--category ...]` | list events |
| `pytheum events show <event-id>` | single event with nested markets |
| `pytheum trades tail <ticker> [--duration 5m]` | live WS tail; Ctrl-C to stop |
| `pytheum trades history <ticker> [--from ...] [--to ...]` | historical trades |
| `pytheum orderbook <ticker>` | snapshot |
| `pytheum fetch market <ticker>` | REST-fetch + normalize + persist (no display) |
| `pytheum export <scope> --format {parquet\|csv\|json} --out <path>` | scope: `market <id>` / `event <id>` / `search <query>` / `watchlist` |
| `pytheum watch {add\|remove\|list} [<market>]` | watchlist ops |
| `pytheum doctor` | health checks (see §13) |
| `pytheum --version` | prints version |

### 12.1 Output mode

- TTY → Rich tables + color
- Piped → JSON lines, one object per row, schema-stable (pydantic `model_dump_json`)
- `--json` / `--table` flags override auto-detection

---

## 13. Observability — `pytheum doctor`

Health check command. Output:

```
pytheum doctor
──────────────
[OK]    Python 3.12.5
[OK]    DuckDB 0.9.2 · file ~/.pytheum/pytheum.duckdb (12 MB, writable)
[OK]    Config file ~/.pytheum/config.toml (valid)
[OK]    Logs dir ~/.pytheum/logs (writable)
[OK]    Kalshi REST reachable (GET /series?limit=1 · 143ms)
[OK]    Kalshi WS reachable (handshake OK · 201ms)
[OK]    Polymarket Gamma reachable (GET /tags · 97ms)
[OK]    Polymarket CLOB reachable (GET /tick-size?token_id=… · 112ms)
[OK]    Polymarket Data reachable (GET /live-volume · 88ms)
[OK]    Polymarket WS reachable (handshake OK · 178ms)
[OK]    Terminal: xterm-256color · truecolor · unicode
[WARN]  Keyring backend unavailable — secrets will be read from config/env only
```

Exit code: `0` = all OK, `1` = any FAIL, `2` = WARN only.

### 13.1 Logging

- `structlog` configured for JSON output to `~/.pytheum/logs/pytheum.jsonl` (daily-rotated).
- Log events include: HTTP request/response (sans body unless `PYTHEUM_DEBUG_HTTP_BODIES=1`), WS frame send/recv counts per channel, reconnect attempts, schema-drift warnings, normalizer failures with the raw payload `raw_id` for post-hoc inspection.
- Secrets (API keys, signing output) scrubbed by a structlog processor.

---

## 14. Local paths

| Path | Purpose |
|---|---|
| `~/.pytheum/config.toml` | user config (see §6.1) |
| `~/.pytheum/pytheum.duckdb` | primary storage (raw + normalized) |
| `~/.pytheum/watchlist.toml` | editable watchlist |
| `~/.pytheum/logs/` | daily-rotated JSON logs |
| `~/.pytheum/exports/` | default export destination |
| `~/.pytheum/kalshi_private_key.pem` | optional — path is configurable |

Paths use `platformdirs` for cross-platform correctness (`~/.pytheum/` on macOS/Linux; `%APPDATA%\Pytheum\` on Windows).

---

## 15. Testing strategy

| Layer | Approach |
|---|---|
| Core primitives | unit tests with injected `Clock` for deterministic time; hypothesis for rate-limit invariants |
| Venue REST | `pytest-httpx` + recorded cassettes (VCR-style); schema-drift fixtures with intentionally malformed payloads asserting `SchemaDriftError` preserves the raw payload |
| Venue WS | recorded JSONL replay fixtures — record a real 60s session once, replay deterministically; reconnect/gap/heartbeat tested via a scripted fake WS server |
| Normalized data | unit tests on normalizers; roundtrip: raw → normalize → persist → re-read → compare |
| App services | unit tests with in-memory DuckDB + fake venue clients |
| CLI commands | `typer.testing.CliRunner` with mocked services |
| TUI | Textual snapshot tests per screen state (empty / loading / error / offline / loaded) |

CI: every PR runs `uv sync && ruff check && mypy src && pytest --cov=pytheum`.

---

## 16. Implementation phases

| Phase | Scope | Definition of done |
|---|---|---|
| 1 · Foundation | repo scaffold (pyproject + uv + ruff + mypy + pytest), core primitives (config, clock, logging, rate_limit, retry, circuit_breaker, pagination), DuckDB schema + migrations, pydantic models | `pytheum doctor` runs (partial); unit tests pass |
| 2 · Venue clients | Kalshi REST + WS with all endpoints in §3.1/3.2; Polymarket Gamma + CLOB + Data REST + WS with all endpoints in §3.3–3.6; URL resolvers; normalizers | fixture-based tests pass for every endpoint; recorded WS replay passes |
| 3 · App services | BrowseService, SearchService, MarketSession, WatchlistService, URLResolverService, ExportService | service-level tests pass; CLI one-shots work end-to-end |
| 4 · TUI | home, explorer, search, market detail, help overlay, command palette, footer, all screen states | snapshot tests per state; manual walkthrough of every keyboard action |
| 5 · Hardening | fake venue server fixtures, schema-drift fixtures, accessibility pass (high-contrast theme, focus rings, text labels), packaging (`uv build`, entry points) | accessibility checklist green; `pip install .` works from a fresh venv |
| 6 · Collector-ready | freshness tracking service, scheduled refresh contracts, replay-from-raw-logs tool | designed for — demonstration tool reads `raw_rest` + `raw_ws` and reconstructs normalized state; no daemon shipped |

---

## 17. Open items tracked for future phases

- Authenticated endpoints (Kalshi portfolio, Polymarket user channel + order placement)
- `EmbeddingAdapter` implementation (sentence-transformers? OpenAI?)
- Kind-aware right pane (Dota / NFL / NBA / soccer context)
- Scrubber playback over historical ticks
- Cross-venue normalized ranking (only if we ever have a defensible metric)
- Social / sentiment / news pipelines
- Full collector daemon
- Packaged distribution (homebrew, deb, PyInstaller single binary)

---

## 18. Glossary

- **Venue:** one of `kalshi`, `polymarket`
- **Native ID:** the venue's primary identifier for a market (Kalshi `ticker`; Polymarket `conditionId`). Always preserved.
- **Raw payload:** the exact JSON returned by the venue API/WS, stored in `raw_rest` or `raw_ws`.
- **Schema version:** integer incremented whenever a normalizer's output shape changes. Every normalized row carries the version it was produced under.
- **Freshness:** text-labeled state of a REST-derived display (`LIVE`, `REFRESHING`, `CACHED`, `STALE`, `FAILED`).
- **Stream state:** text-labeled state of a WS subscription (`CONNECTING`, `LIVE`, `RECONNECTING`, `DISCONNECTED`, `FAILED`).
- **Plug-and-play seam:** the App Services layer — the only layer an alternative interface (collector, notebook, web UI) needs to depend on.
