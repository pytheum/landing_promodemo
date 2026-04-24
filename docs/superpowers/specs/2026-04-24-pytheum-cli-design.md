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
  │  WatchlistService · RefResolverService · ExportService       │
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
│   │   ├── ref_resolver.py
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
│       │   ├── watchlist.py
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

`httpx`, `websockets`, `pydantic >= 2`, `duckdb`, `pyarrow`, `rapidfuzz`, `typer`, `rich`, `textual`, `structlog`, `cryptography`, `tomli-w`, `keyring`.

---

## 3. Endpoint coverage matrix

**Status of this section: provisional.** The tables below enumerate the endpoints we intend to cover in v1, drawn from venue docs and the algodawg review. Before any endpoint is marked "implemented" during Phase 2, it must pass this checklist:

1. **Live fixture captured** — one real response saved to `tests/fixtures/{venue}/` as JSON
2. **Response schema documented** — either via pydantic model + tests or a `.schema.json` alongside the fixture
3. **Pagination behavior confirmed** — cursor / offset / none, with page-size limits
4. **Rate-limit behavior confirmed** — observed headers (X-RateLimit-*), documented in code comments
5. **Normalizer test** — a unit test that takes the fixture and produces the expected normalized model(s)
6. **Error-path test** — a unit test for the venue's common error shape (401 / 404 / 429 / 5xx)

If any of the six is missing for a given endpoint at the end of Phase 2, that endpoint reverts to "deferred" status and does not ship in v1.

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
| Reconnect | ✅ exponential backoff; full REST backfill on reconnect: `GET /book?token_id=…` for every active subscription | |
| Reconciliation | ✅ periodic REST reconciliation (configurable interval) — no native sequence number means this is the only way to catch dropped messages | see §7 for the full contract |

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

**Raw persistence is mandatory for any row in a normalized table.** Every normalized row's `raw_id` points into the single `raw_payloads` table (§5.1) — a globally-unique identifier, no per-transport ambiguity. Objects held in memory by the TTL cache may have `raw_id = None` (not yet persisted), but `MarketRepository.upsert(...)` rejects any write without a matching `raw_id`. There is no `persist_raw=False` flag — if you want ephemeral data, use the cache, not the repository.

**Outcomes are first-class.** Orderbooks, trades, and price points attach to `(venue, market_native_id, outcome_id)`, not to the market alone. Every binary market has exactly two Outcome rows; multi-outcome Polymarket events are still modelled as N sibling Markets (venue-native), but each of those Markets has two Outcomes (YES / NO tokens) with their own token_ids and per-side books.

```python
class Venue(StrEnum):
    KALSHI = "kalshi"
    POLYMARKET = "polymarket"

class PriceUnit(StrEnum):
    PROB_1_0  = "probability_1_0"   # [0.0, 1.0]  ← normalized
    CENTS_100 = "cents_100"         # Kalshi native (0-100)
    USDC      = "usdc"              # Polymarket native

class SizeUnit(StrEnum):
    CONTRACTS = "contracts"         # Kalshi
    SHARES    = "shares"            # Polymarket token count
    USDC      = "usdc"              # USDC notional

class VolumeMetric(StrEnum):
    USD_24H        = "usd_24h"
    USD_TOTAL      = "usd_total"
    CONTRACTS_24H  = "contracts_24h"
    CONTRACTS_TOTAL = "contracts_total"
    UNKNOWN        = "unknown"

class Category(BaseModel):
    venue: Venue
    native_id: str           # Kalshi series_ticker ("FED") or Polymarket tag_id
    native_label: str        # raw venue label — always shown to the user
    display_label: str       # best-effort normalized ("Economics")

class Event(BaseModel):
    venue: Venue
    native_id: str           # Kalshi event_ticker / Polymarket event id-or-slug
    title: str
    primary_category: Category | None
    tags: list[Category] = Field(default_factory=list)   # Polymarket may have multiple
    closes_at: datetime | None
    market_count: int
    aggregate_volume: Decimal | None
    volume_metric: VolumeMetric
    url: str | None                           # canonical venue URL
    raw_id: int | None = None                 # None in memory; required for DB writes
    schema_version: int

class Outcome(BaseModel):
    venue: Venue
    market_native_id: str                     # FK → markets
    outcome_id: str                           # Kalshi: "yes"/"no" · Polymarket: token_id
    token_id: str | None                      # Polymarket only (== outcome_id there)
    label: str                                # "YES" / "NO" / "Eric Adams" etc.
    price: Decimal | None                     # normalized [0.0, 1.0]
    native_price: Decimal | None              # venue's raw value
    price_unit: PriceUnit
    volume: Decimal | None                    # in volume_metric units
    volume_metric: VolumeMetric
    is_resolved: bool = False
    resolution: bool | None = None            # None while open; True/False after settle
    raw_id: int | None = None
    schema_version: int

class Market(BaseModel):
    venue: Venue
    native_id: str                            # Kalshi market ticker / Polymarket conditionId
    event_native_id: str | None
    title: str
    question: str
    status: Literal["open", "closed", "settled", "unopened", "paused"]
    outcomes: list[Outcome]                   # length 2 for binary
    total_volume: Decimal | None              # native venue value
    volume_metric: VolumeMetric
    open_interest: Decimal | None
    liquidity: Decimal | None
    closes_at: datetime | None
    url: str | None                           # canonical venue URL
    raw_id: int | None = None
    schema_version: int

class Trade(BaseModel):
    venue: Venue
    market_native_id: str
    outcome_id: str                           # which side traded
    price: Decimal                            # normalized [0, 1]
    native_price: Decimal                     # raw venue value
    price_unit: PriceUnit
    size: Decimal                             # normalized count
    native_size: Decimal
    size_unit: SizeUnit
    notional: Decimal | None                  # size * price, in currency
    currency: Literal["usd", "usdc"]
    side: Literal["buy", "sell"] | None
    timestamp: datetime
    raw_id: int | None = None
    schema_version: int

class OrderBook(BaseModel):
    venue: Venue
    market_native_id: str
    outcome_id: str                           # per-side book — required
    bids: list[tuple[Decimal, Decimal]]       # (price, size), normalized units, sorted desc
    asks: list[tuple[Decimal, Decimal]]
    price_unit: PriceUnit
    size_unit: SizeUnit
    timestamp: datetime
    raw_id: int | None = None
    schema_version: int

class PricePoint(BaseModel):
    venue: Venue
    market_native_id: str
    outcome_id: str                           # per-side history
    timestamp: datetime
    price: Decimal                            # normalized [0, 1]
    native_price: Decimal
    price_unit: PriceUnit
    volume: Decimal | None
    volume_metric: VolumeMetric
    interval: Literal["1m", "5m", "1h", "6h", "1d", "1w", "1mo", "all", "max"]
    raw_id: int | None = None
    schema_version: int
```

**Note on interval values:** the set above is the union of what Kalshi (1m/1h/1d) and Polymarket CLOB (1h/6h/1d/1w/1m/all/max) expose; `1mo` (1 month) is used internally to avoid collision with `1m` (1 minute).

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

### 4.3 MarketRef / EventRef — first-class identifier

Every place in the system that refers to a market or event uses a typed reference. URL resolution, CLI args, watchlist entries, TUI navigation, and the command palette all go through `MarketRef`.

```python
class RefType(StrEnum):
    KALSHI_TICKER           = "kalshi_ticker"          # "FED-25DEC-T4.00"
    KALSHI_EVENT_TICKER     = "kalshi_event_ticker"    # "FED-25DEC"
    POLYMARKET_CONDITION_ID = "polymarket_condition_id"  # 66-char 0x…
    POLYMARKET_TOKEN_ID     = "polymarket_token_id"      # decimal string
    POLYMARKET_EVENT_SLUG   = "polymarket_event_slug"    # "nyc-mayoral-2026"
    POLYMARKET_MARKET_SLUG  = "polymarket_market_slug"   # "eric-adams-wins-nyc-mayor-2026"
    URL                     = "url"                     # full venue URL

class MarketRef(BaseModel):
    venue: Venue
    ref_type: RefType
    value: str
    outcome_id: str | None = None         # optional — points at a specific side

class EventRef(BaseModel):
    venue: Venue
    ref_type: RefType
    value: str
```

`MarketRef` / `EventRef` are **inert data objects** — pydantic models with no I/O methods. Any resolution (slug → condition_id, URL → MarketRef, token_id → condition_id) happens in **`RefResolverService`** at the App Services layer, which can reach repositories and venue clients as needed. This keeps the model free of layer violations.

```python
class RefResolverService(Protocol):
    async def parse(self, raw: str) -> MarketRef | EventRef:
        """Accept a URL, ticker, conditionId, token_id, or slug and return the
        best ref. Raises MalformedURL / UnresolvedRef on ambiguity or failure."""

    async def canonicalize(self, ref: MarketRef) -> MarketRef:
        """Promote a ref to the venue's primary form: KALSHI_TICKER on Kalshi,
        POLYMARKET_CONDITION_ID on Polymarket. May call the venue to resolve
        slugs or token_ids to conditionId."""
```

CLI args that take a market accept any `RefType` and auto-detect via regex — `pytheum markets show FED-25DEC-T4.00` vs `pytheum markets show 0xabc…` vs `pytheum markets show --ref-type polymarket_market_slug fomc-dec-2025-cut-25bps`. Ambiguous input (e.g., a short token id) fails fast with a clear error listing the detected candidates.

### 4.4 Service return type and error types

All App Services return a typed envelope, `ServiceResult[T]`, that carries the value **plus** a freshness label and an optional non-fatal warning. This avoids the "exception that also carries data" anti-pattern for the common stale-cache case: success paths and soft-failure paths use the same channel, and exceptions are reserved for hard failures that prevent returning anything.

```python
from typing import Generic, TypeVar
T = TypeVar("T")

@dataclass(frozen=True)
class ServiceResult(Generic[T]):
    value: T
    freshness: DataFreshness           # LIVE | REFRESHING | CACHED | STALE | FAILED
    warning: "PytheumError | None" = None   # non-fatal; caller decides whether to surface
    age_s: float | None = None         # cache age when freshness is CACHED/STALE
```

**Stale-cache path:** when the network call fails and only a value past its hard TTL is available (§5.5), the service returns `ServiceResult(value=cached, freshness=STALE, warning=VenueUnavailable(...), age_s=...)`. The UI inspects `freshness` + `warning` and decides how to render (e.g., screen-level offline banner + per-pane `[STALE · 12m]` badge). **No separate `StaleCacheOnly` exception.**

Hard failures (no cached value at all, protocol errors, auth missing for a required endpoint) still raise:

```python
class PytheumError(Exception): ...

class RateLimited(PytheumError):
    venue: Venue
    retry_after_s: float | None

class VenueUnavailable(PytheumError):
    venue: Venue
    status_code: int | None
    cause: Exception | None

class AuthRequired(PytheumError):
    venue: Venue
    endpoint: str

class MalformedURL(PytheumError):
    raw_input: str
    supported_patterns: list[str]

class UnresolvedRef(PytheumError):
    ref: MarketRef
    reason: str

class SchemaDrift(PytheumError):
    venue: Venue
    endpoint: str
    raw_id: int            # raw payload preserved for post-hoc inspection
    validator_errors: list[str]

class NoResults(PytheumError):
    query: str
    scope: str             # "search" | "markets" | "events" | "watchlist"

class UnsupportedEndpoint(PytheumError):
    venue: Venue
    endpoint: str
    reason: str            # e.g., "authenticated, deferred to v2"
```

`VenueUnavailable` is the only error that typically appears as a `ServiceResult.warning` (when it accompanies a stale-cache value); the others are raised.

---

## 5. Storage — DuckDB schema

Single embedded file at `~/.pytheum/pytheum.duckdb`. **Raw first, normalized second.**

### 5.1 Raw payloads (single append-only table)

A **single** `raw_payloads` table with a `transport` column — not one table per transport. This gives every normalized row an unambiguous FK target (`raw_payloads.id` is globally unique) and lets queries span REST + WS without a UNION.

```sql
CREATE SEQUENCE seq_raw_payloads START 1;

CREATE TABLE raw_payloads (
    id             BIGINT        PRIMARY KEY DEFAULT nextval('seq_raw_payloads'),
    venue          VARCHAR       NOT NULL,
    transport      VARCHAR       NOT NULL,       -- 'rest' | 'ws'
    endpoint       VARCHAR       NOT NULL,       -- REST path or WS channel
    request_params JSON,                         -- REST query params / WS subscribe msg
    received_ts    TIMESTAMPTZ   NOT NULL,
    source_ts      TIMESTAMPTZ,
    sequence_no    BIGINT,                       -- WS only (nullable for REST)
    schema_version INT           NOT NULL,
    native_ids     VARCHAR[]     NOT NULL DEFAULT [],
    payload        JSON          NOT NULL,
    status_code    INT,                          -- REST only
    duration_ms    INT,                          -- REST only
    created_ts     TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (transport IN ('rest', 'ws'))
);
CREATE INDEX idx_raw_venue_transport_ep ON raw_payloads(venue, transport, endpoint, received_ts);
```

**Rule:** raw persistence is **mandatory for any data that becomes a normalized row**. Callers that want ephemeral read-through (e.g., a fast live tail) use the in-memory TTL cache and never touch the repository. There is no `persist_raw=False` flag — the two paths are separate code paths.

`raw_payloads` is **never deleted** by v1 code; rotation / pruning is a post-v1 decision.

### 5.2 Normalized tables

**Provenance rule.** All **venue-derived entity/fact tables** (`categories`, `events`, `markets`, `outcomes`, `trades`, `orderbook_snaps`, `price_points`) include `raw_id BIGINT NOT NULL` as a foreign key into `raw_payloads.id` (§5.1). For brevity the DDL below omits the `FOREIGN KEY (raw_id) REFERENCES raw_payloads(id)` clause on each of these tables, but the implementation adds it to all of them.

**Exceptions** — two tables document their source differently:
- **`event_tags`** is a derived join table; its provenance is the `raw_id` on the parent `events` row (and on the `categories` rows it links to). No separate `raw_id` column.
- **`market_aliases`** carries user-authored or heuristic entries, not venue payloads. Its `source` column (`"user" | "heuristic" | "venue"`) documents the origin instead.

Migrations live in `src/pytheum/data/schema/` as numbered SQL files and run at startup.

```sql
CREATE TABLE categories (
    venue          VARCHAR NOT NULL,
    native_id      VARCHAR NOT NULL,
    native_label   VARCHAR NOT NULL,
    display_label  VARCHAR NOT NULL,
    raw_id         BIGINT NOT NULL,
    schema_version INT NOT NULL,
    updated_ts     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (venue, native_id)
);

CREATE TABLE events (
    venue                      VARCHAR NOT NULL,
    native_id                  VARCHAR NOT NULL,
    title                      VARCHAR NOT NULL,
    primary_category_venue     VARCHAR,
    primary_category_native_id VARCHAR,
    closes_at                  TIMESTAMPTZ,
    market_count               INT,
    aggregate_volume           DECIMAL(20,4),
    volume_metric              VARCHAR NOT NULL,
    url                        VARCHAR,
    raw_id                     BIGINT NOT NULL,
    schema_version             INT NOT NULL,
    updated_ts                 TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (venue, native_id),
    FOREIGN KEY (primary_category_venue, primary_category_native_id)
        REFERENCES categories(venue, native_id)
);

-- many-to-many: Polymarket events can carry multiple tags
CREATE TABLE event_tags (
    event_venue      VARCHAR NOT NULL,
    event_native_id  VARCHAR NOT NULL,
    tag_venue        VARCHAR NOT NULL,
    tag_native_id    VARCHAR NOT NULL,
    PRIMARY KEY (event_venue, event_native_id, tag_venue, tag_native_id),
    FOREIGN KEY (event_venue, event_native_id) REFERENCES events(venue, native_id),
    FOREIGN KEY (tag_venue, tag_native_id)     REFERENCES categories(venue, native_id)
);

CREATE TABLE markets (
    venue           VARCHAR NOT NULL,
    native_id       VARCHAR NOT NULL,
    event_venue     VARCHAR,
    event_native_id VARCHAR,
    title           VARCHAR NOT NULL,
    question        VARCHAR,
    status          VARCHAR NOT NULL,
    total_volume    DECIMAL(20,4),
    volume_metric   VARCHAR NOT NULL,
    open_interest   DECIMAL(20,4),
    liquidity       DECIMAL(20,4),
    closes_at       TIMESTAMPTZ,
    url             VARCHAR,
    raw_id          BIGINT NOT NULL,
    schema_version  INT NOT NULL,
    updated_ts      TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (venue, native_id),
    FOREIGN KEY (event_venue, event_native_id) REFERENCES events(venue, native_id)
);

CREATE TABLE outcomes (
    venue            VARCHAR NOT NULL,
    market_native_id VARCHAR NOT NULL,
    outcome_id       VARCHAR NOT NULL,         -- Kalshi "yes"/"no" · Polymarket token_id
    token_id         VARCHAR,                  -- Polymarket only
    label            VARCHAR NOT NULL,
    price            DECIMAL(10,6),            -- normalized [0,1]
    native_price     DECIMAL(20,6),
    price_unit       VARCHAR NOT NULL,
    volume           DECIMAL(20,4),
    volume_metric    VARCHAR NOT NULL,
    is_resolved      BOOLEAN NOT NULL DEFAULT FALSE,
    resolution       BOOLEAN,
    raw_id           BIGINT NOT NULL,
    schema_version   INT NOT NULL,
    updated_ts       TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (venue, market_native_id, outcome_id),
    FOREIGN KEY (venue, market_native_id) REFERENCES markets(venue, native_id)
);

CREATE INDEX idx_outcomes_token ON outcomes(venue, token_id);

-- user-added or heuristic aliases for search
CREATE TABLE market_aliases (
    venue            VARCHAR NOT NULL,
    market_native_id VARCHAR NOT NULL,
    alias            VARCHAR NOT NULL,
    source           VARCHAR NOT NULL,         -- "user" | "heuristic" | "venue"
    PRIMARY KEY (venue, market_native_id, alias),
    FOREIGN KEY (venue, market_native_id) REFERENCES markets(venue, native_id)
);

CREATE TABLE trades (
    venue            VARCHAR NOT NULL,
    market_native_id VARCHAR NOT NULL,
    outcome_id       VARCHAR NOT NULL,
    price            DECIMAL(10,6) NOT NULL,
    native_price     DECIMAL(20,6) NOT NULL,
    price_unit       VARCHAR NOT NULL,
    size             DECIMAL(20,4) NOT NULL,
    native_size      DECIMAL(20,4) NOT NULL,
    size_unit        VARCHAR NOT NULL,
    notional         DECIMAL(20,4),
    currency         VARCHAR NOT NULL,
    side             VARCHAR,
    timestamp        TIMESTAMPTZ NOT NULL,
    raw_id           BIGINT NOT NULL,
    schema_version   INT NOT NULL
);
CREATE INDEX idx_trades_mkt_out_time ON trades(venue, market_native_id, outcome_id, timestamp);

CREATE TABLE orderbook_snaps (
    venue            VARCHAR NOT NULL,
    market_native_id VARCHAR NOT NULL,
    outcome_id       VARCHAR NOT NULL,
    bids             JSON NOT NULL,            -- [[price, size], ...]
    asks             JSON NOT NULL,
    price_unit       VARCHAR NOT NULL,
    size_unit        VARCHAR NOT NULL,
    timestamp        TIMESTAMPTZ NOT NULL,
    raw_id           BIGINT NOT NULL,
    schema_version   INT NOT NULL
);
CREATE INDEX idx_book_mkt_out_time ON orderbook_snaps(venue, market_native_id, outcome_id, timestamp);

CREATE TABLE price_points (
    venue            VARCHAR NOT NULL,
    market_native_id VARCHAR NOT NULL,
    outcome_id       VARCHAR NOT NULL,
    timestamp        TIMESTAMPTZ NOT NULL,
    price            DECIMAL(10,6) NOT NULL,
    native_price     DECIMAL(20,6) NOT NULL,
    price_unit       VARCHAR NOT NULL,
    volume           DECIMAL(20,4),
    volume_metric    VARCHAR NOT NULL,
    interval         VARCHAR NOT NULL,         -- 1m | 5m | 1h | 6h | 1d | 1w | 1mo | all | max
    raw_id           BIGINT NOT NULL,
    schema_version   INT NOT NULL,
    PRIMARY KEY (venue, market_native_id, outcome_id, interval, timestamp)
);
```

### 5.3 Search index

Built on top of the normalized tables with explicit joins so every field listed in §8.1 is actually present in the searchable blob.

```sql
CREATE VIEW searchable_markets AS
SELECT
    m.venue,
    m.native_id,
    m.title                  AS market_title,
    m.question,
    m.url                    AS market_url,
    m.event_venue,
    m.event_native_id,
    e.title                  AS event_title,
    e.url                    AS event_url,
    c.native_id              AS primary_category_native_id,
    c.native_label           AS primary_category_native_label,
    c.display_label          AS primary_category_display_label,
    -- outcome-side info (token_ids, labels, resolution)
    (SELECT list_transform(list(o.token_id), x -> coalesce(x, ''))
       FROM outcomes o
       WHERE o.venue = m.venue AND o.market_native_id = m.native_id) AS token_ids,
    (SELECT list(o.label)
       FROM outcomes o
       WHERE o.venue = m.venue AND o.market_native_id = m.native_id) AS outcome_labels,
    -- event tags (polymarket-style many-to-many)
    (SELECT list(tag_c.native_label)
       FROM event_tags et
       JOIN categories tag_c
         ON et.tag_venue = tag_c.venue AND et.tag_native_id = tag_c.native_id
       WHERE et.event_venue = m.event_venue
         AND et.event_native_id = m.event_native_id) AS tags,
    -- user + heuristic aliases
    (SELECT list(a.alias)
       FROM market_aliases a
       WHERE a.venue = m.venue AND a.market_native_id = m.native_id) AS aliases,
    -- concatenated blob for rapidfuzz / ILIKE — must include every
    -- field §8.1 claims is searchable, including list columns flattened
    concat_ws(' | ',
        m.venue,
        m.native_id,
        m.title,
        coalesce(m.question, ''),
        coalesce(m.url, ''),
        coalesce(e.title, ''),
        coalesce(e.url, ''),
        coalesce(c.native_label, ''),
        coalesce(c.display_label, ''),
        -- list columns flattened; NULL-safe via coalesce
        coalesce(list_string_agg(
            (SELECT list(o.token_id) FROM outcomes o
              WHERE o.venue = m.venue AND o.market_native_id = m.native_id), ' '), ''),
        coalesce(list_string_agg(
            (SELECT list(o.label) FROM outcomes o
              WHERE o.venue = m.venue AND o.market_native_id = m.native_id), ' '), ''),
        coalesce(list_string_agg(
            (SELECT list(tag_c.native_label)
               FROM event_tags et
               JOIN categories tag_c
                 ON et.tag_venue = tag_c.venue AND et.tag_native_id = tag_c.native_id
               WHERE et.event_venue = m.event_venue
                 AND et.event_native_id = m.event_native_id), ' '), ''),
        coalesce(list_string_agg(
            (SELECT list(a.alias) FROM market_aliases a
              WHERE a.venue = m.venue AND a.market_native_id = m.native_id), ' '), '')
    ) AS search_blob
FROM markets m
LEFT JOIN events e
    ON m.event_venue = e.venue AND m.event_native_id = e.native_id
LEFT JOIN categories c
    ON e.primary_category_venue = c.venue
   AND e.primary_category_native_id = c.native_id;
```

Service-side search (§8) loads `search_blob` + list columns into memory, runs exact / substring / rapidfuzz pipeline, and merges results. The `EmbeddingAdapter` (v2) operates on the same per-row document.

### 5.4 Export

Export commands use DuckDB's native:
- `COPY (SELECT ...) TO '{path}' (FORMAT PARQUET)`
- `COPY (SELECT ...) TO '{path}' (FORMAT CSV, HEADER)`
- JSON via `to_json()` aggregation

No separate parquet/CSV writer code.

### 5.5 Cache TTLs

The TTL cache sits between services and the repository; it never persists. These defaults drive the freshness-badge math (§4.2).

| Resource | TTL | Stale-cache hard limit |
|---|---|---|
| Categories list | 1h | 24h |
| Events list | 5m | 1h |
| Markets list (per filter) | 2m | 15m |
| Market detail | 30s | 5m |
| Outcome (per-side price) | 10s | 2m |
| Orderbook snapshot (REST) | 5s | 30s |
| Trades (REST historical page) | 30s | 10m |
| Price history (per interval) | 5m | 1h |
| Tags / search index rebuild | 15m | 1h |

Once data crosses the stale-cache hard limit and the network path has failed, the service returns `ServiceResult(value=cached, freshness=STALE, warning=VenueUnavailable(...), age_s=…)` — the UI decides whether to show it (§4.4). WS-backed data doesn't use these TTLs; it tracks `StreamState` directly.

TTLs are overridable via config:

```toml
[cache.ttl_s]
categories         = 3600
events_list        = 300
markets_list       = 120
market_detail      = 30
outcome            = 10
orderbook_rest     = 5
trades_rest        = 30
price_history      = 300
tags               = 900
```

---

## 6. Auth model

### 6.1 Config slots (defined now, mostly inert in v1)

**Secrets policy:** no raw private keys in TOML, ever. The config holds only non-secret identifiers and **references** to where a secret should be read from (an env var name or a keyring service name). The config file is safe to `cat`, commit as an `.example`, or share for support.

```toml
# ~/.pytheum/config.toml

[venues.kalshi]
# Public endpoints work without any of the below.
api_key_env_var           = "PYTHEUM_KALSHI_API_KEY"      # reads the KEY (not the name)
private_key_path          = ""                            # filesystem path to PEM
private_key_keyring       = ""                            # alt: keyring service name
base_url                  = "https://api.elections.kalshi.com/trade-api/v2"
ws_url                    = "wss://api.elections.kalshi.com/trade-api/ws/v2"
rate_limit_per_sec        = 10

[venues.polymarket]
# Authenticated trading is deferred to v2. These slots only hold references.
funder_address            = ""                            # public address (non-secret)
signer_private_key_env    = ""                            # env var NAME that holds the key
signer_private_key_keyring = ""                           # alt: keyring service name
gamma_url                 = "https://gamma-api.polymarket.com"
clob_url                  = "https://clob.polymarket.com"
data_url                  = "https://data-api.polymarket.com"
ws_url                    = "wss://ws-subscriptions-clob.polymarket.com/ws"
rate_limit_per_sec        = 10

[storage]
duckdb_path               = "~/.pytheum/pytheum.duckdb"
watchlist_path            = "~/.pytheum/watchlist.toml"
exports_dir               = "~/.pytheum/exports"
logs_dir                  = "~/.pytheum/logs"

[tui]
theme                     = "dark"   # dark | light | high-contrast
```

Environment overrides via `PYTHEUM_*` prefix for non-secret fields: `PYTHEUM_VENUES__KALSHI__RATE_LIMIT_PER_SEC=5`. **Secrets are never read from `PYTHEUM_VENUES__…` — only through the env-var-name or keyring-service slots above.** Config validation rejects any attempt to stuff a raw key into the config.

### 6.2 v1 auth behavior

- **Public mode (default):** nothing to configure. Every public endpoint listed in §3 works out of the box.
- **Authenticated mode (reserved):** the Kalshi client, at startup, resolves the API key by reading `api_key_env_var` (an env var name) and fetching the private key from either `private_key_path` (filesystem PEM) or `private_key_keyring` (keyring service name). If any required secret is missing, the client raises `AuthRequired` only when a private endpoint is actually called — public endpoints remain available. When both are present, the client attaches `KALSHI-ACCESS-KEY` / `KALSHI-ACCESS-SIGNATURE` / `KALSHI-ACCESS-TIMESTAMP` headers. The RSA-PSS signing code ships as a tested module, but no v1 user-facing command requires auth.

### 6.3 Secrets handling

- No raw secrets in config files — only references (env var names or keyring service names). Config validation rejects any field whose name doesn't end in `_env_var` / `_env` / `_keyring` / `_path` from containing long random strings.
- Secrets never logged (structlog processor scrubs known key names).
- `private_key_path` values are resolved relative to the config file; bare filenames are rejected.
- Keyring support (via `keyring` lib) is shipped in v1 as the preferred secrets backend; env var references are the portable fallback.

### 6.4 Watchlist TOML schema

The watchlist is a human-editable TOML file at `~/.pytheum/watchlist.toml`. Hand edits survive DB resets, and `pytheum watch add / remove` mutate it atomically (write-to-temp, rename).

```toml
# ~/.pytheum/watchlist.toml

[[entries]]
venue       = "kalshi"
ref_type    = "kalshi_ticker"
value       = "FED-25DEC-T4.00"
outcome_id  = "yes"                    # optional — pin a specific side
label       = "FOMC Dec ≤ 4.00% (YES)" # optional — shown in UI, auto-filled if empty
notes       = ""                       # free-form
added_ts    = 2026-04-24T12:00:00Z
tags        = ["fomc", "macro"]        # user-level tags, separate from venue tags

[[entries]]
venue       = "polymarket"
ref_type    = "polymarket_condition_id"
value       = "0xabc123…"
outcome_id  = ""                       # empty → watch both sides
label       = ""
notes       = ""
added_ts    = 2026-04-24T12:05:00Z
tags        = []
```

Any row that fails validation on load is surfaced as a warning banner on TUI start; the rest of the watchlist loads normally.

---

## 7. WebSocket resilience

All WS clients implement this contract:

| Requirement | Kalshi | Polymarket |
|---|---|---|
| Heartbeat | respond to server ping with pong; client-side 45s idle watchdog — any frame received resets it, expiry forces reconnect (exact venue ping cadence verified empirically during implementation) | same client-side contract: respond to pings, 45s idle watchdog |
| Reconnect policy | exponential backoff 1s → 30s, jitter ±20%, infinite retries; circuit breaker trips after 10 consecutive failures | same |
| Subscription replay | on reconnect, re-send all active subscriptions before emitting LIVE | same |
| Sequence-gap detection | `orderbook_delta.seq` — deterministic. On gap → refetch full book via REST, emit `book_reset` event | **No deterministic gap detection** — Polymarket exposes no sequence number. Can detect out-of-order messages via timestamp regression (not missing ones). Strategy: periodic REST reconciliation (`GET /book` every N seconds per subscription, configurable), plus full REST backfill on every reconnect. Emit `book_reset` events from the reconciliation path. |
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

1. **Exact match** — URL paste, full ticker, full conditionId, full token_id → bypass search, route to `RefResolverService`.
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

- Kalshi: each event has a single category derived from its `series.category`. One `primary_category` per event; `tags[]` is empty.
- Polymarket: each event has zero-or-more tags. The **highest-weight** tag (per Polymarket's own ordering) becomes `primary_category`; the rest land in `tags[]`. This drives the Explorer's Categories column while preserving multi-tag membership for search.
- **Navigation uses the venue's native category list.** No forced cross-venue taxonomy.
- A best-effort `display_label` normalizes obvious synonyms for the "Categories" column header, but the **`native_label` is always shown** in the breadcrumb and in the market-detail metadata.
- Example: a Polymarket event tagged `politics` + `us-elections` + `2026` lands under `Politics` in the Explorer with `primary_category = politics`; the market-detail header reads `category: politics (polymarket) · tags: us-elections, 2026`.
- Tags from Polymarket are persisted to the `event_tags` join table (§5.2) so they participate in search and can be filtered in the future without a schema change.

---

## 11. TUI specification

### 11.1 Screens

| Screen | Entry | Purpose |
|---|---|---|
| `home` | `pytheum` start, or `esc` from any top-level screen | Mode selector: Kalshi / Polymarket / Search / Paste URL / Watchlist |
| `explorer` | from `home` after venue pick | Miller columns: Categories → Events → Markets |
| `market_detail` | from explorer / search / watchlist / URL paste | Full market view: metadata + chart + orderbook + live trades |
| `search` | `/` from home, or `:search <q>` anywhere | Flat cross-venue results with venue badges |
| `watchlist` | Watchlist on `home`, or `:watch` anywhere | Saved markets from `~/.pytheum/watchlist.toml`; columns: venue, label, ticker/id, outcome, last-seen price, added. `enter` opens market_detail; `d` removes; `r` refreshes all; `s` from market_detail adds. Empty state: "No markets saved yet. Open any market and press `s` to save." |
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

**Quit safety.** Accidental `q` is common in keyboard-heavy TUIs:
- On the **home** screen, `q` quits immediately.
- On **any other screen**, `q` puts the footer into a "press q again to quit" prompt for 2 seconds; a second `q` confirms, any other key cancels. `ctrl+c` still quits without confirmation (escape hatch).
- `:quit` / `:q` from command mode always quits immediately regardless of screen.

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

All commands call the same App Services as the TUI. Non-TTY stdout → JSON lines; TTY stdout → Rich-rendered table. Every `<market-ref>` / `<event-ref>` argument accepts any `RefType` (§4.3): ticker, conditionId, token_id, slug, or URL. `RefResolverService.parse()` disambiguates; ambiguous input fails with a listed-candidates error.

| Command | Purpose |
|---|---|
| `pytheum` | launch TUI (alias for `pytheum ui`) |
| `pytheum ui [--open <market-ref>]` | launch TUI; `--open` jumps straight into the market detail screen for the resolved ref |
| `pytheum search <query> [--venue ...] [--limit N]` | cross-venue search |
| `pytheum open <market-ref>` | resolve ref, print a Rich detail view on TTY / JSON on pipe. **Never launches the TUI** — use `pytheum ui --open <ref>` for that. |
| `pytheum markets list [--venue ...] [--category ...] [--event <event-ref>] [--status ...] [--limit N]` | list markets |
| `pytheum markets show <market-ref> [--outcome <outcome-id>]` | single market with freshness header; `--outcome` narrows to one side |
| `pytheum events list [--venue ...] [--category ...]` | list events |
| `pytheum events show <event-ref>` | single event with nested markets |
| `pytheum trades tail <market-ref> [--outcome <outcome-id>] [--duration 5m]` | live WS tail; Polymarket requires an outcome (token), Kalshi can tail either side or both; Ctrl-C to stop |
| `pytheum trades history <market-ref> [--outcome <outcome-id>] [--from ...] [--to ...]` | historical trades |
| `pytheum orderbook <market-ref> --outcome <outcome-id>` | per-side orderbook snapshot; **`--outcome` is required on Polymarket** (books are per-token); Kalshi defaults to rendering both sides |
| `pytheum fetch market <market-ref>` | REST-fetch + normalize + persist (no display) |
| `pytheum export <scope> --format {parquet\|csv\|json} --out <path>` | scope: `market <market-ref>` / `event <event-ref>` / `search <query>` / `watchlist` |
| `pytheum watch {add\|remove\|list} [<market-ref>] [--outcome <outcome-id>]` | watchlist ops; `--outcome` pins a specific side |
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
[OK]    Polymarket CLOB reachable (GET /markets?limit=1 · 112ms)
[OK]    Polymarket Data reachable (GET /live-volume · 88ms)
[OK]    Polymarket WS reachable (handshake OK · 178ms)
[OK]    Terminal: xterm-256color · truecolor · unicode
[OK]    Keyring backend: macOS Keychain
```

**Check design rule:** every check hits an endpoint that requires **no caller-provided dynamic parameters**. `GET /tick-size?token_id=…` is explicitly avoided because a live token id varies between runs — a doctor failure on that check would be indistinguishable from a real outage. Same reasoning behind `GET /markets?limit=1` (lists any one CLOB market) and `GET /live-volume` (takes no required filter).

Exit code: `0` = all OK, `1` = any FAIL, `2` = WARN only.

### 13.1 Logging

- `structlog` configured for JSON output to `~/.pytheum/logs/pytheum.jsonl` (daily-rotated).
- Log events include: HTTP request/response (sans body unless `PYTHEUM_DEBUG_HTTP_BODIES=1`), WS frame send/recv counts per channel, reconnect attempts, schema-drift warnings, normalizer failures with the raw payload `raw_id` for post-hoc inspection.
- Secrets (API keys, signing output) scrubbed by a structlog processor.

---

## 14. Local paths

v1 uses a single, explicitly hardcoded root: **`~/.pytheum/`** (`$HOME/.pytheum/` on macOS/Linux; `%USERPROFILE%\.pytheum\` on Windows). We deliberately do **not** use `platformdirs` — a developer CLI benefits from a predictable path you can `cd` into, and a `~/.pytheum/` dot-directory is the long-standing pattern for this class of tool (compare `~/.aws/`, `~/.gnupg/`, `~/.cargo/`). `platformdirs` is dropped from the runtime deps in §2.

| Path | Purpose |
|---|---|
| `~/.pytheum/config.toml` | user config (see §6.1) |
| `~/.pytheum/pytheum.duckdb` | primary storage (raw + normalized) |
| `~/.pytheum/watchlist.toml` | editable watchlist |
| `~/.pytheum/logs/` | daily-rotated JSON logs |
| `~/.pytheum/exports/` | default export destination |
| `~/.pytheum/kalshi_private_key.pem` | optional — path is configurable |

Every path is overridable via `[storage]` in `config.toml`. Users who prefer XDG conventions can point each slot at `$XDG_CONFIG_HOME / $XDG_DATA_HOME` themselves.

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
| 1 · Foundation | repo scaffold (pyproject + uv + ruff + mypy + pytest), core primitives (config, clock, logging, rate_limit, retry, circuit_breaker, pagination), DuckDB schema + migrations, pydantic models | `pytheum doctor` runs (partial); unit tests pass; **DDL execution test** runs every migration + view against a fresh DuckDB and asserts success (catches syntax drift e.g. in the search view's `list_string_agg`) |
| 2 · Venue clients | Kalshi REST + WS with all endpoints in §3.1/3.2; Polymarket Gamma + CLOB + Data REST + WS with all endpoints in §3.3–3.6; ref resolvers; normalizers | fixture-based tests pass for every endpoint; recorded WS replay passes; **every schema file under `data/schema/` has a corresponding "execute-and-inspect" test** |
| 3 · App services | BrowseService, SearchService, MarketSession, WatchlistService, RefResolverService, ExportService | service-level tests pass; CLI one-shots work end-to-end |
| 4 · TUI | home, explorer, search, market detail, **watchlist**, help overlay, command palette, footer, all screen states | snapshot tests per state (including watchlist empty/loaded); manual walkthrough of every keyboard action |
| 5 · Hardening | fake venue server fixtures, schema-drift fixtures, accessibility pass (high-contrast theme, focus rings, text labels), packaging (`uv build`, entry points) | accessibility checklist green; `pip install .` works from a fresh venv |
| 6 · Collector-ready | freshness tracking service, scheduled refresh contracts, replay-from-raw-logs tool | designed for — demonstration tool reads `raw_payloads` (filtered by transport) and reconstructs normalized state; no daemon shipped |

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

- **Venue:** one of `kalshi`, `polymarket`.
- **Native ID:** the venue's primary identifier for a market (Kalshi `ticker`; Polymarket `conditionId`). Always preserved.
- **Outcome:** one side of a market (YES or NO, or a named outcome for extended types). Orderbooks, trades, and price points all attach to `(venue, market_native_id, outcome_id)`, not to the market as a whole. Polymarket outcomes carry a distinct `token_id`.
- **MarketRef / EventRef:** typed reference used everywhere a market or event is named — URL resolver, CLI args, watchlist entries, TUI navigation, command palette. Has `venue`, `ref_type`, `value`, optional `outcome_id`.
- **Raw payload:** the exact JSON returned by the venue API/WS, stored in the single `raw_payloads` table (distinguished by the `transport` column). Persistence is mandatory for any row that lands in a normalized table (no `persist_raw=False`).
- **Schema version:** integer incremented whenever a normalizer's output shape changes. Every normalized row carries the version it was produced under.
- **Price unit / size unit:** `PriceUnit` (`probability_1_0` / `cents_100` / `usdc`) and `SizeUnit` (`contracts` / `shares` / `usdc`). `price` on normalized rows is always `probability_1_0`; `native_price` preserves the venue's raw value.
- **Freshness:** text-labeled state of a REST-derived display (`LIVE`, `REFRESHING`, `CACHED`, `STALE`, `FAILED`).
- **Stream state:** text-labeled state of a WS subscription (`CONNECTING`, `LIVE`, `RECONNECTING`, `DISCONNECTED`, `FAILED`).
- **ServiceResult:** the typed return envelope from every App Service: `value + freshness + warning? + age_s?`. Lets callers distinguish LIVE / CACHED / STALE / FAILED without raising an exception that also carries data. `ServiceResult(freshness=STALE, warning=VenueUnavailable(…))` is the "stale-cache-only" path.
- **Plug-and-play seam:** the App Services layer — the only layer an alternative interface (collector, notebook, web UI) needs to depend on.
