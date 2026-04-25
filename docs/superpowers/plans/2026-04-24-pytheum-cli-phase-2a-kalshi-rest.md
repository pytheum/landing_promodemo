# Pytheum CLI — Phase 2A: Kalshi REST Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the full Kalshi public REST client end-to-end: an async `KalshiClient.rest` API covering every endpoint in spec §3.1, raw-first persistence into `raw_payloads`, normalization to the Phase 1 pydantic models, a Kalshi URL parser, and a per-endpoint fixture-backed test for each route. Public endpoints work zero-config; authenticated endpoints (RSA-PSS) are wired but inert until a key is configured.

**Architecture:** Sits at Layer 2 (Venue Clients) of the spec's five-layer architecture, on top of the Phase 1 core primitives (rate limiter, retry, circuit breaker, pagination, clock, logging). Exposes a single `KalshiClient` whose `.rest` accessor returns the REST sub-client. Every REST call writes its raw payload to `raw_payloads(transport='rest')` BEFORE the normalizer runs, so a `SchemaDrift` failure preserves the original JSON for post-hoc debugging via the new `raw_id` FK chain. WS arrives in Plan 2B.

**Tech Stack:** httpx (async), cryptography (RSA-PSS), pydantic v2, duckdb, pytest-httpx (fixture-based mocking), pytest-recording (VCR cassettes for selected real-API tests). All async.

**Spec source of truth:** `/Users/kanagn/Desktop/landing_promodemo/docs/superpowers/specs/2026-04-24-pytheum-cli-design.md` (mirrored at `/Users/kanagn/Desktop/pytheum-cli/docs/specs/2026-04-24-pytheum-cli-design.md`). §3.1 lists endpoint coverage; §3.7 lists URL patterns; §6 covers auth; §4.1 lists model shapes.

**Working repo:** `/Users/kanagn/Desktop/pytheum-cli/`. Continues from `phase-1-hardened` tag (commit `407ed5b`). All 130 Phase 1 tests still pass throughout this plan; new tests append to that suite.

**Git authorship:** all commits authored as `Konstantinos Anagnostopoulos <147280494+konstantinosanagn@users.noreply.github.com>` via `git -c user.name=… -c user.email=…`. Do NOT modify global git config.

---

## Architectural decisions baked into this plan

These are choices the spec leaves implicit. The plan locks them in so every task is self-consistent. If a reviewer wants any of these changed, do it BEFORE Task 1.

1. **One `httpx.AsyncClient` per `KalshiClient` instance.** Owned by the client, lifecycle via async context manager (`async with KalshiClient(...) as kc: …`) or explicit `await kc.aclose()`. The client is *not* a singleton — multiple clients may coexist, each with its own rate-limiter state.

2. **Rate limiter is per-client.** A `KalshiClient` instantiated with default config gets its own `AsyncRateLimiter(rate_per_sec=10, burst=10)` from the `Config.venues.kalshi.rate_limit_per_sec` slot. No cross-process / cross-client coordination — Phase 1 explicitly didn't ship a distributed limiter.

3. **Retry decorator wraps the inner request method.** `_request()` is decorated with `@retry_async(RetryPolicy(max_attempts=4, base_s=1.0, max_s=30.0, jitter=0.2))`. `RateLimited(retry_after_s=…)` and `VenueUnavailable` (5xx) are the only retryable errors; others raise immediately.

4. **Raw payload persistence is required for any DB-backed call.** The `KalshiRest` constructor takes a `MarketRepository` and writes `raw_payloads` rows synchronously before normalization. If no repository is passed, the call still works but no raw row is created — the caller gets the parsed object only and the result is unsuitable for `repository.upsert_*`.

5. **Normalizer raises `SchemaDrift` with the `raw_id`.** When a venue payload doesn't match the expected pydantic shape, the normalizer wraps the pydantic `ValidationError` in a `SchemaDrift(venue=Venue.KALSHI, endpoint=…, raw_id=…, validator_errors=…)`. The raw payload is already in `raw_payloads`, so post-hoc inspection is always possible.

6. **Public endpoints work with no auth.** `KalshiClient(auth=None)` (default) only attaches `Accept: application/json`. The auth module is fully implemented and unit-tested but no v1 user-facing CLI command exercises it.

7. **HTTP error → application error mapping** (uniform across all endpoints):
   - `200/2xx` → success path
   - `401 / 403` → `AuthRequired`
   - `404` → `NoResults` (caller decides whether to surface as a user-friendly "not found" message)
   - `429` → `RateLimited(retry_after_s=…)` (parsed from `Retry-After` header; may be `None`)
   - `5xx` → `VenueUnavailable`
   - everything else → `VenueUnavailable` with the status code preserved

8. **Cursor pagination only.** Kalshi's `/events`, `/markets`, `/markets/trades`, `/historical/trades`, etc. all use a `cursor`/`next_cursor` query/response pair. Use the Phase 1 `cursor_paginated[T]` helper. Page size hard-coded at 1000 for v1 (the API's max).

9. **Fixtures are real captures, not synthetic.** Each endpoint task captures a real response from `https://api.elections.kalshi.com/trade-api/v2` via `curl` (public, no auth needed) and saves it under `tests/fixtures/kalshi/`. Fixtures are committed. If the live API is unreachable during fixture capture, the task is BLOCKED — synthetic fixtures hide schema drift, which is exactly the failure mode this layer must surface.

10. **`KalshiClient` is async-only.** No sync wrappers in v1. CLI commands that need to call into it use `asyncio.run(...)` at the boundary.

---

## File map for Phase 2A

```
pytheum-cli/
├── src/pytheum/
│   ├── data/
│   │   └── repository.py                    NEW — MarketRepository
│   └── venues/
│       ├── __init__.py                      NEW
│       └── kalshi/
│           ├── __init__.py                  NEW
│           ├── auth.py                      NEW — RSA-PSS signing
│           ├── client.py                    NEW — KalshiClient (top-level)
│           ├── rest.py                      NEW — KalshiRest with all endpoints
│           ├── urls.py                      NEW — URL → MarketRef/EventRef
│           └── normalizer.py                NEW — raw → normalized models
└── tests/
    ├── data/
    │   └── test_repository.py               NEW
    ├── fixtures/
    │   └── kalshi/                          NEW — committed real-API captures
    │       ├── series_list.json
    │       ├── series_detail_FED.json
    │       ├── events_list.json
    │       ├── events_detail_FED-25DEC.json
    │       ├── markets_list.json
    │       ├── markets_detail_FED-25DEC-T4.00.json
    │       ├── orderbook_FED-25DEC-T4.00.json
    │       ├── trades_live.json
    │       ├── historical_trades.json
    │       ├── candlesticks_FED-25DEC-T4.00.json
    │       └── historical_cutoff.json
    └── venues/
        ├── __init__.py                      NEW
        └── kalshi/
            ├── __init__.py                  NEW
            ├── test_auth.py                 NEW
            ├── test_urls.py                 NEW
            ├── test_normalizer.py           NEW
            ├── test_rest.py                 NEW — per-endpoint fixture tests
            └── test_client_integration.py   NEW — end-to-end with repository
```

10 fixture files + 8 source files + 7 test files. ~25 files total.

---

## Task 1: Repository scaffolding (MarketRepository)

The repository persists normalized rows + their `raw_id` FK. Every venue client writes through it. Phase 1 deferred this to Phase 2.

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
    Outcome,
    PriceUnit,
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


def test_upsert_category_writes_row(repo: MarketRepository) -> None:
    raw_id = repo.record_raw_rest(
        venue=Venue.KALSHI,
        endpoint="/series",
        request_params=None,
        payload={"_": "_"},
        received_ts=datetime(2026, 1, 1, tzinfo=UTC),
        source_ts=None,
        status_code=200,
        duration_ms=1,
        schema_version=1,
        native_ids=[],
    )
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


def test_upsert_market_with_outcomes(repo: MarketRepository) -> None:
    raw_id = repo.record_raw_rest(
        venue=Venue.KALSHI,
        endpoint="/markets/FED-25DEC-T4.00",
        request_params=None,
        payload={"_": "_"},
        received_ts=datetime(2026, 1, 1, tzinfo=UTC),
        source_ts=None,
        status_code=200,
        duration_ms=1,
        schema_version=1,
        native_ids=["FED-25DEC-T4.00"],
    )
    # Seed parents (categories + events) so FK chain holds.
    repo.upsert_category(
        Category(venue=Venue.KALSHI, native_id="FED",
                 native_label="Economics", display_label="Economics"),
        raw_id=raw_id, schema_version=1,
    )
    repo.upsert_event(
        Event(
            venue=Venue.KALSHI,
            native_id="FED-25DEC",
            title="FOMC December 2025",
            primary_category=Category(
                venue=Venue.KALSHI, native_id="FED",
                native_label="Economics", display_label="Economics",
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
    with repo.storage.connect() as conn:
        m = conn.execute(
            "SELECT raw_id FROM markets WHERE venue=? AND native_id=?",
            ["kalshi", "FED-25DEC-T4.00"],
        ).fetchone()
        outcomes = conn.execute(
            "SELECT outcome_id FROM outcomes WHERE venue=? AND market_native_id=? ORDER BY outcome_id",
            ["kalshi", "FED-25DEC-T4.00"],
        ).fetchall()
    assert m == (raw_id,)
    assert outcomes == [("no",), ("yes",)]


def test_upsert_is_idempotent(repo: MarketRepository) -> None:
    """Calling upsert twice with the same primary key updates instead of duplicating."""
    raw_id = repo.record_raw_rest(
        venue=Venue.KALSHI, endpoint="/x", request_params=None,
        payload={}, received_ts=datetime(2026, 1, 1, tzinfo=UTC),
        source_ts=None, status_code=200, duration_ms=1,
        schema_version=1, native_ids=[],
    )
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
"""MarketRepository — persists raw + normalized rows. See spec §2 layer 3."""
from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from pytheum.data.models import (
    Category,
    Event,
    Market,
    Outcome,
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
    # normalized upserts
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
        self, conn: Any, outcome: Outcome, raw_id: int, schema_version: int
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

Note: the `event_venue` value passed to `upsert_market` when there's an event is `market.venue.value` (Kalshi markets only reference Kalshi events). For Polymarket in 2C this stays the same — every market belongs to a same-venue event. If a future cross-venue link is needed, this becomes a parameter, not an inferred value.

- [ ] **Step 4: Run test, verify it passes**

```bash
uv run pytest tests/data/test_repository.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/pytheum/data/repository.py tests/data/test_repository.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "data: add MarketRepository — raw_payloads + normalized upserts"
```

---

## Task 2: Venue package scaffolding + Kalshi auth

**Files:**
- Create: `src/pytheum/venues/__init__.py`
- Create: `src/pytheum/venues/kalshi/__init__.py`
- Create: `src/pytheum/venues/kalshi/auth.py`
- Create: `tests/venues/__init__.py`
- Create: `tests/venues/kalshi/__init__.py`
- Create: `tests/venues/kalshi/test_auth.py`

- [ ] **Step 1: Scaffold the empty packages**

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

- [ ] **Step 2: Write failing auth test**

Write `tests/venues/kalshi/test_auth.py`:

```python
from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

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
    # If load succeeds we can sign with it.
    sig = key.sign(b"x", padding.PSS(mgf=padding.MGF1(SHA256()), salt_length=padding.PSS.DIGEST_LENGTH), SHA256())
    assert isinstance(sig, bytes)


def test_load_private_key_rejects_bare_filename(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="absolute"):
        load_private_key_from_pem(Path("kalshi_private_key.pem"))


def test_signer_produces_three_headers(fresh_pem: Path) -> None:
    clock = FixedClock(datetime(2026, 4, 24, 12, 0, 0, tzinfo=UTC))
    signer = KalshiSigner(api_key="ak-test", private_key=load_private_key_from_pem(fresh_pem), clock=clock)
    headers = signer.sign("GET", "/portfolio/balance")
    assert isinstance(headers, SigningHeaders)
    assert headers.access_key == "ak-test"
    assert headers.timestamp_ms == "1745496000000"   # 2026-04-24 12:00 UTC in ms
    assert isinstance(headers.signature, str)
    assert len(headers.signature) > 0


def test_signature_uses_path_and_method(fresh_pem: Path) -> None:
    clock = FixedClock(datetime(2026, 4, 24, 12, 0, 0, tzinfo=UTC))
    signer = KalshiSigner(api_key="ak-test", private_key=load_private_key_from_pem(fresh_pem), clock=clock)
    a = signer.sign("GET", "/a")
    b = signer.sign("GET", "/b")
    assert a.signature != b.signature  # different paths → different signatures
    c = signer.sign("POST", "/a")
    assert a.signature != c.signature  # different methods → different signatures


def test_to_headers_dict_uses_kalshi_header_names(fresh_pem: Path) -> None:
    clock = FixedClock(datetime(2026, 4, 24, 12, 0, 0, tzinfo=UTC))
    signer = KalshiSigner(api_key="ak-test", private_key=load_private_key_from_pem(fresh_pem), clock=clock)
    h = signer.sign("GET", "/x").as_dict()
    assert set(h.keys()) == {"KALSHI-ACCESS-KEY", "KALSHI-ACCESS-SIGNATURE", "KALSHI-ACCESS-TIMESTAMP"}
```

- [ ] **Step 3: Verify failure**

```bash
uv run pytest tests/venues/kalshi/test_auth.py -v
```

Expected: ModuleNotFoundError on `pytheum.venues.kalshi.auth`.

- [ ] **Step 4: Implement auth**

Write `src/pytheum/venues/kalshi/auth.py`:

```python
"""Kalshi v2 RSA-PSS signing.

The signature payload is the concatenation of:
    timestamp_ms || method || path

signed with RSA-PSS using SHA-256 + MGF1, salt_length = digest length, then
base64-encoded. Public endpoints don't require any of this; only the
authenticated `/portfolio/*` family needs it. v1 wires the signer but no
user-facing command exercises it.
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
    """Load an RSA private key from a PEM file. Path must be absolute or expanduser-able."""
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
    """Stateless signer — produces fresh `SigningHeaders` per request."""

    def __init__(
        self,
        api_key: str,
        private_key: RSAPrivateKey,
        clock: Clock | None = None,
    ) -> None:
        self.api_key = api_key
        self.private_key = private_key
        self.clock = clock or SystemClock()

    def sign(self, method: str, path: str) -> SigningHeaders:
        ts_ms = str(int(self.clock.now().timestamp() * 1000))
        message = f"{ts_ms}{method.upper()}{path}".encode()
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

Expected: 5 passed.

```bash
git add src/pytheum/venues/ tests/venues/
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "venues/kalshi: scaffold + RSA-PSS signer"
```

---

## Task 3: Kalshi URL parser

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
    """A bare series ticker like 'FED' is ambiguous — could be a ticker, event, or category. Reject."""
    with pytest.raises(MalformedURL):
        parse_kalshi_ticker("FED")
```

- [ ] **Step 2: Verify failure**

```bash
uv run pytest tests/venues/kalshi/test_urls.py -v
```

Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement**

Write `src/pytheum/venues/kalshi/urls.py`:

```python
"""Parse Kalshi URLs and bare tickers into MarketRef / EventRef.

Kalshi URL convention:  /markets/{series}/{event_ticker}/{market_ticker}
                        /markets/{series}/{event_ticker}

Bare-ticker disambiguation:
    XXX-YYYYMM-TZZ           → market (3 hyphenated parts, last starts with T)
    XXX-YYYYMM               → event (2 hyphenated parts)
    XXX                      → ambiguous — refuse
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
    "kalshi.com/markets/{series}/{event}/{market}",
    "kalshi.com/markets/{series}/{event}",
    "FED-25DEC-T4.00 (bare market ticker)",
    "FED-25DEC (bare event ticker)",
]
_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9]*(-[A-Z0-9.]+)+$")


def parse_kalshi_url(url: str) -> MarketRef | EventRef:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in _HOSTS:
        raise MalformedURL(raw_input=url, supported_patterns=_SUPPORTED)
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) < 3 or parts[0] != "markets":
        raise MalformedURL(raw_input=url, supported_patterns=_SUPPORTED)
    # parts: ["markets", series, event, (market)?]
    if len(parts) == 4:
        return MarketRef(
            venue=Venue.KALSHI, ref_type=RefType.KALSHI_TICKER, value=parts[3]
        )
    if len(parts) == 3:
        return EventRef(
            venue=Venue.KALSHI, ref_type=RefType.KALSHI_EVENT_TICKER, value=parts[2]
        )
    raise MalformedURL(raw_input=url, supported_patterns=_SUPPORTED)


def parse_kalshi_ticker(s: str) -> MarketRef | EventRef:
    if not _TICKER_RE.match(s):
        raise MalformedURL(raw_input=s, supported_patterns=_SUPPORTED)
    parts = s.split("-")
    if len(parts) >= 3 and parts[-1].startswith("T"):
        return MarketRef(
            venue=Venue.KALSHI, ref_type=RefType.KALSHI_TICKER, value=s
        )
    if len(parts) == 2:
        return EventRef(
            venue=Venue.KALSHI, ref_type=RefType.KALSHI_EVENT_TICKER, value=s
        )
    raise MalformedURL(raw_input=s, supported_patterns=_SUPPORTED)
```

- [ ] **Step 4: Run + commit**

```bash
uv run pytest tests/venues/kalshi/test_urls.py -v
```

Expected: 8 passed.

```bash
git add src/pytheum/venues/kalshi/urls.py tests/venues/kalshi/test_urls.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "venues/kalshi: add URL + bare-ticker parser"
```

---

## Task 4: KalshiRest base — `_request`, error mapping, raw persistence

The base machinery — every endpoint built on top of this. No specific endpoints yet; this task only delivers the inner `_request()` method + error mapping + raw persistence.

**Files:**
- Create: `src/pytheum/venues/kalshi/rest.py` (initial skeleton)
- Create: `src/pytheum/venues/kalshi/client.py`
- Test: `tests/venues/kalshi/test_rest.py` (base machinery tests)

- [ ] **Step 1: Failing test**

Write `tests/venues/kalshi/test_rest.py`:

```python
from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest

from pytheum.core.config import KalshiConfig
from pytheum.data.errors import (
    AuthRequired,
    NoResults,
    RateLimited,
    VenueUnavailable,
)
from pytheum.data.repository import MarketRepository
from pytheum.data.storage import Storage
from pytheum.venues.kalshi.client import KalshiClient


@pytest.fixture
async def repo(tmp_path: Path) -> MarketRepository:
    storage = Storage(tmp_path / "test.duckdb")
    storage.migrate()
    return MarketRepository(storage)


def _make_client(repo: MarketRepository, transport: httpx.MockTransport) -> KalshiClient:
    return KalshiClient(
        config=KalshiConfig(rate_limit_per_sec=1000),  # don't bottleneck the test
        repository=repo,
        _transport=transport,
    )


@pytest.mark.asyncio
async def test_get_persists_raw_payload(repo: MarketRepository) -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ok": True})

    client = _make_client(repo, httpx.MockTransport(handler))
    async with client:
        body, raw_id = await client.rest._request_with_raw("GET", "/series", params=None, native_ids=[])
    assert body == {"ok": True}
    assert raw_id > 0
    with repo.storage.connect() as conn:
        rows = conn.execute(
            "SELECT venue, transport, endpoint, status_code FROM raw_payloads WHERE id=?",
            [raw_id],
        ).fetchall()
    assert rows == [("kalshi", "rest", "/series", 200)]


@pytest.mark.asyncio
async def test_429_raises_rate_limited_with_retry_after(repo: MarketRepository) -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"Retry-After": "7"}, json={"error": "throttle"})

    client = _make_client(repo, httpx.MockTransport(handler))
    async with client:
        with pytest.raises(RateLimited) as exc:
            await client.rest._request_with_raw("GET", "/series", params=None, native_ids=[])
    assert exc.value.retry_after_s == 7.0


@pytest.mark.asyncio
async def test_404_raises_no_results(repo: MarketRepository) -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "not found"})

    client = _make_client(repo, httpx.MockTransport(handler))
    async with client:
        with pytest.raises(NoResults):
            await client.rest._request_with_raw("GET", "/series/FED", params=None, native_ids=["FED"])


@pytest.mark.asyncio
async def test_401_raises_auth_required(repo: MarketRepository) -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "auth"})

    client = _make_client(repo, httpx.MockTransport(handler))
    async with client:
        with pytest.raises(AuthRequired):
            await client.rest._request_with_raw("GET", "/portfolio/x", params=None, native_ids=[])


@pytest.mark.asyncio
async def test_500_raises_venue_unavailable(repo: MarketRepository) -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    client = _make_client(repo, httpx.MockTransport(handler))
    async with client:
        with pytest.raises(VenueUnavailable) as exc:
            await client.rest._request_with_raw("GET", "/series", params=None, native_ids=[])
    assert exc.value.status_code == 500
```

- [ ] **Step 2: Verify failure**

```bash
uv run pytest tests/venues/kalshi/test_rest.py -v
```

Expected: ModuleNotFoundError on `pytheum.venues.kalshi.client`.

- [ ] **Step 3: Implement client + base rest**

Write `src/pytheum/venues/kalshi/rest.py`:

```python
"""KalshiRest — base request machinery.

Endpoints are added in subsequent tasks. This file owns:
    - _request_with_raw : HTTP send + raw_payloads insert + error mapping
"""
from __future__ import annotations

import json as _json
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, cast

import httpx

from pytheum.core.clock import Clock, SystemClock
from pytheum.core.rate_limit import AsyncRateLimiter
from pytheum.data.errors import (
    AuthRequired,
    NoResults,
    RateLimited,
    VenueUnavailable,
)
from pytheum.data.models import Venue
from pytheum.data.repository import MarketRepository

__all__ = ["KalshiRest"]


class KalshiRest:
    """Inner REST sub-client. Constructed by KalshiClient."""

    def __init__(
        self,
        *,
        http: httpx.AsyncClient,
        repository: MarketRepository | None,
        rate_limiter: AsyncRateLimiter,
        clock: Clock,
    ) -> None:
        self._http = http
        self._repo = repository
        self._rl = rate_limiter
        self._clock = clock

    async def _request_with_raw(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None,
        native_ids: Sequence[str],
    ) -> tuple[Any, int]:
        """Send one request, persist its raw payload, return (body, raw_id).

        raw_id is 0 when no repository is attached.
        """
        await self._rl.acquire()
        sent_at = self._clock.now()
        try:
            resp = await self._http.request(method, path, params=params)
        except httpx.HTTPError as e:
            raise VenueUnavailable(venue=Venue.KALSHI, status_code=None, cause=e) from e
        finished_at = self._clock.now()
        duration_ms = int((finished_at - sent_at).total_seconds() * 1000)

        # Always parse JSON or fall back to text.
        body: Any
        try:
            body = resp.json()
        except _json.JSONDecodeError:
            body = {"_raw_text": resp.text}

        # Persist raw FIRST — gives us a raw_id even on schema-drift / error paths.
        raw_id = 0
        if self._repo is not None:
            raw_id = self._repo.record_raw_rest(
                venue=Venue.KALSHI,
                endpoint=path,
                request_params=params,
                payload=body,
                received_ts=finished_at,
                source_ts=None,
                status_code=resp.status_code,
                duration_ms=duration_ms,
                schema_version=1,
                native_ids=native_ids,
            )

        sc = resp.status_code
        if 200 <= sc < 300:
            return body, raw_id
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

Usage:
    async with KalshiClient(config, repository=repo) as kc:
        body, raw_id = await kc.rest._request_with_raw("GET", "/series", params=None, native_ids=[])
"""
from __future__ import annotations

from types import TracebackType
from typing import Self

import httpx

from pytheum.core.clock import Clock, SystemClock
from pytheum.core.config import KalshiConfig
from pytheum.core.rate_limit import AsyncRateLimiter
from pytheum.data.repository import MarketRepository
from pytheum.venues.kalshi.rest import KalshiRest

__all__ = ["KalshiClient"]


class KalshiClient:
    def __init__(
        self,
        config: KalshiConfig,
        *,
        repository: MarketRepository | None = None,
        clock: Clock | None = None,
        _transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.config = config
        self._clock = clock or SystemClock()
        self._http = httpx.AsyncClient(
            base_url=config.base_url,
            timeout=15.0,
            headers={"Accept": "application/json"},
            transport=_transport,
        )
        self._rl = AsyncRateLimiter(
            rate_per_sec=config.rate_limit_per_sec,
            burst=int(config.rate_limit_per_sec) or 1,
            clock=self._clock,
        )
        self.rest = KalshiRest(
            http=self._http, repository=repository, rate_limiter=self._rl, clock=self._clock
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

- [ ] **Step 4: Run + commit**

```bash
uv run pytest tests/venues/kalshi/test_rest.py -v
```

Expected: 5 passed.

```bash
git add src/pytheum/venues/kalshi/rest.py \
        src/pytheum/venues/kalshi/client.py \
        tests/venues/kalshi/test_rest.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "venues/kalshi: KalshiClient + base _request_with_raw + error mapping"
```

---

## Task 5: Capture fixtures + write Kalshi normalizer skeleton

Capture real responses for every endpoint covered in §3.1, then write a normalizer module that converts raw payloads into Phase 1 pydantic models. The normalizer is built up incrementally — Tasks 6-9 add per-endpoint normalizer functions; this task only ships the file + the helper for `series → Category`.

**Files:**
- Create: `src/pytheum/venues/kalshi/normalizer.py`
- Create: `tests/fixtures/kalshi/series_list.json`
- Create: `tests/fixtures/kalshi/series_detail_FED.json`
- Create: `tests/venues/kalshi/test_normalizer.py`

- [ ] **Step 1: Capture series fixtures from the live Kalshi API**

These commands hit the public Kalshi API. The endpoint requires no auth.

```bash
cd /Users/kanagn/Desktop/pytheum-cli
mkdir -p tests/fixtures/kalshi

curl -sS 'https://api.elections.kalshi.com/trade-api/v2/series?limit=5' \
  | python -m json.tool > tests/fixtures/kalshi/series_list.json

# Pick one series the list returned and capture its detail.
SERIES_TICKER=$(python -c "
import json
d = json.load(open('tests/fixtures/kalshi/series_list.json'))
print(d.get('series', [{}])[0].get('ticker', 'KXFED'))
")
echo "captured series ticker: $SERIES_TICKER"
curl -sS "https://api.elections.kalshi.com/trade-api/v2/series/$SERIES_TICKER" \
  | python -m json.tool > tests/fixtures/kalshi/series_detail_FED.json

# Verify the file is valid JSON and non-trivial.
python -c "
import json
for p in ['tests/fixtures/kalshi/series_list.json',
          'tests/fixtures/kalshi/series_detail_FED.json']:
    d = json.load(open(p))
    print(p, 'ok', 'keys:', list(d.keys()))
"
```

Expected: prints `keys: ['series', ...]` for the list and a series detail object for the detail. If any curl returns an error or times out, **STOP** — don't fabricate fixtures; report BLOCKED with the API error.

- [ ] **Step 2: Failing normalizer test**

Write `tests/venues/kalshi/test_normalizer.py`:

```python
from __future__ import annotations

import json
from pathlib import Path

from pytheum.data.models import Category, Venue
from pytheum.venues.kalshi.normalizer import normalize_series_to_categories

FIXTURES = Path(__file__).parent.parent.parent / "fixtures" / "kalshi"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def test_series_list_normalizes_to_categories() -> None:
    payload = _load("series_list.json")
    cats = normalize_series_to_categories(payload)
    assert len(cats) > 0
    assert all(isinstance(c, Category) for c in cats)
    assert all(c.venue is Venue.KALSHI for c in cats)
    # Every category should have a non-empty native_id and label.
    for c in cats:
        assert c.native_id
        assert c.native_label


def test_series_detail_normalizes_to_single_category() -> None:
    payload = _load("series_detail_FED.json")
    cat = normalize_series_to_categories(payload)
    # Detail shape may be {"series": {...}} or direct {...}; normalizer handles both.
    assert len(cat) == 1
    assert isinstance(cat[0], Category)
```

- [ ] **Step 3: Verify failure**

```bash
uv run pytest tests/venues/kalshi/test_normalizer.py -v
```

Expected: ModuleNotFoundError.

- [ ] **Step 4: Implement normalizer skeleton**

Write `src/pytheum/venues/kalshi/normalizer.py`:

```python
"""Kalshi raw → normalized model conversions.

Each function converts a raw payload (dict from the venue API) into one or
more pydantic models from `pytheum.data.models`. Failures wrap pydantic
ValidationError in SchemaDrift with the supplied raw_id (when given).
"""
from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from pytheum.data.errors import SchemaDrift
from pytheum.data.models import Category, Venue

__all__ = ["normalize_series_to_categories"]


_SCHEMA_VERSION = 1


def _wrap_drift(
    endpoint: str, raw_id: int | None, exc: ValidationError
) -> SchemaDrift:
    return SchemaDrift(
        venue=Venue.KALSHI,
        endpoint=endpoint,
        raw_id=raw_id if raw_id is not None else 0,
        validator_errors=[str(e) for e in exc.errors()],
    )


def normalize_series_to_categories(
    payload: dict[str, Any], *, raw_id: int | None = None
) -> list[Category]:
    """Convert a /series list or /series/{ticker} detail response."""
    series_block: list[dict[str, Any]]
    if "series" in payload and isinstance(payload["series"], list):
        series_block = payload["series"]
    elif "series" in payload and isinstance(payload["series"], dict):
        series_block = [payload["series"]]
    elif "ticker" in payload:
        series_block = [payload]
    else:
        series_block = []

    out: list[Category] = []
    for s in series_block:
        try:
            cat = Category(
                venue=Venue.KALSHI,
                native_id=s["ticker"],
                native_label=s.get("category") or s.get("title") or s["ticker"],
                display_label=s.get("category") or s.get("title") or s["ticker"],
            )
        except (KeyError, ValidationError) as e:
            if isinstance(e, ValidationError):
                raise _wrap_drift("/series", raw_id, e) from e
            raise SchemaDrift(
                venue=Venue.KALSHI,
                endpoint="/series",
                raw_id=raw_id or 0,
                validator_errors=[f"missing required key: {e.args[0]!r}"],
            ) from e
        out.append(cat)
    return out
```

- [ ] **Step 5: Run + commit**

```bash
uv run pytest tests/venues/kalshi/test_normalizer.py -v
```

Expected: 2 passed.

```bash
git add src/pytheum/venues/kalshi/normalizer.py \
        tests/fixtures/kalshi/ \
        tests/venues/kalshi/test_normalizer.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "venues/kalshi: normalizer skeleton + series fixtures + categorize tests"
```

---

## Task 6: KalshiRest endpoints — series + events + markets (list + detail)

Wire the four primary list/detail endpoints. Each uses `_request_with_raw`, normalizes into models, and exposes a typed iterator/scalar method.

**Files:**
- Modify: `src/pytheum/venues/kalshi/rest.py` (append endpoint methods)
- Modify: `src/pytheum/venues/kalshi/normalizer.py` (add event + market normalizers)
- Create: `tests/fixtures/kalshi/events_list.json`
- Create: `tests/fixtures/kalshi/events_detail_FED-25DEC.json`
- Create: `tests/fixtures/kalshi/markets_list.json`
- Create: `tests/fixtures/kalshi/markets_detail_FED-25DEC-T4.00.json`
- Modify: `tests/venues/kalshi/test_rest.py` (append per-endpoint tests)
- Modify: `tests/venues/kalshi/test_normalizer.py` (append event + market normalizer tests)

- [ ] **Step 1: Capture event + market fixtures from the live API**

```bash
cd /Users/kanagn/Desktop/pytheum-cli

curl -sS 'https://api.elections.kalshi.com/trade-api/v2/events?limit=3&status=open' \
  | python -m json.tool > tests/fixtures/kalshi/events_list.json

EVENT_TICKER=$(python -c "
import json
d = json.load(open('tests/fixtures/kalshi/events_list.json'))
print(d.get('events', [{}])[0].get('event_ticker', ''))
")
echo "event ticker: $EVENT_TICKER"
test -n "$EVENT_TICKER" || { echo 'NO EVENTS RETURNED — STOP'; exit 1; }
curl -sS "https://api.elections.kalshi.com/trade-api/v2/events/$EVENT_TICKER" \
  | python -m json.tool > tests/fixtures/kalshi/events_detail_FED-25DEC.json

curl -sS 'https://api.elections.kalshi.com/trade-api/v2/markets?limit=3&status=open' \
  | python -m json.tool > tests/fixtures/kalshi/markets_list.json

MARKET_TICKER=$(python -c "
import json
d = json.load(open('tests/fixtures/kalshi/markets_list.json'))
print(d.get('markets', [{}])[0].get('ticker', ''))
")
echo "market ticker: $MARKET_TICKER"
test -n "$MARKET_TICKER" || { echo 'NO MARKETS RETURNED — STOP'; exit 1; }
curl -sS "https://api.elections.kalshi.com/trade-api/v2/markets/$MARKET_TICKER" \
  | python -m json.tool > tests/fixtures/kalshi/markets_detail_FED-25DEC-T4.00.json
```

If any captured file is missing the expected top-level key, **STOP** — the API shape may have drifted from §3.1 and the spec needs updating before normalization is added.

- [ ] **Step 2: Write failing tests**

For each new endpoint, add a test in `tests/venues/kalshi/test_rest.py` that uses `httpx.MockTransport` to return the fixture and asserts the parsed object. For brevity, here is the pattern for one (events list); apply analogously for series/events/markets.

Append to `tests/venues/kalshi/test_rest.py`:

```python
import json as _json
from pathlib import Path

FIXTURES = Path(__file__).parent.parent.parent / "fixtures" / "kalshi"


def _fixture(name: str) -> dict:
    return _json.loads((FIXTURES / name).read_text())


@pytest.mark.asyncio
async def test_get_events_returns_iterator_of_events(repo: MarketRepository) -> None:
    payload = _fixture("events_list.json")

    def handler(req: httpx.Request) -> httpx.Response:
        assert req.url.path.endswith("/events")
        return httpx.Response(200, json=payload)

    client = _make_client(repo, httpx.MockTransport(handler))
    async with client:
        events = [e async for e in client.rest.get_events(status="open", limit=3)]
    assert len(events) > 0
    assert all(e.venue.value == "kalshi" for e in events)
    # Raw payload was persisted.
    with repo.storage.connect() as conn:
        c = conn.execute(
            "SELECT COUNT(*) FROM raw_payloads WHERE endpoint='/events'"
        ).fetchone()
    assert c is not None and c[0] >= 1


@pytest.mark.asyncio
async def test_get_event_detail_returns_event_with_markets(
    repo: MarketRepository,
) -> None:
    payload = _fixture("events_detail_FED-25DEC.json")

    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    client = _make_client(repo, httpx.MockTransport(handler))
    async with client:
        ev, markets = await client.rest.get_event("FED-25DEC")
    # markets may be empty on some events — assert structure, not contents.
    assert ev.venue.value == "kalshi"
    assert ev.native_id == payload.get("event", payload).get("event_ticker") or ev.native_id


# ... analogous tests for get_series, get_markets, get_market ...
```

Add the analogous tests for `get_series`, `get_series_list`, `get_markets`, `get_market`. Each should:
1. Load its fixture.
2. Mock the transport with the fixture.
3. Call the new method.
4. Assert the result is the right pydantic model with non-empty fields.
5. Assert a `raw_payloads` row was written.

- [ ] **Step 3: Verify failures**

```bash
uv run pytest tests/venues/kalshi/test_rest.py -v
```

Expected: AttributeError on `client.rest.get_events` etc.

- [ ] **Step 4: Implement normalizer + endpoints**

Append normalizer functions to `src/pytheum/venues/kalshi/normalizer.py`:

```python
from datetime import datetime
from decimal import Decimal

from pytheum.data.models import (
    Event,
    Market,
    Outcome,
    PriceUnit,
    SizeUnit,
    VolumeMetric,
)


def _to_dt(s: Any) -> datetime | None:
    if not s:
        return None
    if isinstance(s, datetime):
        return s
    return datetime.fromisoformat(str(s).replace("Z", "+00:00"))


def normalize_event(payload: dict[str, Any], *, raw_id: int | None = None) -> Event:
    block = payload.get("event", payload)
    try:
        return Event(
            venue=Venue.KALSHI,
            native_id=block["event_ticker"],
            title=block.get("title", block["event_ticker"]),
            primary_category=None,    # set by repository wiring once series is fetched
            tags=[],
            closes_at=_to_dt(block.get("close_time") or block.get("expected_expiration_time")),
            market_count=len(block.get("markets") or []),
            aggregate_volume=None,
            volume_metric=VolumeMetric.UNKNOWN,
            url=None,
            raw_id=raw_id,
            schema_version=_SCHEMA_VERSION,
        )
    except (KeyError, ValidationError) as e:
        if isinstance(e, ValidationError):
            raise _wrap_drift("/events", raw_id, e) from e
        raise SchemaDrift(
            venue=Venue.KALSHI, endpoint="/events", raw_id=raw_id or 0,
            validator_errors=[f"missing key: {e.args[0]!r}"],
        ) from e


def normalize_market(payload: dict[str, Any], *, raw_id: int | None = None) -> Market:
    block = payload.get("market", payload)
    try:
        ticker = block["ticker"]
        yes_price = block.get("yes_price")
        no_price = block.get("no_price")
        outcomes = []
        if yes_price is not None or no_price is not None:
            outcomes.append(Outcome(
                venue=Venue.KALSHI,
                market_native_id=ticker,
                outcome_id="yes",
                token_id=None,
                label="YES",
                price=Decimal(str(yes_price)) / Decimal("100") if yes_price is not None else None,
                native_price=Decimal(str(yes_price)) if yes_price is not None else None,
                price_unit=PriceUnit.CENTS_100,
                volume=None,
                volume_metric=VolumeMetric.UNKNOWN,
                raw_id=raw_id,
                schema_version=_SCHEMA_VERSION,
            ))
            outcomes.append(Outcome(
                venue=Venue.KALSHI,
                market_native_id=ticker,
                outcome_id="no",
                token_id=None,
                label="NO",
                price=Decimal(str(no_price)) / Decimal("100") if no_price is not None else None,
                native_price=Decimal(str(no_price)) if no_price is not None else None,
                price_unit=PriceUnit.CENTS_100,
                volume=None,
                volume_metric=VolumeMetric.UNKNOWN,
                raw_id=raw_id,
                schema_version=_SCHEMA_VERSION,
            ))
        return Market(
            venue=Venue.KALSHI,
            native_id=ticker,
            event_native_id=block.get("event_ticker"),
            title=block.get("title", ticker),
            question=block.get("subtitle") or block.get("title") or ticker,
            status=block.get("status", "open"),
            outcomes=outcomes,
            total_volume=Decimal(str(block["volume"])) if block.get("volume") is not None else None,
            volume_metric=VolumeMetric.CONTRACTS_TOTAL,
            open_interest=Decimal(str(block["open_interest"])) if block.get("open_interest") is not None else None,
            liquidity=None,
            closes_at=_to_dt(block.get("close_time") or block.get("expected_expiration_time")),
            url=None,
            raw_id=raw_id,
            schema_version=_SCHEMA_VERSION,
        )
    except (KeyError, ValidationError) as e:
        if isinstance(e, ValidationError):
            raise _wrap_drift("/markets", raw_id, e) from e
        raise SchemaDrift(
            venue=Venue.KALSHI, endpoint="/markets", raw_id=raw_id or 0,
            validator_errors=[f"missing key: {e.args[0]!r}"],
        ) from e
```

Append `__all__` extension:

```python
__all__ += ["normalize_event", "normalize_market"]
```

Append endpoint methods to `src/pytheum/venues/kalshi/rest.py`:

```python
from collections.abc import AsyncIterator

from pytheum.core.pagination import cursor_paginated
from pytheum.data.models import Category, Event, Market
from pytheum.venues.kalshi.normalizer import (
    normalize_event,
    normalize_market,
    normalize_series_to_categories,
)


class KalshiRest:
    # ... existing __init__ + _request_with_raw ...

    async def get_series_list(self, *, max_pages: int | None = None) -> AsyncIterator[Category]:
        async def fetch(cursor: str | None) -> tuple[list[Category], str | None]:
            params: dict[str, Any] = {"limit": 1000}
            if cursor:
                params["cursor"] = cursor
            body, raw_id = await self._request_with_raw(
                "GET", "/series", params=params, native_ids=[]
            )
            cats = normalize_series_to_categories(body, raw_id=raw_id)
            return cats, body.get("cursor") or None
        async for c in cursor_paginated(fetch, max_pages=max_pages):
            yield c

    async def get_series(self, ticker: str) -> Category:
        body, raw_id = await self._request_with_raw(
            "GET", f"/series/{ticker}", params=None, native_ids=[ticker]
        )
        return normalize_series_to_categories(body, raw_id=raw_id)[0]

    async def get_events(
        self,
        *,
        series_ticker: str | None = None,
        status: str | None = None,
        limit: int | None = None,
        max_pages: int | None = None,
    ) -> AsyncIterator[Event]:
        async def fetch(cursor: str | None) -> tuple[list[Event], str | None]:
            params: dict[str, Any] = {}
            if series_ticker:
                params["series_ticker"] = series_ticker
            if status:
                params["status"] = status
            params["limit"] = limit or 1000
            if cursor:
                params["cursor"] = cursor
            body, raw_id = await self._request_with_raw(
                "GET", "/events", params=params, native_ids=[]
            )
            events_block = body.get("events") or []
            evs = [normalize_event(e, raw_id=raw_id) for e in events_block]
            return evs, body.get("cursor") or None
        async for e in cursor_paginated(fetch, max_pages=max_pages):
            yield e

    async def get_event(self, event_ticker: str) -> tuple[Event, list[Market]]:
        body, raw_id = await self._request_with_raw(
            "GET", f"/events/{event_ticker}", params=None, native_ids=[event_ticker]
        )
        block = body.get("event", body)
        ev = normalize_event(block, raw_id=raw_id)
        markets = [
            normalize_market(m, raw_id=raw_id) for m in (block.get("markets") or [])
        ]
        return ev, markets

    async def get_markets(
        self,
        *,
        event_ticker: str | None = None,
        series_ticker: str | None = None,
        status: str | None = None,
        limit: int | None = None,
        max_pages: int | None = None,
    ) -> AsyncIterator[Market]:
        async def fetch(cursor: str | None) -> tuple[list[Market], str | None]:
            params: dict[str, Any] = {}
            if event_ticker:
                params["event_ticker"] = event_ticker
            if series_ticker:
                params["series_ticker"] = series_ticker
            if status:
                params["status"] = status
            params["limit"] = limit or 1000
            if cursor:
                params["cursor"] = cursor
            body, raw_id = await self._request_with_raw(
                "GET", "/markets", params=params, native_ids=[]
            )
            block = body.get("markets") or []
            mks = [normalize_market(m, raw_id=raw_id) for m in block]
            return mks, body.get("cursor") or None
        async for m in cursor_paginated(fetch, max_pages=max_pages):
            yield m

    async def get_market(self, ticker: str) -> Market:
        body, raw_id = await self._request_with_raw(
            "GET", f"/markets/{ticker}", params=None, native_ids=[ticker]
        )
        return normalize_market(body, raw_id=raw_id)
```

- [ ] **Step 5: Run all tests + commit**

```bash
uv run pytest tests/venues/kalshi/ -v
```

Expected: 5 base + 8 url + 2 normalizer + new endpoint tests = ~20+ pass.

```bash
git add src/pytheum/venues/kalshi/ tests/venues/kalshi/ tests/fixtures/kalshi/
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "venues/kalshi: series + events + markets endpoints with cursor pagination"
```

---

## Task 7: Orderbook + candlesticks endpoints

**Files:**
- Modify: `src/pytheum/venues/kalshi/rest.py` (append `get_orderbook`, `get_candlesticks`, `get_historical_candlesticks`)
- Modify: `src/pytheum/venues/kalshi/normalizer.py` (`normalize_orderbook`, `normalize_candlesticks` → `list[PricePoint]`)
- Create: `tests/fixtures/kalshi/orderbook_FED-25DEC-T4.00.json`
- Create: `tests/fixtures/kalshi/candlesticks_FED-25DEC-T4.00.json`
- Modify: `tests/venues/kalshi/test_rest.py` (append tests)
- Modify: `tests/venues/kalshi/test_normalizer.py` (append normalizer tests)

The structure mirrors Task 6: capture fixtures, write failing tests, implement normalizers + endpoints, commit. The detailed code is omitted here for brevity but follows the same patterns:

- `get_orderbook(ticker, depth=None) -> OrderBook` — Kalshi returns separate `yes_dollars` / `no_dollars` arrays of `[price, size]` pairs. Normalizer produces TWO `OrderBook` objects (one per outcome) and the method returns them as a tuple `(yes_book, no_book)`. Update tests accordingly.
- `get_candlesticks(ticker, interval, start_ts, end_ts) -> list[PricePoint]` — interval values from §3.1 (1min, 1hr, 1day). Map to the spec's `1m / 1h / 1d`.
- `get_historical_candlesticks(...)` — same shape, different endpoint.
- `get_historical_cutoff() -> datetime | None` — single GET, parse the timestamp.

- [ ] **Step 1: Capture fixtures**
- [ ] **Step 2: Write failing tests**
- [ ] **Step 3: Verify failure**
- [ ] **Step 4: Implement**
- [ ] **Step 5: Run tests; commit**

Commit message: `"venues/kalshi: orderbook + candlesticks + historical-cutoff endpoints"`.

---

## Task 8: Trades endpoints (live + historical)

**Files:**
- Modify: `src/pytheum/venues/kalshi/rest.py` (append `iter_trades`, `iter_historical_trades`)
- Modify: `src/pytheum/venues/kalshi/normalizer.py` (`normalize_trade`)
- Create: `tests/fixtures/kalshi/trades_live.json`
- Create: `tests/fixtures/kalshi/historical_trades.json`
- Modify: `tests/venues/kalshi/test_rest.py` and `test_normalizer.py`

- [ ] **Step 1: Capture fixtures**

```bash
curl -sS "https://api.elections.kalshi.com/trade-api/v2/markets/trades?ticker=$MARKET_TICKER&limit=10" \
  | python -m json.tool > tests/fixtures/kalshi/trades_live.json

curl -sS "https://api.elections.kalshi.com/trade-api/v2/historical/trades?ticker=$MARKET_TICKER&limit=10" \
  | python -m json.tool > tests/fixtures/kalshi/historical_trades.json
```

- [ ] **Step 2-5: Same TDD pattern**

Trade normalizer maps:
- `price` (cents 0–100) → `native_price`; `price / 100` → normalized `price ∈ [0,1]`
- `count` → `native_size` and `size`; `size_unit = SizeUnit.CONTRACTS`
- `taker_side` → `outcome_id` ("yes" / "no")
- `created_time` ISO → `timestamp`
- `currency = "usd"`
- `notional = price * size` (in dollars)
- `side` field from Kalshi → "buy" / "sell" mapping

Iterator method `iter_trades(ticker, since=None, until=None, max_pages=None) -> AsyncIterator[Trade]` uses `cursor_paginated`. `iter_historical_trades` is identical against `/historical/trades`.

Commit message: `"venues/kalshi: live + historical trades iterators"`.

---

## Task 9: End-to-end integration test (`pytheum fetch market`)

Wire a CLI command that proves the entire stack works end-to-end against a real Kalshi response.

**Files:**
- Create: `src/pytheum/cli/fetch.py`
- Modify: `src/pytheum/cli/__init__.py` (register `fetch` subcommand group)
- Create: `tests/cli/test_fetch.py`
- Create: `tests/venues/kalshi/test_client_integration.py`

The CLI command:

```bash
pytheum fetch market <kalshi-ticker>
```

Behavior:
1. Parse the ticker via `parse_kalshi_ticker`.
2. Construct `KalshiClient` with the configured base URL + a `MarketRepository` over `~/.pytheum/pytheum.duckdb`.
3. Call `client.rest.get_market(ticker)`.
4. Repository upserts: market + outcomes + (if event_ticker present) event.
5. Print a Rich table summarizing what was written.

The integration test goes against a live API once and asserts:
- `~/.pytheum/pytheum.duckdb` has rows for the fetched market.
- `raw_payloads` has matching rows tied via `raw_id`.
- The fetched market's `outcomes` list has length 2.

Mark this test with `@pytest.mark.live_api` and `@pytest.mark.skipif(not os.environ.get("PYTHEUM_LIVE_TESTS"), reason="set PYTHEUM_LIVE_TESTS=1 to run live API tests")`. Add to `pyproject.toml`:

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
pythonpath = ["src"]
markers = [
    "live_api: hits a real venue API; opt in via PYTHEUM_LIVE_TESTS=1",
]
```

- [ ] **Step 1-5: Same TDD pattern**

Manual smoke at the end:

```bash
uv run pytheum fetch market FED-25DEC-T4.00
# (or whatever live ticker exists)
```

Commit message: `"cli: pytheum fetch market — end-to-end Kalshi integration"`.

---

## Task 10: Final Phase 2A verification + tag

- [ ] **Step 1: Full suite**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv run pytest -v
```

Expected: all 130 Phase 1 tests + new venues/kalshi + repository tests pass. Approximately 175–200 tests total.

- [ ] **Step 2: Static checks**

```bash
uv run mypy src/pytheum
uv run ruff check src tests
uv run ruff format --check src tests
```

All must be green. If `ruff format --check` fails, run `uv run ruff format src tests` and commit.

- [ ] **Step 3: Live smoke**

```bash
PYTHEUM_LIVE_TESTS=1 uv run pytest tests/venues/kalshi/test_client_integration.py -v
```

Expected: live API hit succeeds; data lands in `~/.pytheum/pytheum.duckdb`.

- [ ] **Step 4: Run `pytheum doctor`**

```bash
uv run pytheum doctor
```

Confirm all checks still report `[OK]`.

- [ ] **Step 5: Tag**

```bash
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    tag -a phase-2a-kalshi-rest -m "Phase 2A — Kalshi REST complete

Full coverage of spec §3.1 endpoints: series, events, markets,
orderbook, trades (live + historical), candlesticks, historical
cutoff. Async via httpx with cursor pagination. Raw-first
persistence into raw_payloads + outcome-aware normalization to
Phase 1 models. URL/ticker parser. Per-endpoint fixtures
captured live. WS client follows in Plan 2B."
```

---

## Phase 2A Definition of Done

- [ ] All Kalshi public REST endpoints from spec §3.1 are implemented as methods on `KalshiClient.rest`
- [ ] Each endpoint persists its raw response into `raw_payloads` and writes a normalized row through `MarketRepository`
- [ ] `pytheum fetch market <ticker>` works end-to-end against a real ticker
- [ ] Per-endpoint fixtures captured from the live API are committed under `tests/fixtures/kalshi/`
- [ ] Per-endpoint mocked-transport tests pass without touching the network
- [ ] One opt-in (`PYTHEUM_LIVE_TESTS=1`) integration test hits the real API and verifies the data flow
- [ ] `SchemaDrift` is raised with the original `raw_id` when a payload doesn't match the expected shape
- [ ] HTTP error mapping is uniform: 401/403 → `AuthRequired`, 404 → `NoResults`, 429 → `RateLimited`, 5xx → `VenueUnavailable`
- [ ] RSA-PSS signing is implemented + unit-tested but no v1 user-facing command requires it
- [ ] `uv run pytest`, `uv run mypy src/pytheum`, `uv run ruff check src tests`, `uv run ruff format --check src tests` all green
- [ ] Tag `phase-2a-kalshi-rest` placed at HEAD; `phase-1-foundation` and `phase-1-hardened` left intact
- [ ] Next: Plan 2B (Kalshi WS) or Plan 2C (Polymarket REST)
