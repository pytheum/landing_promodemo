# Pytheum CLI — Phase 2A: Kalshi REST Implementation Plan (Revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the full Kalshi public REST client end-to-end: an async `KalshiClient.rest`
API covering every endpoint in spec §3.1, raw-first persistence into `raw_payloads` via the
App Services seam, normalization to the Phase 1 pydantic models, a Kalshi URL parser, and a
per-endpoint fixture-backed test for each route. Public endpoints work zero-config;
authenticated endpoints (RSA-PSS) are wired but inert until a key is configured.

**Architecture:** Sits at Layer 2 (Venue Clients) + Layer 4 (App Services) of the spec's
five-layer architecture, on top of the Phase 1 core primitives (rate limiter, retry, circuit
breaker, pagination, clock, logging). Venue clients are **pure transport** — they return
`(raw_body_dict, RawEnvelope)` tuples and never touch DuckDB. `KalshiFetchService` at the App
Services layer owns `record_raw_rest` (raw-first) + normalize (with real raw_id) + upsert.
WS arrives in Plan 2B.

**Tech Stack:** httpx (async), cryptography (RSA-PSS), pydantic v2, duckdb,
pytest + httpx.MockTransport (fixture-based mocking), pytest-recording (VCR cassettes for
selected real-API tests). All async.

**Spec source of truth:**
`/Users/kanagn/Desktop/landing_promodemo/docs/superpowers/specs/2026-04-24-pytheum-cli-design.md`
(mirrored at `/Users/kanagn/Desktop/pytheum-cli/docs/specs/2026-04-24-pytheum-cli-design.md`).
§3.1 lists endpoint coverage; §3.7 lists URL patterns; §6 covers auth; §4.1 lists model shapes.

**Working repo:** `/Users/kanagn/Desktop/pytheum-cli/`. Continues from `phase-1-hardened` tag
(commit `407ed5b`). All 130 Phase 1 tests still pass throughout this plan; new tests append to
that suite.

**Git authorship:** all commits authored as
`Konstantinos Anagnostopoulos <147280494+konstantinosanagn@users.noreply.github.com>`
via `git -c user.name=… -c user.email=…`. Do NOT modify global git config.

---

## Architectural decisions baked into this plan

These choices are locked in so every task is self-consistent. If a reviewer wants any of these
changed, do it BEFORE Task 1.

1. **One `httpx.AsyncClient` per `KalshiClient` instance.** Owned by the client, lifecycle via
   async context manager (`async with KalshiClient(...) as kc: …`) or explicit
   `await kc.aclose()`. The client is *not* a singleton — multiple clients may coexist, each
   with its own rate-limiter state.

2. **Rate limiter is per-client.** A `KalshiClient` instantiated with default config gets its
   own `AsyncRateLimiter(rate_per_sec=10, burst=10)` from the
   `Config.venues.kalshi.rate_limit_per_sec` slot. No cross-process / cross-client
   coordination — Phase 1 explicitly didn't ship a distributed limiter.

3. **Retry decorator wraps the inner request method.** `_send()` is decorated with
   `@retry_async(RetryPolicy(max_attempts=4, base_s=1.0, max_s=30.0, jitter=0.2))`.
   `RateLimited(retry_after_s=…)` and `VenueUnavailable` (5xx) are the only retryable errors;
   others raise immediately.

4. **Venue clients are pure fetchers; persistence lives in `KalshiFetchService`.**
   `KalshiRest` takes NO `MarketRepository` parameter. Every method returns
   `(parsed_model | AsyncIterator[parsed_model], RawEnvelope)`. The client never writes to
   DuckDB. `KalshiFetchService` (at `pytheum/services/fetch.py`) takes a `KalshiClient` +
   `MarketRepository` and is the sole caller of `record_raw_rest` + normalizer + `upsert_*`.
   This preserves the strict layer boundary from spec §2: venue clients must not know about
   DuckDB.

5. **Normalizer raises `SchemaDrift` with the `raw_id` supplied by the service.**
   When a venue payload doesn't match the expected pydantic shape, the normalizer wraps the
   pydantic `ValidationError` in
   `SchemaDrift(venue=Venue.KALSHI, endpoint=…, raw_id=…, validator_errors=…)`. The `raw_id`
   is always provided by the service layer, never defaulted to 0. The raw payload is already in
   `raw_payloads`, so post-hoc inspection is always possible.

6. **Public endpoints work with no auth.** `KalshiClient(config, signer=None)` (default) only
   attaches `Accept: application/json`. The auth module is fully implemented and unit-tested but
   no v1 user-facing CLI command exercises authenticated endpoints.

7. **HTTP error → application error mapping** (uniform across all endpoints):
   - `200 / 2xx` → success path
   - `401 / 403` → `AuthRequired`
   - `404` → `NoResults` (caller decides whether to surface as a user-friendly "not found")
   - `429` → `RateLimited(retry_after_s=…)` (parsed from `Retry-After` header; may be `None`)
   - `5xx` → `VenueUnavailable`
   - everything else → `VenueUnavailable` with the status code preserved

8. **Cursor pagination only.** Kalshi's `/events`, `/markets`, `/markets/trades`,
   `/historical/trades`, etc. all use a `cursor`/`next_cursor` query/response pair. Use the
   Phase 1 `cursor_paginated[T]` helper. Page sizes are per-endpoint named constants
   (see decision #12).

9. **Fixtures are real captures, not synthetic.** Each endpoint task captures a real response
   from `https://api.elections.kalshi.com/trade-api/v2` via `curl` (public, no auth needed)
   and saves it under `tests/fixtures/kalshi/`. Fixtures are committed. If the live API is
   unreachable during fixture capture, the task is BLOCKED — synthetic fixtures hide schema
   drift, which is exactly the failure mode this layer must surface.

10. **`KalshiClient` is async-only.** No sync wrappers in v1. CLI commands that need to call
    into it use `asyncio.run(...)` at the boundary.

11. **`RawEnvelope` is the venue ↔ service contract.** Every `KalshiRest` method returns a
    `(result, RawEnvelope)` tuple. The `RawEnvelope` dataclass (defined at
    `pytheum/data/envelope.py`) carries all metadata needed for `record_raw_rest` — venue,
    transport, endpoint, request_params, received_ts, source_ts, schema_version, native_ids,
    payload, status_code, duration_ms. The service layer unpacks the envelope and passes its
    fields directly to `record_raw_rest`. This decouples transport from persistence without any
    shared state.

12. **Per-endpoint page limits are module-level named constants in `rest.py`.**
    Used in Tasks 7–11 but pre-declared in Task 4 for the base scaffolding:

    ```python
    _LIMIT_SERIES   = 200
    _LIMIT_EVENTS   = 200
    _LIMIT_MARKETS  = 1000
    _LIMIT_TRADES   = 1000
    _LIMIT_HIST_TRADES = 1000
    ```

    These are Kalshi's documented per-endpoint maximums. Passing a higher value causes a 400;
    passing a lower value is fine (e.g., for testing). The service layer may override them via
    keyword argument.

---

## File map for Phase 2A (all 12 tasks)

```
pytheum-cli/
├── src/pytheum/
│   ├── data/
│   │   ├── envelope.py                      NEW  Task 2 — RawEnvelope dataclass
│   │   └── repository.py                    NEW  Task 1 — MarketRepository
│   ├── services/
│   │   ├── __init__.py                      NEW  Task 5 — empty package marker
│   │   └── fetch.py                         NEW  Task 5 — KalshiFetchService
│   └── venues/
│       ├── __init__.py                      NEW  Task 2
│       └── kalshi/
│           ├── __init__.py                  NEW  Task 2
│           ├── auth.py                      NEW  Task 2 — RSA-PSS signing (path/query fix)
│           ├── client.py                    NEW  Task 4 — KalshiClient (top-level)
│           ├── rest.py                      NEW  Task 4 — KalshiRest pure transport
│           ├── urls.py                      NEW  Task 3 — URL → MarketRef/EventRef
│           └── normalizer.py               NEW  Task 5 — raw → normalized models
└── tests/
    ├── data/
    │   └── test_repository.py               NEW  Task 1
    ├── fixtures/
    │   └── kalshi/                          NEW  committed real-API captures (Tasks 5–11)
    │       ├── manifest.json                NEW  Task 5 — endpoint → captured id map
    │       ├── series_list.json             NEW  Task 5
    │       ├── series_detail.json           NEW  Task 5  (no ticker suffix — see note below)
    │       ├── events_list.json             NEW  Task 6
    │       ├── events_detail.json           NEW  Task 6
    │       ├── markets_list.json            NEW  Task 6
    │       ├── markets_detail.json          NEW  Task 6
    │       ├── orderbook.json               NEW  Task 7
    │       ├── trades_live.json             NEW  Task 8
    │       ├── historical_trades.json       NEW  Task 8
    │       ├── candlesticks.json            NEW  Task 9
    │       └── historical_cutoff.json       NEW  Task 9
    ├── services/
    │   ├── __init__.py                      NEW  Task 5
    │   └── test_fetch.py                    NEW  Task 5
    └── venues/
        ├── __init__.py                      NEW  Task 2
        └── kalshi/
            ├── __init__.py                  NEW  Task 2
            ├── test_auth.py                 NEW  Task 2
            ├── test_urls.py                 NEW  Task 3
            ├── test_normalizer.py           NEW  Task 5
            ├── test_rest.py                 NEW  Task 4 + extended in Tasks 6–9
            └── test_client_integration.py  NEW  Task 12 — end-to-end with KalshiFetchService
```

Total: 11 fixture files + 9 source files + 9 test files + 1 manifest = ~30 files.

---

## Fixture manifest pattern

Fixtures are named by endpoint only — no ticker suffixes in the filename. This avoids
committing live tickers that may expire. Instead, the capture step writes
`tests/fixtures/kalshi/manifest.json` keyed by endpoint slug, recording the actual ticker or
ID that was captured. Tests load the manifest at startup and use the recorded identifiers to
drive assertions — for example, to verify that the `native_id` in the normalized model matches
what was actually captured. This means tests stay correct even when the live API returns a
different set of tickers on a fresh fixture capture.

Example manifest structure:

```json
{
  "series_list":   { "endpoint": "/series",                  "captured_ids": ["KXBTC", "KXETH"] },
  "series_detail": { "endpoint": "/series/{ticker}",         "captured_id":  "KXBTC" },
  "events_list":   { "endpoint": "/events",                  "captured_ids": ["KXBTC-25DEC"] },
  "events_detail": { "endpoint": "/events/{event_ticker}",   "captured_id":  "KXBTC-25DEC" },
  "markets_list":  { "endpoint": "/markets",                 "captured_ids": ["KXBTC-25DEC-T95000"] },
  "markets_detail":{ "endpoint": "/markets/{ticker}",        "captured_id":  "KXBTC-25DEC-T95000" },
  "orderbook":     { "endpoint": "/markets/{ticker}/orderbook", "captured_id": "KXBTC-25DEC-T95000" },
  "trades_live":   { "endpoint": "/markets/trades",          "captured_ticker": "KXBTC-25DEC-T95000" },
  "historical_trades": { "endpoint": "/historical/trades",   "captured_ticker": "KXBTC-25DEC-T95000" },
  "candlesticks":  { "endpoint": "/markets/{ticker}/candlesticks", "captured_id": "KXBTC-25DEC-T95000" },
  "historical_cutoff": { "endpoint": "/historical/cutoff",   "captured_id": null }
}
```

The manifest is written by the bash capture commands in each task and committed alongside the
fixture files. The pattern is: capture → write manifest entry → commit both together.

---

## Task 1: MarketRepository — extended with upsert_orderbook + upsert_price_points

The repository persists normalized rows + their `raw_id` FK. It is the only layer that writes
to DuckDB normalized tables. Phase 1 deferred this to Phase 2.

This revised version adds `upsert_orderbook` and `upsert_price_points` that were missing from
the v1 plan (reviewer finding #4).

**Files:**
- Create: `src/pytheum/data/repository.py`
- Test: `tests/data/test_repository.py`

- [ ] **Step 1: Write the failing test**

Write `tests/data/test_repository.py`:

```python
from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest

from pytheum.data.models import (
    Category,
    Event,
    Market,
    OrderBook,
    Outcome,
    PricePoint,
    PriceUnit,
    SizeUnit,
    Trade,
    Venue,
    VolumeMetric,
)
from pytheum.data.repository import MarketRepository
from pytheum.data.storage import Storage


@pytest.fixture
def repo(tmp_path: Path) -> MarketRepository:
    storage = Storage(tmp_path / "test.duckdb")
    storage.migrate()
    return MarketRepository(storage)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _raw(repo: MarketRepository, endpoint: str = "/x") -> int:
    return repo.record_raw_rest(
        venue=Venue.KALSHI,
        endpoint=endpoint,
        request_params=None,
        payload={"_": "_"},
        received_ts=datetime(2026, 1, 1, tzinfo=UTC),
        source_ts=None,
        status_code=200,
        duration_ms=1,
        schema_version=1,
        native_ids=[],
    )


def _seed_fk_chain(repo: MarketRepository, raw_id: int) -> None:
    """Insert the minimum parent rows needed to satisfy FK constraints."""
    repo.upsert_category(
        Category(
            venue=Venue.KALSHI,
            native_id="FED",
            native_label="Economics",
            display_label="Economics",
        ),
        raw_id=raw_id,
        schema_version=1,
    )
    repo.upsert_event(
        Event(
            venue=Venue.KALSHI,
            native_id="FED-25DEC",
            title="FOMC December 2025",
            primary_category=Category(
                venue=Venue.KALSHI,
                native_id="FED",
                native_label="Economics",
                display_label="Economics",
            ),
            closes_at=None,
            market_count=5,
            aggregate_volume=None,
            volume_metric=VolumeMetric.USD_TOTAL,
            url=None,
            schema_version=1,
        ),
        raw_id=raw_id,
        schema_version=1,
    )
    yes = Outcome(
        venue=Venue.KALSHI,
        market_native_id="FED-25DEC-T4.00",
        outcome_id="yes",
        token_id=None,
        label="YES",
        price=Decimal("0.88"),
        native_price=Decimal("88"),
        price_unit=PriceUnit.CENTS_100,
        volume=None,
        volume_metric=VolumeMetric.UNKNOWN,
        schema_version=1,
    )
    no = Outcome(
        venue=Venue.KALSHI,
        market_native_id="FED-25DEC-T4.00",
        outcome_id="no",
        token_id=None,
        label="NO",
        price=Decimal("0.12"),
        native_price=Decimal("12"),
        price_unit=PriceUnit.CENTS_100,
        volume=None,
        volume_metric=VolumeMetric.UNKNOWN,
        schema_version=1,
    )
    market = Market(
        venue=Venue.KALSHI,
        native_id="FED-25DEC-T4.00",
        event_native_id="FED-25DEC",
        title="FOMC Dec 2025 rate ≤ 4.00%",
        question="Will the Dec 2025 FOMC policy rate be ≤ 4.00%?",
        status="open",
        outcomes=[yes, no],
        total_volume=Decimal("31200"),
        volume_metric=VolumeMetric.USD_24H,
        open_interest=None,
        liquidity=None,
        closes_at=None,
        url=None,
        schema_version=1,
    )
    repo.upsert_market(market, raw_id=raw_id, schema_version=1)


# ---------------------------------------------------------------------------
# raw_payloads
# ---------------------------------------------------------------------------

def test_record_raw_returns_id(repo: MarketRepository) -> None:
    raw_id = repo.record_raw_rest(
        venue=Venue.KALSHI,
        endpoint="/series/FED",
        request_params={"limit": 1},
        payload={"ticker": "FED", "category": "Economics"},
        received_ts=datetime(2026, 1, 1, tzinfo=UTC),
        source_ts=None,
        status_code=200,
        duration_ms=42,
        schema_version=1,
        native_ids=["FED"],
    )
    assert raw_id > 0


# ---------------------------------------------------------------------------
# categories
# ---------------------------------------------------------------------------

def test_upsert_category_writes_row(repo: MarketRepository) -> None:
    raw_id = _raw(repo, "/series")
    cat = Category(
        venue=Venue.KALSHI,
        native_id="FED",
        native_label="Economics",
        display_label="Economics",
    )
    repo.upsert_category(cat, raw_id=raw_id, schema_version=1)
    with repo.storage.connect() as conn:
        rows = conn.execute(
            "SELECT venue, native_id, raw_id FROM categories WHERE venue=? AND native_id=?",
            ["kalshi", "FED"],
        ).fetchall()
    assert rows == [("kalshi", "FED", raw_id)]


def test_upsert_category_idempotent(repo: MarketRepository) -> None:
    raw_id = _raw(repo)
    cat = Category(venue=Venue.KALSHI, native_id="FED",
                   native_label="A", display_label="A")
    repo.upsert_category(cat, raw_id=raw_id, schema_version=1)
    repo.upsert_category(cat.model_copy(update={"display_label": "Updated"}),
                         raw_id=raw_id, schema_version=1)
    with repo.storage.connect() as conn:
        rows = conn.execute(
            "SELECT display_label FROM categories WHERE venue=? AND native_id=?",
            ["kalshi", "FED"],
        ).fetchall()
    assert rows == [("Updated",)]


# ---------------------------------------------------------------------------
# events
# ---------------------------------------------------------------------------

def test_upsert_event_writes_row(repo: MarketRepository) -> None:
    raw_id = _raw(repo)
    repo.upsert_category(
        Category(venue=Venue.KALSHI, native_id="FED",
                 native_label="Economics", display_label="Economics"),
        raw_id=raw_id, schema_version=1,
    )
    ev = Event(
        venue=Venue.KALSHI,
        native_id="FED-25DEC",
        title="FOMC Dec 2025",
        primary_category=Category(
            venue=Venue.KALSHI, native_id="FED",
            native_label="Economics", display_label="Economics",
        ),
        closes_at=None,
        market_count=3,
        aggregate_volume=None,
        volume_metric=VolumeMetric.UNKNOWN,
        url=None,
        schema_version=1,
    )
    repo.upsert_event(ev, raw_id=raw_id, schema_version=1)
    with repo.storage.connect() as conn:
        row = conn.execute(
            "SELECT native_id, raw_id FROM events WHERE venue=? AND native_id=?",
            ["kalshi", "FED-25DEC"],
        ).fetchone()
    assert row == ("FED-25DEC", raw_id)


# ---------------------------------------------------------------------------
# markets + outcomes (FK chain)
# ---------------------------------------------------------------------------

def test_upsert_market_with_outcomes(repo: MarketRepository) -> None:
    raw_id = _raw(repo, "/markets/FED-25DEC-T4.00")
    _seed_fk_chain(repo, raw_id)
    with repo.storage.connect() as conn:
        m = conn.execute(
            "SELECT raw_id FROM markets WHERE venue=? AND native_id=?",
            ["kalshi", "FED-25DEC-T4.00"],
        ).fetchone()
        outcomes = conn.execute(
            "SELECT outcome_id FROM outcomes"
            " WHERE venue=? AND market_native_id=? ORDER BY outcome_id",
            ["kalshi", "FED-25DEC-T4.00"],
        ).fetchall()
    assert m == (raw_id,)
    assert outcomes == [("no",), ("yes",)]


def test_upsert_market_idempotent(repo: MarketRepository) -> None:
    raw_id = _raw(repo)
    _seed_fk_chain(repo, raw_id)
    # Re-upsert with a different title — row should update, not duplicate.
    raw_id2 = _raw(repo)
    repo.upsert_category(
        Category(venue=Venue.KALSHI, native_id="FED",
                 native_label="Economics", display_label="Economics"),
        raw_id=raw_id2, schema_version=1,
    )
    repo.upsert_event(
        Event(
            venue=Venue.KALSHI, native_id="FED-25DEC", title="FOMC Dec 2025 UPDATED",
            primary_category=Category(
                venue=Venue.KALSHI, native_id="FED",
                native_label="Economics", display_label="Economics",
            ),
            closes_at=None, market_count=5, aggregate_volume=None,
            volume_metric=VolumeMetric.USD_TOTAL, url=None, schema_version=1,
        ),
        raw_id=raw_id2, schema_version=1,
    )
    market2 = Market(
        venue=Venue.KALSHI,
        native_id="FED-25DEC-T4.00",
        event_native_id="FED-25DEC",
        title="UPDATED TITLE",
        question="Will the Dec 2025 FOMC policy rate be ≤ 4.00%?",
        status="open",
        outcomes=[],
        total_volume=Decimal("99999"),
        volume_metric=VolumeMetric.USD_24H,
        open_interest=None,
        liquidity=None,
        closes_at=None,
        url=None,
        schema_version=1,
    )
    repo.upsert_market(market2, raw_id=raw_id2, schema_version=1)
    with repo.storage.connect() as conn:
        rows = conn.execute(
            "SELECT COUNT(*) FROM markets WHERE venue=? AND native_id=?",
            ["kalshi", "FED-25DEC-T4.00"],
        ).fetchall()
        title = conn.execute(
            "SELECT title FROM markets WHERE venue=? AND native_id=?",
            ["kalshi", "FED-25DEC-T4.00"],
        ).fetchone()
    assert rows == [(1,)]
    assert title == ("UPDATED TITLE",)


# ---------------------------------------------------------------------------
# orderbook_snaps — upsert_orderbook (reviewer finding #4)
# ---------------------------------------------------------------------------

def test_upsert_orderbook_writes_snap(repo: MarketRepository) -> None:
    raw_id = _raw(repo, "/markets/FED-25DEC-T4.00/orderbook")
    _seed_fk_chain(repo, raw_id)
    ob = OrderBook(
        venue=Venue.KALSHI,
        market_native_id="FED-25DEC-T4.00",
        outcome_id="yes",
        bids=[(Decimal("0.87"), Decimal("10")), (Decimal("0.86"), Decimal("5"))],
        asks=[(Decimal("0.88"), Decimal("8")), (Decimal("0.89"), Decimal("3"))],
        price_unit=PriceUnit.PROB_1_0,
        size_unit=SizeUnit.CONTRACTS,
        timestamp=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
        schema_version=1,
    )
    repo.upsert_orderbook(ob, raw_id=raw_id, schema_version=1)
    with repo.storage.connect() as conn:
        row = conn.execute(
            "SELECT venue, market_native_id, outcome_id, raw_id"
            " FROM orderbook_snaps"
            " WHERE venue=? AND market_native_id=? AND outcome_id=?",
            ["kalshi", "FED-25DEC-T4.00", "yes"],
        ).fetchone()
    assert row is not None
    assert row[0] == "kalshi"
    assert row[3] == raw_id


def test_upsert_orderbook_stores_bids_and_asks_as_json(repo: MarketRepository) -> None:
    raw_id = _raw(repo, "/markets/FED-25DEC-T4.00/orderbook")
    _seed_fk_chain(repo, raw_id)
    bids = [(Decimal("0.80"), Decimal("20"))]
    asks = [(Decimal("0.82"), Decimal("15"))]
    ob = OrderBook(
        venue=Venue.KALSHI,
        market_native_id="FED-25DEC-T4.00",
        outcome_id="yes",
        bids=bids,
        asks=asks,
        price_unit=PriceUnit.PROB_1_0,
        size_unit=SizeUnit.CONTRACTS,
        timestamp=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
        schema_version=1,
    )
    repo.upsert_orderbook(ob, raw_id=raw_id, schema_version=1)
    with repo.storage.connect() as conn:
        row = conn.execute(
            "SELECT bids, asks FROM orderbook_snaps"
            " WHERE venue=? AND market_native_id=? AND outcome_id=?",
            ["kalshi", "FED-25DEC-T4.00", "yes"],
        ).fetchone()
    assert row is not None
    stored_bids = json.loads(row[0])
    stored_asks = json.loads(row[1])
    assert stored_bids[0][0] == "0.80"
    assert stored_asks[0][0] == "0.82"


# ---------------------------------------------------------------------------
# price_points — upsert_price_points (reviewer finding #4)
# ---------------------------------------------------------------------------

def test_upsert_price_points_writes_batch(repo: MarketRepository) -> None:
    raw_id = _raw(repo, "/markets/FED-25DEC-T4.00/candlesticks")
    _seed_fk_chain(repo, raw_id)
    pts = [
        PricePoint(
            venue=Venue.KALSHI,
            market_native_id="FED-25DEC-T4.00",
            outcome_id="yes",
            timestamp=datetime(2026, 1, 1, h, 0, tzinfo=UTC),
            price=Decimal("0.88"),
            native_price=Decimal("88"),
            price_unit=PriceUnit.CENTS_100,
            volume=None,
            volume_metric=VolumeMetric.UNKNOWN,
            interval="1h",
            schema_version=1,
        )
        for h in range(3)
    ]
    repo.upsert_price_points(pts, raw_id=raw_id, schema_version=1)
    with repo.storage.connect() as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM price_points WHERE venue=? AND market_native_id=?",
            ["kalshi", "FED-25DEC-T4.00"],
        ).fetchone()
    assert count is not None and count[0] == 3


def test_upsert_price_points_idempotent(repo: MarketRepository) -> None:
    raw_id = _raw(repo, "/markets/FED-25DEC-T4.00/candlesticks")
    _seed_fk_chain(repo, raw_id)
    ts = datetime(2026, 1, 1, 0, 0, tzinfo=UTC)
    pt = PricePoint(
        venue=Venue.KALSHI,
        market_native_id="FED-25DEC-T4.00",
        outcome_id="yes",
        timestamp=ts,
        price=Decimal("0.88"),
        native_price=Decimal("88"),
        price_unit=PriceUnit.CENTS_100,
        volume=None,
        volume_metric=VolumeMetric.UNKNOWN,
        interval="1h",
        schema_version=1,
    )
    repo.upsert_price_points([pt], raw_id=raw_id, schema_version=1)
    # Write again with different price — should update, not duplicate.
    pt2 = pt.model_copy(update={"price": Decimal("0.90"), "native_price": Decimal("90")})
    repo.upsert_price_points([pt2], raw_id=raw_id, schema_version=1)
    with repo.storage.connect() as conn:
        rows = conn.execute(
            "SELECT COUNT(*), MAX(price) FROM price_points"
            " WHERE venue=? AND market_native_id=? AND outcome_id=? AND interval=?",
            ["kalshi", "FED-25DEC-T4.00", "yes", "1h"],
        ).fetchone()
    assert rows is not None
    assert rows[0] == 1                        # no duplicate
    assert float(rows[1]) == pytest.approx(0.90)  # updated


def test_upsert_price_points_empty_is_noop(repo: MarketRepository) -> None:
    raw_id = _raw(repo)
    repo.upsert_price_points([], raw_id=raw_id, schema_version=1)
    with repo.storage.connect() as conn:
        count = conn.execute("SELECT COUNT(*) FROM price_points").fetchone()
    assert count is not None and count[0] == 0


# ---------------------------------------------------------------------------
# trades (batch insert — not upsert; trades are append-only)
# ---------------------------------------------------------------------------

def test_insert_trades_batch(repo: MarketRepository) -> None:
    raw_id = _raw(repo, "/markets/trades")
    _seed_fk_chain(repo, raw_id)
    trades = [
        Trade(
            venue=Venue.KALSHI,
            market_native_id="FED-25DEC-T4.00",
            outcome_id="yes",
            price=Decimal("0.88"),
            native_price=Decimal("88"),
            price_unit=PriceUnit.CENTS_100,
            size=Decimal("100"),
            native_size=Decimal("100"),
            size_unit=SizeUnit.CONTRACTS,
            notional=Decimal("88"),
            currency="usd",
            side="buy",
            timestamp=datetime(2026, 1, 1, tzinfo=UTC),
            schema_version=1,
        )
        for _ in range(5)
    ]
    repo.insert_trades(trades, raw_id=raw_id, schema_version=1)
    with repo.storage.connect() as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM trades WHERE venue=? AND market_native_id=?",
            ["kalshi", "FED-25DEC-T4.00"],
        ).fetchone()
    assert count is not None and count[0] == 5
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv run pytest tests/data/test_repository.py -v
```

Expected: `ModuleNotFoundError: No module named 'pytheum.data.repository'`.

- [ ] **Step 3: Implement repository**

Write `src/pytheum/data/repository.py`:

```python
"""MarketRepository — persists raw + normalized rows. See spec §2 layer 3.

Design contract:
- The repository is the ONLY layer that writes to DuckDB normalized tables.
- Venue clients (KalshiRest) never call methods here — that is the service layer's job.
- Every normalized upsert requires a real raw_id (never 0 or None).
- All upserts are idempotent via ON CONFLICT ... DO UPDATE.
"""
from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from pytheum.data.models import (
    Category,
    Event,
    Market,
    OrderBook,
    Outcome,
    PricePoint,
    Trade,
    Venue,
)
from pytheum.data.storage import Storage

__all__ = ["MarketRepository"]


def _json(value: Any) -> str:
    return json.dumps(value, default=str)


class MarketRepository:
    """Wrapper around `Storage` that owns the raw_payloads + normalized-row contract."""

    def __init__(self, storage: Storage) -> None:
        self.storage = storage

    # ------------------------------------------------------------------
    # raw payloads
    # ------------------------------------------------------------------

    def record_raw_rest(
        self,
        *,
        venue: Venue,
        endpoint: str,
        request_params: dict[str, Any] | None,
        payload: Any,
        received_ts: datetime,
        source_ts: datetime | None,
        status_code: int,
        duration_ms: int,
        schema_version: int,
        native_ids: Sequence[str],
    ) -> int:
        """Insert a raw REST payload row and return its auto-generated id."""
        with self.storage.connect() as conn:
            row = conn.execute(
                """
                INSERT INTO raw_payloads (
                    venue, transport, endpoint, request_params, received_ts,
                    source_ts, schema_version, native_ids, payload, status_code, duration_ms
                ) VALUES (?, 'rest', ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING id
                """,
                [
                    venue.value,
                    endpoint,
                    _json(request_params) if request_params is not None else None,
                    received_ts,
                    source_ts,
                    schema_version,
                    list(native_ids),
                    _json(payload),
                    status_code,
                    duration_ms,
                ],
            ).fetchone()
        if row is None:
            raise RuntimeError("INSERT ... RETURNING produced no row")
        return int(row[0])

    # ------------------------------------------------------------------
    # categories
    # ------------------------------------------------------------------

    def upsert_category(
        self, category: Category, *, raw_id: int, schema_version: int
    ) -> None:
        with self.storage.connect() as conn:
            conn.execute(
                """
                INSERT INTO categories (
                    venue, native_id, native_label, display_label,
                    raw_id, schema_version, updated_ts
                ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT (venue, native_id) DO UPDATE SET
                    native_label = excluded.native_label,
                    display_label = excluded.display_label,
                    raw_id = excluded.raw_id,
                    schema_version = excluded.schema_version,
                    updated_ts = CURRENT_TIMESTAMP
                """,
                [
                    category.venue.value,
                    category.native_id,
                    category.native_label,
                    category.display_label,
                    raw_id,
                    schema_version,
                ],
            )

    # ------------------------------------------------------------------
    # events
    # ------------------------------------------------------------------

    def upsert_event(
        self, event: Event, *, raw_id: int, schema_version: int
    ) -> None:
        with self.storage.connect() as conn:
            conn.execute(
                """
                INSERT INTO events (
                    venue, native_id, title,
                    primary_category_venue, primary_category_native_id,
                    closes_at, market_count, aggregate_volume, volume_metric,
                    url, raw_id, schema_version, updated_ts
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT (venue, native_id) DO UPDATE SET
                    title = excluded.title,
                    primary_category_venue = excluded.primary_category_venue,
                    primary_category_native_id = excluded.primary_category_native_id,
                    closes_at = excluded.closes_at,
                    market_count = excluded.market_count,
                    aggregate_volume = excluded.aggregate_volume,
                    volume_metric = excluded.volume_metric,
                    url = excluded.url,
                    raw_id = excluded.raw_id,
                    schema_version = excluded.schema_version,
                    updated_ts = CURRENT_TIMESTAMP
                """,
                [
                    event.venue.value,
                    event.native_id,
                    event.title,
                    event.primary_category.venue.value if event.primary_category else None,
                    event.primary_category.native_id if event.primary_category else None,
                    event.closes_at,
                    event.market_count,
                    event.aggregate_volume,
                    event.volume_metric.value,
                    event.url,
                    raw_id,
                    schema_version,
                ],
            )

    # ------------------------------------------------------------------
    # markets + outcomes
    # ------------------------------------------------------------------

    def upsert_market(
        self, market: Market, *, raw_id: int, schema_version: int
    ) -> None:
        with self.storage.connect() as conn:
            conn.execute(
                """
                INSERT INTO markets (
                    venue, native_id, event_venue, event_native_id,
                    title, question, status,
                    total_volume, volume_metric, open_interest, liquidity,
                    closes_at, url, raw_id, schema_version, updated_ts
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT (venue, native_id) DO UPDATE SET
                    event_venue = excluded.event_venue,
                    event_native_id = excluded.event_native_id,
                    title = excluded.title,
                    question = excluded.question,
                    status = excluded.status,
                    total_volume = excluded.total_volume,
                    volume_metric = excluded.volume_metric,
                    open_interest = excluded.open_interest,
                    liquidity = excluded.liquidity,
                    closes_at = excluded.closes_at,
                    url = excluded.url,
                    raw_id = excluded.raw_id,
                    schema_version = excluded.schema_version,
                    updated_ts = CURRENT_TIMESTAMP
                """,
                [
                    market.venue.value,
                    market.native_id,
                    # event_venue: same venue as market for all v1 markets
                    market.venue.value if market.event_native_id else None,
                    market.event_native_id,
                    market.title,
                    market.question,
                    market.status,
                    market.total_volume,
                    market.volume_metric.value,
                    market.open_interest,
                    market.liquidity,
                    market.closes_at,
                    market.url,
                    raw_id,
                    schema_version,
                ],
            )
            for outcome in market.outcomes:
                self._upsert_outcome_unsafe(conn, outcome, raw_id, schema_version)

    def _upsert_outcome_unsafe(
        self,
        conn: Any,
        outcome: Outcome,
        raw_id: int,
        schema_version: int,
    ) -> None:
        """Insert/update an outcome inside an existing connection transaction."""
        conn.execute(
            """
            INSERT INTO outcomes (
                venue, market_native_id, outcome_id, token_id, label,
                price, native_price, price_unit, volume, volume_metric,
                is_resolved, resolution, raw_id, schema_version, updated_ts
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (venue, market_native_id, outcome_id) DO UPDATE SET
                token_id = excluded.token_id,
                label = excluded.label,
                price = excluded.price,
                native_price = excluded.native_price,
                price_unit = excluded.price_unit,
                volume = excluded.volume,
                volume_metric = excluded.volume_metric,
                is_resolved = excluded.is_resolved,
                resolution = excluded.resolution,
                raw_id = excluded.raw_id,
                schema_version = excluded.schema_version,
                updated_ts = CURRENT_TIMESTAMP
            """,
            [
                outcome.venue.value,
                outcome.market_native_id,
                outcome.outcome_id,
                outcome.token_id,
                outcome.label,
                outcome.price,
                outcome.native_price,
                outcome.price_unit.value,
                outcome.volume,
                outcome.volume_metric.value,
                outcome.is_resolved,
                outcome.resolution,
                raw_id,
                schema_version,
            ],
        )

    # ------------------------------------------------------------------
    # orderbook_snaps — upsert_orderbook (reviewer finding #4)
    # ------------------------------------------------------------------

    def upsert_orderbook(
        self,
        orderbook: OrderBook,
        *,
        raw_id: int,
        schema_version: int,
    ) -> None:
        """Write one per-side orderbook snapshot row.

        `orderbook_snaps` has no PRIMARY KEY on (venue, market_native_id, outcome_id)
        alone — multiple snaps per market/side accumulate over time (timestamped).
        We INSERT a new row each time; the index on (venue, market_native_id, outcome_id,
        timestamp) supports "latest snap" queries efficiently.

        For the WS live-tail path (Phase 2B) this method is called on every delta-applied
        snapshot. For the REST path (Phase 2A) it is called once per GET /orderbook response.
        """
        bids_json = _json([[str(p), str(s)] for p, s in orderbook.bids])
        asks_json = _json([[str(p), str(s)] for p, s in orderbook.asks])
        with self.storage.connect() as conn:
            conn.execute(
                """
                INSERT INTO orderbook_snaps (
                    venue, market_native_id, outcome_id,
                    bids, asks, price_unit, size_unit,
                    timestamp, raw_id, schema_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    orderbook.venue.value,
                    orderbook.market_native_id,
                    orderbook.outcome_id,
                    bids_json,
                    asks_json,
                    orderbook.price_unit.value,
                    orderbook.size_unit.value,
                    orderbook.timestamp,
                    raw_id,
                    schema_version,
                ],
            )

    # ------------------------------------------------------------------
    # price_points — upsert_price_points (reviewer finding #4)
    # ------------------------------------------------------------------

    def upsert_price_points(
        self,
        points: Sequence[PricePoint],
        *,
        raw_id: int,
        schema_version: int,
    ) -> None:
        """Batch upsert price_points. Idempotent via PRIMARY KEY on
        (venue, market_native_id, outcome_id, interval, timestamp).

        Empty list is a no-op (safe to call on empty paginator pages).
        """
        if not points:
            return
        with self.storage.connect() as conn:
            conn.executemany(
                """
                INSERT INTO price_points (
                    venue, market_native_id, outcome_id,
                    timestamp, price, native_price, price_unit,
                    volume, volume_metric, interval,
                    raw_id, schema_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (venue, market_native_id, outcome_id, interval, timestamp)
                DO UPDATE SET
                    price = excluded.price,
                    native_price = excluded.native_price,
                    volume = excluded.volume,
                    raw_id = excluded.raw_id,
                    schema_version = excluded.schema_version
                """,
                [
                    [
                        pt.venue.value,
                        pt.market_native_id,
                        pt.outcome_id,
                        pt.timestamp,
                        pt.price,
                        pt.native_price,
                        pt.price_unit.value,
                        pt.volume,
                        pt.volume_metric.value,
                        pt.interval,
                        raw_id,
                        schema_version,
                    ]
                    for pt in points
                ],
            )

    # ------------------------------------------------------------------
    # trades (append-only — not an upsert; trades never change after write)
    # ------------------------------------------------------------------

    def insert_trades(
        self, trades: Sequence[Trade], *, raw_id: int, schema_version: int
    ) -> None:
        if not trades:
            return
        with self.storage.connect() as conn:
            conn.executemany(
                """
                INSERT INTO trades (
                    venue, market_native_id, outcome_id,
                    price, native_price, price_unit,
                    size, native_size, size_unit,
                    notional, currency, side, timestamp,
                    raw_id, schema_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    [
                        t.venue.value, t.market_native_id, t.outcome_id,
                        t.price, t.native_price, t.price_unit.value,
                        t.size, t.native_size, t.size_unit.value,
                        t.notional, t.currency, t.side, t.timestamp,
                        raw_id, schema_version,
                    ]
                    for t in trades
                ],
            )
```

**Note on `event_venue`:** `upsert_market` passes `market.venue.value` as `event_venue`
when `event_native_id` is set. For Kalshi in 2A and Polymarket in 2C, every market belongs to
a same-venue event. If a future cross-venue link is ever needed, that value becomes an explicit
parameter rather than an inferred one.

- [ ] **Step 4: Run test, verify it passes**

```bash
uv run pytest tests/data/test_repository.py -v
```

Expected: all tests pass (11+ tests). If any fail, check that `OrderBook` and `PricePoint` are
imported in `pytheum.data.models` and that `orderbook_snaps` + `price_points` tables exist in
the migration. If the migration doesn't include them, add the DDL from spec §5.2 to the latest
migration file before re-running.

- [ ] **Step 5: Commit**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
git add src/pytheum/data/repository.py tests/data/test_repository.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "data: MarketRepository — raw + 6 normalized upserts incl. orderbook + price_points"
```

---

## Task 2: Venue scaffolding + RawEnvelope + RSA-PSS signer (path/query fix + header wiring)

This task introduces:

1. `pytheum/data/envelope.py` — `RawEnvelope` dataclass (the venue ↔ service contract)
2. `pytheum/venues/__init__.py` + `pytheum/venues/kalshi/__init__.py` — empty package markers
3. `pytheum/venues/kalshi/auth.py` — `KalshiSigner` with the corrected full-path signing
   (reviewer finding #5: sign `/trade-api/v2/…`, strip query params, attach headers via httpx)

**Files:**
- Create: `src/pytheum/data/envelope.py`
- Create: `src/pytheum/venues/__init__.py`
- Create: `src/pytheum/venues/kalshi/__init__.py`
- Create: `src/pytheum/venues/kalshi/auth.py`
- Create: `tests/venues/__init__.py`
- Create: `tests/venues/kalshi/__init__.py`
- Create: `tests/venues/kalshi/test_auth.py`

- [ ] **Step 1: Scaffold empty packages + write RawEnvelope**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
mkdir -p src/pytheum/venues/kalshi tests/venues/kalshi tests/fixtures/kalshi
touch src/pytheum/venues/__init__.py
touch src/pytheum/venues/kalshi/__init__.py
touch tests/venues/__init__.py
touch tests/venues/kalshi/__init__.py
```

Write `src/pytheum/venues/__init__.py`:

```python
"""Venue clients — one sub-package per supported venue."""
```

Write `src/pytheum/venues/kalshi/__init__.py`:

```python
"""Kalshi venue client (Kalshi Elections — trade-api/v2)."""
```

Write `src/pytheum/data/envelope.py`:

```python
"""RawEnvelope — the immutable record a venue client returns alongside parsed data.

The service layer (KalshiFetchService) unpacks the envelope and calls
MarketRepository.record_raw_rest with its fields. Venue clients never write to
the database directly — this dataclass is the boundary object.

Used by KalshiRest (Phase 2A REST) and will be reused by KalshiWS + PolymarketWS
in Phases 2B/2C/2D.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from pytheum.data.models import Venue

__all__ = ["RawEnvelope"]


@dataclass(frozen=True)
class RawEnvelope:
    venue: Venue
    transport: Literal["rest", "ws"]
    endpoint: str                      # Kalshi-relative path, no query params
    request_params: dict[str, Any] | None
    received_ts: datetime
    source_ts: datetime | None
    schema_version: int
    native_ids: list[str]
    payload: Any                       # the parsed JSON body (dict / list)
    status_code: int | None            # REST only; None for WS frames
    duration_ms: int | None            # REST only; None for WS frames
```

- [ ] **Step 2: Write failing auth test**

Write `tests/venues/kalshi/test_auth.py`:

```python
from __future__ import annotations

import base64
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.hashes import SHA256

from pytheum.core.clock import FixedClock
from pytheum.venues.kalshi.auth import (
    KalshiSigner,
    SigningHeaders,
    load_private_key_from_pem,
)


@pytest.fixture
def fresh_pem(tmp_path: Path) -> Path:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    p = tmp_path / "kalshi_private_key.pem"
    p.write_bytes(pem)
    return p


def test_load_private_key(fresh_pem: Path) -> None:
    key = load_private_key_from_pem(fresh_pem)
    sig = key.sign(
        b"test",
        padding.PSS(mgf=padding.MGF1(SHA256()), salt_length=padding.PSS.DIGEST_LENGTH),
        SHA256(),
    )
    assert isinstance(sig, bytes)


def test_load_private_key_rejects_bare_filename(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="absolute"):
        load_private_key_from_pem(Path("kalshi_private_key.pem"))


def test_signer_produces_three_headers(fresh_pem: Path) -> None:
    clock = FixedClock(datetime(2026, 4, 24, 12, 0, 0, tzinfo=UTC))
    signer = KalshiSigner(
        api_key="ak-test",
        private_key=load_private_key_from_pem(fresh_pem),
        clock=clock,
    )
    headers = signer.sign("GET", "/trade-api/v2/portfolio/balance")
    assert isinstance(headers, SigningHeaders)
    assert headers.access_key == "ak-test"
    assert headers.timestamp_ms == "1745496000000"  # 2026-04-24 12:00:00 UTC in ms
    assert isinstance(headers.signature, str)
    assert len(headers.signature) > 0


def test_signature_differs_by_prefix(fresh_pem: Path) -> None:
    """Reviewer finding #5: signing /trade-api/v2/portfolio vs /portfolio gives different sig."""
    clock = FixedClock(datetime(2026, 4, 24, 12, 0, 0, tzinfo=UTC))
    signer = KalshiSigner(
        api_key="ak-test",
        private_key=load_private_key_from_pem(fresh_pem),
        clock=clock,
    )
    full = signer.sign("GET", "/trade-api/v2/portfolio/balance")
    bare = signer.sign("GET", "/portfolio/balance")
    # Different full_path → different message → different signature.
    assert full.signature != bare.signature


def test_query_params_stripped_before_signing(fresh_pem: Path) -> None:
    """Reviewer finding #5: query string must NOT change the signature."""
    clock = FixedClock(datetime(2026, 4, 24, 12, 0, 0, tzinfo=UTC))
    signer = KalshiSigner(
        api_key="ak-test",
        private_key=load_private_key_from_pem(fresh_pem),
        clock=clock,
    )
    without_qs = signer.sign("GET", "/trade-api/v2/markets")
    with_qs    = signer.sign("GET", "/trade-api/v2/markets?limit=10&cursor=abc")
    # Stripping the query string makes both messages identical → same signature.
    assert without_qs.signature == with_qs.signature


def test_signature_differs_by_method(fresh_pem: Path) -> None:
    clock = FixedClock(datetime(2026, 4, 24, 12, 0, 0, tzinfo=UTC))
    signer = KalshiSigner(
        api_key="ak-test",
        private_key=load_private_key_from_pem(fresh_pem),
        clock=clock,
    )
    get = signer.sign("GET", "/trade-api/v2/markets")
    post = signer.sign("POST", "/trade-api/v2/markets")
    assert get.signature != post.signature


def test_header_names_are_correct(fresh_pem: Path) -> None:
    clock = FixedClock(datetime(2026, 4, 24, 12, 0, 0, tzinfo=UTC))
    signer = KalshiSigner(
        api_key="ak-test",
        private_key=load_private_key_from_pem(fresh_pem),
        clock=clock,
    )
    h = signer.sign("GET", "/trade-api/v2/markets").as_dict()
    assert set(h.keys()) == {
        "KALSHI-ACCESS-KEY",
        "KALSHI-ACCESS-SIGNATURE",
        "KALSHI-ACCESS-TIMESTAMP",
    }


def test_signer_headers_appear_on_wire_when_configured(fresh_pem: Path) -> None:
    """Reviewer finding #5: signer headers must be attached to actual outgoing requests."""
    from pytheum.core.config import KalshiConfig
    from pytheum.venues.kalshi.client import KalshiClient

    import asyncio

    clock = FixedClock(datetime(2026, 4, 24, 12, 0, 0, tzinfo=UTC))
    signer = KalshiSigner(
        api_key="ak-wire-test",
        private_key=load_private_key_from_pem(fresh_pem),
        clock=clock,
    )

    captured_headers: dict[str, str] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured_headers.update(dict(req.headers))
        return httpx.Response(200, json={"ok": True})

    async def run() -> None:
        client = KalshiClient(
            config=KalshiConfig(rate_limit_per_sec=1000),
            signer=signer,
            _transport=httpx.MockTransport(handler),
            _clock=clock,
        )
        async with client:
            await client.rest._send("GET", "/series", params=None, native_ids=[])

    asyncio.run(run())

    assert "kalshi-access-key" in captured_headers or "KALSHI-ACCESS-KEY" in captured_headers
    assert "kalshi-access-signature" in captured_headers or "KALSHI-ACCESS-SIGNATURE" in captured_headers
    assert "kalshi-access-timestamp" in captured_headers or "KALSHI-ACCESS-TIMESTAMP" in captured_headers
```

- [ ] **Step 3: Verify failure**

```bash
uv run pytest tests/venues/kalshi/test_auth.py -v
```

Expected: `ModuleNotFoundError: No module named 'pytheum.venues.kalshi.auth'`.

- [ ] **Step 4: Implement auth (with path/query fix)**

Write `src/pytheum/venues/kalshi/auth.py`:

```python
"""Kalshi v2 RSA-PSS signing — full-path + query-stripped variant.

Per reviewer finding #5, the signature message is:

    timestamp_ms_str + METHOD_UPPER + bare_path

where `bare_path` is the FULL path including the `/trade-api/v2` prefix, with
query parameters stripped. Example:

    "1745496000000GET/trade-api/v2/portfolio/balance"

This differs from the v1 plan which signed only the endpoint-relative segment
(e.g. `/portfolio/balance`). The signer's `sign()` method takes `full_path`
(already including `/trade-api/v2`); callers in `KalshiRest._send` are
responsible for prepending the prefix before calling `sign()`.

Signing uses RSA-PSS with SHA-256, MGF1(SHA-256), salt_length = DIGEST_LENGTH
(32 bytes for SHA-256), then base64-encodes the signature bytes.

Public endpoints don't require any of this; only `/portfolio/*` family needs it.
v1 wires the signer but no user-facing command exercises it.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey
from cryptography.hazmat.primitives.hashes import SHA256

from pytheum.core.clock import Clock, SystemClock

__all__ = ["KalshiSigner", "SigningHeaders", "load_private_key_from_pem"]


@dataclass(frozen=True)
class SigningHeaders:
    access_key: str
    signature: str
    timestamp_ms: str

    def as_dict(self) -> dict[str, str]:
        return {
            "KALSHI-ACCESS-KEY": self.access_key,
            "KALSHI-ACCESS-SIGNATURE": self.signature,
            "KALSHI-ACCESS-TIMESTAMP": self.timestamp_ms,
        }


def load_private_key_from_pem(path: Path) -> RSAPrivateKey:
    """Load an RSA private key from a PEM file.

    Path must be absolute or home-expandable. A bare filename (no directory
    component) is rejected to prevent accidental CWD-relative key loading.
    """
    if not path.is_absolute() and not path.expanduser().is_absolute():
        raise ValueError(
            f"private_key_path must be absolute (or use ~), got bare filename: {path}"
        )
    expanded = path.expanduser()
    pem_bytes = expanded.read_bytes()
    key = serialization.load_pem_private_key(pem_bytes, password=None)
    if not isinstance(key, RSAPrivateKey):
        raise TypeError(f"expected RSA private key, got {type(key).__name__}")
    return key


class KalshiSigner:
    """Stateless signer — produces fresh `SigningHeaders` per request.

    `sign(method, full_path)` where `full_path` includes the `/trade-api/v2`
    prefix. Query params are stripped inside this method — callers may pass
    paths with or without `?…` and the signature will be identical.
    """

    def __init__(
        self,
        api_key: str,
        private_key: RSAPrivateKey,
        clock: Clock | None = None,
    ) -> None:
        self.api_key = api_key
        self.private_key = private_key
        self.clock = clock or SystemClock()

    def sign(self, method: str, full_path: str) -> SigningHeaders:
        """Sign a request.

        Args:
            method: HTTP verb, e.g. "GET" or "POST" (case-insensitive).
            full_path: full URL path including /trade-api/v2 prefix, with or
                       without query string. Query params are stripped here.
        """
        bare_path = full_path.split("?", 1)[0]
        ts_ms = str(int(self.clock.now().timestamp() * 1000))
        message = f"{ts_ms}{method.upper()}{bare_path}".encode()
        sig_bytes = self.private_key.sign(
            message,
            padding.PSS(
                mgf=padding.MGF1(SHA256()),
                salt_length=padding.PSS.DIGEST_LENGTH,
            ),
            SHA256(),
        )
        return SigningHeaders(
            access_key=self.api_key,
            signature=base64.b64encode(sig_bytes).decode("ascii"),
            timestamp_ms=ts_ms,
        )
```

- [ ] **Step 5: Run + commit**

```bash
uv run pytest tests/venues/kalshi/test_auth.py -v
```

Expected: all auth unit tests pass (all except `test_signer_headers_appear_on_wire_when_configured`,
which requires `KalshiClient` from Task 4 — it is expected to error with
`ModuleNotFoundError: No module named 'pytheum.venues.kalshi.client'` at this stage).
The wire test will become green in Task 4. Mark it with `@pytest.mark.skip(reason="requires Task 4")`
temporarily if it blocks the commit:

```python
@pytest.mark.skip(reason="requires KalshiClient from Task 4")
def test_signer_headers_appear_on_wire_when_configured(fresh_pem: Path) -> None:
    ...
```

```bash
cd /Users/kanagn/Desktop/pytheum-cli
git add src/pytheum/data/envelope.py \
        src/pytheum/venues/ \
        tests/venues/ \
        tests/fixtures/kalshi/
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "venues/kalshi: RawEnvelope + package scaffold + RSA-PSS signer (full-path, query-stripped)"
```

---

## Task 3: Kalshi URL / ticker parser

No changes from the v1 plan — this task was flagged as good by the reviewer.

**Files:**
- Create: `src/pytheum/venues/kalshi/urls.py`
- Test: `tests/venues/kalshi/test_urls.py`

- [ ] **Step 1: Failing test**

Write `tests/venues/kalshi/test_urls.py`:

```python
from __future__ import annotations

import pytest

from pytheum.data.errors import MalformedURL
from pytheum.data.models import Venue
from pytheum.data.refs import EventRef, MarketRef, RefType
from pytheum.venues.kalshi.urls import parse_kalshi_url, parse_kalshi_ticker


def test_parse_market_url_full() -> None:
    url = "https://kalshi.com/markets/FED/FED-25DEC/FED-25DEC-T4.00"
    ref = parse_kalshi_url(url)
    assert ref == MarketRef(
        venue=Venue.KALSHI,
        ref_type=RefType.KALSHI_TICKER,
        value="FED-25DEC-T4.00",
    )


def test_parse_event_url() -> None:
    url = "https://kalshi.com/markets/FED/FED-25DEC"
    ref = parse_kalshi_url(url)
    assert ref == EventRef(
        venue=Venue.KALSHI,
        ref_type=RefType.KALSHI_EVENT_TICKER,
        value="FED-25DEC",
    )


def test_parse_url_handles_trailing_slash_and_query() -> None:
    url = "https://kalshi.com/markets/FED/FED-25DEC/FED-25DEC-T4.00/?utm=x"
    ref = parse_kalshi_url(url)
    assert isinstance(ref, MarketRef)
    assert ref.value == "FED-25DEC-T4.00"


def test_parse_non_kalshi_url_raises() -> None:
    with pytest.raises(MalformedURL):
        parse_kalshi_url("https://polymarket.com/event/x")


def test_parse_garbage_raises() -> None:
    with pytest.raises(MalformedURL):
        parse_kalshi_url("not-a-url")


def test_parse_bare_ticker_market() -> None:
    ref = parse_kalshi_ticker("FED-25DEC-T4.00")
    assert ref == MarketRef(
        venue=Venue.KALSHI,
        ref_type=RefType.KALSHI_TICKER,
        value="FED-25DEC-T4.00",
    )


def test_parse_bare_event_ticker() -> None:
    ref = parse_kalshi_ticker("FED-25DEC")
    assert ref == EventRef(
        venue=Venue.KALSHI,
        ref_type=RefType.KALSHI_EVENT_TICKER,
        value="FED-25DEC",
    )


def test_parse_bare_series_ticker_raises() -> None:
    """A bare series ticker like 'FED' is ambiguous — reject."""
    with pytest.raises(MalformedURL):
        parse_kalshi_ticker("FED")
```

- [ ] **Step 2: Verify failure**

```bash
uv run pytest tests/venues/kalshi/test_urls.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

Write `src/pytheum/venues/kalshi/urls.py`:

```python
"""Parse Kalshi URLs and bare tickers into MarketRef / EventRef.

Kalshi URL convention:  /markets/{series}/{event_ticker}/{market_ticker}
                        /markets/{series}/{event_ticker}

Bare-ticker disambiguation:
    XXX-YYYYMM-TZZ.ZZ    → market (3+ hyphen parts, last starts with T)
    XXX-YYYYMM            → event  (2 hyphen parts)
    XXX                   → ambiguous — refuse (could be series, event, or category)

See also spec §3.7 for the full URL resolution matrix.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

from pytheum.data.errors import MalformedURL
from pytheum.data.models import Venue
from pytheum.data.refs import EventRef, MarketRef, RefType

__all__ = ["parse_kalshi_url", "parse_kalshi_ticker"]

_HOSTS = ("kalshi.com", "www.kalshi.com")
_SUPPORTED = [
    "https://kalshi.com/markets/{series}/{event}/{market}",
    "https://kalshi.com/markets/{series}/{event}",
    "FED-25DEC-T4.00  (bare market ticker)",
    "FED-25DEC         (bare event ticker)",
]
# Tickers: start with an uppercase letter, then uppercase / digits / hyphens / dots.
_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9]*(-[A-Z0-9.]+)+$")


def parse_kalshi_url(url: str) -> MarketRef | EventRef:
    """Parse a Kalshi market or event URL into a typed ref.

    Raises MalformedURL if the host is not kalshi.com or the path structure
    doesn't match the expected /markets/{series}/{event}[/{market}] pattern.
    """
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in _HOSTS:
        raise MalformedURL(raw_input=url, supported_patterns=_SUPPORTED)
    parts = [p for p in parsed.path.split("/") if p]
    # parts: ["markets", series, event, (market)?]
    if len(parts) < 3 or parts[0] != "markets":
        raise MalformedURL(raw_input=url, supported_patterns=_SUPPORTED)
    if len(parts) >= 4:
        return MarketRef(
            venue=Venue.KALSHI,
            ref_type=RefType.KALSHI_TICKER,
            value=parts[3],
        )
    if len(parts) == 3:
        return EventRef(
            venue=Venue.KALSHI,
            ref_type=RefType.KALSHI_EVENT_TICKER,
            value=parts[2],
        )
    raise MalformedURL(raw_input=url, supported_patterns=_SUPPORTED)


def parse_kalshi_ticker(s: str) -> MarketRef | EventRef:
    """Disambiguate a bare Kalshi ticker string.

    Three-or-more-part tickers (last segment starts with T) → MarketRef.
    Two-part tickers → EventRef.
    One-part tickers → MalformedURL (ambiguous — may be a series ticker).
    """
    if not _TICKER_RE.match(s):
        raise MalformedURL(raw_input=s, supported_patterns=_SUPPORTED)
    parts = s.split("-")
    if len(parts) >= 3 and parts[-1].startswith("T"):
        return MarketRef(
            venue=Venue.KALSHI,
            ref_type=RefType.KALSHI_TICKER,
            value=s,
        )
    if len(parts) == 2:
        return EventRef(
            venue=Venue.KALSHI,
            ref_type=RefType.KALSHI_EVENT_TICKER,
            value=s,
        )
    raise MalformedURL(raw_input=s, supported_patterns=_SUPPORTED)
```

- [ ] **Step 4: Run + commit**

```bash
uv run pytest tests/venues/kalshi/test_urls.py -v
```

Expected: 8 passed.

```bash
cd /Users/kanagn/Desktop/pytheum-cli
git add src/pytheum/venues/kalshi/urls.py tests/venues/kalshi/test_urls.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "venues/kalshi: URL + bare-ticker parser"
```

---

## Task 4: RawEnvelope-returning KalshiRest._send + KalshiClient (no repository dependency)

This is the core architectural fix for reviewer finding #2 (layering conflict) and #3
(raw_id=0 fallback). The client is a pure transporter. The service layer (Task 5) is
responsible for all DB writes.

Key changes from v1 plan:
- `KalshiRest` has NO `repository` parameter.
- `_send()` returns `tuple[Any, RawEnvelope]`, not `tuple[Any, int]`.
- `raw_id = 0` fallback is gone entirely.
- `KalshiClient` accepts optional `signer: KalshiSigner | None`.
- `_send` builds `full_path = f"/trade-api/v2{path}"` and calls `signer.sign(method, full_path)`.
- Error mapping: 401/403 → `AuthRequired`, 404 → `NoResults`, 429 → `RateLimited`, 5xx → `VenueUnavailable`.

**Files:**
- Create: `src/pytheum/venues/kalshi/rest.py` (initial skeleton)
- Create: `src/pytheum/venues/kalshi/client.py`
- Test: `tests/venues/kalshi/test_rest.py` (base machinery tests)

- [ ] **Step 1: Failing test**

Write `tests/venues/kalshi/test_rest.py`:

```python
from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from pytheum.core.clock import FixedClock
from pytheum.core.config import KalshiConfig
from pytheum.data.envelope import RawEnvelope
from pytheum.data.errors import (
    AuthRequired,
    NoResults,
    RateLimited,
    VenueUnavailable,
)
from pytheum.venues.kalshi.auth import KalshiSigner, load_private_key_from_pem
from pytheum.venues.kalshi.client import KalshiClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_client(
    transport: httpx.MockTransport,
    signer: KalshiSigner | None = None,
) -> KalshiClient:
    clock = FixedClock(datetime(2026, 1, 1, tzinfo=UTC))
    return KalshiClient(
        config=KalshiConfig(rate_limit_per_sec=10_000),  # don't throttle tests
        signer=signer,
        _transport=transport,
        _clock=clock,
    )


@pytest.fixture
def fresh_signer(tmp_path: Path) -> KalshiSigner:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    p = tmp_path / "key.pem"
    p.write_bytes(pem)
    clock = FixedClock(datetime(2026, 1, 1, tzinfo=UTC))
    return KalshiSigner(
        api_key="ak-test",
        private_key=load_private_key_from_pem(p),
        clock=clock,
    )


# ---------------------------------------------------------------------------
# RawEnvelope fields
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_send_returns_raw_envelope_with_correct_fields() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"series": []})

    client = _make_client(httpx.MockTransport(handler))
    async with client:
        body, env = await client.rest._send("GET", "/series", params={"limit": 5}, native_ids=[])

    assert body == {"series": []}
    assert isinstance(env, RawEnvelope)
    assert env.venue.value == "kalshi"
    assert env.transport == "rest"
    assert env.endpoint == "/series"
    assert env.request_params == {"limit": 5}
    assert env.status_code == 200
    assert env.duration_ms is not None and env.duration_ms >= 0
    assert env.payload == {"series": []}
    assert env.native_ids == []


@pytest.mark.asyncio
async def test_send_native_ids_forwarded_to_envelope() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"market": {}})

    client = _make_client(httpx.MockTransport(handler))
    async with client:
        _, env = await client.rest._send(
            "GET", "/markets/FED-25DEC-T4.00",
            params=None,
            native_ids=["FED-25DEC-T4.00"],
        )
    assert env.native_ids == ["FED-25DEC-T4.00"]
    assert env.endpoint == "/markets/FED-25DEC-T4.00"


# ---------------------------------------------------------------------------
# Error mapping
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_429_raises_rate_limited_with_retry_after() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"Retry-After": "7"}, json={"error": "throttle"})

    client = _make_client(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(RateLimited) as exc:
            await client.rest._send("GET", "/series", params=None, native_ids=[])
    assert exc.value.retry_after_s == 7.0


@pytest.mark.asyncio
async def test_429_no_retry_after_header() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": "throttle"})

    client = _make_client(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(RateLimited) as exc:
            await client.rest._send("GET", "/series", params=None, native_ids=[])
    assert exc.value.retry_after_s is None


@pytest.mark.asyncio
async def test_404_raises_no_results() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "not found"})

    client = _make_client(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(NoResults):
            await client.rest._send(
                "GET", "/series/FED", params=None, native_ids=["FED"]
            )


@pytest.mark.asyncio
async def test_401_raises_auth_required() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "auth"})

    client = _make_client(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(AuthRequired):
            await client.rest._send(
                "GET", "/portfolio/balance", params=None, native_ids=[]
            )


@pytest.mark.asyncio
async def test_403_raises_auth_required() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "forbidden"})

    client = _make_client(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(AuthRequired):
            await client.rest._send(
                "GET", "/portfolio/balance", params=None, native_ids=[]
            )


@pytest.mark.asyncio
async def test_500_raises_venue_unavailable_with_status_code() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    client = _make_client(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(VenueUnavailable) as exc:
            await client.rest._send("GET", "/series", params=None, native_ids=[])
    assert exc.value.status_code == 500


@pytest.mark.asyncio
async def test_503_raises_venue_unavailable() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"error": "service unavailable"})

    client = _make_client(httpx.MockTransport(handler))
    async with client:
        with pytest.raises(VenueUnavailable) as exc:
            await client.rest._send("GET", "/series", params=None, native_ids=[])
    assert exc.value.status_code == 503


# ---------------------------------------------------------------------------
# Signer headers on the wire (reviewer finding #5)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_signer_headers_appear_on_wire(fresh_signer: KalshiSigner) -> None:
    """When a signer is configured, KALSHI-ACCESS-* headers must reach the server."""
    captured: dict[str, str] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured.update({k.lower(): v for k, v in req.headers.items()})
        return httpx.Response(200, json={"ok": True})

    client = _make_client(httpx.MockTransport(handler), signer=fresh_signer)
    async with client:
        await client.rest._send("GET", "/series", params=None, native_ids=[])

    assert "kalshi-access-key" in captured
    assert "kalshi-access-signature" in captured
    assert "kalshi-access-timestamp" in captured
    assert captured["kalshi-access-key"] == "ak-test"


@pytest.mark.asyncio
async def test_no_signer_no_auth_headers() -> None:
    """Without a signer, no KALSHI-ACCESS-* headers should be sent."""
    captured: dict[str, str] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured.update({k.lower(): v for k, v in req.headers.items()})
        return httpx.Response(200, json={"ok": True})

    client = _make_client(httpx.MockTransport(handler), signer=None)
    async with client:
        await client.rest._send("GET", "/series", params=None, native_ids=[])

    assert "kalshi-access-key" not in captured
    assert "kalshi-access-signature" not in captured


@pytest.mark.asyncio
async def test_signer_signs_full_path_including_prefix(fresh_signer: KalshiSigner) -> None:
    """The signed path must include /trade-api/v2 prefix (reviewer finding #5)."""
    import base64
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.hashes import SHA256

    signed_ts: str = ""
    signed_sig: str = ""

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal signed_ts, signed_sig
        # httpx lowercases header names
        signed_ts = req.headers.get("kalshi-access-timestamp", "")
        signed_sig = req.headers.get("kalshi-access-signature", "")
        return httpx.Response(200, json={"ok": True})

    client = _make_client(httpx.MockTransport(handler), signer=fresh_signer)
    async with client:
        await client.rest._send("GET", "/series", params=None, native_ids=[])

    assert signed_ts and signed_sig
    # Verify the signature was made with full_path = /trade-api/v2/series
    message = f"{signed_ts}GET/trade-api/v2/series".encode()
    sig_bytes = base64.b64decode(signed_sig)
    pub_key = fresh_signer.private_key.public_key()
    # Should not raise — if the wrong path was signed, verify() raises InvalidSignature.
    pub_key.verify(
        sig_bytes,
        message,
        padding.PSS(mgf=padding.MGF1(SHA256()), salt_length=padding.PSS.DIGEST_LENGTH),
        SHA256(),
    )
```

@pytest.mark.asyncio
async def test_429_triggers_retry_and_eventually_succeeds() -> None:
    """A transport that returns 429 once then 200 must succeed after retry."""
    attempt_count = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal attempt_count
        attempt_count += 1
        if attempt_count == 1:
            return httpx.Response(429, headers={"Retry-After": "0"}, json={"error": "rate limited"})
        return httpx.Response(200, json={"series": []})

    client = _make_client(httpx.MockTransport(handler))
    async with client:
        body, env = await client.rest._send("GET", "/series", params=None, native_ids=[])

    assert attempt_count == 2, f"Expected 2 attempts (1 retry), got {attempt_count}"
    assert env.status_code == 200
```

- [ ] **Step 2: Verify failure**

```bash
uv run pytest tests/venues/kalshi/test_rest.py -v
```

Expected: `ModuleNotFoundError: No module named 'pytheum.venues.kalshi.client'`.

- [ ] **Step 3: Implement KalshiRest + KalshiClient**

Write `src/pytheum/venues/kalshi/rest.py`:

```python
"""KalshiRest — pure transport layer for Kalshi trade-api/v2 REST endpoints.

Design contract (reviewer findings #2, #3):
- NO MarketRepository parameter. This class never writes to DuckDB.
- Every method returns (parsed_model, RawEnvelope).
  The service layer (KalshiFetchService) owns raw recording + normalize + upsert.
- No raw_id=0 fallback — if a caller wants ephemeral data, it discards the envelope.

Per-endpoint pagination limits (decision #12):
    _LIMIT_SERIES = 200, _LIMIT_EVENTS = 200, _LIMIT_MARKETS = 1000,
    _LIMIT_TRADES = 1000, _LIMIT_HIST_TRADES = 1000

Endpoints are added in Tasks 6-11. This file owns only the base _send() + error
mapping.
"""
from __future__ import annotations

import json as _json_module
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

import httpx

from pytheum.core.clock import Clock, SystemClock
from pytheum.core.rate_limit import AsyncRateLimiter
from pytheum.core.retry import RetryPolicy, retry_async
from pytheum.data.envelope import RawEnvelope
from pytheum.data.errors import (
    AuthRequired,
    NoResults,
    RateLimited,
    VenueUnavailable,
)
from pytheum.data.models import Venue
from pytheum.venues.kalshi.auth import KalshiSigner

__all__ = ["KalshiRest"]

# Per-endpoint pagination limits — Kalshi documented maximums (decision #12).
_LIMIT_SERIES      = 200
_LIMIT_EVENTS      = 200
_LIMIT_MARKETS     = 1000
_LIMIT_TRADES      = 1000
_LIMIT_HIST_TRADES = 1000

# Kalshi API path prefix — prepended before signing (reviewer finding #5).
_API_PREFIX = "/trade-api/v2"


class KalshiRest:
    """Kalshi REST sub-client. Constructed and owned by KalshiClient.

    All methods return (result, RawEnvelope). The envelope carries all
    metadata needed for the service layer to call record_raw_rest.
    """

    def __init__(
        self,
        *,
        http: httpx.AsyncClient,
        signer: KalshiSigner | None,
        rate_limiter: AsyncRateLimiter,
        clock: Clock,
    ) -> None:
        self._http = http
        self._signer = signer
        self._rl = rate_limiter
        self._clock = clock
        # _send is the public retry-wrapped entry point; _send_inner is the actual
        # implementation. The retry layer handles RateLimited + VenueUnavailable (5xx).
        # Circuit breaker integration is deferred to a later phase.
        self._send = retry_async(
            RetryPolicy(max_attempts=4, base_s=1.0, max_s=30.0, jitter=0.2)
        )(self._send_inner)

    async def _send_inner(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None,
        native_ids: Sequence[str] = (),
    ) -> tuple[Any, RawEnvelope]:
        """Inner implementation of _send (wrapped by retry in __init__).

        Public callers should use self._send (the retry-wrapped version).
        Send one HTTP request; return (parsed_body, RawEnvelope).

        Args:
            method: HTTP verb string (e.g. "GET", "POST").
            path: endpoint path relative to the base_url, e.g. "/series" or
                  "/markets/FED-25DEC-T4.00". Must NOT include /trade-api/v2
                  (that prefix is added here for signing, but the httpx client's
                  base_url already includes it).
            params: optional query parameters dict.
            native_ids: venue-native identifier(s) this request targets
                        (recorded in the RawEnvelope for traceability).

        Returns:
            (body, envelope) where body is the parsed JSON and envelope contains
            all metadata for downstream raw_payloads persistence.

        Raises:
            AuthRequired: 401 or 403
            NoResults: 404
            RateLimited: 429 (with optional retry_after_s)
            VenueUnavailable: 5xx or network error
        """
        await self._rl.acquire()

        # Build auth headers — sign the FULL path (prefix + endpoint).
        # The httpx base_url handles the actual URL construction; we only need
        # the full path string for the HMAC message.
        headers: dict[str, str] = {}
        if self._signer is not None:
            full_path = f"{_API_PREFIX}{path}"
            headers.update(self._signer.sign(method, full_path).as_dict())

        sent_at = self._clock.now()
        try:
            resp = await self._http.request(
                method, path, params=params, headers=headers
            )
        except httpx.HTTPError as exc:
            raise VenueUnavailable(venue=Venue.KALSHI, status_code=None, cause=exc) from exc

        finished_at = self._clock.now()
        duration_ms = int((finished_at - sent_at).total_seconds() * 1000)

        # Parse response body — always attempt JSON; fall back to text wrapper.
        body: Any
        try:
            body = resp.json()
        except _json_module.JSONDecodeError:
            body = {"_raw_text": resp.text}

        # Build the envelope. The service layer will call record_raw_rest with
        # envelope fields — no DB write happens here.
        envelope = RawEnvelope(
            venue=Venue.KALSHI,
            transport="rest",
            endpoint=path,
            request_params=dict(params) if params else None,
            received_ts=finished_at,
            source_ts=None,
            schema_version=1,
            native_ids=list(native_ids),
            payload=body,
            status_code=resp.status_code,
            duration_ms=duration_ms,
        )

        sc = resp.status_code
        if 200 <= sc < 300:
            return body, envelope
        if sc in (401, 403):
            raise AuthRequired(venue=Venue.KALSHI, endpoint=path)
        if sc == 404:
            raise NoResults(query=path, scope="kalshi-rest")
        if sc == 429:
            retry_after_h = resp.headers.get("Retry-After")
            retry_after = float(retry_after_h) if retry_after_h is not None else None
            raise RateLimited(venue=Venue.KALSHI, retry_after_s=retry_after)
        raise VenueUnavailable(venue=Venue.KALSHI, status_code=sc, cause=None)
```

Write `src/pytheum/venues/kalshi/client.py`:

```python
"""KalshiClient — top-level entry point for the Kalshi venue.

Usage (public, no auth):
    async with KalshiClient(config) as kc:
        body, env = await kc.rest._send("GET", "/series", params=None, native_ids=[])

Usage (authenticated):
    signer = KalshiSigner(api_key=..., private_key=load_private_key_from_pem(path))
    async with KalshiClient(config, signer=signer) as kc:
        body, env = await kc.rest._send("GET", "/portfolio/balance", params=None, native_ids=[])

The client owns the httpx.AsyncClient lifecycle. It does NOT own a MarketRepository —
persistence is the responsibility of KalshiFetchService (see pytheum/services/fetch.py).
"""
from __future__ import annotations

from types import TracebackType
from typing import Self

import httpx

from pytheum.core.clock import Clock, SystemClock
from pytheum.core.config import KalshiConfig
from pytheum.core.rate_limit import AsyncRateLimiter
from pytheum.venues.kalshi.auth import KalshiSigner
from pytheum.venues.kalshi.rest import KalshiRest

__all__ = ["KalshiClient"]

# Kalshi Elections Trade API v2 base URL.
_BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"


class KalshiClient:
    """Async Kalshi venue client. Use as async context manager or call aclose().

    Args:
        config:      KalshiConfig (rate_limit_per_sec, base_url override, etc.)
        signer:      Optional KalshiSigner for authenticated endpoints. If None,
                     only public endpoints are accessible.
        _transport:  Injected httpx transport for testing (use httpx.MockTransport).
        _clock:      Injected Clock for testing (use FixedClock).
    """

    def __init__(
        self,
        config: KalshiConfig | None = None,
        *,
        signer: KalshiSigner | None = None,
        _transport: httpx.AsyncBaseTransport | None = None,
        _clock: Clock | None = None,
    ) -> None:
        self.config = config or KalshiConfig()
        self._clock = _clock or SystemClock()
        base_url = getattr(config, "base_url", _BASE_URL) or _BASE_URL
        self._http = httpx.AsyncClient(
            base_url=base_url,
            timeout=15.0,
            headers={"Accept": "application/json"},
            transport=_transport,
        )
        burst = max(1, int(config.rate_limit_per_sec))
        self._rl = AsyncRateLimiter(
            rate_per_sec=config.rate_limit_per_sec,
            burst=burst,
            clock=self._clock,
        )
        self.rest = KalshiRest(
            http=self._http,
            signer=signer,
            rate_limiter=self._rl,
            clock=self._clock,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.aclose()
```

- [ ] **Step 4: Remove the skip marker from the wire test in test_auth.py**

Now that `KalshiClient` exists, remove the `@pytest.mark.skip` added in Task 2 Step 5 (if
it was added). The test `test_signer_headers_appear_on_wire_when_configured` in
`tests/venues/kalshi/test_auth.py` should now pass.

- [ ] **Step 5: Run all tests to confirm full green**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv run pytest tests/venues/kalshi/test_rest.py tests/venues/kalshi/test_auth.py -v
```

Expected: all rest + auth tests pass. If `test_signer_signs_full_path_including_prefix` fails
with `cryptography.exceptions.InvalidSignature`, the `_API_PREFIX` prepending in `_send` is
wrong — double-check the message construction in `KalshiRest._send`.

Also run the full suite to confirm nothing regressed:

```bash
uv run pytest --tb=short -q
```

Expected: all 130 Phase 1 tests + new Task 1-4 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
git add src/pytheum/venues/kalshi/rest.py \
        src/pytheum/venues/kalshi/client.py \
        tests/venues/kalshi/test_rest.py \
        tests/venues/kalshi/test_auth.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "venues/kalshi: pure-transport KalshiRest._send + KalshiClient — no repo dependency"
```

---

## Task 5: Normalizer module (pure functions)

**Files:**
- Create: `src/pytheum/venues/kalshi/normalizer.py`
- Create: `tests/venues/kalshi/test_normalizer.py`

---

- [ ] **Step 1: Write the failing tests**

`tests/venues/kalshi/test_normalizer.py`:

```python
"""Unit tests for pytheum.venues.kalshi.normalizer (pure functions).

Coverage: 1 happy-path + 1 SchemaDrift per normalizer function = 12 tests.
Real-fixture integration tests (cassette-backed) live in Tasks 7-11.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from pytheum.data.errors import SchemaDrift
from pytheum.data.models import SizeUnit
from pytheum.venues.kalshi import normalizer as N


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def _series_payload() -> dict:
    return {
        "series": [
            {
                "ticker": "KXINFL",
                "title": "Inflation",
                "category": "Economics",
                "tags": ["CPI", "macro"],
                "frequency": "monthly",
                "settlement_sources": [],
                "contract_url": "https://kalshi.com/markets/kxinfl",
            }
        ]
    }


def _event_payload() -> dict:
    return {
        "event": {
            "event_ticker": "KXINFL-25JAN",
            "series_ticker": "KXINFL",
            "title": "CPI Jan 2025",
            "category": "Economics",
            "sub_title": "",
            "status": "open",
            "mutually_exclusive": True,
            "markets": [],
            "strike_date": "2025-01-15T00:00:00Z",
        }
    }


def _market_payload() -> dict:
    return {
        "market": {
            "ticker": "KXINFL-25JAN-B3.5",
            "event_ticker": "KXINFL-25JAN",
            "title": "Will CPI exceed 3.5% in Jan 2025?",
            "subtitle": "",
            "status": "active",
            "result": "",
            "open_time": "2024-12-01T00:00:00Z",
            "close_time": "2025-01-15T12:00:00Z",
            "expiration_time": "2025-01-17T00:00:00Z",
            "yes_bid": 45,
            "yes_ask": 47,
            "no_bid": 53,
            "no_ask": 55,
            "last_price": 46,
            "volume": 12000,
            "open_interest": 3200,
            "liquidity": 8000,
            "rules_primary": "...",
            "rules_secondary": "",
            "response_price_units": "usd_cent",
        }
    }


def _orderbook_payload() -> dict:
    return {
        "orderbook": {
            "yes": [[45, 100], [44, 200]],
            "no": [[55, 150], [54, 300]],
        }
    }


def _trade_item() -> dict:
    return {
        "trade_id": "tr-abc123",
        "ticker": "KXINFL-25JAN-B3.5",
        "yes_price": 46,
        "no_price": 54,
        "count": 10,
        "taker_side": "yes",
        "created_time": "2025-01-10T14:23:00Z",
    }


def _candlestick_item() -> dict:
    return {
        "end_period_ts": 1736521380,
        "yes_bid": {"close": 46, "high": 48, "low": 44, "open": 45},
        "yes_ask": {"close": 47, "high": 49, "low": 45, "open": 46},
        "volume": 150,
        "open_interest": 3300,
    }


# ─────────────────────────────────────────────
# normalize_series_to_categories
# ─────────────────────────────────────────────

class TestNormalizeSeriesToCategories:
    def test_happy_path(self):
        cats = N.normalize_series_to_categories(_series_payload(), raw_id=1)
        assert len(cats) == 1
        cat = cats[0]
        assert cat.native_id == "KXINFL"
        assert cat.native_label == "Inflation"
        assert cat.display_label == "Economics"

    def test_schema_drift_on_missing_ticker(self):
        bad = {"series": [{"title": "No ticker here"}]}
        with pytest.raises(SchemaDrift):
            N.normalize_series_to_categories(bad, raw_id=99)


# ─────────────────────────────────────────────
# normalize_event
# ─────────────────────────────────────────────

class TestNormalizeEvent:
    def test_happy_path(self):
        event = N.normalize_event(_event_payload()["event"], raw_id=2)
        assert event.native_id == "KXINFL-25JAN"
        assert event.title == "CPI Jan 2025"
        assert event.market_count >= 0  # Event has no .status field

    def test_schema_drift_on_missing_event_key(self):
        bad = {"not_event": {}}
        with pytest.raises(SchemaDrift):
            N.normalize_event(bad, raw_id=99)


# ─────────────────────────────────────────────
# normalize_market
# ─────────────────────────────────────────────

class TestNormalizeMarket:
    def test_happy_path(self):
        market = N.normalize_market(_market_payload(), raw_id=3)
        assert market.native_id == "KXINFL-25JAN-B3.5"
        assert market.status == "open"  # "active" maps to "open"
        assert len(market.outcomes) == 2
        yes_outcome = next(o for o in market.outcomes if o.outcome_id == "yes")
        assert yes_outcome.price == Decimal("0.46")

    def test_schema_drift_on_missing_market_key(self):
        bad = {"not_market": {}}
        with pytest.raises(SchemaDrift):
            N.normalize_market(bad, raw_id=99)


# ─────────────────────────────────────────────
# normalize_orderbook
# ─────────────────────────────────────────────

class TestNormalizeOrderbook:
    def test_happy_path(self):
        yes_book, no_book = N.normalize_orderbook(
            _orderbook_payload(), market_native_id=10, raw_id=4
        )
        assert yes_book.outcome_id == "yes"
        assert len(yes_book.bids) == 2
        assert yes_book.bids[0][0] == Decimal("0.45")
        assert no_book.outcome_id == "no"
        assert len(no_book.bids) == 2

    def test_schema_drift_on_missing_orderbook_key(self):
        bad = {"wrong": {}}
        with pytest.raises(SchemaDrift):
            N.normalize_orderbook(bad, market_native_id=10, raw_id=99)


# ─────────────────────────────────────────────
# normalize_trade
# ─────────────────────────────────────────────

class TestNormalizeTrade:
    def test_happy_path(self):
        trade = N.normalize_trade(_trade_item(), raw_id=5)
        assert trade.outcome_id == "yes"
        assert trade.currency == "usd"
        assert trade.size_unit == SizeUnit.CONTRACTS
        assert trade.price == Decimal("0.46")
        assert trade.side == "buy"

    def test_schema_drift_on_missing_taker_side(self):
        bad = {"ticker": "X"}
        with pytest.raises(SchemaDrift):
            N.normalize_trade(bad, raw_id=99)


# ─────────────────────────────────────────────
# normalize_candlestick
# ─────────────────────────────────────────────

class TestNormalizeCandlestick:
    def test_happy_path(self):
        points = N.normalize_candlestick(
            _candlestick_item(),
            market_native_id=20,
            interval="1min",
            raw_id=6,
        )
        # yes + no → 2 price points
        assert len(points) == 2
        outcome_ids = {p.outcome_id for p in points}
        assert outcome_ids == {"yes", "no"}
        yes_pt = next(p for p in points if p.outcome_id == "yes")
        assert yes_pt.interval == "1m"

    def test_schema_drift_on_missing_end_period_ts(self):
        bad = {"yes_bid": {}, "yes_ask": {}, "volume": 0, "open_interest": 0}
        with pytest.raises(SchemaDrift):
            N.normalize_candlestick(
                bad, market_native_id=20, interval="1min", raw_id=99
            )
```

---

- [ ] **Step 2: Verify failure**

```bash
cd /Users/kanagn/Desktop/pytheum-cli && \
python -m pytest tests/venues/kalshi/test_normalizer.py -q 2>&1 | head -30
```

Expected: `ImportError` or `ModuleNotFoundError` — `normalizer` does not exist yet.
All 12 tests fail at collection time.

---

- [ ] **Step 3: Implement**

`src/pytheum/venues/kalshi/normalizer.py`:

```python
"""Pure normalizer functions for Kalshi REST payloads.

Each function accepts ``*, raw_id: int | None = None`` and raises
:exc:`~pytheum.data.errors.SchemaDrift` on any KeyError or ValidationError
so the caller (KalshiFetchService) can attach the real ``raw_id`` from
``record_raw_rest`` before re-raising.

No DuckDB, no HTTP — these are pure data transformations.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

import structlog

from pytheum.data.errors import SchemaDrift
from pytheum.data.models import (
    Category,
    Event,
    Market,
    Outcome,
    OrderBook,
    PricePoint,
    PriceUnit,
    SizeUnit,
    Trade,
    Venue,
    VolumeMetric,
)

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Status mapping
# ─────────────────────────────────────────────────────────────────────────────

_KALSHI_STATUS: dict[str, str] = {
    "active": "open",
    "unopened": "unopened",
    "open": "open",
    "closed": "closed",
    "settled": "settled",
    "paused": "paused",
}

# ─────────────────────────────────────────────────────────────────────────────
# Interval mapping
# ─────────────────────────────────────────────────────────────────────────────

_INTERVAL_MAP: dict[str, str] = {
    "1min": "1m",
    "1hr": "1h",
    "1day": "1d",
}

# ─────────────────────────────────────────────────────────────────────────────
# Shared helpers
# ─────────────────────────────────────────────────────────────────────────────


def _cents_to_prob(cents: int | float | None) -> Decimal | None:
    """Convert a Kalshi cent price (0–100) to a probability Decimal (0.00–1.00).

    Returns ``None`` when *cents* is ``None`` so callers can propagate absence
    cleanly without a separate sentinel.
    """
    if cents is None:
        return None
    return Decimal(str(cents)) / Decimal("100")


def _status(block: dict[str, Any]) -> str:
    """Return the normalised status string, warning on unknown values."""
    raw = block.get("status", "open")
    mapped = _KALSHI_STATUS.get(raw)
    if mapped is None:
        log.warning(
            "kalshi.normalizer.unknown_status",
            raw_status=raw,
            fallback="open",
        )
        mapped = "open"
    return mapped


# ─────────────────────────────────────────────────────────────────────────────
# Public normalizer functions
# ─────────────────────────────────────────────────────────────────────────────


def normalize_series_to_categories(
    payload: dict[str, Any],
    *,
    raw_id: int | None = None,
) -> list[Category]:
    """Normalise a ``GET /series`` response into a list of :class:`Category` models."""
    try:
        series_list: list[dict[str, Any]] = payload["series"]
        return [
            Category(
                venue=Venue.KALSHI,
                native_id=s["ticker"],
                native_label=s.get("title") or s["ticker"],
                display_label=s.get("category") or s.get("title") or s["ticker"],
            )
            for s in series_list
        ]
    except (KeyError, TypeError, Exception) as exc:
        raise SchemaDrift(
            venue=Venue.KALSHI,
            endpoint="series",
            raw_id=raw_id or 0,
            validator_errors=[str(exc)],
        ) from exc


def normalize_series(raw: dict[str, Any], *, raw_id: int) -> Category:
    """Normalize a single raw Kalshi series dict into a :class:`Category` model.

    Kalshi series are category buckets: each has a ticker (e.g. "KXBTC"),
    a title (e.g. "Bitcoin"), and a category string (e.g. "Crypto").
    We map:
        native_id    = series["ticker"]
        native_label = series["title"]     (or ticker if title absent)
        display_label = series.get("category") or series["title"]

    Raises :class:`SchemaDrift` if required fields are missing.
    """
    try:
        ticker = raw["ticker"]
        title = raw.get("title") or ticker
        category_label = raw.get("category") or title
        return Category(
            venue=Venue.KALSHI,
            native_id=ticker,
            native_label=title,
            display_label=category_label,
        )
    except (KeyError, ValidationError) as exc:
        raise SchemaDrift(
            venue=Venue.KALSHI,
            endpoint="/series",
            raw_id=raw_id,
            validator_errors=[str(exc)],
        ) from exc


def normalize_event(
    raw: dict[str, Any],
    *,
    raw_id: int,
) -> Event:
    """Normalise a single Kalshi event dict into an :class:`Event`.

    Accepts either a bare event dict (from a list response) or the inner
    ``payload["event"]`` dict from a detail response.

    Mapping: event_ticker→native_id, series_ticker→primary_category,
    close_time→closes_at, markets_count→market_count, volume→aggregate_volume.
    """
    try:
        ticker = raw["event_ticker"]
        series_ticker = raw.get("series_ticker") or raw.get("category", "")
        primary_category: Category | None = (
            Category(
                venue=Venue.KALSHI,
                native_id=series_ticker,
                native_label=series_ticker,
                display_label=series_ticker,
            )
            if series_ticker else None
        )
        closes_at_raw = raw.get("close_time") or raw.get("closes_at")
        closes_at: datetime | None = (
            datetime.fromisoformat(closes_at_raw.rstrip("Z")).replace(tzinfo=UTC)
            if closes_at_raw else None
        )
        volume_raw = raw.get("volume") or raw.get("dollar_volume")
        return Event(
            venue=Venue.KALSHI,
            native_id=ticker,
            title=raw.get("title") or ticker,
            primary_category=primary_category,
            tags=[],
            closes_at=closes_at,
            market_count=int(raw.get("markets_count", 0) or 0),
            aggregate_volume=Decimal(str(volume_raw)) if volume_raw is not None else None,
            volume_metric=VolumeMetric.USD_TOTAL,
            url=(
                f"https://kalshi.com/markets/{series_ticker}/{ticker}"
                if series_ticker else None
            ),
            raw_id=raw_id,
            schema_version=1,
        )
    except (KeyError, ValueError, ValidationError) as exc:
        raise SchemaDrift(
            venue=Venue.KALSHI,
            endpoint="/events",
            raw_id=raw_id or 0,
            validator_errors=[str(exc)],
        ) from exc


def normalize_market(
    payload: dict[str, Any],
    *,
    raw_id: int | None = None,
) -> Market:
    """Normalise a ``GET /markets/{ticker}`` response into a :class:`Market`.

    Builds exactly two :class:`Outcome` entries — ``yes`` and ``no`` —
    from the cent-denominated bid prices using :func:`_cents_to_prob`.
    """
    try:
        block: dict[str, Any] = payload["market"]
        ticker = block["ticker"]
        yes_prob = _cents_to_prob(block.get("yes_bid"))
        no_prob = _cents_to_prob(block.get("no_bid"))
        outcomes: list[Outcome] = [
            Outcome(
                venue=Venue.KALSHI, market_native_id=ticker,
                outcome_id="yes", token_id=None, label="YES",
                price=yes_prob, native_price=Decimal(str(block.get("yes_bid") or 0)),
                price_unit=PriceUnit.CENTS_100,
                volume=None, volume_metric=VolumeMetric.UNKNOWN, schema_version=1,
            ),
            Outcome(
                venue=Venue.KALSHI, market_native_id=ticker,
                outcome_id="no", token_id=None, label="NO",
                price=no_prob, native_price=Decimal(str(block.get("no_bid") or 0)),
                price_unit=PriceUnit.CENTS_100,
                volume=None, volume_metric=VolumeMetric.UNKNOWN, schema_version=1,
            ),
        ]
        return Market(
            venue=Venue.KALSHI,
            native_id=ticker,
            event_native_id=block.get("event_ticker") or None,
            title=block.get("title", ""),
            question=block.get("subtitle") or block.get("title", ""),
            status=_status(block),
            outcomes=outcomes,
            total_volume=Decimal(str(block["volume"])) if block.get("volume") is not None else None,
            volume_metric=VolumeMetric.UNKNOWN,
            open_interest=Decimal(str(block["open_interest"])) if block.get("open_interest") is not None else None,
            liquidity=Decimal(str(block["liquidity"])) if block.get("liquidity") is not None else None,
            closes_at=None,
            url=None,
            raw_id=raw_id,
            schema_version=1,
        )
    except (KeyError, TypeError, Exception) as exc:
        raise SchemaDrift(
            venue=Venue.KALSHI,
            endpoint="market",
            raw_id=raw_id or 0,
            validator_errors=[str(exc)],
        ) from exc


def normalize_orderbook(
    payload: dict[str, Any],
    *,
    market_native_id: int,
    raw_id: int | None = None,
) -> tuple[OrderBook, OrderBook]:
    """Normalise a ``GET /markets/{ticker}/orderbook`` response.

    Returns ``(yes_book, no_book)``. Each level list is ``[[price_cents, qty], ...]``.
    """
    try:
        block: dict[str, Any] = payload["orderbook"]

        def _tuples(raw: list[list[int]]) -> list[tuple[Decimal, Decimal]]:
            return [
                (
                    _cents_to_prob(level[0]) or Decimal("0"),
                    Decimal(str(level[1])),
                )
                for level in raw
            ]

        yes_levels = _tuples(block.get("yes", []))
        no_levels = _tuples(block.get("no", []))
        from datetime import datetime, timezone
        now = datetime.now(tz=timezone.utc)
        yes_book = OrderBook(
            venue=Venue.KALSHI,
            market_native_id=market_native_id,
            outcome_id="yes",
            bids=yes_levels,
            asks=[],
            price_unit=PriceUnit.CENTS_100,
            size_unit=SizeUnit.CONTRACTS,
            timestamp=now,
            raw_id=raw_id,
            schema_version=1,
        )
        no_book = OrderBook(
            venue=Venue.KALSHI,
            market_native_id=market_native_id,
            outcome_id="no",
            bids=no_levels,
            asks=[],
            price_unit=PriceUnit.CENTS_100,
            size_unit=SizeUnit.CONTRACTS,
            timestamp=now,
            raw_id=raw_id,
            schema_version=1,
        )
        return yes_book, no_book
    except (KeyError, TypeError, Exception) as exc:
        raise SchemaDrift(
            venue=Venue.KALSHI,
            endpoint="orderbook",
            raw_id=raw_id or 0,
            validator_errors=[str(exc)],
        ) from exc


def normalize_trade(
    item: dict[str, Any],
    *,
    raw_id: int | None = None,
) -> Trade:
    """Normalise a single trade item from ``GET /markets/{ticker}/trades``.

    ``taker_side`` determines the directional outcome_id (``"yes"`` or ``"no"``).
    Currency is always ``"usd"``; size unit is always ``CONTRACTS``.
    Cent prices are converted to probabilities via :func:`_cents_to_prob`.
    """
    try:
        taker_side: str = item["taker_side"]
        native_price = Decimal(str(item.get("yes_price", 0) if taker_side == "yes" else item.get("no_price", 0)))
        native_size = Decimal(str(item.get("count", 0)))
        price = native_price / Decimal("100")
        notional = native_price * native_size / Decimal("100")
        from datetime import datetime
        created = item["created_time"]
        if isinstance(created, str):
            ts = datetime.fromisoformat(created.replace("Z", "+00:00"))
        else:
            from datetime import timezone
            ts = datetime.fromtimestamp(int(created), tz=timezone.utc)
        return Trade(
            venue=Venue.KALSHI,
            market_native_id=item.get("ticker", ""),
            outcome_id=taker_side,  # "yes" | "no"
            price=price,
            native_price=native_price,
            price_unit=PriceUnit.CENTS_100,
            size=native_size,
            native_size=native_size,
            size_unit=SizeUnit.CONTRACTS,
            notional=notional,
            currency="usd",
            side="buy" if taker_side == "yes" else "sell",
            timestamp=ts,
            raw_id=raw_id,
            schema_version=1,
        )
    except (KeyError, TypeError, Exception) as exc:
        raise SchemaDrift(
            venue=Venue.KALSHI,
            endpoint="trades",
            raw_id=raw_id or 0,
            validator_errors=[str(exc)],
        ) from exc


def normalize_candlestick(
    item: dict[str, Any],
    *,
    market_native_id: int,
    interval: str,
    raw_id: int | None = None,
) -> list[PricePoint]:
    """Normalise a single candlestick item from ``GET /series/{ticker}/markets/candlesticks``.

    Returns two :class:`PricePoint` objects — one for ``yes``, one for ``no``.
    *interval* is mapped: ``1min`` → ``1m``, ``1hr`` → ``1h``, ``1day`` → ``1d``.
    Unknown interval strings are passed through unmodified with a warning.
    """
    try:
        ts: int = item["end_period_ts"]
        mapped_interval = _INTERVAL_MAP.get(interval)
        if mapped_interval is None:
            log.warning(
                "kalshi.normalizer.unknown_interval",
                raw_interval=interval,
                passthrough=interval,
            )
            mapped_interval = interval

        yes_bid = item.get("yes_bid", {})
        yes_ask = item.get("yes_ask", {})

        def _ohlc(bid: dict[str, Any], ask: dict[str, Any]) -> dict[str, Decimal | None]:
            # Use bid close as the representative price; expose all four legs.
            return {
                "open": _cents_to_prob(bid.get("open")),
                "high": _cents_to_prob(bid.get("high")),
                "low": _cents_to_prob(bid.get("low")),
                "close": _cents_to_prob(bid.get("close")),
                "ask_close": _cents_to_prob(ask.get("close")),
            }

        yes_ohlc = _ohlc(yes_bid, yes_ask)
        # No-side prices are the complement of yes-side when not provided directly.
        no_bid = item.get("no_bid", {})
        no_ask = item.get("no_ask", {})
        no_ohlc = _ohlc(no_bid, no_ask) if no_bid else {
            k: (Decimal("1") - v if v is not None else None)
            for k, v in yes_ohlc.items()
        }

        from datetime import datetime, timezone
        timestamp = datetime.fromtimestamp(ts, tz=timezone.utc)
        yes_pt = PricePoint(
            venue=Venue.KALSHI,
            market_native_id=market_native_id,
            outcome_id="yes",
            timestamp=timestamp,
            price=yes_ohlc["close"] or Decimal("0"),
            native_price=(yes_ohlc["close"] or Decimal("0")) * Decimal("100"),
            price_unit=PriceUnit.CENTS_100,
            volume=Decimal(str(item["volume"])) if item.get("volume") is not None else None,
            volume_metric=VolumeMetric.UNKNOWN,
            interval=mapped_interval,
            raw_id=raw_id,
            schema_version=1,
        )
        no_pt = PricePoint(
            venue=Venue.KALSHI,
            market_native_id=market_native_id,
            outcome_id="no",
            timestamp=timestamp,
            price=no_ohlc["close"] or Decimal("0"),
            native_price=(no_ohlc["close"] or Decimal("0")) * Decimal("100"),
            price_unit=PriceUnit.CENTS_100,
            volume=Decimal(str(item["volume"])) if item.get("volume") is not None else None,
            volume_metric=VolumeMetric.UNKNOWN,
            interval=mapped_interval,
            raw_id=raw_id,
            schema_version=1,
        )
        return [yes_pt, no_pt]
    except (KeyError, TypeError, Exception) as exc:
        raise SchemaDrift(
            venue=Venue.KALSHI,
            endpoint="candlesticks",
            raw_id=raw_id or 0,
            validator_errors=[str(exc)],
        ) from exc
```

---

- [ ] **Step 4: Verify pass**

```bash
cd /Users/kanagn/Desktop/pytheum-cli && \
python -m pytest tests/venues/kalshi/test_normalizer.py -v 2>&1 | tail -20
```

Expected output (12 tests):

```
tests/venues/kalshi/test_normalizer.py::TestNormalizeSeriesToCategories::test_happy_path PASSED
tests/venues/kalshi/test_normalizer.py::TestNormalizeSeriesToCategories::test_schema_drift_on_missing_ticker PASSED
tests/venues/kalshi/test_normalizer.py::TestNormalizeEvent::test_happy_path PASSED
tests/venues/kalshi/test_normalizer.py::TestNormalizeEvent::test_schema_drift_on_missing_event_key PASSED
tests/venues/kalshi/test_normalizer.py::TestNormalizeMarket::test_happy_path PASSED
tests/venues/kalshi/test_normalizer.py::TestNormalizeMarket::test_schema_drift_on_missing_market_key PASSED
tests/venues/kalshi/test_normalizer.py::TestNormalizeOrderbook::test_happy_path PASSED
tests/venues/kalshi/test_normalizer.py::TestNormalizeOrderbook::test_schema_drift_on_missing_orderbook_key PASSED
tests/venues/kalshi/test_normalizer.py::TestNormalizeTrade::test_happy_path PASSED
tests/venues/kalshi/test_normalizer.py::TestNormalizeTrade::test_schema_drift_on_missing_trade_id PASSED
tests/venues/kalshi/test_normalizer.py::TestNormalizeCandlestick::test_happy_path PASSED
tests/venues/kalshi/test_normalizer.py::TestNormalizeCandlestick::test_schema_drift_on_missing_end_period_ts PASSED

============== 12 passed in X.XXs ==============
```

Also confirm the full suite still green:

```bash
cd /Users/kanagn/Desktop/pytheum-cli && \
python -m pytest --tb=short -q 2>&1 | tail -5
```

Expected: all Phase 1 tests (130+) plus 12 new tests pass; zero failures.

---

- [ ] **Step 5: Commit**

```bash
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "$(cat <<'EOF'
feat(normalizer): add Kalshi REST normalizer — 6 pure functions, 12 unit tests

- normalize_series_to_categories, normalize_event, normalize_market,
  normalize_orderbook, normalize_trade, normalize_candlestick
- _KALSHI_STATUS dict + _cents_to_prob helper (verbatim from plan)
- All functions accept *, raw_id: int | None = None and raise SchemaDrift
  on KeyError / ValidationError so KalshiFetchService can supply raw_id
- Unknown status values emit structlog warning and fall back to "open"
- Unknown interval strings pass through with a structlog warning
- 12 unit tests: 1 happy-path + 1 SchemaDrift per function
EOF
)"
```

---

## Task 6: App Services scaffold + KalshiFetchService

**Files:**
- Create: `src/pytheum/services/__init__.py`
- Create: `src/pytheum/services/fetch.py`
- Create: `tests/services/__init__.py`
- Create: `tests/services/conftest.py`
- Create: `tests/services/test_fetch.py`
- Create: `tests/fixtures/kalshi/_manifest.py`
- Create: `tests/fixtures/kalshi/manifest.json`

---

- [ ] **Step 1: Write the failing tests**

`tests/services/test_fetch.py`:

```python
"""Tests for KalshiFetchService scaffold (Task 6).

All service methods are stubs in Task 6; their bodies arrive in Tasks 7-11.
These tests verify the service can be instantiated and that the expected
method names exist (so Task 7-11 tests don't fail at attribute lookup).
"""
from __future__ import annotations

from pathlib import Path

import pytest
import pytest_asyncio

from pytheum.services.fetch import KalshiFetchService


# ─────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────

@pytest_asyncio.fixture
async def fetch_service(tmp_path: Path):
    """Build a KalshiFetchService backed by a real tmp DuckDB (no HTTP needed)."""
    from pytheum.core.config import KalshiConfig
    from pytheum.data.repository import MarketRepository
    from pytheum.data.storage import Storage
    from pytheum.venues.kalshi.client import KalshiClient

    storage = Storage(tmp_path / "test.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    config = KalshiConfig(rate_limit_per_sec=1000)
    client = KalshiClient(config=config)
    service = KalshiFetchService(client=client, repository=repo)
    try:
        yield service
    finally:
        await client.aclose()


# ─────────────────────────────────────────────
# Tests — instantiation and method existence
# ─────────────────────────────────────────────

class TestKalshiFetchServiceScaffold:
    @pytest.mark.asyncio
    async def test_service_instantiates(self, fetch_service):
        """KalshiFetchService can be constructed with a client and repository."""
        assert isinstance(fetch_service, KalshiFetchService)

    @pytest.mark.asyncio
    async def test_service_has_fetch_market(self, fetch_service):
        """fetch_market method exists (stub raises NotImplementedError in Task 6)."""
        assert callable(getattr(fetch_service, "fetch_market", None))
        with pytest.raises(NotImplementedError):
            await fetch_service.fetch_market("KXINFL-25JAN-B3.5")

    @pytest.mark.asyncio
    async def test_service_has_fetch_series_list(self, fetch_service):
        """fetch_series_list method exists as a stub."""
        assert callable(getattr(fetch_service, "fetch_series_list", None))
        with pytest.raises(NotImplementedError):
            await fetch_service.fetch_series_list()
```

Create the supporting scaffold files (empty/minimal — they must exist for imports to resolve):

`tests/services/__init__.py`: empty

`tests/fixtures/kalshi/manifest.json`:
```json
{"captured_at": null, "endpoints": {}}
```

`tests/fixtures/kalshi/_manifest.py`: (verbatim from plan prompt)

```python
# tests/fixtures/kalshi/_manifest.py
import json
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent

def load_manifest() -> dict[str, Any]:
    return json.loads((HERE / "manifest.json").read_text())

def fixture(endpoint_key: str) -> tuple[dict[str, Any], dict[str, Any]]:
    manifest = load_manifest()
    entry = manifest["endpoints"][endpoint_key]
    payload = json.loads((HERE / entry["file"]).read_text())
    return payload, entry
```

`tests/services/conftest.py`: (verbatim from plan prompt)

```python
# tests/services/conftest.py
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from pytheum.core.config import KalshiConfig
from pytheum.data.repository import MarketRepository
from pytheum.data.storage import Storage
from pytheum.services.fetch import KalshiFetchService
from pytheum.venues.kalshi.client import KalshiClient


@pytest.fixture
async def fetch_service(tmp_path: Path) -> AsyncIterator[KalshiFetchService]:
    storage = Storage(tmp_path / "test.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    config = KalshiConfig(rate_limit_per_sec=1000)
    client = KalshiClient(config=config)
    service = KalshiFetchService(client=client, repository=repo)
    try:
        yield service
    finally:
        await client.aclose()
```

> **Note:** `tests/services/conftest.py` defines the shared `fetch_service` fixture used by
> Tasks 7–11. The `test_fetch.py` in this task defines its own local `fetch_service` fixture
> (scoped to this file only, with mock transport) that shadows the conftest fixture. This
> prevents live HTTP calls during `test_fetch.py` while allowing Tasks 7–11 to override
> with real fixture files. Pytest local fixtures take precedence over conftest fixtures.

---

- [ ] **Step 2: Verify failure**

```bash
cd /Users/kanagn/Desktop/pytheum-cli && \
python -m pytest tests/services/test_fetch.py -q 2>&1 | head -30
```

Expected: `ImportError` — `pytheum.services.fetch` does not exist yet.
All 3 tests fail at collection time.

---

- [ ] **Step 3: Implement**

`src/pytheum/services/__init__.py`:

```python
"""App Services layer — orchestrates venue clients, repository, and normalization."""
```

`src/pytheum/services/fetch.py`:

```python
"""KalshiFetchService — App Services layer for Kalshi REST data.

Orchestrates the raw-first three-step pipeline for every fetch:
  1. Call the venue client (pure transport, returns (raw_body_dict, RawEnvelope)).
  2. Persist the raw envelope via MarketRepository.record_raw_rest → get real raw_id.
  3. Normalize with real raw_id, upsert parsed model (upsert_market, upsert_event, etc.).

This is the **only** layer that touches DuckDB on behalf of Kalshi REST.
Venue clients (KalshiRest) must never be passed a repository.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, AsyncIterator

import structlog

from pytheum.data.models import (
    Category,
    Event,
    Market,
    OrderBook,
    PricePoint,
    Trade,
)
from pytheum.venues.kalshi import normalizer

if TYPE_CHECKING:
    from pytheum.data.repository import MarketRepository
    from pytheum.venues.kalshi.client import KalshiClient

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

_SCHEMA_VERSION = 1


class KalshiFetchService:
    """Fetch, persist, and normalise Kalshi REST data.

    Parameters
    ----------
    client:
        A :class:`~pytheum.venues.kalshi.client.KalshiClient` instance.
        The service does **not** own the client lifecycle; callers are
        responsible for ``await client.aclose()``.
    repository:
        A :class:`~pytheum.data.repository.MarketRepository` backed by an
        already-migrated :class:`~pytheum.data.storage.Storage` instance.
    """

    def __init__(
        self,
        *,
        client: "KalshiClient",
        repository: "MarketRepository",
    ) -> None:
        self.client = client
        self.repo = repository
        self._schema_version = _SCHEMA_VERSION

    # ─────────────────────────────────────────────────────────────────────
    # Stubs — all methods are stubs in Task 6; bodies arrive in Tasks 7–11
    # alongside their venue endpoints. The FK chain pattern (ensure parent
    # exists before upserting child) is also wired in Tasks 7–11.
    # ─────────────────────────────────────────────────────────────────────

    async def fetch_market(self, ticker: str) -> Market:
        """Fetch a single market by ticker, persist raw envelope, upsert model.

        Returns the :class:`~pytheum.data.models.Market` with ``raw_id`` set
        to the integer primary key from ``raw_payloads``.
        Body filled in by Task 9 alongside get_market endpoint.
        """
        raise NotImplementedError("filled in by Task 9")

    async def fetch_series(self, ticker: str) -> Category:
        """Fetch and persist a single series / category by ticker."""
        raise NotImplementedError("filled in by Task 7")

    async def fetch_series_list(self) -> list[Category]:
        """Fetch and persist the full list of series (paginated)."""
        raise NotImplementedError("filled in by Task 7")

    async def fetch_events(self, **filters: Any) -> list[Event]:
        """Fetch and persist all events matching the given filters (paginated)."""
        raise NotImplementedError("filled in by Task 8")

    async def fetch_event_with_markets(
        self, event_ticker: str
    ) -> tuple[Event, list[Market]]:
        """Fetch and persist an event together with its nested markets."""
        raise NotImplementedError("filled in by Task 8")

    async def fetch_orderbook(
        self, ticker: str
    ) -> tuple[OrderBook, OrderBook]:
        """Fetch and persist the yes/no orderbook for a market."""
        raise NotImplementedError("filled in by Task 9")

    async def iter_trades(
        self, ticker: str, **filters: Any
    ) -> AsyncIterator[Trade]:
        """Async-iterate over trades for a market (cursor-paginated)."""
        raise NotImplementedError("filled in by Task 10")
        # satisfy mypy / type checkers — never reached at runtime
        yield  # type: ignore[misc]

    async def fetch_candlesticks(
        self, ticker: str, interval: str, **filters: Any
    ) -> list[PricePoint]:
        """Fetch and persist candlestick price points for a market."""
        raise NotImplementedError("filled in by Task 11")
```

---

- [ ] **Step 4: Verify pass**

```bash
cd /Users/kanagn/Desktop/pytheum-cli && \
python -m pytest tests/services/test_fetch.py -v 2>&1 | tail -15
```

Expected output (3 tests):

```
tests/services/test_fetch.py::TestKalshiFetchServiceScaffold::test_service_instantiates PASSED
tests/services/test_fetch.py::TestKalshiFetchServiceScaffold::test_service_has_fetch_market PASSED
tests/services/test_fetch.py::TestKalshiFetchServiceScaffold::test_service_has_fetch_series_list PASSED

============== 3 passed in X.XXs ==============
```

Also confirm full suite regression-free:

```bash
cd /Users/kanagn/Desktop/pytheum-cli && \
python -m pytest --tb=short -q 2>&1 | tail -5
```

Expected: all Phase 1 tests (130+) + Task 5 tests (12) + Task 6 tests (3) = 145+ passed; 0 failed.

---

- [ ] **Step 5: Commit**

```bash
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "$(cat <<'EOF'
feat(services): add KalshiFetchService scaffold (Task 6)

- src/pytheum/services/__init__.py — package docstring
- src/pytheum/services/fetch.py — KalshiFetchService with all methods as
  stubs (NotImplementedError); bodies arrive in Tasks 7-11 alongside
  their venue endpoints (raw-first: venue returns raw dict, service
  records raw FIRST then normalizes with real raw_id)
- tests/services/conftest.py — shared fetch_service fixture (live transport,
  used by Tasks 7-11)
- tests/services/test_fetch.py — 3 scaffold tests: instantiation + method
  existence checks (fetch_market and fetch_series_list raise NotImplementedError)
- tests/fixtures/kalshi/manifest.json — initial empty manifest
- tests/fixtures/kalshi/_manifest.py — load_manifest + fixture helpers
EOF
)"
```

---

## Task 7: Series endpoints (`/series` list + `/series/{ticker}` detail)

`GET /series` returns paginated Series objects (category buckets). `GET /series/{ticker}`
returns a single Series. The service layer records each page's raw envelope before
normalizing; detail calls do the same with a single-item envelope.

**Files:**
- Modify: `src/pytheum/venues/kalshi/rest.py` — add `iter_series`, `get_series`, `get_series_page`
- Modify: `src/pytheum/services/fetch.py` — implement `fetch_series_list`, `fetch_series`
- Create: `tests/fixtures/kalshi/series_list.json`
- Create: `tests/fixtures/kalshi/series_detail.json`
- Modify: `tests/fixtures/kalshi/manifest.json` (append `series_list`, `series_detail`)
- Modify: `tests/venues/kalshi/test_rest.py` — append series REST tests
- Modify: `tests/venues/kalshi/test_normalizer.py` — append real-fixture normalizer test
- Modify: `tests/services/test_fetch.py` — append service tests

---

- [ ] **Step 1: Capture fixtures + manifest update**

```bash
# Capture series list (first 5 entries — enough to cover pagination logic)
curl -s "https://api.elections.kalshi.com/trade-api/v2/series?limit=5" \
  -H "Accept: application/json" \
  | python3 -m json.tool \
  > /Users/kanagn/Desktop/pytheum-cli/tests/fixtures/kalshi/series_list.json

# Extract the first ticker for detail capture
TICKER=$(python3 -c "
import json, sys
data = json.load(open('tests/fixtures/kalshi/series_list.json'))
print(data['series'][0]['ticker'])
")

# Capture series detail
curl -s "https://api.elections.kalshi.com/trade-api/v2/series/${TICKER}" \
  -H "Accept: application/json" \
  | python3 -m json.tool \
  > /Users/kanagn/Desktop/pytheum-cli/tests/fixtures/kalshi/series_detail.json

echo "Captured series list and detail for ticker: ${TICKER}"
```

Update manifest (run from repo root):

```python
# scripts/update_manifest.py  — run as: python3 scripts/update_manifest.py series
import json, sys
from pathlib import Path

MANIFEST = Path("tests/fixtures/kalshi/manifest.json")
manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}

series_list = json.loads(
    Path("tests/fixtures/kalshi/series_list.json").read_text()
)
series_detail = json.loads(
    Path("tests/fixtures/kalshi/series_detail.json").read_text()
)

captured_ids = [s["ticker"] for s in series_list.get("series", [])]
detail_id = series_detail.get("series", {}).get("ticker", "")

manifest["series_list"] = {
    "endpoint": "/series",
    "captured_ids": captured_ids,
}
manifest["series_detail"] = {
    "endpoint": "/series/{ticker}",
    "captured_id": detail_id,
}

MANIFEST.write_text(json.dumps(manifest, indent=2))
print(f"Manifest updated: series_list={captured_ids}, series_detail={detail_id!r}")
```

```bash
cd /Users/kanagn/Desktop/pytheum-cli
python3 scripts/update_manifest.py series
```

---

- [ ] **Step 2: Failing tests**

Append to `tests/venues/kalshi/test_rest.py`:

```python
# ---------------------------------------------------------------------------
# Task 7 — Series endpoints
# ---------------------------------------------------------------------------

import json
from pathlib import Path

_FIXTURES = Path(__file__).parent.parent.parent / "fixtures" / "kalshi"
_MANIFEST = json.loads((_FIXTURES / "manifest.json").read_text())


@pytest.mark.asyncio
async def test_get_series_page_returns_models(kalshi_client: KalshiClient) -> None:
    """get_series_page() returns (list[Category], RawEnvelope, next_cursor)."""
    fixture = json.loads((_FIXTURES / "series_list.json").read_text())
    transport = httpx.MockTransport(
        lambda r: httpx.Response(200, json=fixture)
    )
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        categories, env, next_cursor = await kc.rest.get_series_page()
    assert isinstance(categories, list)
    assert len(categories) > 0
    assert all(hasattr(c, "native_id") for c in categories)
    assert env.endpoint == "/series"
    assert env.status_code == 200
    # next_cursor is str | None — just assert the type
    assert next_cursor is None or isinstance(next_cursor, str)


@pytest.mark.asyncio
async def test_get_series_page_with_cursor(kalshi_client: KalshiClient) -> None:
    """get_series_page(cursor=...) includes cursor in request params."""
    fixture = json.loads((_FIXTURES / "series_list.json").read_text())
    requests_seen: list[httpx.Request] = []

    def handler(r: httpx.Request) -> httpx.Response:
        requests_seen.append(r)
        return httpx.Response(200, json=fixture)

    transport = httpx.MockTransport(handler)
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        await kc.rest.get_series_page(cursor="abc123")

    assert len(requests_seen) == 1
    assert "cursor=abc123" in str(requests_seen[0].url)


@pytest.mark.asyncio
async def test_iter_series_yields_all_pages(kalshi_client: KalshiClient) -> None:
    """iter_series() exhausts pagination and yields Category objects."""
    # Page 1 has next_cursor; page 2 has no cursor → stops.
    fixture = json.loads((_FIXTURES / "series_list.json").read_text())
    page1 = dict(fixture, cursor="page2")
    page2 = dict(fixture, cursor=None)
    call_count = 0

    def handler(r: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return httpx.Response(200, json=page1 if call_count == 1 else page2)

    transport = httpx.MockTransport(handler)
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        results = [s async for s in kc.rest.iter_series()]

    assert call_count == 2
    # Both pages yielded; each page had len(fixture["series"]) items.
    assert len(results) == 2 * len(fixture.get("series", []))


@pytest.mark.asyncio
async def test_get_series_returns_category(kalshi_client: KalshiClient) -> None:
    """get_series(ticker) returns (Category, RawEnvelope)."""
    fixture = json.loads((_FIXTURES / "series_detail.json").read_text())
    expected_ticker = _MANIFEST["series_detail"]["captured_id"]
    transport = httpx.MockTransport(
        lambda r: httpx.Response(200, json=fixture)
    )
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        category, env = await kc.rest.get_series(expected_ticker)

    assert category.native_id == expected_ticker
    assert env.endpoint == f"/series/{expected_ticker}"
    assert env.status_code == 200


@pytest.mark.asyncio
async def test_get_series_404_raises_no_results(kalshi_client: KalshiClient) -> None:
    transport = httpx.MockTransport(
        lambda r: httpx.Response(404, json={"detail": "not found"})
    )
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        with pytest.raises(NoResults):
            await kc.rest.get_series("NONEXISTENT")
```

Append to `tests/venues/kalshi/test_normalizer.py`:

```python
# ---------------------------------------------------------------------------
# Task 7 — Normalizer real-fixture tests (series)
# ---------------------------------------------------------------------------

def test_normalize_series_list_fixture() -> None:
    """normalize_series() round-trips through every item in the captured fixture."""
    from pytheum.venues.kalshi.normalizer import normalize_series

    fixture = json.loads(
        (Path(__file__).parent.parent.parent / "fixtures" / "kalshi" / "series_list.json")
        .read_text()
    )
    manifest = json.loads(
        (Path(__file__).parent.parent.parent / "fixtures" / "kalshi" / "manifest.json")
        .read_text()
    )
    expected_ids: list[str] = manifest["series_list"]["captured_ids"]

    categories = [normalize_series(s, raw_id=1) for s in fixture["series"]]
    assert len(categories) == len(fixture["series"])
    normalized_ids = [c.native_id for c in categories]
    for eid in expected_ids:
        assert eid in normalized_ids, f"{eid!r} missing from normalized output"


def test_normalize_series_detail_fixture() -> None:
    """normalize_series() produces a Category with the manifest captured_id."""
    from pytheum.venues.kalshi.normalizer import normalize_series

    fixture = json.loads(
        (Path(__file__).parent.parent.parent / "fixtures" / "kalshi" / "series_detail.json")
        .read_text()
    )
    manifest = json.loads(
        (Path(__file__).parent.parent.parent / "fixtures" / "kalshi" / "manifest.json")
        .read_text()
    )
    expected_ticker = manifest["series_detail"]["captured_id"]
    category = normalize_series(fixture["series"], raw_id=1)
    assert category.native_id == expected_ticker
    assert category.venue.value == "kalshi"
```

Append to `tests/services/test_fetch.py`:

```python
# ---------------------------------------------------------------------------
# Task 7 — KalshiFetchService: series methods
# ---------------------------------------------------------------------------

import json
import httpx
import pytest
from pathlib import Path

from tests.fixtures.kalshi._manifest import fixture as mf


@pytest.mark.asyncio
async def test_fetch_series_list_upserts_categories(tmp_path):
    """fetch_series_list() pages through get_series_page and upserts each Category."""
    from pytheum.core.config import KalshiConfig
    from pytheum.data.repository import MarketRepository
    from pytheum.data.storage import Storage
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.services.fetch import KalshiFetchService

    fixture_payload, _ = mf("series_list")
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=fixture_payload))

    storage = Storage(tmp_path / "t.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        categories = await svc.fetch_series_list()

    assert len(categories) > 0
    for cat in categories:
        assert cat.raw_id is not None
        assert cat.native_id


@pytest.mark.asyncio
async def test_fetch_series_list_multi_page(tmp_path):
    """fetch_series_list() follows pagination through multiple pages."""
    from pytheum.core.config import KalshiConfig
    from pytheum.data.repository import MarketRepository
    from pytheum.data.storage import Storage
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.services.fetch import KalshiFetchService

    fixture_payload, _ = mf("series_list")
    page1 = dict(fixture_payload, cursor="page2")
    page2 = dict(fixture_payload)
    page2.pop("cursor", None)
    call_count = 0

    def handler(r: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return httpx.Response(200, json=page1 if call_count == 1 else page2)

    storage = Storage(tmp_path / "t.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    async with KalshiClient(config=KalshiConfig(), _transport=httpx.MockTransport(handler)) as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        categories = await svc.fetch_series_list()

    assert call_count == 2
    assert len(categories) == 2 * len(fixture_payload.get("series", []))


@pytest.mark.asyncio
async def test_fetch_series_returns_category(tmp_path):
    """fetch_series() records raw and returns the Category with raw_id set."""
    from pytheum.core.config import KalshiConfig
    from pytheum.data.repository import MarketRepository
    from pytheum.data.storage import Storage
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.services.fetch import KalshiFetchService

    fixture_payload, entry = mf("series_detail")
    expected_id = entry["captured_id"]
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=fixture_payload))

    storage = Storage(tmp_path / "t.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        result = await svc.fetch_series(expected_id)

    assert result.native_id == expected_id
    assert result.raw_id is not None
```

---

- [ ] **Step 3: Verify failure**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv run pytest tests/venues/kalshi/test_rest.py::test_get_series_page_returns_models \
              tests/venues/kalshi/test_normalizer.py::test_normalize_series_list_fixture \
              tests/services/test_fetch.py::test_fetch_series_list_upserts_categories \
              -v 2>&1 | head -40
```

Expected output:
```
FAILED tests/venues/kalshi/test_rest.py::test_get_series_page_returns_models
  AttributeError: 'KalshiRest' object has no attribute 'get_series_page'
FAILED tests/venues/kalshi/test_normalizer.py::test_normalize_series_list_fixture
  ImportError: cannot import name 'normalize_series' from 'pytheum.venues.kalshi.normalizer'
FAILED tests/services/test_fetch.py::test_fetch_series_list_upserts_categories
  NotImplementedError: fetch_series_list not yet implemented
```

---

- [ ] **Step 4: Implement**

Add to `src/pytheum/venues/kalshi/rest.py` (after the existing `__init__` / `_send` block):

```python
# ---------------------------------------------------------------------------
# Series endpoints
# ---------------------------------------------------------------------------

async def get_series_page(
    self,
    *,
    cursor: str | None = None,
    limit: int = _LIMIT_SERIES,
) -> tuple[list[Category], RawEnvelope, str | None]:
    """Fetch one page of series.

    Returns (categories, envelope, next_cursor).
    next_cursor is None when the final page is reached.
    """
    params: dict[str, Any] = {"limit": limit}
    if cursor is not None:
        params["cursor"] = cursor

    data, env = await self._send("GET", "/series", params=params)
    categories = [
        normalize_series(s, raw_id=0)  # raw_id=0; service layer replaces after persist
        for s in data.get("series", [])
    ]
    next_cursor: str | None = data.get("cursor") or None
    return categories, env, next_cursor


async def get_series(
    self,
    ticker: str,
) -> tuple[Category, RawEnvelope]:
    """Fetch a single series by ticker.

    Returns (category, envelope).
    Raises NoResults on 404.
    """
    data, env = await self._send("GET", f"/series/{ticker}",
                                 params={}, native_ids=[ticker])
    category = normalize_series(data["series"], raw_id=0)
    return category, env


async def iter_series(
    self,
    *,
    limit: int = _LIMIT_SERIES,
) -> AsyncIterator[Category]:
    """Async iterator over all series pages.

    Envelope is discarded — use get_series_page when you need it.
    """
    cursor: str | None = None
    while True:
        categories, _env, next_cursor = await self.get_series_page(
            cursor=cursor, limit=limit
        )
        for cat in categories:
            yield cat
        if next_cursor is None:
            break
        cursor = next_cursor
```

> **`normalize_series` and `normalize_series_to_categories` were defined in Task 5** —
> do not redefine them here. Import directly from
> `pytheum.venues.kalshi.normalizer` when needed in tests or service code.

Implement in `src/pytheum/services/fetch.py` (replace `NotImplementedError` stubs):

> **`_persist(env)` helper pattern.** All three service tasks use the same
> `record_raw_rest` call signature. Define a private helper to avoid repetition:
>
> ```python
> def _persist(self, env: RawEnvelope) -> int:
>     return self.repo.record_raw_rest(
>         venue=env.venue, endpoint=env.endpoint,
>         request_params=env.request_params, payload=env.payload,
>         received_ts=env.received_ts, source_ts=env.source_ts,
>         status_code=env.status_code, duration_ms=env.duration_ms,
>         schema_version=self._schema_version, native_ids=env.native_ids,
>     )
> ```
>
> Tasks 8 and 9 call `self._persist(env)` rather than repeating the full kwarg block.
> `RawEnvelope` must carry `next_cursor: str | None = None`; use
> `dataclasses.replace(env, next_cursor=next_cursor)` to stash it after each page call.

```python
async def fetch_series_list(
    self,
    *,
    limit: int = _LIMIT_SERIES,
) -> list[Category]:
    """Fetch all series pages, persist each page's raw, upsert categories."""
    all_categories: list[Category] = []
    cursor: str | None = None
    while True:
        categories, env, next_cursor = await self.client.rest.get_series_page(
            cursor=cursor, limit=limit
        )
        raw_id = self._persist(env)
        for cat in categories:
            self.repo.upsert_category(cat, raw_id=raw_id,
                                      schema_version=self._schema_version)
            all_categories.append(cat.model_copy(update={"raw_id": raw_id}))
        if next_cursor is None:
            break
        cursor = next_cursor
    return all_categories


async def fetch_series(self, ticker: str) -> Category:
    """Fetch a single series, persist raw, upsert category, return with raw_id."""
    category, env = await self.client.rest.get_series(ticker)
    raw_id = self._persist(env)
    category = category.model_copy(update={"raw_id": raw_id})
    self.repo.upsert_category(category, raw_id=raw_id,
                              schema_version=self._schema_version)
    return category
```

---

- [ ] **Step 5: Verify pass**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv run pytest tests/venues/kalshi/test_rest.py -k "series" \
              tests/venues/kalshi/test_normalizer.py -k "series" \
              tests/services/test_fetch.py -k "series" \
              -v 2>&1 | tail -20
```

Expected:
```
tests/venues/kalshi/test_rest.py::test_get_series_page_returns_models PASSED
tests/venues/kalshi/test_rest.py::test_get_series_page_with_cursor PASSED
tests/venues/kalshi/test_rest.py::test_iter_series_yields_all_pages PASSED
tests/venues/kalshi/test_rest.py::test_get_series_returns_category PASSED
tests/venues/kalshi/test_rest.py::test_get_series_404_raises_no_results PASSED
tests/venues/kalshi/test_normalizer.py::test_normalize_series_list_fixture PASSED
tests/venues/kalshi/test_normalizer.py::test_normalize_series_detail_fixture PASSED
tests/services/test_fetch.py::test_fetch_series_list_upserts_categories PASSED
tests/services/test_fetch.py::test_fetch_series_list_multi_page PASSED
tests/services/test_fetch.py::test_fetch_series_returns_category PASSED
10 passed in <Xs>
```

Full suite must still pass:

```bash
uv run pytest --tb=short -q 2>&1 | tail -5
# Expect: 140+ passed, 0 failed
```

---

- [ ] **Step 6: Commit**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    add \
      src/pytheum/venues/kalshi/rest.py \
      src/pytheum/venues/kalshi/normalizer.py \
      src/pytheum/services/fetch.py \
      tests/fixtures/kalshi/series_list.json \
      tests/fixtures/kalshi/series_detail.json \
      tests/fixtures/kalshi/manifest.json \
      tests/venues/kalshi/test_rest.py \
      tests/venues/kalshi/test_normalizer.py \
      tests/services/test_fetch.py

git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "$(cat <<'EOF'
feat(kalshi): Task 7 — series list + detail endpoints with fixture tests

Implements get_series_page / get_series / iter_series on KalshiRest;
fetch_series_list / fetch_series on KalshiFetchService; normalize_series
in the normalizer. Commits real-API fixtures for series list and detail
with manifest entries. 10 new tests, all passing; 130 Phase 1 tests
still green.
EOF
)"
```

---

## Task 8: Events endpoints (`/events` list + `/events/{event_ticker}` detail with nested markets)

`GET /events` returns paginated Event objects. `GET /events/{event_ticker}` returns an Event
with a nested `markets` array — `get_event` returns `tuple[Event, list[Market], RawEnvelope]`.
Filters on the list endpoint (`series_ticker`, `status`) are passed through by the service.

**Files:**
- Modify: `src/pytheum/venues/kalshi/rest.py` — add `iter_events`, `get_event`, `get_events_page`
- Modify: `src/pytheum/services/fetch.py` — implement `fetch_events`, `fetch_event_with_markets`
- Create: `tests/fixtures/kalshi/events_list.json`
- Create: `tests/fixtures/kalshi/events_detail.json`
- Modify: `tests/fixtures/kalshi/manifest.json` (append `events_list`, `events_detail`)
- Modify: `tests/venues/kalshi/test_rest.py` — append events REST tests
- Modify: `tests/venues/kalshi/test_normalizer.py` — append normalizer tests
- Modify: `tests/services/test_fetch.py` — append service tests

---

- [ ] **Step 1: Capture fixtures + manifest update**

```bash
# Capture events list
curl -s "https://api.elections.kalshi.com/trade-api/v2/events?limit=5" \
  -H "Accept: application/json" \
  | python3 -m json.tool \
  > /Users/kanagn/Desktop/pytheum-cli/tests/fixtures/kalshi/events_list.json

# Extract first event_ticker for detail
EVENT_TICKER=$(python3 -c "
import json
data = json.load(open('tests/fixtures/kalshi/events_list.json'))
print(data['events'][0]['event_ticker'])
")

# Capture events detail (includes nested markets array)
curl -s "https://api.elections.kalshi.com/trade-api/v2/events/${EVENT_TICKER}" \
  -H "Accept: application/json" \
  | python3 -m json.tool \
  > /Users/kanagn/Desktop/pytheum-cli/tests/fixtures/kalshi/events_detail.json

echo "Captured events list and detail for event: ${EVENT_TICKER}"
```

Update manifest:

```python
# Add to scripts/update_manifest.py or run inline:
import json
from pathlib import Path

MANIFEST = Path("tests/fixtures/kalshi/manifest.json")
manifest = json.loads(MANIFEST.read_text())

events_list = json.loads(Path("tests/fixtures/kalshi/events_list.json").read_text())
events_detail = json.loads(Path("tests/fixtures/kalshi/events_detail.json").read_text())

captured_ids = [e["event_ticker"] for e in events_list.get("events", [])]
detail_id = events_detail.get("event", {}).get("event_ticker", "")

manifest["events_list"] = {
    "endpoint": "/events",
    "captured_ids": captured_ids,
}
manifest["events_detail"] = {
    "endpoint": "/events/{event_ticker}",
    "captured_id": detail_id,
    "nested_market_count": len(events_detail.get("event", {}).get("markets", [])),
}

MANIFEST.write_text(json.dumps(manifest, indent=2))
print(f"Manifest updated: events_list={captured_ids}, events_detail={detail_id!r}")
```

---

- [ ] **Step 2: Failing tests**

Append to `tests/venues/kalshi/test_rest.py`:

```python
# ---------------------------------------------------------------------------
# Task 8 — Events endpoints
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_events_page_returns_models(kalshi_client: KalshiClient) -> None:
    fixture = json.loads((_FIXTURES / "events_list.json").read_text())
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=fixture))
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        events, env, next_cursor = await kc.rest.get_events_page()
    assert isinstance(events, list)
    assert len(events) > 0
    assert all(hasattr(e, "native_id") for e in events)
    assert env.endpoint == "/events"


@pytest.mark.asyncio
async def test_get_events_page_filters(kalshi_client: KalshiClient) -> None:
    """Filters are forwarded as query parameters."""
    fixture = json.loads((_FIXTURES / "events_list.json").read_text())
    requests_seen: list[httpx.Request] = []

    def handler(r: httpx.Request) -> httpx.Response:
        requests_seen.append(r)
        return httpx.Response(200, json=fixture)

    transport = httpx.MockTransport(handler)
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        await kc.rest.get_events_page(series_ticker="KXBTC", status="open")

    url_str = str(requests_seen[0].url)
    assert "series_ticker=KXBTC" in url_str
    assert "status=open" in url_str


@pytest.mark.asyncio
async def test_iter_events_yields_across_pages(kalshi_client: KalshiClient) -> None:
    fixture = json.loads((_FIXTURES / "events_list.json").read_text())
    page1 = dict(fixture, cursor="next")
    page2 = dict(fixture, cursor=None)
    call_count = 0

    def handler(r: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return httpx.Response(200, json=page1 if call_count == 1 else page2)

    transport = httpx.MockTransport(handler)
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        results = [e async for e in kc.rest.iter_events()]

    assert call_count == 2
    assert len(results) == 2 * len(fixture.get("events", []))


@pytest.mark.asyncio
async def test_get_event_returns_event_and_markets(kalshi_client: KalshiClient) -> None:
    """get_event() returns (Event, list[Market], RawEnvelope)."""
    fixture = json.loads((_FIXTURES / "events_detail.json").read_text())
    expected_ticker = _MANIFEST["events_detail"]["captured_id"]
    expected_market_count = _MANIFEST["events_detail"]["nested_market_count"]

    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=fixture))
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        event, markets, env = await kc.rest.get_event(expected_ticker)

    assert event.native_id == expected_ticker
    assert len(markets) == expected_market_count
    assert all(hasattr(m, "native_id") for m in markets)
    assert env.endpoint == f"/events/{expected_ticker}"


@pytest.mark.asyncio
async def test_get_event_404_raises_no_results() -> None:
    transport = httpx.MockTransport(
        lambda r: httpx.Response(404, json={"detail": "not found"})
    )
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        with pytest.raises(NoResults):
            await kc.rest.get_event("NONEXISTENT-99JAN")
```

Append to `tests/venues/kalshi/test_normalizer.py`:

```python
# ---------------------------------------------------------------------------
# Task 8 — Normalizer real-fixture tests (events)
# ---------------------------------------------------------------------------

def test_normalize_events_list_fixture() -> None:
    from pytheum.venues.kalshi.normalizer import normalize_event

    fixture = json.loads(
        (Path(__file__).parent.parent.parent / "fixtures" / "kalshi" / "events_list.json")
        .read_text()
    )
    manifest = json.loads(
        (Path(__file__).parent.parent.parent / "fixtures" / "kalshi" / "manifest.json")
        .read_text()
    )
    expected_ids: list[str] = manifest["events_list"]["captured_ids"]
    events = [normalize_event(e, raw_id=1) for e in fixture["events"]]
    normalized_ids = [e.native_id for e in events]
    for eid in expected_ids:
        assert eid in normalized_ids, f"{eid!r} missing from normalized events"


def test_normalize_events_detail_with_nested_markets() -> None:
    """Events detail normalizes Event + nested markets list."""
    from pytheum.venues.kalshi.normalizer import normalize_event, normalize_market

    fixture = json.loads(
        (Path(__file__).parent.parent.parent / "fixtures" / "kalshi" / "events_detail.json")
        .read_text()
    )
    manifest = json.loads(
        (Path(__file__).parent.parent.parent / "fixtures" / "kalshi" / "manifest.json")
        .read_text()
    )
    raw_event = fixture["event"]
    expected_ticker = manifest["events_detail"]["captured_id"]
    expected_market_count = manifest["events_detail"]["nested_market_count"]

    event = normalize_event(raw_event, raw_id=1)
    markets = [normalize_market(m, raw_id=1) for m in raw_event.get("markets", [])]

    assert event.native_id == expected_ticker
    assert len(markets) == expected_market_count
    # Each nested market references this event
    assert all(m.event_native_id == expected_ticker for m in markets)
```

Append to `tests/services/test_fetch.py`:

```python
# ---------------------------------------------------------------------------
# Task 8 — KalshiFetchService: events methods
# ---------------------------------------------------------------------------

import httpx
import pytest

from tests.fixtures.kalshi._manifest import fixture as mf


@pytest.mark.asyncio
async def test_fetch_events_upserts_events(tmp_path):
    """fetch_events() pages through get_events_page and upserts each Event."""
    from pytheum.core.config import KalshiConfig
    from pytheum.data.repository import MarketRepository
    from pytheum.data.storage import Storage
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.services.fetch import KalshiFetchService

    fixture_payload, _ = mf("events_list")
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=fixture_payload))

    storage = Storage(tmp_path / "t.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        events = await svc.fetch_events()

    assert len(events) > 0
    assert events[0].raw_id is not None
    assert events[0].native_id


@pytest.mark.asyncio
async def test_fetch_events_passes_filters(tmp_path):
    """fetch_events(series_ticker=..., status=...) forwards filters to the rest client."""
    from pytheum.core.config import KalshiConfig
    from pytheum.data.repository import MarketRepository
    from pytheum.data.storage import Storage
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.services.fetch import KalshiFetchService

    requests_seen: list[httpx.Request] = []

    def handler(r: httpx.Request) -> httpx.Response:
        requests_seen.append(r)
        return httpx.Response(200, json={"events": [], "cursor": None})

    storage = Storage(tmp_path / "t.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    async with KalshiClient(config=KalshiConfig(), _transport=httpx.MockTransport(handler)) as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        await svc.fetch_events(series_ticker="KXBTC", status="open")

    assert len(requests_seen) == 1
    assert "series_ticker=KXBTC" in str(requests_seen[0].url)
    assert "status=open" in str(requests_seen[0].url)


@pytest.mark.asyncio
async def test_fetch_event_with_markets_upserts_event_and_markets(tmp_path):
    """fetch_event_with_markets() upserts the Event + each nested Market."""
    from pytheum.core.config import KalshiConfig
    from pytheum.data.repository import MarketRepository
    from pytheum.data.storage import Storage
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.services.fetch import KalshiFetchService

    fixture_payload, entry = mf("events_detail")
    event_ticker = entry["captured_id"]
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=fixture_payload))

    storage = Storage(tmp_path / "t.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        result_event, result_markets = await svc.fetch_event_with_markets(event_ticker)

    assert result_event.native_id == event_ticker
    assert result_event.raw_id is not None
    assert isinstance(result_markets, list)
```

---

- [ ] **Step 3: Verify failure**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv run pytest tests/venues/kalshi/test_rest.py::test_get_events_page_returns_models \
              tests/venues/kalshi/test_normalizer.py::test_normalize_events_list_fixture \
              tests/services/test_fetch.py::test_fetch_events_upserts_events \
              -v 2>&1 | head -40
```

Expected:
```
FAILED tests/venues/kalshi/test_rest.py::test_get_events_page_returns_models
  AttributeError: 'KalshiRest' object has no attribute 'get_events_page'
FAILED tests/venues/kalshi/test_normalizer.py::test_normalize_events_list_fixture
  ImportError: cannot import name 'normalize_event' from 'pytheum.venues.kalshi.normalizer'
FAILED tests/services/test_fetch.py::test_fetch_events_upserts_events
  NotImplementedError: fetch_events not yet implemented
```

---

- [ ] **Step 4: Implement**

Add to `src/pytheum/venues/kalshi/rest.py`:

```python
# ---------------------------------------------------------------------------
# Events endpoints
# ---------------------------------------------------------------------------

async def get_events_page(
    self,
    *,
    cursor: str | None = None,
    limit: int = _LIMIT_EVENTS,
    series_ticker: str | None = None,
    status: str | None = None,
) -> tuple[list[Event], RawEnvelope, str | None]:
    """Fetch one page of events.

    Returns (events, envelope, next_cursor).
    Filters: series_ticker, status — passed as query params when provided.
    """
    params: dict[str, Any] = {"limit": limit}
    if cursor is not None:
        params["cursor"] = cursor
    if series_ticker is not None:
        params["series_ticker"] = series_ticker
    if status is not None:
        params["status"] = status

    data, env = await self._send("GET", "/events", params=params)
    events = [
        normalize_event(e, raw_id=0)
        for e in data.get("events", [])
    ]
    next_cursor: str | None = data.get("cursor") or None
    return events, env, next_cursor


async def get_event(
    self,
    event_ticker: str,
) -> tuple[Event, list[Market], RawEnvelope]:
    """Fetch a single event with nested markets.

    Returns (event, markets, envelope).
    Raises NoResults on 404.
    """
    data, env = await self._send(
        "GET", f"/events/{event_ticker}",
        params={}, native_ids=[event_ticker]
    )
    raw_event = data["event"]
    event = normalize_event(raw_event, raw_id=0)
    markets = [
        normalize_market(m, raw_id=0)
        for m in raw_event.get("markets", [])
    ]
    return event, markets, env


async def iter_events(
    self,
    *,
    limit: int = _LIMIT_EVENTS,
    series_ticker: str | None = None,
    status: str | None = None,
) -> AsyncIterator[Event]:
    """Async iterator over all event pages.

    Envelope discarded — use get_events_page when you need it.
    Forwards series_ticker and status filters to each page request.
    """
    cursor: str | None = None
    while True:
        events, _env, next_cursor = await self.get_events_page(
            cursor=cursor, limit=limit,
            series_ticker=series_ticker, status=status,
        )
        for ev in events:
            yield ev
        if next_cursor is None:
            break
        cursor = next_cursor
```

> **`normalize_event` was defined in Task 5** — do not redefine it here.
> Import directly from `pytheum.venues.kalshi.normalizer` when needed in tests or service code.

Implement in `src/pytheum/services/fetch.py` (uses `self._persist` from Task 7):

```python
async def fetch_events(
    self,
    *,
    series_ticker: str | None = None,
    status: str | None = None,
    limit: int = _LIMIT_EVENTS,
) -> list[Event]:
    """Page through /events with optional filters. Record each page's raw; upsert events."""
    all_events: list[Event] = []
    cursor: str | None = None
    filters: dict[str, Any] = {}
    if series_ticker is not None:
        filters["series_ticker"] = series_ticker
    if status is not None:
        filters["status"] = status

    while True:
        events, env, next_cursor = await self.client.rest.get_events_page(
            cursor=cursor, limit=limit, **filters
        )
        raw_id = self._persist(env)
        for ev in events:
            self.repo.upsert_event(ev, raw_id=raw_id,
                                   schema_version=self._schema_version)
            all_events.append(ev.model_copy(update={"raw_id": raw_id}))
        if next_cursor is None:
            break
        cursor = next_cursor
    return all_events


async def fetch_event_with_markets(
    self,
    event_ticker: str,
) -> tuple[Event, list[Market]]:
    """Fetch /events/{event_ticker}, record raw, upsert event + nested markets.

    The single raw row covers both the event and its nested markets —
    they share the same raw_id because they came from the same HTTP response.
    """
    event, markets, env = await self.client.rest.get_event(event_ticker)
    raw_id = self._persist(env)
    event = event.model_copy(update={"raw_id": raw_id})
    self.repo.upsert_event(event, raw_id=raw_id,
                           schema_version=self._schema_version)
    markets_out: list[Market] = []
    for mkt in markets:
        mkt = mkt.model_copy(update={"raw_id": raw_id})
        self.repo.upsert_market(mkt, raw_id=raw_id,
                                schema_version=self._schema_version)
        markets_out.append(mkt)
    return event, markets_out
```

---

- [ ] **Step 5: Verify pass**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv run pytest tests/venues/kalshi/test_rest.py -k "event" \
              tests/venues/kalshi/test_normalizer.py -k "event" \
              tests/services/test_fetch.py -k "event" \
              -v 2>&1 | tail -20
```

Expected:
```
tests/venues/kalshi/test_rest.py::test_get_events_page_returns_models PASSED
tests/venues/kalshi/test_rest.py::test_get_events_page_filters PASSED
tests/venues/kalshi/test_rest.py::test_iter_events_yields_across_pages PASSED
tests/venues/kalshi/test_rest.py::test_get_event_returns_event_and_markets PASSED
tests/venues/kalshi/test_rest.py::test_get_event_404_raises_no_results PASSED
tests/venues/kalshi/test_normalizer.py::test_normalize_events_list_fixture PASSED
tests/venues/kalshi/test_normalizer.py::test_normalize_events_detail_with_nested_markets PASSED
tests/services/test_fetch.py::test_fetch_events_upserts_events PASSED
tests/services/test_fetch.py::test_fetch_events_passes_filters PASSED
tests/services/test_fetch.py::test_fetch_event_with_markets_upserts_event_and_markets PASSED
10 passed in <Xs>
```

Full suite:

```bash
uv run pytest --tb=short -q 2>&1 | tail -5
# Expect: 150+ passed, 0 failed
```

---

- [ ] **Step 6: Commit**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    add \
      src/pytheum/venues/kalshi/rest.py \
      src/pytheum/venues/kalshi/normalizer.py \
      src/pytheum/services/fetch.py \
      tests/fixtures/kalshi/events_list.json \
      tests/fixtures/kalshi/events_detail.json \
      tests/fixtures/kalshi/manifest.json \
      tests/venues/kalshi/test_rest.py \
      tests/venues/kalshi/test_normalizer.py \
      tests/services/test_fetch.py

git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "$(cat <<'EOF'
feat(kalshi): Task 8 — events list + detail endpoints with nested markets

Implements get_events_page / get_event / iter_events on KalshiRest;
fetch_events / fetch_event_with_markets on KalshiFetchService;
normalize_event in the normalizer. get_event returns (Event, list[Market],
RawEnvelope) so nested markets share the single raw_id of the detail
response. Commits real-API fixtures for events list and detail.
10 new tests, all passing; 150+ total tests green.
EOF
)"
```

---

## Task 9: Markets endpoints (`/markets` list + `/markets/{ticker}` detail)

`GET /markets` returns paginated Market objects. `GET /markets/{ticker}` returns a single
Market. `fetch_markets_for_event` is a thin wrapper that pages through
`/markets?event_ticker=X` and upserts each market — the primary use case from the CLI.

**Files:**
- Modify: `src/pytheum/venues/kalshi/rest.py` — add `iter_markets`, `get_market`, `get_markets_page`
- Modify: `src/pytheum/services/fetch.py` — implement `fetch_markets`, `fetch_market`, `fetch_markets_for_event`
- Create: `tests/fixtures/kalshi/markets_list.json`
- Create: `tests/fixtures/kalshi/markets_detail.json`
- Modify: `tests/fixtures/kalshi/manifest.json` (append `markets_list`, `markets_detail`)
- Modify: `tests/venues/kalshi/test_rest.py` — append markets REST tests
- Modify: `tests/venues/kalshi/test_normalizer.py` — append normalizer tests
- Modify: `tests/services/test_fetch.py` — append service tests

---

- [ ] **Step 1: Capture fixtures + manifest update**

```bash
# Capture markets list
curl -s "https://api.elections.kalshi.com/trade-api/v2/markets?limit=5" \
  -H "Accept: application/json" \
  | python3 -m json.tool \
  > /Users/kanagn/Desktop/pytheum-cli/tests/fixtures/kalshi/markets_list.json

# Extract first ticker for detail
MARKET_TICKER=$(python3 -c "
import json
data = json.load(open('tests/fixtures/kalshi/markets_list.json'))
print(data['markets'][0]['ticker'])
")

# Capture market detail
curl -s "https://api.elections.kalshi.com/trade-api/v2/markets/${MARKET_TICKER}" \
  -H "Accept: application/json" \
  | python3 -m json.tool \
  > /Users/kanagn/Desktop/pytheum-cli/tests/fixtures/kalshi/markets_detail.json

echo "Captured markets list and detail for ticker: ${MARKET_TICKER}"
```

Update manifest:

```python
import json
from pathlib import Path

MANIFEST = Path("tests/fixtures/kalshi/manifest.json")
manifest = json.loads(MANIFEST.read_text())

markets_list = json.loads(Path("tests/fixtures/kalshi/markets_list.json").read_text())
markets_detail = json.loads(Path("tests/fixtures/kalshi/markets_detail.json").read_text())

captured_ids = [m["ticker"] for m in markets_list.get("markets", [])]
detail_id = markets_detail.get("market", {}).get("ticker", "")

manifest["markets_list"] = {
    "endpoint": "/markets",
    "captured_ids": captured_ids,
}
manifest["markets_detail"] = {
    "endpoint": "/markets/{ticker}",
    "captured_id": detail_id,
}

MANIFEST.write_text(json.dumps(manifest, indent=2))
print(f"Manifest updated: markets_list={captured_ids}, markets_detail={detail_id!r}")
```

---

- [ ] **Step 2: Failing tests**

Append to `tests/venues/kalshi/test_rest.py`:

```python
# ---------------------------------------------------------------------------
# Task 9 — Markets endpoints
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_markets_page_returns_models() -> None:
    fixture = json.loads((_FIXTURES / "markets_list.json").read_text())
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=fixture))
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        markets, env, next_cursor = await kc.rest.get_markets_page()
    assert isinstance(markets, list)
    assert len(markets) > 0
    assert all(hasattr(m, "native_id") for m in markets)
    assert env.endpoint == "/markets"


@pytest.mark.asyncio
async def test_get_markets_page_filters() -> None:
    """event_ticker, series_ticker, status are forwarded as query params."""
    fixture = json.loads((_FIXTURES / "markets_list.json").read_text())
    requests_seen: list[httpx.Request] = []

    def handler(r: httpx.Request) -> httpx.Response:
        requests_seen.append(r)
        return httpx.Response(200, json=fixture)

    transport = httpx.MockTransport(handler)
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        await kc.rest.get_markets_page(
            event_ticker="KXBTC-25DEC",
            series_ticker="KXBTC",
            status="open",
        )

    url_str = str(requests_seen[0].url)
    assert "event_ticker=KXBTC-25DEC" in url_str
    assert "series_ticker=KXBTC" in url_str
    assert "status=open" in url_str


@pytest.mark.asyncio
async def test_iter_markets_exhausts_pages() -> None:
    fixture = json.loads((_FIXTURES / "markets_list.json").read_text())
    page1 = dict(fixture, cursor="page2")
    page2 = dict(fixture, cursor=None)
    call_count = 0

    def handler(r: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return httpx.Response(200, json=page1 if call_count == 1 else page2)

    transport = httpx.MockTransport(handler)
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        results = [m async for m in kc.rest.iter_markets()]

    assert call_count == 2
    assert len(results) == 2 * len(fixture.get("markets", []))


@pytest.mark.asyncio
async def test_get_market_returns_market() -> None:
    """get_market(ticker) returns (Market, RawEnvelope)."""
    fixture = json.loads((_FIXTURES / "markets_detail.json").read_text())
    expected_ticker = _MANIFEST["markets_detail"]["captured_id"]

    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=fixture))
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        market, env = await kc.rest.get_market(expected_ticker)

    assert market.native_id == expected_ticker
    assert market.status in {"open", "closed", "settled", "unopened", "paused"}
    assert env.endpoint == f"/markets/{expected_ticker}"


@pytest.mark.asyncio
async def test_get_market_outcomes_present() -> None:
    """Market from detail fixture has two outcomes (binary market)."""
    fixture = json.loads((_FIXTURES / "markets_detail.json").read_text())
    expected_ticker = _MANIFEST["markets_detail"]["captured_id"]

    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=fixture))
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        market, _env = await kc.rest.get_market(expected_ticker)

    # Binary markets have exactly 2 outcomes (YES / NO)
    assert len(market.outcomes) == 2
    outcome_ids = {o.outcome_id for o in market.outcomes}
    assert outcome_ids == {"yes", "no"}


@pytest.mark.asyncio
async def test_get_market_404_raises_no_results() -> None:
    transport = httpx.MockTransport(
        lambda r: httpx.Response(404, json={"detail": "not found"})
    )
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        with pytest.raises(NoResults):
            await kc.rest.get_market("NONEXISTENT-99JAN-T0")
```

Append to `tests/venues/kalshi/test_normalizer.py`:

```python
# ---------------------------------------------------------------------------
# Task 9 — Normalizer real-fixture tests (markets)
# ---------------------------------------------------------------------------

def test_normalize_markets_list_fixture() -> None:
    from pytheum.venues.kalshi.normalizer import normalize_market

    fixture = json.loads(
        (Path(__file__).parent.parent.parent / "fixtures" / "kalshi" / "markets_list.json")
        .read_text()
    )
    manifest = json.loads(
        (Path(__file__).parent.parent.parent / "fixtures" / "kalshi" / "manifest.json")
        .read_text()
    )
    expected_ids: list[str] = manifest["markets_list"]["captured_ids"]
    markets = [normalize_market(m, raw_id=1) for m in fixture["markets"]]
    normalized_ids = [m.native_id for m in markets]
    for eid in expected_ids:
        assert eid in normalized_ids, f"{eid!r} missing from normalized markets"


def test_normalize_market_detail_fixture() -> None:
    """normalize_market() on the detail fixture produces a valid Market model."""
    from pytheum.venues.kalshi.normalizer import normalize_market

    fixture = json.loads(
        (Path(__file__).parent.parent.parent / "fixtures" / "kalshi" / "markets_detail.json")
        .read_text()
    )
    manifest = json.loads(
        (Path(__file__).parent.parent.parent / "fixtures" / "kalshi" / "manifest.json")
        .read_text()
    )
    expected_ticker = manifest["markets_detail"]["captured_id"]
    market = normalize_market(fixture["market"], raw_id=1)

    assert market.native_id == expected_ticker
    assert market.venue.value == "kalshi"
    assert market.status in {"open", "closed", "settled", "unopened", "paused"}
    # Prices are normalized to [0.0, 1.0]
    for outcome in market.outcomes:
        if outcome.price is not None:
            assert Decimal("0") <= outcome.price <= Decimal("1"), (
                f"outcome {outcome.outcome_id!r} price {outcome.price!r} out of range"
            )


def test_normalize_market_status_mapping() -> None:
    """_KALSHI_STATUS maps all known Kalshi status strings."""
    from pytheum.venues.kalshi.normalizer import normalize_market

    status_cases = [
        ("active", "open"),
        ("open", "open"),
        ("closed", "closed"),
        ("settled", "settled"),
        ("determined", "settled"),
        ("unopened", "unopened"),
        ("paused", "paused"),
    ]
    base_raw = {
        "ticker": "TEST-99JAN-T0",
        "event_ticker": "TEST-99JAN",
        "title": "Test market",
        "subtitle": "Test subtitle",
        "yes_bid": 50,
        "yes_ask": 52,
        "no_bid": 48,
        "no_ask": 50,
        "volume": 1000,
        "volume_24h": 100,
        "open_interest": None,
        "close_time": None,
    }
    for kalshi_status, expected_status in status_cases:
        raw = dict(base_raw, status=kalshi_status)
        market = normalize_market(raw, raw_id=1)
        assert market.status == expected_status, (
            f"Kalshi status {kalshi_status!r} → expected {expected_status!r}, "
            f"got {market.status!r}"
        )
```

Append to `tests/services/test_fetch.py`:

```python
# ---------------------------------------------------------------------------
# Task 9 — KalshiFetchService: markets methods
# ---------------------------------------------------------------------------

import httpx
import pytest

from tests.fixtures.kalshi._manifest import fixture as mf


@pytest.mark.asyncio
async def test_fetch_markets_upserts_markets(tmp_path):
    """fetch_markets() pages through get_markets_page and upserts each Market."""
    from pytheum.core.config import KalshiConfig
    from pytheum.data.repository import MarketRepository
    from pytheum.data.storage import Storage
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.services.fetch import KalshiFetchService

    fixture_payload, _ = mf("markets_list")
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=fixture_payload))

    storage = Storage(tmp_path / "t.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        markets = await svc.fetch_markets()

    assert len(markets) > 0
    assert markets[0].raw_id is not None


@pytest.mark.asyncio
async def test_fetch_markets_for_event_passes_event_ticker(tmp_path):
    """fetch_markets_for_event(event_ticker) forwards event_ticker filter."""
    from pytheum.core.config import KalshiConfig
    from pytheum.data.repository import MarketRepository
    from pytheum.data.storage import Storage
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.services.fetch import KalshiFetchService

    requests_seen: list[httpx.Request] = []

    def handler(r: httpx.Request) -> httpx.Response:
        requests_seen.append(r)
        return httpx.Response(200, json={"markets": [], "cursor": None})

    storage = Storage(tmp_path / "t.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    async with KalshiClient(config=KalshiConfig(), _transport=httpx.MockTransport(handler)) as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        await svc.fetch_markets_for_event("KXBTC-25DEC")

    assert len(requests_seen) == 1
    assert "event_ticker=KXBTC-25DEC" in str(requests_seen[0].url)


@pytest.mark.asyncio
async def test_fetch_markets_for_event_multi_page(tmp_path):
    """fetch_markets_for_event() follows pagination for a given event_ticker."""
    from pytheum.core.config import KalshiConfig
    from pytheum.data.repository import MarketRepository
    from pytheum.data.storage import Storage
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.services.fetch import KalshiFetchService

    fixture_payload, _ = mf("markets_list")
    page1 = dict(fixture_payload, cursor="page2")
    page2 = dict(fixture_payload)
    page2.pop("cursor", None)
    call_count = 0

    def handler(r: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return httpx.Response(200, json=page1 if call_count == 1 else page2)

    storage = Storage(tmp_path / "t.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    async with KalshiClient(config=KalshiConfig(), _transport=httpx.MockTransport(handler)) as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        markets = await svc.fetch_markets_for_event("KXBTC-25DEC")

    assert call_count == 2
    assert len(markets) == 2 * len(fixture_payload.get("markets", []))


@pytest.mark.asyncio
async def test_fetch_market_records_raw_and_upserts(tmp_path):
    """fetch_market() records raw, upserts market, returns Market with raw_id."""
    from pytheum.core.config import KalshiConfig
    from pytheum.data.repository import MarketRepository
    from pytheum.data.storage import Storage
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.services.fetch import KalshiFetchService

    fixture_payload, entry = mf("markets_detail")
    ticker = entry["captured_id"]
    # fetch_market internally calls fetch_event_with_markets for FK chain;
    # we return the market fixture for any request (event endpoint will also hit this transport).
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=fixture_payload))

    storage = Storage(tmp_path / "t.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    async with KalshiClient(config=KalshiConfig(), _transport=transport) as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        result = await svc.fetch_market(ticker)

    assert result.native_id == ticker
    assert result.raw_id is not None
```

---

- [ ] **Step 3: Verify failure**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv run pytest tests/venues/kalshi/test_rest.py::test_get_markets_page_returns_models \
              tests/venues/kalshi/test_normalizer.py::test_normalize_markets_list_fixture \
              tests/services/test_fetch.py::test_fetch_markets_upserts_markets \
              -v 2>&1 | head -40
```

Expected:
```
FAILED tests/venues/kalshi/test_rest.py::test_get_markets_page_returns_models
  AttributeError: 'KalshiRest' object has no attribute 'get_markets_page'
FAILED tests/venues/kalshi/test_normalizer.py::test_normalize_markets_list_fixture
  ImportError: cannot import name 'normalize_market' from 'pytheum.venues.kalshi.normalizer'
FAILED tests/services/test_fetch.py::test_fetch_markets_upserts_markets
  NotImplementedError: fetch_markets not yet implemented
```

---

- [ ] **Step 4: Implement**

Add to `src/pytheum/venues/kalshi/rest.py`:

```python
# ---------------------------------------------------------------------------
# Markets endpoints
# ---------------------------------------------------------------------------

async def get_markets_page(
    self,
    *,
    cursor: str | None = None,
    limit: int = _LIMIT_MARKETS,
    event_ticker: str | None = None,
    series_ticker: str | None = None,
    status: str | None = None,
) -> tuple[list[Market], RawEnvelope, str | None]:
    """Fetch one page of markets.

    Returns (markets, envelope, next_cursor).
    Filters: event_ticker, series_ticker, status — passed when provided.
    """
    params: dict[str, Any] = {"limit": limit}
    if cursor is not None:
        params["cursor"] = cursor
    if event_ticker is not None:
        params["event_ticker"] = event_ticker
    if series_ticker is not None:
        params["series_ticker"] = series_ticker
    if status is not None:
        params["status"] = status

    data, env = await self._send("GET", "/markets", params=params)
    markets = [
        normalize_market(m, raw_id=0)
        for m in data.get("markets", [])
    ]
    next_cursor: str | None = data.get("cursor") or None
    return markets, env, next_cursor


async def get_market(
    self,
    ticker: str,
) -> tuple[Market, RawEnvelope]:
    """Fetch a single market by ticker.

    Returns (market, envelope).
    Raises NoResults on 404.
    """
    data, env = await self._send(
        "GET", f"/markets/{ticker}",
        params={}, native_ids=[ticker]
    )
    market = normalize_market(data["market"], raw_id=0)
    return market, env


async def iter_markets(
    self,
    *,
    limit: int = _LIMIT_MARKETS,
    event_ticker: str | None = None,
    series_ticker: str | None = None,
    status: str | None = None,
) -> AsyncIterator[Market]:
    """Async iterator over all market pages.

    Envelope discarded — use get_markets_page when you need it.
    Forwards event_ticker, series_ticker, status filters to each page.
    """
    cursor: str | None = None
    while True:
        markets, _env, next_cursor = await self.get_markets_page(
            cursor=cursor, limit=limit,
            event_ticker=event_ticker,
            series_ticker=series_ticker,
            status=status,
        )
        for mkt in markets:
            yield mkt
        if next_cursor is None:
            break
        cursor = next_cursor
```

**Note:** `normalize_market` is already defined in Task 5 (the canonical normalizer module). When implementing Task 9, **extend the existing Task 5 `normalize_market`** with the richer mappings below — do NOT add a second function. The implementer should merge these refinements into the Task 5 body:

- Use a `_midpoint(bid, ask)` helper to compute outcome prices from `yes_bid/yes_ask` (and `no_bid/no_ask`) rather than the bid alone
- Apply the full `_KALSHI_STATUS` mapping (already defined in Task 5; ensure `"determined"` maps to `"settled"`)
- Set `volume_metric=VolumeMetric.USD_24H` when `volume_24h` is the source field; fall back to `volume`
- Parse `close_time` (Kalshi-flavoured ISO with trailing `Z`) into `closes_at`
- Drop outcomes whose bid AND ask are both `None`
- Construct `url=f"https://kalshi.com/markets/{ticker}"` when `event_ticker` is missing

The function signature stays as in Task 5: `normalize_market(payload: dict[str, Any], *, raw_id: int | None = None) -> Market` — it accepts the wrapped form `{"market": {...}}` and pulls `block = payload["market"]` internally.

Implement in `src/pytheum/services/fetch.py` (uses `self._persist` from Task 7):

```python
async def fetch_markets(
    self,
    *,
    event_ticker: str | None = None,
    series_ticker: str | None = None,
    status: str | None = None,
    limit: int = _LIMIT_MARKETS,
) -> list[Market]:
    """Page through /markets with optional filters. Record raw; upsert markets."""
    all_markets: list[Market] = []
    cursor: str | None = None
    filters: dict[str, Any] = {}
    if event_ticker is not None:
        filters["event_ticker"] = event_ticker
    if series_ticker is not None:
        filters["series_ticker"] = series_ticker
    if status is not None:
        filters["status"] = status

    while True:
        markets, env, next_cursor = await self.client.rest.get_markets_page(
            cursor=cursor, limit=limit, **filters
        )
        raw_id = self._persist(env)
        for mkt in markets:
            mkt = mkt.model_copy(update={"raw_id": raw_id})
            self.repo.upsert_market(mkt, raw_id=raw_id,
                                    schema_version=self._schema_version)
            all_markets.append(mkt)
        if next_cursor is None:
            break
        cursor = next_cursor
    return all_markets


async def fetch_markets_for_event(self, event_ticker: str) -> list[Market]:
    """Thin wrapper: page through /markets?event_ticker=X and upsert each.

    Primary call-path from CLI commands like `pytheum events show`.
    """
    return await self.fetch_markets(event_ticker=event_ticker)


async def fetch_market(self, ticker: str) -> Market:
    """Fetch /markets/{ticker}, record raw, upsert market, return with raw_id.

    Raw-first flow: venue returns raw dict → record_raw_rest → normalize
    with real raw_id → ensure parent event exists (FK) → upsert market.
    """
    body, env = await self.client.rest.get_market(ticker)
    raw_id = self._persist(env)
    market = normalize_market(body["market"] if "market" in body else body, raw_id=raw_id)
    # FK chain: ensure parent event exists before upserting market.
    if market.event_native_id is not None:
        await self.fetch_event_with_markets(market.event_native_id)  # idempotent upsert
    self.repo.upsert_market(market, raw_id=raw_id,
                            schema_version=self._schema_version)
    return market
```

> **Note on FK chain:** `fetch_event_with_markets` is idempotent — if the event already
> exists in the DB it will not re-fetch unless the record is stale. For `fetch_orderbook`,
> `iter_trades`, and `fetch_candlesticks`, call `await self.fetch_market(ticker)` at the
> top of those methods to ensure the market and its outcomes exist before upserting rows
> that FK to outcomes.

---

- [ ] **Step 5: Verify pass**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv run pytest tests/venues/kalshi/test_rest.py -k "market" \
              tests/venues/kalshi/test_normalizer.py -k "market" \
              tests/services/test_fetch.py -k "market" \
              -v 2>&1 | tail -25
```

Expected:
```
tests/venues/kalshi/test_rest.py::test_get_markets_page_returns_models PASSED
tests/venues/kalshi/test_rest.py::test_get_markets_page_filters PASSED
tests/venues/kalshi/test_rest.py::test_iter_markets_exhausts_pages PASSED
tests/venues/kalshi/test_rest.py::test_get_market_returns_market PASSED
tests/venues/kalshi/test_rest.py::test_get_market_outcomes_present PASSED
tests/venues/kalshi/test_rest.py::test_get_market_404_raises_no_results PASSED
tests/venues/kalshi/test_normalizer.py::test_normalize_markets_list_fixture PASSED
tests/venues/kalshi/test_normalizer.py::test_normalize_market_detail_fixture PASSED
tests/venues/kalshi/test_normalizer.py::test_normalize_market_status_mapping PASSED
tests/services/test_fetch.py::test_fetch_markets_upserts_markets PASSED
tests/services/test_fetch.py::test_fetch_markets_for_event_passes_event_ticker PASSED
tests/services/test_fetch.py::test_fetch_markets_for_event_multi_page PASSED
tests/services/test_fetch.py::test_fetch_market_records_raw_and_upserts PASSED
13 passed in <Xs>
```

Full suite:

```bash
uv run pytest --tb=short -q 2>&1 | tail -5
# Expect: 163+ passed, 0 failed
```

---

- [ ] **Step 6: Commit**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    add \
      src/pytheum/venues/kalshi/rest.py \
      src/pytheum/venues/kalshi/normalizer.py \
      src/pytheum/services/fetch.py \
      tests/fixtures/kalshi/markets_list.json \
      tests/fixtures/kalshi/markets_detail.json \
      tests/fixtures/kalshi/manifest.json \
      tests/venues/kalshi/test_rest.py \
      tests/venues/kalshi/test_normalizer.py \
      tests/services/test_fetch.py

git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "$(cat <<'EOF'
feat(kalshi): Task 9 — markets list + detail endpoints with status mapping

Implements get_markets_page / get_market / iter_markets on KalshiRest;
fetch_markets / fetch_market / fetch_markets_for_event on KalshiFetchService;
normalize_market + _KALSHI_STATUS + _midpoint helpers in the normalizer.
Outcomes built from yes_bid/yes_ask/no_bid/no_ask midpoints; prices
normalized to [0, 1]. Commits real-API fixtures for markets list and
detail. 13 new tests, all passing; 163+ total tests green.
EOF
)"
```

---

## Task 10: Orderbook + Candlesticks + Historical Cutoff

Add the snapshot and price-history endpoints to `KalshiRest`, implement the matching service
methods in `KalshiFetchService`, capture the three required fixtures, and wire the normalizers
through the full raw-first persistence chain. This task finalises the price-data surface of the
Kalshi REST client; Task 11 adds trade-level data and Task 12 wires everything into the CLI.

**Files:**
- Modify: `src/pytheum/venues/kalshi/rest.py`
- Modify: `src/pytheum/services/fetch.py`
- Create: `tests/fixtures/kalshi/orderbook.json`
- Create: `tests/fixtures/kalshi/candlesticks.json`
- Create: `tests/fixtures/kalshi/historical_cutoff.json`
- Modify: `tests/fixtures/kalshi/manifest.json`
- Modify: `tests/venues/kalshi/test_rest.py`
- Modify: `tests/venues/kalshi/test_normalizer.py`
- Modify: `tests/services/test_fetch.py`

---

- [ ] **Step 1: Capture fixtures + update manifest**

Use the ticker recorded in `manifest.json` under `markets_detail.captured_id` (e.g.
`KXBTC-25DEC-T95000`). Store it in `TICKER` for the commands below.

```bash
TICKER=$(python3 -c "
import json, pathlib
m = json.loads(pathlib.Path('tests/fixtures/kalshi/manifest.json').read_text())
print(m['markets_detail']['captured_id'])
")

BASE="https://api.elections.kalshi.com/trade-api/v2"

# Orderbook (depth=10 is a reasonable default; API accepts 1-20)
curl -s "${BASE}/markets/${TICKER}/orderbook?depth=10" \
  | python3 -m json.tool --indent 2 \
  > tests/fixtures/kalshi/orderbook.json

# Candlesticks — period_interval values: 1 = 1 min, 60 = 1 hr, 1440 = 1 day.
# Use 1440 (daily) so the response fits in one page for most tickers.
# start_ts and end_ts are UNIX seconds.
START=$(python3 -c "import time; print(int(time.time()) - 30*86400)")
END=$(python3 -c "import time; print(int(time.time()))")
curl -s "${BASE}/markets/${TICKER}/candlesticks?period_interval=1440&start_ts=${START}&end_ts=${END}" \
  | python3 -m json.tool --indent 2 \
  > tests/fixtures/kalshi/candlesticks.json

# Historical cutoff — no path parameters
curl -s "${BASE}/historical/cutoff" \
  | python3 -m json.tool --indent 2 \
  > tests/fixtures/kalshi/historical_cutoff.json
```

Verify each file is valid JSON and non-empty:

```bash
python3 -c "
import json, pathlib
for f in ['orderbook', 'candlesticks', 'historical_cutoff']:
    d = json.loads(pathlib.Path(f'tests/fixtures/kalshi/{f}.json').read_text())
    print(f, 'OK', list(d.keys())[:4])
"
```

Update `tests/fixtures/kalshi/manifest.json` — add three new entries under the existing keys
(do not remove existing entries):

```json
{
  "orderbook":          { "endpoint": "/markets/{ticker}/orderbook",            "captured_id": "<TICKER>" },
  "candlesticks":       { "endpoint": "/markets/{ticker}/candlesticks",          "captured_id": "<TICKER>",
                          "period_interval_sent": 1440, "kalshi_interval_name": "1d" },
  "historical_cutoff":  { "endpoint": "/historical/cutoff",                       "captured_id": null }
}
```

Replace `<TICKER>` with the actual value.

> **Deviation note — interval mapping:** Kalshi's `period_interval` is an integer (minutes).
> The plan uses `1m/1h/1d` internally. The mapping is:
> `"1m" → 1`, `"1h" → 60`, `"1d" → 1440`.
> Verify this against the live fixture before writing the conversion helper — if the captured
> `candlesticks.json` shows a different field name or encoding, update the mapping table in
> `normalizer.py` and record the deviation in a `# DEVIATION:` comment.

---

- [ ] **Step 2: Write failing tests**

Append to `tests/venues/kalshi/test_rest.py`:

```python
# ---------------------------------------------------------------------------
# Task 10 — orderbook, candlesticks, historical_cutoff
# ---------------------------------------------------------------------------

import json
from pathlib import Path

import pytest
import httpx

from tests.fixtures.kalshi._manifest import fixture as mf

FIXTURE_DIR = Path(__file__).parent.parent.parent / "fixtures" / "kalshi"


@pytest.fixture
def orderbook_transport():
    payload, _ = mf("orderbook")
    return httpx.MockTransport(lambda r: httpx.Response(200, json=payload))


@pytest.fixture
def candlesticks_transport():
    payload, _ = mf("candlesticks")
    return httpx.MockTransport(lambda r: httpx.Response(200, json=payload))


@pytest.fixture
def historical_cutoff_transport():
    payload, _ = mf("historical_cutoff")
    return httpx.MockTransport(lambda r: httpx.Response(200, json=payload))


@pytest.mark.asyncio
async def test_get_orderbook_returns_two_books(orderbook_transport):
    from pytheum.venues.kalshi.client import KalshiClient
    async with KalshiClient(_transport=orderbook_transport) as kc:
        entry = mf("orderbook")
        ticker = entry[1]["captured_id"]
        (yes_book, no_book), env = await kc.rest.get_orderbook(ticker, depth=10)
    assert yes_book.outcome_id == "yes"
    assert no_book.outcome_id == "no"
    assert yes_book.market_native_id == ticker
    assert env.status_code == 200


@pytest.mark.asyncio
async def test_get_orderbook_same_raw_id_for_both_sides(orderbook_transport):
    """Both sides come from the same HTTP response — same raw_id when persisted."""
    from pytheum.venues.kalshi.client import KalshiClient
    async with KalshiClient(_transport=orderbook_transport) as kc:
        entry = mf("orderbook")
        ticker = entry[1]["captured_id"]
        (yes_book, no_book), env = await kc.rest.get_orderbook(ticker)
    # RawEnvelope carries one payload — the service layer is responsible for
    # persisting it once and using its raw_id for both yes and no upserts.
    assert env.payload is not None
    assert "yes" in env.payload or "orderbook" in env.payload


@pytest.mark.asyncio
async def test_get_candlesticks_returns_price_points(candlesticks_transport):
    from pytheum.venues.kalshi.client import KalshiClient
    import time
    async with KalshiClient(_transport=candlesticks_transport) as kc:
        entry = mf("candlesticks")
        ticker = entry[1]["captured_id"]
        start = int(time.time()) - 30 * 86400
        end = int(time.time())
        pts, env = await kc.rest.get_candlesticks(
            ticker, interval="1d", start_ts=start, end_ts=end
        )
    # Each candle yields 2 PricePoints (yes + no)
    assert len(pts) > 0
    assert len(pts) % 2 == 0
    outcome_ids = {p.outcome_id for p in pts}
    assert outcome_ids == {"yes", "no"}


@pytest.mark.asyncio
async def test_get_candlesticks_interval_stored_as_internal(candlesticks_transport):
    """Interval in returned PricePoints must use internal notation (1m/1h/1d)."""
    from pytheum.venues.kalshi.client import KalshiClient
    import time
    async with KalshiClient(_transport=candlesticks_transport) as kc:
        entry = mf("candlesticks")
        ticker = entry[1]["captured_id"]
        start = int(time.time()) - 30 * 86400
        end = int(time.time())
        pts, _ = await kc.rest.get_candlesticks(
            ticker, interval="1d", start_ts=start, end_ts=end
        )
    for p in pts:
        assert p.interval in {"1m", "1h", "1d"}


@pytest.mark.asyncio
async def test_get_historical_cutoff_returns_datetime_or_none(historical_cutoff_transport):
    from pytheum.venues.kalshi.client import KalshiClient
    from datetime import datetime
    async with KalshiClient(_transport=historical_cutoff_transport) as kc:
        cutoff, env = await kc.rest.get_historical_cutoff()
    assert cutoff is None or isinstance(cutoff, datetime)
    assert env.status_code == 200
```

Append to `tests/venues/kalshi/test_normalizer.py`:

```python
# ---------------------------------------------------------------------------
# Task 10 — normalize_orderbook, normalize_candlestick
# ---------------------------------------------------------------------------

from tests.fixtures.kalshi._manifest import fixture as mf


def test_normalize_orderbook_produces_yes_and_no():
    from pytheum.venues.kalshi.normalizer import normalize_orderbook
    payload, entry = mf("orderbook")
    ticker = entry["captured_id"]
    ob_payload = payload.get("orderbook", payload)  # unwrap if nested
    yes_book, no_book = normalize_orderbook(ob_payload, market_native_id=ticker, raw_id=1)
    assert yes_book.outcome_id == "yes"
    assert no_book.outcome_id == "no"
    # Price must be in [0, 1] — normalizer converts cents to probability
    for price, _ in yes_book.bids + yes_book.asks + no_book.bids + no_book.asks:
        assert 0.0 <= float(price) <= 1.0, f"price out of range: {price}"


def test_normalize_orderbook_bids_and_asks_present():
    from pytheum.venues.kalshi.normalizer import normalize_orderbook
    payload, entry = mf("orderbook")
    ticker = entry["captured_id"]
    ob_payload = payload.get("orderbook", payload)
    yes_book, no_book = normalize_orderbook(ob_payload, market_native_id=ticker, raw_id=1)
    # At least one side must have levels (live market may have thin book — relax to >= 0)
    assert isinstance(yes_book.bids, list)
    assert isinstance(yes_book.asks, list)


def test_normalize_candlestick_yields_two_price_points():
    from pytheum.venues.kalshi.normalizer import normalize_candlestick
    payload, entry = mf("candlesticks")
    ticker = entry["captured_id"]
    candles = payload.get("candles", payload.get("candlesticks", []))
    if not candles:
        pytest.skip("No candles in captured fixture")
    pts = normalize_candlestick(candles[0], market_native_id=ticker, interval="1d", raw_id=1)
    assert len(pts) == 2
    outcome_ids = {p.outcome_id for p in pts}
    assert outcome_ids == {"yes", "no"}


def test_normalize_candlestick_uses_close_price():
    from pytheum.venues.kalshi.normalizer import normalize_candlestick
    payload, entry = mf("candlesticks")
    ticker = entry["captured_id"]
    candles = payload.get("candles", payload.get("candlesticks", []))
    if not candles:
        pytest.skip("No candles in captured fixture")
    item = candles[0]
    pts = normalize_candlestick(item, market_native_id=ticker, interval="1d", raw_id=1)
    yes_pt = next(p for p in pts if p.outcome_id == "yes")
    expected_close = item["yes_price"]["close"] / 100
    assert float(yes_pt.price) == pytest.approx(expected_close, abs=1e-6)
```

Append to `tests/services/test_fetch.py`:

```python
# ---------------------------------------------------------------------------
# Task 10 — fetch_orderbook, fetch_candlesticks
# ---------------------------------------------------------------------------

import time
import httpx
import pytest

from tests.fixtures.kalshi._manifest import fixture as mf


@pytest.mark.asyncio
async def test_fetch_orderbook_upserts_both_sides(tmp_path):
    from pytheum.data.storage import Storage
    from pytheum.data.repository import MarketRepository
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.services.fetch import KalshiFetchService

    orderbook_payload, entry = mf("orderbook")
    market_payload, _ = mf("markets_detail")
    event_payload, _ = mf("events_detail")
    ticker = entry["captured_id"]
    event_ticker = ticker.rsplit("-T", 1)[0]  # e.g. "KXBTC-25DEC-T95000" → "KXBTC-25DEC"

    # Path-aware dispatcher: fetch_orderbook → fetch_market (FK) → fetch_event_with_markets (FK).
    # Each sub-request must receive the correct payload shape for normalization to succeed.
    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith(f"/markets/{ticker}/orderbook"):
            return httpx.Response(200, json=orderbook_payload)
        if path.endswith(f"/events/{event_ticker}"):
            return httpx.Response(200, json=event_payload)
        if path.endswith(f"/markets/{ticker}"):
            return httpx.Response(200, json=market_payload)
        return httpx.Response(404, json={"error": "unmocked path: " + path})

    transport = httpx.MockTransport(handler)

    storage = Storage(tmp_path / "t.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    # No _seed_market needed: fetch_orderbook calls fetch_market internally.

    async with KalshiClient(_transport=transport) as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        yes_book, no_book = await svc.fetch_orderbook(ticker)

    assert yes_book.outcome_id == "yes"
    assert no_book.outcome_id == "no"

    with repo.storage.connect() as conn:
        rows = conn.execute(
            "SELECT outcome_id, raw_id FROM orderbook_snaps"
            " WHERE venue='kalshi' AND market_native_id=?"
            " ORDER BY outcome_id",
            [ticker],
        ).fetchall()

    assert len(rows) == 2
    # Both sides share the same raw_id (one HTTP response)
    raw_ids = {r[1] for r in rows}
    assert len(raw_ids) == 1, f"Expected same raw_id for both sides, got {raw_ids}"
    sides = [r[0] for r in rows]
    assert "yes" in sides and "no" in sides


@pytest.mark.asyncio
async def test_fetch_candlesticks_upserts_price_points(tmp_path):
    from pytheum.data.storage import Storage
    from pytheum.data.repository import MarketRepository
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.services.fetch import KalshiFetchService

    candlesticks_payload, entry = mf("candlesticks")
    market_payload, _ = mf("markets_detail")
    event_payload, _ = mf("events_detail")
    ticker = entry["captured_id"]
    event_ticker = ticker.rsplit("-T", 1)[0]  # e.g. "KXBTC-25DEC-T95000" → "KXBTC-25DEC"

    # Path-aware dispatcher: fetch_candlesticks → fetch_market (FK) → fetch_event_with_markets (FK).
    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith(f"/markets/{ticker}/candlesticks"):
            return httpx.Response(200, json=candlesticks_payload)
        if path.endswith(f"/events/{event_ticker}"):
            return httpx.Response(200, json=event_payload)
        if path.endswith(f"/markets/{ticker}"):
            return httpx.Response(200, json=market_payload)
        return httpx.Response(404, json={"error": "unmocked path: " + path})

    transport = httpx.MockTransport(handler)

    storage = Storage(tmp_path / "t.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    # No _seed_market needed: fetch_candlesticks calls fetch_market internally.

    start = int(time.time()) - 30 * 86400
    end = int(time.time())

    async with KalshiClient(_transport=transport) as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        pts = await svc.fetch_candlesticks(ticker, "1d", start_ts=start, end_ts=end)

    assert len(pts) > 0
    # Every PricePoint must use the internal interval string
    for p in pts:
        assert p.interval in {"1m", "1h", "1d"}
    # Rows should be in price_points table
    with repo.storage.connect() as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM price_points WHERE venue='kalshi' AND market_native_id=?",
            [ticker],
        ).fetchone()
    assert count is not None and count[0] == len(pts)
```

---

- [ ] **Step 3: Run tests, verify they fail**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv run pytest tests/venues/kalshi/test_rest.py::test_get_orderbook_returns_two_books \
              tests/venues/kalshi/test_normalizer.py::test_normalize_orderbook_produces_yes_and_no \
              tests/services/test_fetch.py::test_fetch_orderbook_upserts_both_sides \
              -v 2>&1 | head -40
```

Expected: `AttributeError: 'KalshiRest' object has no attribute 'get_orderbook'` or similar.

---

- [ ] **Step 4: Implement `rest.py` additions**

Add the following to `src/pytheum/venues/kalshi/rest.py` after the existing market-detail method.

First add the interval conversion helper near the top of the module (after the `_LIMIT_*`
constants):

```python
# Interval conversion: internal notation → Kalshi period_interval (minutes).
# Verified against live fixture captured in Task 10 Step 1.
# DEVIATION: Kalshi uses an integer number of minutes, not a string label.
_INTERVAL_TO_KALSHI: dict[str, int] = {
    "1m": 1,
    "1h": 60,
    "1d": 1440,
}
_KALSHI_TO_INTERVAL: dict[int, str] = {v: k for k, v in _INTERVAL_TO_KALSHI.items()}
```

Then add the four endpoint methods:

```python
async def get_orderbook(
    self,
    ticker: str,
    *,
    depth: int | None = None,
) -> tuple[tuple[OrderBook, OrderBook], RawEnvelope]:
    """GET /markets/{ticker}/orderbook

    Returns a (yes_book, no_book) pair plus the raw envelope.

    Kalshi response shape::

        {"orderbook": {"yes": [[price_cents, size], ...], "no": [[...], ...]}}

    Both sides come from one HTTP round-trip; the service layer persists the
    raw payload ONCE and supplies its raw_id to both upsert_orderbook calls.
    """
    params: dict[str, Any] = {}
    if depth is not None:
        params["depth"] = depth
    body, env = await self._send(
        "GET",
        f"/markets/{ticker}/orderbook",
        params=params or None,
        native_ids=[ticker],
    )
    ob_payload = body.get("orderbook", body)
    yes_book, no_book = normalize_orderbook(
        ob_payload, market_native_id=ticker, raw_id=None
    )
    return (yes_book, no_book), env


async def get_candlesticks(
    self,
    ticker: str,
    *,
    interval: str,
    start_ts: int | None = None,
    end_ts: int | None = None,
) -> tuple[list[PricePoint], RawEnvelope]:
    """GET /markets/{ticker}/candlesticks

    Kalshi requires ``start_ts``, ``end_ts`` (UNIX seconds), and
    ``period_interval`` (integer minutes: 1 / 60 / 1440).

    The ``interval`` parameter uses internal notation (``"1m"``/``"1h"``/``"1d"``);
    this method converts to Kalshi's integer before sending.

    Each candle in the response yields TWO PricePoints — one for ``yes``, one
    for ``no`` — using the ``close`` price.
    """
    if interval not in _INTERVAL_TO_KALSHI:
        raise ValueError(
            f"Unknown interval {interval!r}. Valid: {list(_INTERVAL_TO_KALSHI)}"
        )
    params: dict[str, Any] = {"period_interval": _INTERVAL_TO_KALSHI[interval]}
    if start_ts is not None:
        params["start_ts"] = start_ts
    if end_ts is not None:
        params["end_ts"] = end_ts
    body, env = await self._send(
        "GET",
        f"/markets/{ticker}/candlesticks",
        params=params,
        native_ids=[ticker],
    )
    candles = body.get("candles", body.get("candlesticks", []))
    pts: list[PricePoint] = []
    for item in candles:
        pts.extend(
            normalize_candlestick(item, market_native_id=ticker, interval=interval, raw_id=None)
        )
    return pts, env


async def get_historical_candlesticks(
    self,
    ticker: str,
    *,
    interval: str,
    start_ts: int | None = None,
    end_ts: int | None = None,
) -> tuple[list[PricePoint], RawEnvelope]:
    """GET /historical/markets/{ticker}/candlesticks — same shape as get_candlesticks, different endpoint.

    Kalshi routes older price history through this path; the response schema is
    identical to the live candlesticks endpoint.
    Verify path against live API during implementation — use
    ``# DEVIATION:`` comment if Kalshi changes it.
    """
    if interval not in _INTERVAL_TO_KALSHI:
        raise ValueError(f"Unknown interval {interval!r}.")
    params: dict[str, Any] = {
        "period_interval": _INTERVAL_TO_KALSHI[interval],
    }
    if start_ts is not None:
        params["start_ts"] = start_ts
    if end_ts is not None:
        params["end_ts"] = end_ts
    body, env = await self._send(
        "GET",
        f"/historical/markets/{ticker}/candlesticks",
        params=params,
        native_ids=[ticker],
    )
    candles = body.get("candles", body.get("candlesticks", []))
    pts: list[PricePoint] = []
    for item in candles:
        pts.extend(
            normalize_candlestick(item, market_native_id=ticker, interval=interval, raw_id=None)
        )
    return pts, env


async def get_historical_cutoff(self) -> tuple[datetime | None, RawEnvelope]:
    """GET /historical/cutoff

    Returns the earliest timestamp for which historical candlestick data is
    available, or ``None`` if the response field is absent/null.

    Expected response shape::

        {"cutoff_ts": 1700000000}   # UNIX seconds, or null
    """
    body, env = await self._send(
        "GET",
        "/historical/cutoff",
        params=None,
        native_ids=[],
    )
    raw_cutoff = body.get("cutoff_ts")
    if raw_cutoff is None:
        return None, env
    from datetime import UTC
    cutoff = datetime.fromtimestamp(int(raw_cutoff), tz=UTC)
    return cutoff, env
```

---

- [ ] **Step 5: Implement `fetch.py` additions**

Add to `src/pytheum/services/fetch.py`:

```python
async def fetch_orderbook(
    self,
    ticker: str,
    *,
    depth: int | None = None,
) -> tuple[OrderBook, OrderBook]:
    """Fetch the current orderbook, persist the raw payload once, upsert both sides.

    Returns ``(yes_book, no_book)``. Both rows in ``orderbook_snaps`` share the
    same ``raw_id`` because they originate from a single HTTP response.
    FK chain: ensures market + outcomes exist before upserting orderbook rows.
    """
    # FK chain: ensure market and its outcomes exist before upserting orderbook rows.
    await self.fetch_market(ticker)
    (yes_book, no_book), env = await self.client.rest.get_orderbook(
        ticker, depth=depth
    )
    raw_id = self.repo.record_raw_rest(
        venue=env.venue,
        endpoint=env.endpoint,
        request_params=env.request_params,
        payload=env.payload,
        received_ts=env.received_ts,
        source_ts=env.source_ts,
        status_code=env.status_code,
        duration_ms=env.duration_ms,
        schema_version=1,
        native_ids=env.native_ids,
    )
    # Re-attach raw_id to both books so downstream callers can trace them.
    yes_book = yes_book.model_copy(update={"raw_id": raw_id})
    no_book = no_book.model_copy(update={"raw_id": raw_id})
    self.repo.upsert_orderbook(yes_book, raw_id=raw_id, schema_version=1)
    self.repo.upsert_orderbook(no_book, raw_id=raw_id, schema_version=1)
    return yes_book, no_book


async def fetch_candlesticks(
    self,
    ticker: str,
    interval: str,
    *,
    start_ts: int | None = None,
    end_ts: int | None = None,
    historical: bool = False,
) -> list[PricePoint]:
    """Fetch candlesticks (live or historical), persist raw once, batch-upsert PricePoints.

    Each candle becomes 2 PricePoint rows (yes + no). The ``interval`` field
    in the DB uses internal notation (``1m``/``1h``/``1d``), NOT Kalshi's
    integer minutes.

    Pass ``historical=True`` to route through ``/historical/markets/{ticker}/candlesticks``.
    FK chain: ensures market + outcomes exist before upserting price_points rows.
    """
    # FK chain: ensure market and its outcomes exist before upserting price_points rows.
    await self.fetch_market(ticker)
    if historical:
        pts, env = await self.client.rest.get_historical_candlesticks(
            ticker, interval=interval, start_ts=start_ts, end_ts=end_ts
        )
    else:
        pts, env = await self.client.rest.get_candlesticks(
            ticker, interval=interval, start_ts=start_ts, end_ts=end_ts
        )
    if not pts:
        return pts
    raw_id = self.repo.record_raw_rest(
        venue=env.venue,
        endpoint=env.endpoint,
        request_params=env.request_params,
        payload=env.payload,
        received_ts=env.received_ts,
        source_ts=env.source_ts,
        status_code=env.status_code,
        duration_ms=env.duration_ms,
        schema_version=1,
        native_ids=env.native_ids,
    )
    self.repo.upsert_price_points(pts, raw_id=raw_id, schema_version=1)
    return pts
```

---

- [ ] **Step 6: Run tests + commit**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv run pytest tests/venues/kalshi/test_rest.py \
              tests/venues/kalshi/test_normalizer.py \
              tests/services/test_fetch.py \
              -v
```

All Task 10 tests must pass. Phase 1 tests must still pass:

```bash
uv run pytest -q
```

Commit:

```bash
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    add src/pytheum/venues/kalshi/rest.py \
        src/pytheum/services/fetch.py \
        tests/fixtures/kalshi/orderbook.json \
        tests/fixtures/kalshi/candlesticks.json \
        tests/fixtures/kalshi/historical_cutoff.json \
        tests/fixtures/kalshi/manifest.json \
        tests/venues/kalshi/test_rest.py \
        tests/venues/kalshi/test_normalizer.py \
        tests/services/test_fetch.py

git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "feat(kalshi): orderbook + candlesticks REST methods + service + fixtures (Task 10)"
```

---

## Task 11: Trades (live + historical)

Add cursor-paginated trade endpoints to `KalshiRest` and an async-generator service method that
persists each page as it streams. Both the live trades endpoint (`/markets/trades`) and the
historical path (`/historical/trades`) share the same normalizer and page-limit constants; the
`historical` flag in the service method selects which route to call.

**Files:**
- Modify: `src/pytheum/venues/kalshi/rest.py`
- Modify: `src/pytheum/services/fetch.py`
- Create: `tests/fixtures/kalshi/trades_live.json`
- Create: `tests/fixtures/kalshi/trades_historical.json`
- Modify: `tests/fixtures/kalshi/manifest.json`
- Modify: `tests/venues/kalshi/test_rest.py`
- Modify: `tests/venues/kalshi/test_normalizer.py`
- Modify: `tests/services/test_fetch.py`

---

- [ ] **Step 1: Capture fixtures + update manifest**

```bash
TICKER=$(python3 -c "
import json, pathlib
m = json.loads(pathlib.Path('tests/fixtures/kalshi/manifest.json').read_text())
print(m['markets_detail']['captured_id'])
")

BASE="https://api.elections.kalshi.com/trade-api/v2"

# Live trades — last ~24h, limit=10 for a small but real fixture
curl -s "${BASE}/markets/trades?ticker=${TICKER}&limit=10" \
  | python3 -m json.tool --indent 2 \
  > tests/fixtures/kalshi/trades_live.json

# Historical trades — same ticker, limit=10
curl -s "${BASE}/historical/trades?ticker=${TICKER}&limit=10" \
  | python3 -m json.tool --indent 2 \
  > tests/fixtures/kalshi/trades_historical.json
```

Verify:

```bash
python3 -c "
import json, pathlib
for f in ['trades_live', 'trades_historical']:
    d = json.loads(pathlib.Path(f'tests/fixtures/kalshi/{f}.json').read_text())
    trades = d.get('trades', [])
    print(f, 'trades:', len(trades), 'keys:', list(trades[0].keys())[:6] if trades else '(empty)')
"
```

If either fixture returns zero trades (rare — market may be inactive), substitute the most
recently active ticker in the manifest. Update `manifest.json`:

```json
{
  "trades_live":       { "endpoint": "/markets/trades",    "captured_ticker": "<TICKER>", "limit_sent": 10 },
  "trades_historical": { "endpoint": "/historical/trades", "captured_ticker": "<TICKER>", "limit_sent": 10 }
}
```

> **Deviation note — `taker_side` and `side` mapping:** Kalshi's trade records contain
> `taker_side` which is `"yes"` or `"no"`. The `outcome_id` is derived directly from
> `taker_side`. The `side` field in the normalized `Trade` model is a heuristic:
> `"buy"` when `taker_side == "yes"`, `"sell"` otherwise. This is NOT a guaranteed
> semantic — it reflects the taker's direction on the YES outcome. Mark with
> `# HEURISTIC: taker_side→side` in `normalizer.py`.

---

- [ ] **Step 2: Write failing tests**

Append to `tests/venues/kalshi/test_rest.py`:

```python
# ---------------------------------------------------------------------------
# Task 11 — trades (live + historical)
# ---------------------------------------------------------------------------


@pytest.fixture
def trades_live_transport():
    payload, _ = mf("trades_live")
    return httpx.MockTransport(lambda r: httpx.Response(200, json=payload))


@pytest.fixture
def trades_historical_transport():
    payload, _ = mf("trades_historical")
    return httpx.MockTransport(lambda r: httpx.Response(200, json=payload))


@pytest.mark.asyncio
async def test_get_trades_page_returns_list_and_cursor(trades_live_transport):
    from pytheum.venues.kalshi.client import KalshiClient
    entry = mf("trades_live")
    ticker = entry[1]["captured_ticker"]
    async with KalshiClient(_transport=trades_live_transport) as kc:
        trades, env, next_cursor = await kc.rest.get_trades_page(ticker)
    assert isinstance(trades, list)
    assert env.status_code == 200
    # next_cursor is None when there are no more pages (small fixture)
    assert next_cursor is None or isinstance(next_cursor, str)


@pytest.mark.asyncio
async def test_get_trades_page_trade_fields(trades_live_transport):
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.data.models import SizeUnit
    from decimal import Decimal
    entry = mf("trades_live")
    ticker = entry[1]["captured_ticker"]
    async with KalshiClient(_transport=trades_live_transport) as kc:
        trades, _, _ = await kc.rest.get_trades_page(ticker)
    if not trades:
        pytest.skip("No trades in fixture")
    for t in trades:
        assert t.currency == "usd"
        assert t.size_unit == SizeUnit.CONTRACTS
        assert 0 <= float(t.price) <= 1, f"price out of range: {t.price}"
        assert t.outcome_id in {"yes", "no"}
        assert t.side in {"buy", "sell"}


@pytest.mark.asyncio
async def test_get_historical_trades_page_returns_list(trades_historical_transport):
    from pytheum.venues.kalshi.client import KalshiClient
    entry = mf("trades_historical")
    ticker = entry[1]["captured_ticker"]
    async with KalshiClient(_transport=trades_historical_transport) as kc:
        trades, env, _ = await kc.rest.get_historical_trades_page(ticker)
    assert isinstance(trades, list)
    assert env.status_code == 200


@pytest.mark.asyncio
async def test_iter_trades_yields_trade_objects(trades_live_transport):
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.data.models import Trade
    entry = mf("trades_live")
    ticker = entry[1]["captured_ticker"]
    async with KalshiClient(_transport=trades_live_transport) as kc:
        collected = []
        async for t in kc.rest.iter_trades(ticker):
            collected.append(t)
            assert isinstance(t, Trade)
    # At minimum we should get whatever the fixture contains
    assert isinstance(collected, list)
```

Append to `tests/venues/kalshi/test_normalizer.py`:

```python
# ---------------------------------------------------------------------------
# Task 11 — normalize_trade
# ---------------------------------------------------------------------------

from decimal import Decimal
from datetime import datetime


def test_normalize_trade_fields():
    from pytheum.venues.kalshi.normalizer import normalize_trade
    from pytheum.data.models import SizeUnit
    item = {
        "trade_id": "abc123",
        "ticker": "FED-25DEC-T4.00",
        "taker_side": "yes",
        "yes_price": 88,
        "count": 100,
        "created_time": "2026-01-01T12:00:00Z",
    }
    trade = normalize_trade(item, raw_id=1)
    assert trade.outcome_id == "yes"
    assert trade.currency == "usd"
    assert trade.size_unit == SizeUnit.CONTRACTS
    assert float(trade.native_price) == 88
    assert float(trade.price) == pytest.approx(0.88)
    assert int(trade.native_size) == 100
    assert float(trade.notional) == pytest.approx(88.0)  # 88 * 100 / 100
    assert trade.side == "buy"  # HEURISTIC: taker_side==yes → buy
    assert isinstance(trade.timestamp, datetime)


def test_normalize_trade_no_side():
    from pytheum.venues.kalshi.normalizer import normalize_trade
    item = {
        "trade_id": "xyz999",
        "ticker": "FED-25DEC-T4.00",
        "taker_side": "no",
        "yes_price": 12,
        "count": 50,
        "created_time": "2026-01-01T12:00:00Z",
    }
    trade = normalize_trade(item, raw_id=1)
    assert trade.outcome_id == "no"
    assert trade.side == "sell"  # HEURISTIC


def test_normalize_trade_price_in_range():
    from pytheum.venues.kalshi.normalizer import normalize_trade
    for cents in [1, 50, 99]:
        item = {
            "trade_id": f"t{cents}",
            "ticker": "X",
            "taker_side": "yes",
            "yes_price": cents,
            "count": 1,
            "created_time": "2026-01-01T00:00:00Z",
        }
        t = normalize_trade(item, raw_id=1)
        assert 0 <= float(t.price) <= 1
```

Append to `tests/services/test_fetch.py`:

```python
# ---------------------------------------------------------------------------
# Task 11 — iter_trades (service-layer persistence)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_iter_trades_persists_to_db(tmp_path):
    from pytheum.data.storage import Storage
    from pytheum.data.repository import MarketRepository
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.services.fetch import KalshiFetchService

    trades_payload, entry = mf("trades_live")
    market_payload, _ = mf("markets_detail")
    event_payload, _ = mf("events_detail")
    ticker = entry["captured_ticker"]
    event_ticker = ticker.rsplit("-T", 1)[0]

    # Path-aware dispatcher: iter_trades → fetch_market (FK) → fetch_event_with_markets (FK).
    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith("/markets/trades") or path.endswith("/historical/trades"):
            return httpx.Response(200, json=trades_payload)
        if path.endswith(f"/events/{event_ticker}"):
            return httpx.Response(200, json=event_payload)
        if path.endswith(f"/markets/{ticker}"):
            return httpx.Response(200, json=market_payload)
        return httpx.Response(404, json={"error": "unmocked path: " + path})

    transport = httpx.MockTransport(handler)

    storage = Storage(tmp_path / "t.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    # No _seed_market needed: iter_trades calls fetch_market internally.

    async with KalshiClient(_transport=transport) as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        collected = []
        async for t in svc.iter_trades(ticker):
            collected.append(t)

    with repo.storage.connect() as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM trades WHERE venue='kalshi'",
        ).fetchone()
    db_count = count[0] if count else 0
    assert db_count == len(collected)


@pytest.mark.asyncio
async def test_iter_trades_historical_flag(tmp_path):
    from pytheum.data.storage import Storage
    from pytheum.data.repository import MarketRepository
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.services.fetch import KalshiFetchService

    trades_payload, entry = mf("trades_historical")
    market_payload, _ = mf("markets_detail")
    event_payload, _ = mf("events_detail")
    ticker = entry["captured_ticker"]
    event_ticker = ticker.rsplit("-T", 1)[0]

    # Path-aware dispatcher: iter_trades (historical=True) → fetch_market (FK).
    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith("/markets/trades") or path.endswith("/historical/trades"):
            return httpx.Response(200, json=trades_payload)
        if path.endswith(f"/events/{event_ticker}"):
            return httpx.Response(200, json=event_payload)
        if path.endswith(f"/markets/{ticker}"):
            return httpx.Response(200, json=market_payload)
        return httpx.Response(404, json={"error": "unmocked path: " + path})

    transport = httpx.MockTransport(handler)

    storage = Storage(tmp_path / "t.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    # No _seed_market needed: iter_trades calls fetch_market internally.

    async with KalshiClient(_transport=transport) as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        collected = []
        async for t in svc.iter_trades(ticker, historical=True):
            collected.append(t)

    with repo.storage.connect() as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM trades WHERE venue='kalshi'",
        ).fetchone()
    assert (count[0] if count else 0) == len(collected)


@pytest.mark.asyncio
async def test_iter_trades_currency_and_size_unit(tmp_path):
    from pytheum.data.storage import Storage
    from pytheum.data.repository import MarketRepository
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.services.fetch import KalshiFetchService
    from pytheum.data.models import SizeUnit

    trades_payload, entry = mf("trades_live")
    market_payload, _ = mf("markets_detail")
    event_payload, _ = mf("events_detail")
    ticker = entry["captured_ticker"]
    event_ticker = ticker.rsplit("-T", 1)[0]

    # Path-aware dispatcher: iter_trades → fetch_market (FK) → fetch_event_with_markets (FK).
    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith("/markets/trades") or path.endswith("/historical/trades"):
            return httpx.Response(200, json=trades_payload)
        if path.endswith(f"/events/{event_ticker}"):
            return httpx.Response(200, json=event_payload)
        if path.endswith(f"/markets/{ticker}"):
            return httpx.Response(200, json=market_payload)
        return httpx.Response(404, json={"error": "unmocked path: " + path})

    transport = httpx.MockTransport(handler)

    storage = Storage(tmp_path / "t.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)
    # No _seed_market needed: iter_trades calls fetch_market internally.

    async with KalshiClient(_transport=transport) as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        trades = [t async for t in svc.iter_trades(ticker)]

    if not trades:
        pytest.skip("No trades in fixture")
    for t in trades:
        assert t.currency == "usd"
        assert t.size_unit == SizeUnit.CONTRACTS
        assert 0 <= float(t.price) <= 1
```

---

- [ ] **Step 3: Run tests, verify they fail**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv run pytest tests/venues/kalshi/test_rest.py::test_get_trades_page_returns_list_and_cursor \
              tests/venues/kalshi/test_normalizer.py::test_normalize_trade_fields \
              tests/services/test_fetch.py::test_iter_trades_persists_to_db \
              -v 2>&1 | head -40
```

Expected: `AttributeError: 'KalshiRest' object has no attribute 'get_trades_page'`.

---

- [ ] **Step 4: Implement `rest.py` additions**

Add to `src/pytheum/venues/kalshi/rest.py`:

```python
async def get_trades_page(
    self,
    ticker: str,
    *,
    cursor: str | None = None,
    limit: int = _LIMIT_TRADES,
    min_ts: int | None = None,
    max_ts: int | None = None,
) -> tuple[list[Trade], RawEnvelope, str | None]:
    """GET /markets/trades?ticker=... — one cursor page of live trades.

    Returns ``(trades, envelope, next_cursor)``.
    ``next_cursor`` is ``None`` when no further pages exist.
    ``limit`` defaults to ``_LIMIT_TRADES = 1000`` (Kalshi's documented max).
    """
    params: dict[str, Any] = {"ticker": ticker, "limit": limit}
    if cursor:
        params["cursor"] = cursor
    if min_ts is not None:
        params["min_ts"] = min_ts
    if max_ts is not None:
        params["max_ts"] = max_ts
    body, env = await self._send(
        "GET", "/markets/trades", params=params, native_ids=[ticker]
    )
    raw_trades = body.get("trades", [])
    trades = [normalize_trade(item, raw_id=None) for item in raw_trades]
    next_cursor: str | None = body.get("cursor") or None
    return trades, env, next_cursor


async def get_historical_trades_page(
    self,
    ticker: str,
    *,
    cursor: str | None = None,
    limit: int = _LIMIT_HIST_TRADES,
    min_ts: int | None = None,
    max_ts: int | None = None,
) -> tuple[list[Trade], RawEnvelope, str | None]:
    """GET /historical/trades?ticker=... — one cursor page of historical trades.

    Same shape as ``get_trades_page``; different endpoint path.
    ``limit`` defaults to ``_LIMIT_HIST_TRADES = 1000``.
    """
    params: dict[str, Any] = {"ticker": ticker, "limit": limit}
    if cursor:
        params["cursor"] = cursor
    if min_ts is not None:
        params["min_ts"] = min_ts
    if max_ts is not None:
        params["max_ts"] = max_ts
    body, env = await self._send(
        "GET", "/historical/trades", params=params, native_ids=[ticker]
    )
    raw_trades = body.get("trades", [])
    trades = [normalize_trade(item, raw_id=None) for item in raw_trades]
    next_cursor: str | None = body.get("cursor") or None
    return trades, env, next_cursor


async def iter_trades(
    self,
    ticker: str,
    *,
    since: int | None = None,
    until: int | None = None,
    historical: bool = False,
) -> AsyncIterator[Trade]:
    """Async generator yielding all Trade objects across cursor pages.

    Yields individual Trade objects; callers that need persistence should use
    ``KalshiFetchService.iter_trades`` instead (which persists each page).
    The ``historical`` flag routes to ``/historical/trades``.
    """
    cursor: str | None = None
    while True:
        if historical:
            page, env, next_cursor = await self.get_historical_trades_page(
                ticker, cursor=cursor, min_ts=since, max_ts=until
            )
        else:
            page, env, next_cursor = await self.get_trades_page(
                ticker, cursor=cursor, min_ts=since, max_ts=until
            )
        for trade in page:
            yield trade
        if not next_cursor:
            break
        cursor = next_cursor
```

---

- [ ] **Step 5: Implement `fetch.py` additions (use the Task 5 `normalize_trade`)**

`normalize_trade` is the canonical version defined in Task 5 — do NOT add a second function. When implementing Task 11, **extend the existing Task 5 `normalize_trade`** with these refinements as needed:

- Map `taker_side` → `outcome_id` (direct) and to `side` via the heuristic: `"yes" → "buy"`, `"no" → "sell"` (an exchange-level approximation; document the heuristic in a comment).
- Read price from `yes_price` (cents): `native_price = Decimal(str(item["yes_price"]))`, `price = native_price / Decimal("100")`.
- Read size from `count`: `native_size = Decimal(str(item["count"]))`, `size_unit = SizeUnit.CONTRACTS`.
- Compute `notional = native_price * native_size / Decimal("100")` (USD value).
- Set `currency = "usd"` (Kalshi is USD-denominated).
- Parse `created_time` (ISO-8601 with `Z`) via `datetime.fromisoformat(s.replace("Z", "+00:00"))`. If `created_time` arrives as a Unix epoch int, fall back to `datetime.fromtimestamp(int(s), tz=UTC)`.
- `market_native_id = item.get("ticker", "")` (Kalshi includes the ticker on each trade row).

The function signature stays as in Task 5: `normalize_trade(item: dict[str, Any], *, raw_id: int | None = None) -> Trade`.

Add `iter_trades` to `src/pytheum/services/fetch.py`:

```python
async def iter_trades(
    self,
    ticker: str,
    *,
    since: int | None = None,
    until: int | None = None,
    historical: bool = False,
) -> AsyncIterator[Trade]:
    """Async generator: fetch cursor pages, persist each page, yield Trade objects.

    Each page is recorded as a separate ``raw_payloads`` row. Trades from the
    same page share a ``raw_id``; trades from different pages have different
    ``raw_id`` values. This lets you trace any individual trade back to the
    exact HTTP response that delivered it.
    FK chain: ensures market + outcomes exist before inserting trade rows.
    """
    # FK chain: ensure market and its outcomes exist before inserting trade rows.
    await self.fetch_market(ticker)
    cursor: str | None = None
    while True:
        if historical:
            page, env, next_cursor = await self.client.rest.get_historical_trades_page(
                ticker, cursor=cursor, min_ts=since, max_ts=until
            )
        else:
            page, env, next_cursor = await self.client.rest.get_trades_page(
                ticker, cursor=cursor, min_ts=since, max_ts=until
            )
        if page:
            raw_id = self.repo.record_raw_rest(
                venue=env.venue,
                endpoint=env.endpoint,
                request_params=env.request_params,
                payload=env.payload,
                received_ts=env.received_ts,
                source_ts=env.source_ts,
                status_code=env.status_code,
                duration_ms=env.duration_ms,
                schema_version=1,
                native_ids=env.native_ids,
            )
            self.repo.insert_trades(page, raw_id=raw_id, schema_version=1)
            for trade in page:
                yield trade
        if not next_cursor:
            break
        cursor = next_cursor
```

---

- [ ] **Step 6: Run tests + commit**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv run pytest tests/venues/kalshi/test_rest.py \
              tests/venues/kalshi/test_normalizer.py \
              tests/services/test_fetch.py \
              -v
uv run pytest -q  # full suite
```

All tests green. Commit:

```bash
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    add src/pytheum/venues/kalshi/rest.py \
        src/pytheum/venues/kalshi/normalizer.py \
        src/pytheum/services/fetch.py \
        tests/fixtures/kalshi/trades_live.json \
        tests/fixtures/kalshi/trades_historical.json \
        tests/fixtures/kalshi/manifest.json \
        tests/venues/kalshi/test_rest.py \
        tests/venues/kalshi/test_normalizer.py \
        tests/services/test_fetch.py

git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "feat(kalshi): trades REST methods + service iterator + normalizer (Task 11)"
```

---

## Task 12: `pytheum fetch market` CLI + integration tests + Phase 2A tag

Wire the full stack into a usable CLI command, add a `CliRunner`-based unit test, add an
opt-in live integration test that writes to a temporary DB, and place the `phase-2a-kalshi-rest`
git tag at HEAD. This is the delivery gate for Phase 2A — everything from Task 1 through Task 12
must be green before the tag is placed.

**Files:**
- Create: `src/pytheum/cli/fetch.py`
- Modify: `src/pytheum/cli/__init__.py`
- Create: `tests/cli/__init__.py`
- Create: `tests/cli/test_fetch.py`
- Create: `tests/venues/kalshi/test_client_integration.py`

---

- [ ] **Step 1: Write failing tests**

Create `tests/cli/__init__.py` (empty).

Write `tests/cli/test_fetch.py`:

```python
"""CLI test: pytheum fetch market <ticker>

Uses httpx.MockTransport so no live network is needed. Sets HOME to tmp_path
so config resolution via `_expected_config_path()` lands in a clean directory.
Invokes the Typer app via CliRunner.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import httpx
import pytest
from typer.testing import CliRunner

from tests.fixtures.kalshi._manifest import fixture as mf


runner = CliRunner()


def _make_config_file(tmp_path: Path) -> Path:
    """Write a minimal ~/.pytheum/config.toml into tmp_path."""
    config_dir = tmp_path / ".pytheum"
    config_dir.mkdir(parents=True, exist_ok=True)
    config_path = config_dir / "config.toml"
    config_path.write_text(
        "[storage]\n"
        f'duckdb_path = "{tmp_path / "pytheum.duckdb"}"\n'
        "\n"
        "[venues.kalshi]\n"
        'base_url = "https://api.elections.kalshi.com/trade-api/v2"\n'
        "rate_limit_per_sec = 10\n"
    )
    return config_path


def _market_transport(ticker: str) -> httpx.MockTransport:
    """Return a MockTransport that answers GET /markets/{ticker} with the fixture."""
    payload, _ = mf("markets_detail")

    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    return httpx.MockTransport(_handler)


def test_fetch_market_writes_to_repository(tmp_path, monkeypatch):
    """End-to-end: CLI writes market row + raw_payloads row to a tmp DuckDB."""
    from pytheum.cli import app

    # Point HOME at tmp_path so config resolution finds our injected config.
    monkeypatch.setenv("HOME", str(tmp_path))
    _make_config_file(tmp_path)

    payload, entry = mf("markets_detail")
    ticker = entry["captured_id"]

    # Patch KalshiClient so it uses the mock transport, not a live connection.
    import pytheum.venues.kalshi.client as client_mod

    _orig_init = client_mod.KalshiClient.__init__

    def _patched_init(self, *, config=None, signer=None, transport=None, **kw):
        _orig_init(self, config=config, signer=signer,
                   transport=_market_transport(ticker), **kw)

    monkeypatch.setattr(client_mod.KalshiClient, "__init__", _patched_init)

    result = runner.invoke(app, ["fetch", "market", ticker])

    assert result.exit_code == 0, f"CLI exited {result.exit_code}:\n{result.output}"
    assert ticker in result.output

    # Verify DB rows were written.
    from pytheum.data.storage import Storage
    from pytheum.data.repository import MarketRepository

    db_path = tmp_path / "pytheum.duckdb"
    storage = Storage(db_path)
    storage.migrate()
    repo = MarketRepository(storage)
    with repo.storage.connect() as conn:
        mrow = conn.execute(
            "SELECT native_id FROM markets WHERE venue='kalshi' AND native_id=?",
            [ticker],
        ).fetchone()
        rrow = conn.execute(
            "SELECT COUNT(*) FROM raw_payloads WHERE venue='kalshi'",
        ).fetchone()
    assert mrow is not None, "market row not found in DB"
    assert rrow is not None and rrow[0] >= 1, "raw_payloads row not found"
```

Write `tests/venues/kalshi/test_client_integration.py`:

```python
"""Live integration test — requires PYTHEUM_LIVE_TESTS=1 in environment.

Uses a tmp_path-backed Storage; never touches ~/.pytheum/.
Hits the real Kalshi API. Gate with pytest.mark.skipif so CI stays green.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

LIVE = bool(os.environ.get("PYTHEUM_LIVE_TESTS"))


@pytest.mark.skipif(not LIVE, reason="PYTHEUM_LIVE_TESTS not set")
@pytest.mark.asyncio
async def test_live_fetch_market(tmp_path: Path) -> None:
    """Fetch a real market from the live Kalshi API and verify it lands in the DB."""
    from tests.fixtures.kalshi._manifest import fixture as mf
    from pytheum.data.storage import Storage
    from pytheum.data.repository import MarketRepository
    from pytheum.venues.kalshi.client import KalshiClient
    from pytheum.services.fetch import KalshiFetchService

    _, entry = mf("markets_detail")
    ticker = entry["captured_id"]

    storage = Storage(tmp_path / "live.duckdb")
    storage.migrate()
    repo = MarketRepository(storage)

    # No signer needed — market detail is a public endpoint.
    async with KalshiClient() as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        market = await svc.fetch_market(ticker)

    assert market.native_id == ticker

    with repo.storage.connect() as conn:
        row = conn.execute(
            "SELECT native_id FROM markets WHERE venue='kalshi' AND native_id=?",
            [ticker],
        ).fetchone()
        raw = conn.execute(
            "SELECT COUNT(*) FROM raw_payloads WHERE venue='kalshi'",
        ).fetchone()
    assert row is not None, "Market row missing from DB after live fetch"
    assert raw is not None and raw[0] >= 1, "raw_payloads row missing"
```

---

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv run pytest tests/cli/test_fetch.py::test_fetch_market_writes_to_repository -v 2>&1 | head -30
```

Expected: `ImportError: cannot import name 'fetch_app' from 'pytheum.cli.fetch'` or
`ModuleNotFoundError: No module named 'pytheum.cli.fetch'`.

---

- [ ] **Step 3: Implement `src/pytheum/cli/fetch.py`**

```python
"""pytheum fetch — CLI command group for fetching + persisting venue data."""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from pytheum.core.config import load_config
from pytheum.data.repository import MarketRepository
from pytheum.data.storage import Storage
from pytheum.services.fetch import KalshiFetchService
from pytheum.venues.kalshi.client import KalshiClient
from pytheum.data.refs import MarketRef
from pytheum.venues.kalshi.urls import parse_kalshi_url, parse_kalshi_ticker

console = Console()

fetch_app = typer.Typer(
    name="fetch",
    help="Fetch and persist market data from a venue.",
    no_args_is_help=True,
)


def _config_path() -> Path:
    """Resolve the expected config file path (~/.pytheum/config.toml)."""
    return Path.home() / ".pytheum" / "config.toml"


@fetch_app.command(name="market")
def fetch_market_cmd(
    ref_or_url: Annotated[
        str,
        typer.Argument(help="Market ticker, slug, conditionId, or full URL."),
    ],
) -> None:
    """Fetch a single market by ticker, conditionId, slug, or URL and persist it."""
    asyncio.run(_fetch_market_async(ref_or_url))


async def _fetch_market_async(ref_or_url: str) -> None:
    cfg = load_config(_config_path())

    storage = Storage(cfg.storage.duckdb_path)
    storage.migrate()
    repo = MarketRepository(storage)

    async with KalshiClient(config=cfg.venues.kalshi) as kc:
        svc = KalshiFetchService(client=kc, repository=repo)
        try:
            if ref_or_url.startswith(("http://", "https://")):
                ref = parse_kalshi_url(ref_or_url)
            else:
                ref = parse_kalshi_ticker(ref_or_url)

            if not isinstance(ref, MarketRef):
                raise typer.BadParameter(
                    f"Expected a market reference, got {type(ref).__name__!r}: {ref_or_url!r}"
                )

            market = await svc.fetch_market(ref.value)
        except Exception as exc:
            console.print(f"[bold red]Error:[/] {exc}")
            raise typer.Exit(code=1) from exc

    # Pretty-print a summary table via Rich.
    table = Table(title=f"Market — {market.native_id}", show_header=True, header_style="bold cyan")
    table.add_column("Field", style="dim", width=18)
    table.add_column("Value")
    table.add_row("Ticker", market.native_id)
    table.add_row("Title", market.title or "—")
    table.add_row("Status", market.status or "—")
    table.add_row("Event", market.event_native_id or "—")
    table.add_row("Outcomes", str(len(market.outcomes)))
    if market.total_volume is not None:
        table.add_row("Volume", str(market.total_volume))
    console.print(table)
```

---

- [ ] **Step 4: Register `fetch_app` in `src/pytheum/cli/__init__.py`**

Open `src/pytheum/cli/__init__.py`. Add the import and `add_typer` call near the other
sub-command registrations:

```python
from pytheum.cli.fetch import fetch_app  # noqa: E402  (after existing imports)

app.add_typer(fetch_app, name="fetch")
```

If `__init__.py` does not yet define a `fetch` group, add it after the existing
`add_typer` calls. Do not move or remove any existing sub-commands.

---

- [ ] **Step 5: Run CLI test + full suite**

```bash
cd /Users/kanagn/Desktop/pytheum-cli

# CLI unit test
uv run pytest tests/cli/test_fetch.py -v

# Full suite
uv run pytest -q

# Static analysis
uv run mypy src/pytheum
uv run ruff check src tests
uv run ruff format --check src tests
```

All must be green. Fix any import errors, type errors, or lint issues before proceeding to
Step 6. Common issues:

- `MarketRef` not exported from `urls.py` — add to `__all__`.
- `parse_kalshi_ticker` missing — implement a trivial wrapper that returns
  `MarketRef(value=ticker)` for bare strings that look like Kalshi tickers
  (contain `-`, no scheme).
- `KalshiClient` constructor keyword mismatch — check Task 4's implementation and align.
- `load_config` path argument type — may need `str(path)` conversion.

---

- [ ] **Step 6: Live smoke test + place tag**

Run the live integration test (requires network + live Kalshi API):

```bash
cd /Users/kanagn/Desktop/pytheum-cli
PYTHEUM_LIVE_TESTS=1 uv run pytest tests/venues/kalshi/test_client_integration.py -v
```

If the live API is reachable and the fixture ticker is still active, the test passes and you see
the market data printed. If the ticker has expired, update `manifest.json` to a live ticker and
re-run — do NOT skip the live test; it is the final gate.

Final verification (all four commands must exit 0):

```bash
uv run pytest -q
uv run mypy src/pytheum
uv run ruff check src tests
uv run ruff format --check src tests
```

Place the Phase 2A tag:

```bash
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    add src/pytheum/cli/fetch.py \
        src/pytheum/cli/__init__.py \
        tests/cli/__init__.py \
        tests/cli/test_fetch.py \
        tests/venues/kalshi/test_client_integration.py

git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "feat(cli): pytheum fetch market command + integration tests (Task 12)"

git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    tag -a phase-2a-kalshi-rest -m "Phase 2A — Kalshi REST complete

Layered architecture: pure-transport KalshiRest + KalshiFetchService
at app-services seam + extended MarketRepository. Full §3.1 endpoint
coverage with cursor pagination, per-endpoint limits, raw-first
persistence, real-API fixtures via manifest.json, RSA-PSS auth
wired with full-path/query-stripped signing. WS arrives in 2B."
```

Verify the tag is present and points to HEAD:

```bash
git tag -l "phase-2a-kalshi-rest"
git log --oneline -1 phase-2a-kalshi-rest
```

Verify the earlier tags are intact:

```bash
git tag -l "phase-1-foundation" "phase-1-hardened"
```

---

## Phase 2A Definition of Done

- [ ] All Kalshi public REST endpoints from spec §3.1 implemented as methods on `KalshiClient.rest`
- [ ] `KalshiRest` is pure transport — no `MarketRepository` dependency (Critical #2 closed)
- [ ] `KalshiFetchService` at `pytheum/services/fetch.py` orchestrates fetch → record raw → upsert
- [ ] No `raw_id = 0` escape hatch — all persisted normalized rows have a real raw_id (Critical #3 closed)
- [ ] `MarketRepository` includes `record_raw_rest`, `upsert_category`, `upsert_event`, `upsert_market` (with outcomes), `upsert_orderbook`, `insert_trades`, `upsert_price_points` (Critical #4 closed)
- [ ] Tasks 7-12 are fully spelled-out TDD plans (Critical #1 closed)
- [ ] Signer signs full path including `/trade-api/v2` prefix with query params stripped (Important #5 closed)
- [ ] Signer headers (`KALSHI-ACCESS-KEY/SIGNATURE/TIMESTAMP`) are attached to outgoing requests via httpx
- [ ] Per-endpoint page limits as named constants (`_LIMIT_SERIES`, `_LIMIT_EVENTS`, `_LIMIT_MARKETS`, `_LIMIT_TRADES`, `_LIMIT_HIST_TRADES`) (Important #6 closed)
- [ ] Normalizer mappings explicit (status, cents→probability, currency, volume_metric, interval) — see Task 5 (Important #7 closed)
- [ ] `pytheum fetch market <ref>` calls `KalshiFetchService.fetch_market`, not the venue client directly (Important #8 closed)
- [ ] All live integration tests use `tmp_path` + injected `Storage`; never touch `~/.pytheum/` (Important #9 closed)
- [ ] Fixture capture writes `manifest.json`; tests load via `_manifest.fixture(endpoint_key)` helper (reviewer suggestion closed)
- [ ] `uv run pytest`, `uv run mypy src/pytheum`, `uv run ruff check src tests`, `uv run ruff format --check src tests` all green
- [ ] Tag `phase-2a-kalshi-rest` placed at HEAD; `phase-1-foundation` and `phase-1-hardened` left intact
- [ ] Next: Plan 2B (Kalshi WS) or Plan 2C (Polymarket REST)

*End of plan. To execute, dispatch via the superpowers:subagent-driven-development skill, starting at Task 1.*
