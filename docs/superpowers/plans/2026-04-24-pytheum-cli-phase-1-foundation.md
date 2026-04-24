# Pytheum CLI — Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `pytheum-cli` repo and ship the entire foundation layer — repo scaffold, core async primitives, DuckDB schema with a passing execution test, pydantic models, and a partial `pytheum doctor` command. Zero venue client code; zero TUI. This phase ships as a working CLI skeleton that `pytheum doctor` executes end-to-end.

**Architecture:** Five-layer design per the spec (`docs/superpowers/specs/2026-04-24-pytheum-cli-design.md` in the `landing_promodemo` repo). This plan implements **only the bottom two layers** — Core Primitives and the Normalized Data types/storage — plus the repo scaffold and a partial CLI entrypoint. Venue clients (Phase 2), App Services (Phase 3), and TUI (Phase 4) are separate plans.

**Tech Stack:** Python ≥ 3.12, uv for environments, pydantic v2, structlog, duckdb, httpx (installed but unused in Phase 1), rapidfuzz (installed but unused), typer, rich, ruff + mypy strict + pytest + pytest-asyncio + hypothesis.

**Spec source of truth:** `/Users/kanagn/Desktop/landing_promodemo/docs/superpowers/specs/2026-04-24-pytheum-cli-design.md`. Keep it open while working.

**Target repo (new):** `/Users/kanagn/Desktop/pytheum-cli/`. Every Bash command below assumes the working directory is this new repo unless otherwise stated.

**Git authorship:** all commits in the new repo are authored as `Konstantinos Anagnostopoulos <147280494+konstantinosanagn@users.noreply.github.com>`. Use `git -c user.name=… -c user.email=… commit` (do NOT modify global git config).

---

## File map for Phase 1

Everything this plan creates:

```
pytheum-cli/
├── .gitignore
├── .env.example
├── README.md
├── CLAUDE.md
├── LICENSE
├── pyproject.toml
├── uv.lock                                    (created by uv)
├── docs/
│   └── specs/
│       └── 2026-04-24-pytheum-cli-design.md   (copied from landing_promodemo)
├── src/
│   └── pytheum/
│       ├── __init__.py
│       ├── __main__.py
│       ├── core/
│       │   ├── __init__.py
│       │   ├── clock.py
│       │   ├── config.py
│       │   ├── logging.py
│       │   ├── rate_limit.py
│       │   ├── retry.py
│       │   ├── circuit_breaker.py
│       │   └── pagination.py
│       ├── data/
│       │   ├── __init__.py
│       │   ├── errors.py
│       │   ├── freshness.py
│       │   ├── models.py
│       │   ├── refs.py
│       │   ├── storage.py
│       │   └── schema/
│       │       ├── __init__.py
│       │       ├── 001_raw_payloads.sql
│       │       ├── 002_categories_events.sql
│       │       ├── 003_markets_outcomes.sql
│       │       ├── 004_trades_orderbook_prices.sql
│       │       ├── 005_aliases_tags.sql
│       │       └── 006_searchable_markets_view.sql
│       └── cli/
│           ├── __init__.py
│           └── doctor.py
└── tests/
    ├── __init__.py
    ├── core/
    │   ├── __init__.py
    │   ├── test_clock.py
    │   ├── test_config.py
    │   ├── test_logging.py
    │   ├── test_rate_limit.py
    │   ├── test_retry.py
    │   ├── test_circuit_breaker.py
    │   └── test_pagination.py
    ├── data/
    │   ├── __init__.py
    │   ├── test_models.py
    │   ├── test_refs.py
    │   ├── test_freshness.py
    │   ├── test_errors.py
    │   └── test_storage.py
    └── cli/
        ├── __init__.py
        └── test_doctor.py
```

---

## Task 1: Create repo + initial scaffold

**Files:**
- Create: `/Users/kanagn/Desktop/pytheum-cli/` (directory)
- Create: `pytheum-cli/.gitignore`
- Create: `pytheum-cli/README.md`
- Create: `pytheum-cli/LICENSE`
- Create: `pytheum-cli/pyproject.toml`

- [ ] **Step 1: Create repo directory and initialize git**

```bash
mkdir -p /Users/kanagn/Desktop/pytheum-cli
cd /Users/kanagn/Desktop/pytheum-cli
git init -b main
```

Expected: `Initialized empty Git repository in …`

- [ ] **Step 2: Create `.gitignore`**

Write `/Users/kanagn/Desktop/pytheum-cli/.gitignore`:

```
# Python
__pycache__/
*.py[cod]
*$py.class
*.egg-info/
.pytest_cache/
.mypy_cache/
.ruff_cache/
.coverage
htmlcov/
dist/
build/

# uv
.venv/

# OS
.DS_Store

# IDE
.vscode/
.idea/

# Env + secrets
.env
.env.*
!.env.example

# Pytheum local artefacts ever created inside the repo
# (the real store lives at ~/.pytheum/, outside the repo; these patterns only
#  protect against stray local files during tests / manual experiments)
*.duckdb
*.duckdb.wal
```

- [ ] **Step 3: Create `LICENSE` (MIT)**

Write `/Users/kanagn/Desktop/pytheum-cli/LICENSE`:

```
MIT License

Copyright (c) 2026 Konstantinos Anagnostopoulos

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Create `README.md` stub**

Write `/Users/kanagn/Desktop/pytheum-cli/README.md`:

````markdown
# Pytheum CLI

A keyboard-driven TUI + scriptable CLI for Kalshi and Polymarket prediction markets. REST + WebSockets, DuckDB-backed local storage, venue-native navigation.

**Status:** Phase 1 (foundation). Venue clients + TUI not yet shipped. See `docs/specs/2026-04-24-pytheum-cli-design.md` for the full design.

## Install (development)

```bash
git clone <repo>
cd pytheum-cli
uv sync
```

## Run

```bash
uv run pytheum doctor
```

## License

MIT
````

- [ ] **Step 5: Create `pyproject.toml`**

Write `/Users/kanagn/Desktop/pytheum-cli/pyproject.toml`:

```toml
[project]
name = "pytheum"
version = "0.1.0"
description = "Kalshi + Polymarket prediction market data CLI / TUI"
readme = "README.md"
license = { text = "MIT" }
requires-python = ">=3.12"
authors = [{ name = "Konstantinos Anagnostopoulos" }]
dependencies = [
    "httpx>=0.27",
    "websockets>=13",
    "pydantic>=2.7",
    "duckdb>=0.10",
    "pyarrow>=16",
    "rapidfuzz>=3",
    "typer>=0.12",
    "rich>=13",
    "textual>=0.60",
    "structlog>=24",
    "cryptography>=42",
    "tomli-w>=1.0",
    "keyring>=25",
]

[project.scripts]
pytheum = "pytheum.cli:app"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/pytheum"]

[dependency-groups]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
    "pytest-httpx>=0.30",
    "pytest-recording>=0.13",
    "hypothesis>=6",
    "ruff>=0.4",
    "mypy>=1.10",
]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "N", "SIM", "RUF"]
ignore = ["E501"]    # line-length handled by formatter

[tool.ruff.format]
quote-style = "double"

[tool.mypy]
python_version = "3.12"
strict = true
files = ["src/pytheum"]

# Third-party libraries that ship incomplete or no type stubs. Restricted per
# module so strict typing still applies to our own code. Revisit each time
# these deps are upgraded — several of them gain stubs over time.
[[tool.mypy.overrides]]
module = [
    "duckdb",
    "duckdb.*",
    "keyring",
    "keyring.*",
    "structlog",
    "structlog.*",
    "rapidfuzz",
    "rapidfuzz.*",
]
ignore_missing_imports = true

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
pythonpath = ["src"]
```

- [ ] **Step 6: Verify uv can bootstrap the project**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv sync
```

Expected: creates `.venv/` and `uv.lock`; no errors. If `uv` is missing, run `curl -LsSf https://astral.sh/uv/install.sh | sh` first.

- [ ] **Step 7: Commit**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
git add .gitignore README.md LICENSE pyproject.toml uv.lock
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "scaffold: initial pyproject + gitignore + readme + license"
```

---

## Task 2: Package skeleton + spec copy

**Files:**
- Create: `pytheum-cli/src/pytheum/__init__.py`
- Create: `pytheum-cli/src/pytheum/__main__.py`
- Create: `pytheum-cli/src/pytheum/core/__init__.py`
- Create: `pytheum-cli/src/pytheum/data/__init__.py`
- Create: `pytheum-cli/src/pytheum/cli/__init__.py`
- Create: `pytheum-cli/tests/__init__.py`
- Create: `pytheum-cli/tests/core/__init__.py`
- Create: `pytheum-cli/tests/data/__init__.py`
- Create: `pytheum-cli/tests/cli/__init__.py`
- Create: `pytheum-cli/docs/specs/2026-04-24-pytheum-cli-design.md`
- Create: `pytheum-cli/CLAUDE.md`

- [ ] **Step 1: Create the src + tests directory structure**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
mkdir -p src/pytheum/core src/pytheum/data/schema src/pytheum/cli
mkdir -p tests/core tests/data tests/cli
mkdir -p docs/specs
```

- [ ] **Step 2: Write package `__init__.py` files**

Write `src/pytheum/__init__.py`:

```python
"""Pytheum — Kalshi + Polymarket prediction market CLI/TUI."""
from __future__ import annotations

__version__ = "0.1.0"
```

Write `src/pytheum/core/__init__.py`:

```python
"""Core primitives shared across venue clients and services."""
```

Write `src/pytheum/data/__init__.py`:

```python
"""Normalized data models, storage, and repository."""
```

Write `src/pytheum/data/schema/__init__.py`:

```python
"""SQL migration files loaded via importlib.resources."""
```

Write `src/pytheum/cli/__init__.py`:

```python
"""Typer CLI app — one-shot commands and the TUI launcher."""
from __future__ import annotations

import typer

app = typer.Typer(
    name="pytheum",
    help="Pytheum — Kalshi + Polymarket CLI / TUI",
    no_args_is_help=False,
    add_completion=False,
)
```

Write `src/pytheum/__main__.py`:

```python
"""Entry point for `python -m pytheum`."""
from __future__ import annotations

from pytheum.cli import app


def main() -> None:
    app()


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Write test package `__init__.py` files**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
touch tests/__init__.py tests/core/__init__.py tests/data/__init__.py tests/cli/__init__.py
```

- [ ] **Step 4: Copy the design spec**

```bash
cp /Users/kanagn/Desktop/landing_promodemo/docs/superpowers/specs/2026-04-24-pytheum-cli-design.md \
   /Users/kanagn/Desktop/pytheum-cli/docs/specs/2026-04-24-pytheum-cli-design.md
```

- [ ] **Step 5: Write `CLAUDE.md`**

Write `pytheum-cli/CLAUDE.md`:

```markdown
# Pytheum CLI

Keyboard-driven TUI + scriptable CLI for Kalshi + Polymarket prediction markets. Async-first (httpx + websockets + asyncio), DuckDB-backed local storage, venue-native navigation.

## Running locally

```bash
uv sync
uv run pytheum doctor     # health checks
uv run pytheum --help
```

## Architecture

Five layers, strict top-down deps (see `docs/specs/2026-04-24-pytheum-cli-design.md`):

1. **Core primitives** (`core/`) — config, clock, logging, rate_limit, retry, circuit_breaker, pagination
2. **Venue clients** (`venues/`) — Kalshi, Polymarket; `.rest` + `.ws` per venue (Phase 2)
3. **Normalized data** (`data/`) — DuckDB storage, pydantic models, repository
4. **App services** (`services/`) — Browse, Search, MarketSession, Watchlist, RefResolver, Export (Phase 3)
5. **Interfaces** (`cli/` + `tui/`) — siblings, both call services

## Key conventions

- **Raw-first storage**: every venue-derived normalized row is backed by a row in `raw_payloads` (single table, `transport` column distinguishes REST vs WS).
- **Outcomes first-class**: orderbooks, trades, and price points attach to `(venue, market_native_id, outcome_id)`, not just `market_native_id`.
- **Normalized price is `probability_1_0`** in `[0.0, 1.0]`; `native_price` + `price_unit` preserve venue values.
- **Text labels for state**, not color: `LIVE`, `STALE`, `RECONNECTING`, `FAILED`. Color is optional decoration.
- **One CLI flag per ref** via `MarketRef` — any command taking a market accepts ticker, conditionId, token_id, slug, or URL and auto-detects.

## Local paths

- `~/.pytheum/config.toml`
- `~/.pytheum/pytheum.duckdb`
- `~/.pytheum/watchlist.toml`
- `~/.pytheum/logs/`
- `~/.pytheum/exports/`
```

- [ ] **Step 6: Verify `python -m pytheum` works**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv run python -m pytheum --help
```

Expected: Typer's default help screen showing `Usage: pytheum [OPTIONS] COMMAND [ARGS]...`

- [ ] **Step 7: Commit**

```bash
git add src/ tests/ docs/ CLAUDE.md
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "scaffold: package skeleton + spec copy + CLAUDE.md"
```

---

## Task 3: Clock primitive

**Files:**
- Create: `src/pytheum/core/clock.py`
- Test: `tests/core/test_clock.py`

- [ ] **Step 1: Write the failing test**

Write `tests/core/test_clock.py`:

```python
from __future__ import annotations

from datetime import UTC, datetime

from pytheum.core.clock import Clock, FixedClock, SystemClock


def test_system_clock_returns_aware_datetime() -> None:
    clock = SystemClock()
    now = clock.now()
    assert isinstance(now, datetime)
    assert now.tzinfo is not None


def test_fixed_clock_returns_the_configured_instant() -> None:
    frozen = datetime(2026, 4, 24, 12, 0, 0, tzinfo=UTC)
    clock = FixedClock(frozen)
    assert clock.now() == frozen
    assert clock.now() == frozen


def test_fixed_clock_can_advance() -> None:
    frozen = datetime(2026, 4, 24, 12, 0, 0, tzinfo=UTC)
    clock = FixedClock(frozen)
    clock.advance_seconds(30)
    assert clock.now() == datetime(2026, 4, 24, 12, 0, 30, tzinfo=UTC)


def test_clock_is_a_protocol() -> None:
    # Both concrete classes must satisfy the Clock protocol structurally.
    def takes_clock(c: Clock) -> datetime:
        return c.now()

    assert takes_clock(SystemClock()) is not None
    assert takes_clock(FixedClock(datetime(2026, 1, 1, tzinfo=UTC))) is not None
```

- [ ] **Step 2: Run test, verify it fails**

```bash
uv run pytest tests/core/test_clock.py -v
```

Expected: `ModuleNotFoundError: No module named 'pytheum.core.clock'`

- [ ] **Step 3: Implement clock**

Write `src/pytheum/core/clock.py`:

```python
"""Injectable time source. Production uses SystemClock; tests use FixedClock."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Protocol, runtime_checkable


@runtime_checkable
class Clock(Protocol):
    """Read-only view of 'now' as an aware UTC datetime."""

    def now(self) -> datetime: ...


class SystemClock:
    """Wall-clock time. Always UTC, always aware."""

    def now(self) -> datetime:
        return datetime.now(tz=UTC)


@dataclass
class FixedClock:
    """Time source for tests. `advance_seconds` moves the clock forward."""

    _instant: datetime = field(default_factory=lambda: datetime(2026, 1, 1, tzinfo=UTC))

    def now(self) -> datetime:
        return self._instant

    def advance_seconds(self, seconds: float) -> None:
        self._instant = self._instant + timedelta(seconds=seconds)

    def set(self, instant: datetime) -> None:
        if instant.tzinfo is None:
            raise ValueError("FixedClock requires a tz-aware datetime")
        self._instant = instant
```

- [ ] **Step 4: Run test, verify it passes**

```bash
uv run pytest tests/core/test_clock.py -v
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pytheum/core/clock.py tests/core/test_clock.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "core: add Clock protocol with SystemClock + FixedClock"
```

---

## Task 4: Config loader (TOML + env overrides)

**Files:**
- Create: `src/pytheum/core/config.py`
- Test: `tests/core/test_config.py`

- [ ] **Step 1: Write the failing test**

Write `tests/core/test_config.py`:

```python
from __future__ import annotations

from pathlib import Path

import pytest

from pytheum.core.config import Config, ConfigError, load_config


def test_load_defaults_when_no_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    cfg = load_config(config_path=None)
    assert cfg.venues.kalshi.base_url == "https://api.elections.kalshi.com/trade-api/v2"
    assert cfg.venues.polymarket.gamma_url == "https://gamma-api.polymarket.com"
    assert cfg.venues.kalshi.rate_limit_per_sec == 10
    assert cfg.storage.duckdb_path == tmp_path / ".pytheum" / "pytheum.duckdb"


def test_load_from_toml(tmp_path: Path) -> None:
    cfg_path = tmp_path / "config.toml"
    cfg_path.write_text(
        """
[venues.kalshi]
rate_limit_per_sec = 5

[tui]
theme = "high-contrast"
"""
    )
    cfg = load_config(config_path=cfg_path)
    assert cfg.venues.kalshi.rate_limit_per_sec == 5
    assert cfg.tui.theme == "high-contrast"
    # unspecified fields use defaults
    assert cfg.venues.kalshi.base_url == "https://api.elections.kalshi.com/trade-api/v2"


def test_env_overrides_non_secret_fields(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PYTHEUM_VENUES__KALSHI__RATE_LIMIT_PER_SEC", "3")
    cfg = load_config(config_path=None, env_prefix="PYTHEUM_")
    assert cfg.venues.kalshi.rate_limit_per_sec == 3


def test_env_cannot_inject_secrets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # api_key itself has no env slot — only api_key_env_var does.
    monkeypatch.setenv("PYTHEUM_VENUES__KALSHI__API_KEY", "fake-secret")
    cfg = load_config(config_path=None, env_prefix="PYTHEUM_")
    # the raw API key must NOT appear anywhere on the config object
    as_str = repr(cfg)
    assert "fake-secret" not in as_str


def test_rejects_raw_secret_in_toml(tmp_path: Path) -> None:
    cfg_path = tmp_path / "config.toml"
    cfg_path.write_text(
        """
[venues.polymarket]
signer_private_key = "0xdeadbeef"
"""
    )
    with pytest.raises(ConfigError, match="secret"):
        load_config(config_path=cfg_path)


def test_path_expansion(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    cfg = load_config(config_path=None)
    assert cfg.storage.duckdb_path == tmp_path / ".pytheum" / "pytheum.duckdb"
    assert cfg.storage.logs_dir == tmp_path / ".pytheum" / "logs"


def test_config_is_frozen() -> None:
    cfg = load_config(config_path=None)
    with pytest.raises((AttributeError, TypeError)):
        cfg.tui.theme = "dark"  # type: ignore[misc]
```

- [ ] **Step 2: Run test, verify it fails**

```bash
uv run pytest tests/core/test_config.py -v
```

Expected: `ModuleNotFoundError` on `pytheum.core.config`.

- [ ] **Step 3: Implement config loader**

Write `src/pytheum/core/config.py`:

```python
"""Config loader: TOML file + environment overrides + path expansion.

Secrets policy: no raw keys in TOML or env, ever. Only references
(env var NAMES or keyring service names). See spec §6.1 / §6.3.
"""
from __future__ import annotations

import os
import tomllib
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

__all__ = ["Config", "ConfigError", "load_config"]


class ConfigError(Exception):
    """Raised when the config file is invalid or contains forbidden content."""


# Field names that hold REFERENCES (env-var names, paths, keyring service
# names) are allowed. Any other field that looks like a raw secret is rejected.
_REFERENCE_SUFFIXES = ("_env_var", "_env", "_keyring", "_path", "_address")


def _looks_like_raw_secret(field_name: str, value: Any) -> bool:
    if not isinstance(value, str):
        return False
    if any(field_name.endswith(s) for s in _REFERENCE_SUFFIXES):
        return False
    # Catch the obvious "someone pasted a key" case.
    if field_name in {"api_key", "signer_private_key", "private_key", "secret"}:
        return bool(value)
    if len(value) >= 32 and all(c.isalnum() or c in "-_" for c in value):
        return True
    return False


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class KalshiConfig(_Frozen):
    api_key_env_var: str = ""
    private_key_path: str = ""
    private_key_keyring: str = ""
    base_url: str = "https://api.elections.kalshi.com/trade-api/v2"
    ws_url: str = "wss://api.elections.kalshi.com/trade-api/ws/v2"
    rate_limit_per_sec: float = 10.0


class PolymarketConfig(_Frozen):
    funder_address: str = ""
    signer_private_key_env: str = ""
    signer_private_key_keyring: str = ""
    gamma_url: str = "https://gamma-api.polymarket.com"
    clob_url: str = "https://clob.polymarket.com"
    data_url: str = "https://data-api.polymarket.com"
    ws_url: str = "wss://ws-subscriptions-clob.polymarket.com/ws"
    rate_limit_per_sec: float = 10.0


class VenuesConfig(_Frozen):
    kalshi: KalshiConfig = Field(default_factory=KalshiConfig)
    polymarket: PolymarketConfig = Field(default_factory=PolymarketConfig)


class StorageConfig(_Frozen):
    duckdb_path: Path = Field(default_factory=lambda: Path.home() / ".pytheum" / "pytheum.duckdb")
    watchlist_path: Path = Field(default_factory=lambda: Path.home() / ".pytheum" / "watchlist.toml")
    exports_dir: Path = Field(default_factory=lambda: Path.home() / ".pytheum" / "exports")
    logs_dir: Path = Field(default_factory=lambda: Path.home() / ".pytheum" / "logs")

    @field_validator("duckdb_path", "watchlist_path", "exports_dir", "logs_dir", mode="before")
    @classmethod
    def _expand(cls, v: Any) -> Path:
        if isinstance(v, Path):
            return v
        if isinstance(v, str):
            return Path(v).expanduser()
        raise TypeError(f"expected str or Path, got {type(v)}")


class CacheTTLConfig(_Frozen):
    categories: int = 3600
    events_list: int = 300
    markets_list: int = 120
    market_detail: int = 30
    outcome: int = 10
    orderbook_rest: int = 5
    trades_rest: int = 30
    price_history: int = 300
    tags: int = 900


class CacheConfig(_Frozen):
    ttl_s: CacheTTLConfig = Field(default_factory=CacheTTLConfig)


class TUIConfig(_Frozen):
    theme: Literal["dark", "light", "high-contrast"] = "dark"


class Config(_Frozen):
    venues: VenuesConfig = Field(default_factory=VenuesConfig)
    storage: StorageConfig = Field(default_factory=StorageConfig)
    cache: CacheConfig = Field(default_factory=CacheConfig)
    tui: TUIConfig = Field(default_factory=TUIConfig)


def _scrub_secrets(data: dict[str, Any]) -> None:
    """Walk a parsed TOML dict and raise ConfigError if any field holds a raw secret."""
    for key, value in data.items():
        if isinstance(value, dict):
            _scrub_secrets(value)
        elif _looks_like_raw_secret(key, value):
            raise ConfigError(
                f"Field {key!r} appears to contain a raw secret. "
                "Use a reference slot (e.g. api_key_env_var = 'MY_VAR') instead."
            )


def _deep_merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _apply_env_overrides(data: dict[str, Any], env_prefix: str) -> dict[str, Any]:
    """Translate PYTHEUM_A__B__C=val into data[a][b][c] = val (non-secret fields only)."""
    overrides: dict[str, Any] = {}
    for env_key, env_val in os.environ.items():
        if not env_key.startswith(env_prefix):
            continue
        path = env_key[len(env_prefix) :].lower().split("__")
        if not path:
            continue
        leaf = path[-1]
        # Refuse to let env inject raw secrets.
        if _looks_like_raw_secret(leaf, env_val):
            continue
        cursor = overrides
        for part in path[:-1]:
            cursor = cursor.setdefault(part, {})
        # Coerce numeric strings to numbers where the target looks numeric.
        cursor[leaf] = _coerce(env_val)
    return _deep_merge(data, overrides)


def _coerce(raw: str) -> Any:
    if raw.lower() in {"true", "false"}:
        return raw.lower() == "true"
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError:
        pass
    return raw


def load_config(
    config_path: Path | None = None,
    env_prefix: str = "PYTHEUM_",
) -> Config:
    """Load config from TOML (optional) + env overrides. Defaults fill gaps."""
    data: dict[str, Any] = {}
    if config_path is not None and config_path.exists():
        with config_path.open("rb") as f:
            data = tomllib.load(f)
        _scrub_secrets(data)
    data = _apply_env_overrides(data, env_prefix)
    try:
        return Config.model_validate(data)
    except ValidationError as e:
        raise ConfigError(str(e)) from e
```

- [ ] **Step 4: Run test, verify it passes**

```bash
uv run pytest tests/core/test_config.py -v
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pytheum/core/config.py tests/core/test_config.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "core: add config loader (TOML + env, rejects raw secrets)"
```

---

## Task 5: Logging (structlog + secret scrubber)

**Files:**
- Create: `src/pytheum/core/logging.py`
- Test: `tests/core/test_logging.py`

- [ ] **Step 1: Write the failing test**

Write `tests/core/test_logging.py`:

```python
from __future__ import annotations

import io
import json

import structlog

from pytheum.core.logging import configure_logging, scrub_secrets_processor


def test_scrub_processor_masks_known_secret_keys() -> None:
    processor = scrub_secrets_processor
    event = {
        "event": "request",
        "api_key": "sk-live-abc123",
        "authorization": "Bearer x",
        "not_secret": "ok",
    }
    out = processor(None, "info", event)
    assert out["api_key"] == "***"
    assert out["authorization"] == "***"
    assert out["not_secret"] == "ok"


def test_configure_logging_emits_json() -> None:
    buffer = io.StringIO()
    configure_logging(stream=buffer, level="INFO", json_output=True)
    log = structlog.get_logger()
    log.info("hello", api_key="should-be-scrubbed", ticker="FED-25DEC-T4.00")

    line = buffer.getvalue().strip().splitlines()[-1]
    parsed = json.loads(line)
    assert parsed["event"] == "hello"
    assert parsed["api_key"] == "***"
    assert parsed["ticker"] == "FED-25DEC-T4.00"


def test_configure_logging_human_mode() -> None:
    buffer = io.StringIO()
    configure_logging(stream=buffer, level="INFO", json_output=False)
    log = structlog.get_logger()
    log.info("hello", ticker="FED-25DEC-T4.00")
    out = buffer.getvalue()
    assert "hello" in out
    assert "FED-25DEC-T4.00" in out
```

- [ ] **Step 2: Run test, verify it fails**

```bash
uv run pytest tests/core/test_logging.py -v
```

Expected: `ModuleNotFoundError` on `pytheum.core.logging`.

- [ ] **Step 3: Implement logging**

Write `src/pytheum/core/logging.py`:

```python
"""Structlog configuration with a secret-scrubbing processor."""
from __future__ import annotations

import logging
import sys
from typing import Any, MutableMapping, TextIO

import structlog

__all__ = ["configure_logging", "scrub_secrets_processor"]


_SECRET_KEYS = frozenset(
    {
        "api_key",
        "api_secret",
        "authorization",
        "cookie",
        "password",
        "private_key",
        "secret",
        "signer_private_key",
        "token",
        "x-api-key",
    }
)


def scrub_secrets_processor(
    logger: Any, method_name: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    """Replace values of known secret-named keys with '***'."""
    for key in list(event_dict.keys()):
        if key.lower() in _SECRET_KEYS:
            event_dict[key] = "***"
    return event_dict


def configure_logging(
    stream: TextIO | None = None,
    level: str = "INFO",
    json_output: bool = True,
) -> None:
    """Configure structlog globally. Call once at process start."""
    target = stream or sys.stderr

    handler = logging.StreamHandler(target)
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        scrub_secrets_processor,
    ]

    if json_output:
        renderers: list[Any] = [
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(sort_keys=True),
        ]
    else:
        renderers = [structlog.dev.ConsoleRenderer(colors=False)]

    structlog.configure(
        processors=shared_processors + renderers,
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelNamesMapping()[level]
        ),
        logger_factory=structlog.PrintLoggerFactory(file=target),
        cache_logger_on_first_use=False,
    )
```

- [ ] **Step 4: Run test, verify it passes**

```bash
uv run pytest tests/core/test_logging.py -v
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pytheum/core/logging.py tests/core/test_logging.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "core: add structlog config with secret scrubber"
```

---

## Task 6: Rate limiter (async token bucket)

**Files:**
- Create: `src/pytheum/core/rate_limit.py`
- Test: `tests/core/test_rate_limit.py`

- [ ] **Step 1: Write the failing test**

Write `tests/core/test_rate_limit.py`:

```python
from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from pytheum.core.clock import FixedClock
from pytheum.core.rate_limit import AsyncRateLimiter


@pytest.mark.asyncio
async def test_acquire_is_instant_when_tokens_available() -> None:
    clock = FixedClock(datetime(2026, 1, 1, tzinfo=UTC))
    limiter = AsyncRateLimiter(rate_per_sec=10, burst=10, clock=clock)
    for _ in range(10):
        await limiter.acquire()
    # 10 tokens consumed, no wait so far.


@pytest.mark.asyncio
async def test_acquire_blocks_when_bucket_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = FixedClock(datetime(2026, 1, 1, tzinfo=UTC))
    limiter = AsyncRateLimiter(rate_per_sec=10, burst=1, clock=clock)

    await limiter.acquire()  # empties bucket

    sleeps: list[float] = []

    async def fake_sleep(s: float) -> None:
        sleeps.append(s)
        clock.advance_seconds(s)

    monkeypatch.setattr("asyncio.sleep", fake_sleep)
    await limiter.acquire()
    # 1 token at 10/s → refill takes 0.1s. Allow small float tolerance.
    assert sleeps
    assert abs(sleeps[0] - 0.1) < 1e-6


@pytest.mark.asyncio
async def test_rate_limiter_refills_over_time() -> None:
    clock = FixedClock(datetime(2026, 1, 1, tzinfo=UTC))
    limiter = AsyncRateLimiter(rate_per_sec=5, burst=5, clock=clock)
    for _ in range(5):
        await limiter.acquire()
    # 1 second later, bucket should be full again.
    clock.advance_seconds(1.0)
    for _ in range(5):
        await limiter.acquire()


@pytest.mark.asyncio
async def test_invalid_rate_rejected() -> None:
    with pytest.raises(ValueError):
        AsyncRateLimiter(rate_per_sec=0, burst=1)
    with pytest.raises(ValueError):
        AsyncRateLimiter(rate_per_sec=10, burst=0)
```

- [ ] **Step 2: Run test, verify it fails**

```bash
uv run pytest tests/core/test_rate_limit.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement rate limiter**

Write `src/pytheum/core/rate_limit.py`:

```python
"""Async token-bucket rate limiter."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from pytheum.core.clock import Clock, SystemClock

__all__ = ["AsyncRateLimiter"]


@dataclass
class AsyncRateLimiter:
    """Token-bucket rate limiter. Concurrent-safe within one event loop.

    `rate_per_sec` tokens refill continuously. `burst` caps the bucket size.
    `acquire()` returns as soon as one token is available; blocks otherwise.
    """

    rate_per_sec: float
    burst: int
    clock: Clock = field(default_factory=SystemClock)

    _tokens: float = field(init=False)
    _last_refill_ts: float = field(init=False, default=0.0)
    _lock: asyncio.Lock = field(init=False, default_factory=asyncio.Lock)

    def __post_init__(self) -> None:
        if self.rate_per_sec <= 0:
            raise ValueError("rate_per_sec must be > 0")
        if self.burst <= 0:
            raise ValueError("burst must be > 0")
        self._tokens = float(self.burst)
        self._last_refill_ts = self.clock.now().timestamp()

    async def acquire(self) -> None:
        while True:
            async with self._lock:
                self._refill()
                if self._tokens >= 1.0:
                    self._tokens -= 1.0
                    return
                wait_s = (1.0 - self._tokens) / self.rate_per_sec
            await asyncio.sleep(wait_s)

    def _refill(self) -> None:
        now = self.clock.now().timestamp()
        elapsed = now - self._last_refill_ts
        if elapsed <= 0:
            return
        self._tokens = min(
            float(self.burst),
            self._tokens + elapsed * self.rate_per_sec,
        )
        self._last_refill_ts = now
```

- [ ] **Step 4: Run test, verify it passes**

```bash
uv run pytest tests/core/test_rate_limit.py -v
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pytheum/core/rate_limit.py tests/core/test_rate_limit.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "core: add async token-bucket rate limiter"
```

---

## Task 7: Retry decorator (429 + 5xx exponential backoff)

**Files:**
- Create: `src/pytheum/core/retry.py`
- Test: `tests/core/test_retry.py`

- [ ] **Step 1: Write the failing test**

Write `tests/core/test_retry.py`:

```python
from __future__ import annotations

import pytest

from pytheum.core.retry import RetryPolicy, Retryable, retry_async


class _TransientError(Exception, Retryable):
    def __init__(self, retry_after_s: float | None = None) -> None:
        super().__init__("transient")
        self.retry_after_s = retry_after_s


class _FatalError(Exception):
    pass


@pytest.mark.asyncio
async def test_retry_succeeds_on_first_try(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    @retry_async(RetryPolicy(max_attempts=3))
    async def op() -> int:
        nonlocal calls
        calls += 1
        return 42

    assert await op() == 42
    assert calls == 1


@pytest.mark.asyncio
async def test_retry_retries_on_retryable(monkeypatch: pytest.MonkeyPatch) -> None:
    sleeps: list[float] = []

    async def fake_sleep(s: float) -> None:
        sleeps.append(s)

    monkeypatch.setattr("asyncio.sleep", fake_sleep)

    calls = 0

    @retry_async(RetryPolicy(max_attempts=3, base_s=0.1, max_s=1.0, jitter=0))
    async def op() -> int:
        nonlocal calls
        calls += 1
        if calls < 3:
            raise _TransientError()
        return 42

    assert await op() == 42
    assert calls == 3
    assert len(sleeps) == 2
    # Exponential: base * 2^0, base * 2^1  → 0.1, 0.2
    assert abs(sleeps[0] - 0.1) < 1e-6
    assert abs(sleeps[1] - 0.2) < 1e-6


@pytest.mark.asyncio
async def test_retry_honors_retry_after(monkeypatch: pytest.MonkeyPatch) -> None:
    sleeps: list[float] = []

    async def fake_sleep(s: float) -> None:
        sleeps.append(s)

    monkeypatch.setattr("asyncio.sleep", fake_sleep)

    calls = 0

    @retry_async(RetryPolicy(max_attempts=2, base_s=0.1, max_s=10.0, jitter=0))
    async def op() -> int:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise _TransientError(retry_after_s=3.5)
        return 42

    await op()
    assert sleeps == [3.5]


@pytest.mark.asyncio
async def test_retry_does_not_retry_fatal() -> None:
    @retry_async(RetryPolicy(max_attempts=3))
    async def op() -> None:
        raise _FatalError()

    with pytest.raises(_FatalError):
        await op()


@pytest.mark.asyncio
async def test_retry_exhausts_and_reraises(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_sleep(_s: float) -> None:
        pass

    monkeypatch.setattr("asyncio.sleep", fake_sleep)

    @retry_async(RetryPolicy(max_attempts=3, base_s=0.01, jitter=0))
    async def op() -> None:
        raise _TransientError()

    with pytest.raises(_TransientError):
        await op()
```

- [ ] **Step 2: Run test, verify it fails**

```bash
uv run pytest tests/core/test_retry.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement retry**

Write `src/pytheum/core/retry.py`:

```python
"""Async retry decorator with exponential backoff. Retries only `Retryable` errors."""
from __future__ import annotations

import asyncio
import random
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import wraps
from typing import Protocol, TypeVar, cast, runtime_checkable

__all__ = ["RetryPolicy", "Retryable", "retry_async"]

T = TypeVar("T")


@runtime_checkable
class Retryable(Protocol):
    """Marker protocol. Errors that mix this in are retried; others re-raise.

    Implementations may set `retry_after_s` to override the computed backoff.
    """

    retry_after_s: float | None


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 4
    base_s: float = 1.0
    max_s: float = 30.0
    jitter: float = 0.2   # ±20% multiplicative noise

    def backoff(self, attempt: int) -> float:
        raw = min(self.max_s, self.base_s * (2 ** (attempt - 1)))
        if self.jitter <= 0:
            return raw
        delta = raw * self.jitter
        return max(0.0, raw + random.uniform(-delta, delta))


def retry_async(
    policy: RetryPolicy,
) -> Callable[[Callable[..., Awaitable[T]]], Callable[..., Awaitable[T]]]:
    """Decorate an async function so that `Retryable` exceptions are retried."""

    def decorator(fn: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
        @wraps(fn)
        async def wrapper(*args: object, **kwargs: object) -> T:
            last_exc: BaseException | None = None
            for attempt in range(1, policy.max_attempts + 1):
                try:
                    return await fn(*args, **kwargs)
                except Exception as e:
                    if not isinstance(e, Retryable):
                        raise
                    last_exc = e
                    if attempt == policy.max_attempts:
                        raise
                    retry_after = cast(Retryable, e).retry_after_s
                    wait = retry_after if retry_after is not None else policy.backoff(attempt)
                    await asyncio.sleep(wait)
            # Unreachable — the loop either returns or raises.
            assert last_exc is not None
            raise last_exc

        return wrapper

    return decorator
```

- [ ] **Step 4: Run test, verify it passes**

```bash
uv run pytest tests/core/test_retry.py -v
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pytheum/core/retry.py tests/core/test_retry.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "core: add async retry decorator with Retryable protocol"
```

---

## Task 8: Circuit breaker

**Files:**
- Create: `src/pytheum/core/circuit_breaker.py`
- Test: `tests/core/test_circuit_breaker.py`

- [ ] **Step 1: Write the failing test**

Write `tests/core/test_circuit_breaker.py`:

```python
from __future__ import annotations

from datetime import UTC, datetime

import pytest

from pytheum.core.circuit_breaker import CircuitBreaker, CircuitState, OpenCircuit
from pytheum.core.clock import FixedClock


def test_starts_closed() -> None:
    cb = CircuitBreaker(failure_threshold=3, cooldown_s=5.0)
    assert cb.state == CircuitState.CLOSED


def test_opens_after_threshold_failures() -> None:
    cb = CircuitBreaker(failure_threshold=3, cooldown_s=5.0)
    for _ in range(3):
        cb.record_failure()
    assert cb.state == CircuitState.OPEN


def test_open_circuit_raises_on_check() -> None:
    cb = CircuitBreaker(failure_threshold=1, cooldown_s=5.0)
    cb.record_failure()
    with pytest.raises(OpenCircuit):
        cb.check()


def test_half_open_after_cooldown() -> None:
    clock = FixedClock(datetime(2026, 1, 1, tzinfo=UTC))
    cb = CircuitBreaker(failure_threshold=1, cooldown_s=5.0, clock=clock)
    cb.record_failure()
    assert cb.state == CircuitState.OPEN
    clock.advance_seconds(5.1)
    assert cb.state == CircuitState.HALF_OPEN
    # half-open allows a probe
    cb.check()


def test_success_in_half_open_closes() -> None:
    clock = FixedClock(datetime(2026, 1, 1, tzinfo=UTC))
    cb = CircuitBreaker(failure_threshold=1, cooldown_s=5.0, clock=clock)
    cb.record_failure()
    clock.advance_seconds(5.1)
    cb.check()
    cb.record_success()
    assert cb.state == CircuitState.CLOSED


def test_failure_in_half_open_reopens() -> None:
    clock = FixedClock(datetime(2026, 1, 1, tzinfo=UTC))
    cb = CircuitBreaker(failure_threshold=1, cooldown_s=5.0, clock=clock)
    cb.record_failure()
    clock.advance_seconds(5.1)
    cb.check()
    cb.record_failure()
    assert cb.state == CircuitState.OPEN
```

- [ ] **Step 2: Run test, verify it fails**

```bash
uv run pytest tests/core/test_circuit_breaker.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement circuit breaker**

Write `src/pytheum/core/circuit_breaker.py`:

```python
"""Circuit breaker: trip on sustained failure; half-open probe after cooldown."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum

from pytheum.core.clock import Clock, SystemClock

__all__ = ["CircuitBreaker", "CircuitState", "OpenCircuit"]


class CircuitState(StrEnum):
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"


class OpenCircuit(Exception):
    """Raised when a caller tries to proceed while the circuit is OPEN."""


@dataclass
class CircuitBreaker:
    failure_threshold: int
    cooldown_s: float
    clock: Clock = field(default_factory=SystemClock)

    _consecutive_failures: int = field(init=False, default=0)
    _opened_at: datetime | None = field(init=False, default=None)
    _probe_in_flight: bool = field(init=False, default=False)

    @property
    def state(self) -> CircuitState:
        if self._opened_at is None:
            return CircuitState.CLOSED
        age = (self.clock.now() - self._opened_at).total_seconds()
        if age < self.cooldown_s:
            return CircuitState.OPEN
        return CircuitState.HALF_OPEN

    def check(self) -> None:
        st = self.state
        if st is CircuitState.OPEN:
            raise OpenCircuit("circuit is OPEN; retry after cooldown")
        if st is CircuitState.HALF_OPEN:
            self._probe_in_flight = True

    def record_success(self) -> None:
        self._consecutive_failures = 0
        self._opened_at = None
        self._probe_in_flight = False

    def record_failure(self) -> None:
        self._consecutive_failures += 1
        if self._probe_in_flight:
            # failed probe → re-open
            self._opened_at = self.clock.now()
            self._probe_in_flight = False
            return
        if self._consecutive_failures >= self.failure_threshold:
            self._opened_at = self.clock.now()
```

- [ ] **Step 4: Run test, verify it passes**

```bash
uv run pytest tests/core/test_circuit_breaker.py -v
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pytheum/core/circuit_breaker.py tests/core/test_circuit_breaker.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "core: add circuit breaker with half-open probe"
```

---

## Task 9: Pagination iterators (cursor + offset, async generators)

**Files:**
- Create: `src/pytheum/core/pagination.py`
- Test: `tests/core/test_pagination.py`

- [ ] **Step 1: Write the failing test**

Write `tests/core/test_pagination.py`:

```python
from __future__ import annotations

import pytest

from pytheum.core.pagination import cursor_paginated, offset_paginated


@pytest.mark.asyncio
async def test_cursor_paginated_walks_all_pages() -> None:
    # Fake backend: 3 pages, each with a `next_cursor` until the last.
    async def fetch(cursor: str | None) -> tuple[list[int], str | None]:
        pages = {
            None: ([1, 2, 3], "c2"),
            "c2": ([4, 5, 6], "c3"),
            "c3": ([7, 8], None),
        }
        return pages[cursor]

    collected = [x async for x in cursor_paginated(fetch)]
    assert collected == [1, 2, 3, 4, 5, 6, 7, 8]


@pytest.mark.asyncio
async def test_cursor_paginated_respects_max_pages() -> None:
    async def fetch(cursor: str | None) -> tuple[list[int], str | None]:
        # Infinite: always returns a next_cursor.
        n = 0 if cursor is None else int(cursor)
        return ([n, n + 1], str(n + 2))

    collected = [x async for x in cursor_paginated(fetch, max_pages=2)]
    assert collected == [0, 1, 2, 3]


@pytest.mark.asyncio
async def test_offset_paginated_walks_until_empty_page() -> None:
    async def fetch(offset: int, limit: int) -> list[int]:
        pages = {
            (0, 3): [1, 2, 3],
            (3, 3): [4, 5, 6],
            (6, 3): [7],
            (7, 3): [],
        }
        return pages[(offset, limit)]

    collected = [x async for x in offset_paginated(fetch, page_size=3)]
    assert collected == [1, 2, 3, 4, 5, 6, 7]


@pytest.mark.asyncio
async def test_offset_paginated_stops_on_short_page() -> None:
    async def fetch(offset: int, limit: int) -> list[int]:
        # Page 0: full (size 3). Page 1: short (size 2) → stop.
        pages = {
            (0, 3): [1, 2, 3],
            (3, 3): [4, 5],
        }
        return pages.get((offset, limit), [])

    collected = [x async for x in offset_paginated(fetch, page_size=3)]
    assert collected == [1, 2, 3, 4, 5]


@pytest.mark.asyncio
async def test_offset_respects_max_items() -> None:
    async def fetch(offset: int, limit: int) -> list[int]:
        return list(range(offset, offset + limit))

    collected = [x async for x in offset_paginated(fetch, page_size=10, max_items=3)]
    assert collected == [0, 1, 2]
```

- [ ] **Step 2: Run test, verify it fails**

```bash
uv run pytest tests/core/test_pagination.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement pagination**

Write `src/pytheum/core/pagination.py`:

```python
"""Async pagination iterators for cursor- and offset-style APIs."""
from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import TypeVar

__all__ = ["cursor_paginated", "offset_paginated"]

T = TypeVar("T")

CursorFetcher = Callable[[str | None], Awaitable[tuple[list[T], str | None]]]
OffsetFetcher = Callable[[int, int], Awaitable[list[T]]]


async def cursor_paginated(
    fetch: CursorFetcher[T],
    *,
    max_pages: int | None = None,
) -> AsyncIterator[T]:
    """Walk a cursor-paginated endpoint until `next_cursor` is None or max_pages reached."""
    cursor: str | None = None
    pages_seen = 0
    while True:
        items, cursor = await fetch(cursor)
        for item in items:
            yield item
        pages_seen += 1
        if cursor is None:
            return
        if max_pages is not None and pages_seen >= max_pages:
            return


async def offset_paginated(
    fetch: OffsetFetcher[T],
    *,
    page_size: int = 100,
    max_items: int | None = None,
) -> AsyncIterator[T]:
    """Walk an offset-paginated endpoint until a short/empty page or max_items hit."""
    offset = 0
    emitted = 0
    while True:
        items = await fetch(offset, page_size)
        for item in items:
            yield item
            emitted += 1
            if max_items is not None and emitted >= max_items:
                return
        if len(items) < page_size:
            return
        offset += page_size
```

- [ ] **Step 4: Run test, verify it passes**

```bash
uv run pytest tests/core/test_pagination.py -v
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pytheum/core/pagination.py tests/core/test_pagination.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "core: add async cursor + offset pagination iterators"
```

---

## Task 10: Enums — Venue, PriceUnit, SizeUnit, VolumeMetric

**Files:**
- Create: `src/pytheum/data/models.py` (initial: enums only)
- Test: `tests/data/test_models.py` (partial — enums section)

- [ ] **Step 1: Write the failing test**

Write `tests/data/test_models.py`:

```python
from __future__ import annotations

import pytest

from pytheum.data.models import PriceUnit, SizeUnit, Venue, VolumeMetric


def test_venue_values() -> None:
    assert Venue.KALSHI == "kalshi"
    assert Venue.POLYMARKET == "polymarket"
    assert list(Venue) == [Venue.KALSHI, Venue.POLYMARKET]


def test_price_unit_values() -> None:
    assert PriceUnit.PROB_1_0 == "probability_1_0"
    assert PriceUnit.CENTS_100 == "cents_100"
    assert PriceUnit.USDC == "usdc"


def test_size_unit_values() -> None:
    assert SizeUnit.CONTRACTS == "contracts"
    assert SizeUnit.SHARES == "shares"
    assert SizeUnit.USDC == "usdc"


def test_volume_metric_values() -> None:
    assert VolumeMetric.USD_24H == "usd_24h"
    assert VolumeMetric.USD_TOTAL == "usd_total"
    assert VolumeMetric.CONTRACTS_24H == "contracts_24h"
    assert VolumeMetric.UNKNOWN == "unknown"


@pytest.mark.parametrize("e", [Venue, PriceUnit, SizeUnit, VolumeMetric])
def test_all_enums_are_string_enums(e: type) -> None:
    # Must be safely JSON-serializable as plain strings by pydantic v2.
    assert issubclass(e, str)
```

- [ ] **Step 2: Run test, verify it fails**

```bash
uv run pytest tests/data/test_models.py -v
```

Expected: `ModuleNotFoundError` on `pytheum.data.models`.

- [ ] **Step 3: Implement enums**

Write `src/pytheum/data/models.py`:

```python
"""Pydantic v2 domain models and enums. See spec §4."""
from __future__ import annotations

from enum import StrEnum

__all__ = [
    "PriceUnit",
    "SizeUnit",
    "Venue",
    "VolumeMetric",
]


class Venue(StrEnum):
    KALSHI = "kalshi"
    POLYMARKET = "polymarket"


class PriceUnit(StrEnum):
    PROB_1_0 = "probability_1_0"   # [0.0, 1.0] — normalized
    CENTS_100 = "cents_100"        # Kalshi native (0-100)
    USDC = "usdc"                  # Polymarket native


class SizeUnit(StrEnum):
    CONTRACTS = "contracts"
    SHARES = "shares"
    USDC = "usdc"


class VolumeMetric(StrEnum):
    USD_24H = "usd_24h"
    USD_TOTAL = "usd_total"
    CONTRACTS_24H = "contracts_24h"
    CONTRACTS_TOTAL = "contracts_total"
    UNKNOWN = "unknown"
```

- [ ] **Step 4: Run test, verify it passes**

```bash
uv run pytest tests/data/test_models.py -v
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pytheum/data/models.py tests/data/test_models.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "data: add Venue / PriceUnit / SizeUnit / VolumeMetric enums"
```

---

## Task 11: Freshness + stream-state enums + ServiceResult

**Files:**
- Create: `src/pytheum/data/freshness.py`
- Test: `tests/data/test_freshness.py`

- [ ] **Step 1: Write the failing test**

Write `tests/data/test_freshness.py`:

```python
from __future__ import annotations

from pytheum.data.freshness import DataFreshness, ServiceResult, StreamState


def test_freshness_values() -> None:
    assert DataFreshness.LIVE == "LIVE"
    assert DataFreshness.REFRESHING == "REFRESHING"
    assert DataFreshness.CACHED == "CACHED"
    assert DataFreshness.STALE == "STALE"
    assert DataFreshness.FAILED == "FAILED"


def test_stream_state_values() -> None:
    assert StreamState.CONNECTING == "CONNECTING"
    assert StreamState.LIVE == "LIVE"
    assert StreamState.RECONNECTING == "RECONNECTING"
    assert StreamState.DISCONNECTED == "DISCONNECTED"
    assert StreamState.FAILED == "FAILED"


def test_service_result_fresh() -> None:
    r: ServiceResult[int] = ServiceResult(value=42, freshness=DataFreshness.LIVE)
    assert r.value == 42
    assert r.freshness is DataFreshness.LIVE
    assert r.warning is None
    assert r.age_s is None


def test_service_result_stale_carries_warning() -> None:
    warning = RuntimeError("venue down")
    r: ServiceResult[str] = ServiceResult(
        value="cached-v",
        freshness=DataFreshness.STALE,
        warning=warning,
        age_s=120.5,
    )
    assert r.value == "cached-v"
    assert r.freshness is DataFreshness.STALE
    assert r.warning is warning
    assert r.age_s == 120.5


def test_service_result_is_frozen() -> None:
    r: ServiceResult[int] = ServiceResult(value=1, freshness=DataFreshness.LIVE)
    try:
        r.value = 2   # type: ignore[misc]
    except (AttributeError, Exception):
        return
    raise AssertionError("ServiceResult should be frozen")
```

- [ ] **Step 2: Run test, verify it fails**

```bash
uv run pytest tests/data/test_freshness.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement freshness**

Write `src/pytheum/data/freshness.py`:

```python
"""Freshness / stream state enums and the ServiceResult return envelope. See spec §4.2, §4.4."""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Generic, TypeVar

__all__ = ["DataFreshness", "ServiceResult", "StreamState"]

T = TypeVar("T")


class DataFreshness(StrEnum):
    """REST-derived data freshness. Always shown as a text label in the UI."""

    LIVE = "LIVE"
    REFRESHING = "REFRESHING"
    CACHED = "CACHED"
    STALE = "STALE"
    FAILED = "FAILED"


class StreamState(StrEnum):
    """WS subscription state. Always shown as a text label in the UI."""

    CONNECTING = "CONNECTING"
    LIVE = "LIVE"
    RECONNECTING = "RECONNECTING"
    DISCONNECTED = "DISCONNECTED"
    FAILED = "FAILED"


@dataclass(frozen=True)
class ServiceResult(Generic[T]):
    """Envelope returned by every App Service. Value + freshness + optional warning."""

    value: T
    freshness: DataFreshness
    warning: BaseException | None = None
    age_s: float | None = None
```

- [ ] **Step 4: Run test, verify it passes**

```bash
uv run pytest tests/data/test_freshness.py -v
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pytheum/data/freshness.py tests/data/test_freshness.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "data: add DataFreshness + StreamState + ServiceResult"
```

---

## Task 12: Service error types

**Files:**
- Create: `src/pytheum/data/errors.py`
- Test: `tests/data/test_errors.py`

- [ ] **Step 1: Write the failing test**

Write `tests/data/test_errors.py`:

```python
from __future__ import annotations

import pytest

from pytheum.data.errors import (
    AuthRequired,
    MalformedURL,
    NoResults,
    PytheumError,
    RateLimited,
    SchemaDrift,
    UnresolvedRef,
    UnsupportedEndpoint,
    VenueUnavailable,
)
from pytheum.data.models import Venue


def test_all_errors_inherit_from_pytheum_error() -> None:
    for cls in (
        RateLimited,
        VenueUnavailable,
        AuthRequired,
        MalformedURL,
        UnresolvedRef,
        SchemaDrift,
        NoResults,
        UnsupportedEndpoint,
    ):
        assert issubclass(cls, PytheumError)
        assert issubclass(cls, Exception)


def test_rate_limited_fields() -> None:
    e = RateLimited(venue=Venue.KALSHI, retry_after_s=5.0)
    assert e.venue is Venue.KALSHI
    assert e.retry_after_s == 5.0


def test_venue_unavailable_fields() -> None:
    cause = RuntimeError("boom")
    e = VenueUnavailable(venue=Venue.POLYMARKET, status_code=503, cause=cause)
    assert e.venue is Venue.POLYMARKET
    assert e.status_code == 503
    assert e.cause is cause


def test_auth_required_is_raisable() -> None:
    with pytest.raises(AuthRequired):
        raise AuthRequired(venue=Venue.KALSHI, endpoint="/portfolio/balance")


def test_malformed_url_fields() -> None:
    e = MalformedURL(raw_input="https://bogus.example/xyz", supported_patterns=["kalshi.com/markets/...", "polymarket.com/event/..."])
    assert "bogus" in e.raw_input
    assert len(e.supported_patterns) == 2


def test_no_results_fields() -> None:
    e = NoResults(query="nonsense", scope="search")
    assert e.query == "nonsense"
    assert e.scope == "search"


def test_schema_drift_captures_raw_id() -> None:
    e = SchemaDrift(
        venue=Venue.KALSHI,
        endpoint="/markets/FED-X",
        raw_id=42,
        validator_errors=["missing 'yes_price'"],
    )
    assert e.raw_id == 42
    assert "missing" in e.validator_errors[0]
```

- [ ] **Step 2: Run test, verify it fails**

```bash
uv run pytest tests/data/test_errors.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement errors**

Write `src/pytheum/data/errors.py`:

```python
"""Service-layer error hierarchy. See spec §4.4."""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pytheum.data.models import Venue
    from pytheum.data.refs import MarketRef

__all__ = [
    "AuthRequired",
    "MalformedURL",
    "NoResults",
    "PytheumError",
    "RateLimited",
    "SchemaDrift",
    "UnresolvedRef",
    "UnsupportedEndpoint",
    "VenueUnavailable",
]


class PytheumError(Exception):
    """Root of the application error hierarchy."""


# NOTE: the retry Protocol lives in pytheum.core.retry.Retryable.
# Errors below satisfy it structurally by setting self.retry_after_s.


class RateLimited(PytheumError):
    def __init__(self, venue: "Venue", retry_after_s: float | None = None) -> None:
        super().__init__(f"rate limited on {venue}")
        self.venue = venue
        self.retry_after_s = retry_after_s


class VenueUnavailable(PytheumError):
    def __init__(
        self,
        venue: "Venue",
        status_code: int | None = None,
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(f"venue {venue} unavailable (status={status_code})")
        self.venue = venue
        self.status_code = status_code
        self.cause = cause
        self.retry_after_s: float | None = None


class AuthRequired(PytheumError):
    def __init__(self, venue: "Venue", endpoint: str) -> None:
        super().__init__(f"{endpoint} on {venue} requires authentication")
        self.venue = venue
        self.endpoint = endpoint


class MalformedURL(PytheumError):
    def __init__(self, raw_input: str, supported_patterns: list[str]) -> None:
        super().__init__(f"could not parse URL: {raw_input!r}")
        self.raw_input = raw_input
        self.supported_patterns = supported_patterns


class UnresolvedRef(PytheumError):
    def __init__(self, ref: "MarketRef", reason: str) -> None:
        super().__init__(f"cannot resolve {ref!r}: {reason}")
        self.ref = ref
        self.reason = reason


class SchemaDrift(PytheumError):
    def __init__(
        self,
        venue: "Venue",
        endpoint: str,
        raw_id: int,
        validator_errors: list[str],
    ) -> None:
        super().__init__(f"schema drift at {endpoint} on {venue} (raw_id={raw_id})")
        self.venue = venue
        self.endpoint = endpoint
        self.raw_id = raw_id
        self.validator_errors = validator_errors


class NoResults(PytheumError):
    def __init__(self, query: str, scope: str) -> None:
        super().__init__(f"no results for {query!r} in {scope}")
        self.query = query
        self.scope = scope


class UnsupportedEndpoint(PytheumError):
    def __init__(self, venue: "Venue", endpoint: str, reason: str) -> None:
        super().__init__(f"{endpoint} on {venue} unsupported: {reason}")
        self.venue = venue
        self.endpoint = endpoint
        self.reason = reason
```

- [ ] **Step 4: Run test, verify it passes**

```bash
uv run pytest tests/data/test_errors.py -v
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pytheum/data/errors.py tests/data/test_errors.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "data: add service-layer error hierarchy"
```

---

## Task 13: Ref types — RefType, MarketRef, EventRef

**Files:**
- Create: `src/pytheum/data/refs.py`
- Test: `tests/data/test_refs.py`

- [ ] **Step 1: Write the failing test**

Write `tests/data/test_refs.py`:

```python
from __future__ import annotations

import pytest
from pydantic import ValidationError

from pytheum.data.models import Venue
from pytheum.data.refs import EventRef, MarketRef, RefType


def test_ref_type_values() -> None:
    assert RefType.KALSHI_TICKER == "kalshi_ticker"
    assert RefType.POLYMARKET_CONDITION_ID == "polymarket_condition_id"
    assert RefType.URL == "url"


def test_market_ref_minimal() -> None:
    r = MarketRef(venue=Venue.KALSHI, ref_type=RefType.KALSHI_TICKER, value="FED-25DEC-T4.00")
    assert r.venue is Venue.KALSHI
    assert r.ref_type is RefType.KALSHI_TICKER
    assert r.value == "FED-25DEC-T4.00"
    assert r.outcome_id is None


def test_market_ref_with_outcome() -> None:
    r = MarketRef(
        venue=Venue.POLYMARKET,
        ref_type=RefType.POLYMARKET_TOKEN_ID,
        value="123456789",
        outcome_id="123456789",
    )
    assert r.outcome_id == "123456789"


def test_event_ref_minimal() -> None:
    r = EventRef(
        venue=Venue.POLYMARKET,
        ref_type=RefType.POLYMARKET_EVENT_SLUG,
        value="nyc-mayoral-2026",
    )
    assert r.ref_type is RefType.POLYMARKET_EVENT_SLUG


def test_refs_are_frozen() -> None:
    r = MarketRef(venue=Venue.KALSHI, ref_type=RefType.KALSHI_TICKER, value="X")
    with pytest.raises((ValidationError, AttributeError, TypeError)):
        r.value = "Y"   # type: ignore[misc]


def test_ref_cannot_have_empty_value() -> None:
    with pytest.raises(ValidationError):
        MarketRef(venue=Venue.KALSHI, ref_type=RefType.KALSHI_TICKER, value="")
```

- [ ] **Step 2: Run test, verify it fails**

```bash
uv run pytest tests/data/test_refs.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement refs**

Write `src/pytheum/data/refs.py`:

```python
"""Typed market / event references. Inert — resolution lives in RefResolverService (Phase 3).

See spec §4.3.
"""
from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from pytheum.data.models import Venue

__all__ = ["EventRef", "MarketRef", "RefType"]


class RefType(StrEnum):
    KALSHI_TICKER = "kalshi_ticker"
    KALSHI_EVENT_TICKER = "kalshi_event_ticker"
    POLYMARKET_CONDITION_ID = "polymarket_condition_id"
    POLYMARKET_TOKEN_ID = "polymarket_token_id"
    POLYMARKET_EVENT_SLUG = "polymarket_event_slug"
    POLYMARKET_MARKET_SLUG = "polymarket_market_slug"
    URL = "url"


class _FrozenRef(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class MarketRef(_FrozenRef):
    venue: Venue
    ref_type: RefType
    value: str = Field(min_length=1)
    outcome_id: str | None = None


class EventRef(_FrozenRef):
    venue: Venue
    ref_type: RefType
    value: str = Field(min_length=1)
```

- [ ] **Step 4: Run test, verify it passes**

```bash
uv run pytest tests/data/test_refs.py -v
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pytheum/data/refs.py tests/data/test_refs.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "data: add MarketRef / EventRef / RefType"
```

---

## Task 14: Entity models — Category, Event, Outcome, Market

**Files:**
- Modify: `src/pytheum/data/models.py:1-…` (append entity models to existing file)
- Modify: `tests/data/test_models.py` (append entity-model tests)

- [ ] **Step 1: Update `tests/data/test_models.py`**

Replace the **top import block** (imports only — leave existing test functions unchanged) with:

```python
from __future__ import annotations

from decimal import Decimal

import pytest
from pydantic import ValidationError

from pytheum.data.models import (
    Category,
    Event,
    Market,
    Outcome,
    PriceUnit,
    SizeUnit,
    Venue,
    VolumeMetric,
)
```

Then **append the new test functions** (no new imports) at the end of the file:

```python
def test_category_minimal() -> None:
    c = Category(
        venue=Venue.KALSHI,
        native_id="FED",
        native_label="Economics",
        display_label="Economics",
    )
    assert c.native_id == "FED"


def test_event_defaults_empty_tags() -> None:
    e = Event(
        venue=Venue.KALSHI,
        native_id="FED-25DEC",
        title="FOMC December 2025",
        primary_category=None,
        closes_at=None,
        market_count=5,
        aggregate_volume=None,
        volume_metric=VolumeMetric.USD_TOTAL,
        url=None,
        schema_version=1,
    )
    assert e.tags == []
    assert e.raw_id is None


def test_outcome_requires_price_unit_when_price_set() -> None:
    o = Outcome(
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
    assert o.price == Decimal("0.88")
    assert o.price_unit is PriceUnit.CENTS_100


def test_market_has_two_outcomes_for_binary() -> None:
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
    m = Market(
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
        url="https://kalshi.com/markets/FED/FED-25DEC/FED-25DEC-T4.00",
        schema_version=1,
    )
    assert len(m.outcomes) == 2


def test_market_rejects_invalid_status() -> None:
    with pytest.raises(ValidationError):
        Market(
            venue=Venue.KALSHI,
            native_id="X",
            event_native_id=None,
            title="T",
            question="Q",
            status="bogus",   # type: ignore[arg-type]
            outcomes=[],
            total_volume=None,
            volume_metric=VolumeMetric.UNKNOWN,
            open_interest=None,
            liquidity=None,
            closes_at=None,
            url=None,
            schema_version=1,
        )
```

- [ ] **Step 2: Run test, verify it fails**

```bash
uv run pytest tests/data/test_models.py -v
```

Expected: new tests fail with `ImportError` or attribute errors.

- [ ] **Step 3: Append entity models to `src/pytheum/data/models.py`**

Append (keep existing enum definitions, add below them):

```python
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

__all__ += [
    "Category",
    "Event",
    "Market",
    "Outcome",
]


class _Record(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Category(_Record):
    venue: Venue
    native_id: str
    native_label: str
    display_label: str


class Event(_Record):
    venue: Venue
    native_id: str
    title: str
    primary_category: Category | None
    tags: list[Category] = Field(default_factory=list)
    closes_at: datetime | None
    market_count: int
    aggregate_volume: Decimal | None
    volume_metric: VolumeMetric
    url: str | None
    raw_id: int | None = None
    schema_version: int


class Outcome(_Record):
    venue: Venue
    market_native_id: str
    outcome_id: str
    token_id: str | None
    label: str
    price: Decimal | None
    native_price: Decimal | None
    price_unit: PriceUnit
    volume: Decimal | None
    volume_metric: VolumeMetric
    is_resolved: bool = False
    resolution: bool | None = None
    raw_id: int | None = None
    schema_version: int


class Market(_Record):
    venue: Venue
    native_id: str
    event_native_id: str | None
    title: str
    question: str
    status: Literal["open", "closed", "settled", "unopened", "paused"]
    outcomes: list[Outcome]
    total_volume: Decimal | None
    volume_metric: VolumeMetric
    open_interest: Decimal | None
    liquidity: Decimal | None
    closes_at: datetime | None
    url: str | None
    raw_id: int | None = None
    schema_version: int
```

- [ ] **Step 4: Run test, verify it passes**

```bash
uv run pytest tests/data/test_models.py -v
```

Expected: all tests pass (enums + 5 new entity tests).

- [ ] **Step 5: Commit**

```bash
git add src/pytheum/data/models.py tests/data/test_models.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "data: add Category / Event / Outcome / Market entity models"
```

---

## Task 15: Fact models — Trade, OrderBook, PricePoint

**Files:**
- Modify: `src/pytheum/data/models.py` (append)
- Modify: `tests/data/test_models.py` (append)

- [ ] **Step 1: Update `tests/data/test_models.py`**

Extend the **top import block** to include `OrderBook`, `PricePoint`, `Trade` and the `datetime` imports. The file's top block should now look like:

```python
from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

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
```

Then **append the new test functions** (no new imports) at the end of the file:

```python
def test_trade_requires_outcome_and_units() -> None:
    t = Trade(
        venue=Venue.KALSHI,
        market_native_id="FED-25DEC-T4.00",
        outcome_id="yes",
        price=Decimal("0.88"),
        native_price=Decimal("88"),
        price_unit=PriceUnit.CENTS_100,
        size=Decimal("120"),
        native_size=Decimal("120"),
        size_unit=SizeUnit.CONTRACTS,
        notional=Decimal("105.6"),
        currency="usd",
        side="buy",
        timestamp=datetime(2026, 4, 24, 12, 0, tzinfo=UTC),
        schema_version=1,
    )
    assert t.outcome_id == "yes"
    assert t.size_unit is SizeUnit.CONTRACTS


def test_orderbook_attaches_to_outcome() -> None:
    b = OrderBook(
        venue=Venue.POLYMARKET,
        market_native_id="0xabc",
        outcome_id="token_yes_123",
        bids=[(Decimal("0.87"), Decimal("1000")), (Decimal("0.86"), Decimal("500"))],
        asks=[(Decimal("0.89"), Decimal("750"))],
        price_unit=PriceUnit.USDC,
        size_unit=SizeUnit.SHARES,
        timestamp=datetime(2026, 4, 24, tzinfo=UTC),
        schema_version=1,
    )
    assert b.outcome_id == "token_yes_123"
    assert b.bids[0] == (Decimal("0.87"), Decimal("1000"))


def test_price_point_interval_accepts_all_supported() -> None:
    for interval in ("1m", "5m", "1h", "6h", "1d", "1w", "1mo", "all", "max"):
        p = PricePoint(
            venue=Venue.POLYMARKET,
            market_native_id="0xabc",
            outcome_id="token_yes_123",
            timestamp=datetime(2026, 4, 24, tzinfo=UTC),
            price=Decimal("0.55"),
            native_price=Decimal("0.55"),
            price_unit=PriceUnit.USDC,
            volume=None,
            volume_metric=VolumeMetric.UNKNOWN,
            interval=interval,  # type: ignore[arg-type]
            schema_version=1,
        )
        assert p.interval == interval
```

- [ ] **Step 2: Run test, verify it fails**

```bash
uv run pytest tests/data/test_models.py -v
```

Expected: new fact-model tests fail on `ImportError`.

- [ ] **Step 3: Append fact models**

Append to `src/pytheum/data/models.py`:

```python
__all__ += ["OrderBook", "PricePoint", "Trade"]


class Trade(_Record):
    venue: Venue
    market_native_id: str
    outcome_id: str
    price: Decimal
    native_price: Decimal
    price_unit: PriceUnit
    size: Decimal
    native_size: Decimal
    size_unit: SizeUnit
    notional: Decimal | None
    currency: Literal["usd", "usdc"]
    side: Literal["buy", "sell"] | None
    timestamp: datetime
    raw_id: int | None = None
    schema_version: int


class OrderBook(_Record):
    venue: Venue
    market_native_id: str
    outcome_id: str
    bids: list[tuple[Decimal, Decimal]]
    asks: list[tuple[Decimal, Decimal]]
    price_unit: PriceUnit
    size_unit: SizeUnit
    timestamp: datetime
    raw_id: int | None = None
    schema_version: int


class PricePoint(_Record):
    venue: Venue
    market_native_id: str
    outcome_id: str
    timestamp: datetime
    price: Decimal
    native_price: Decimal
    price_unit: PriceUnit
    volume: Decimal | None
    volume_metric: VolumeMetric
    interval: Literal["1m", "5m", "1h", "6h", "1d", "1w", "1mo", "all", "max"]
    raw_id: int | None = None
    schema_version: int
```

- [ ] **Step 4: Run test, verify it passes**

```bash
uv run pytest tests/data/test_models.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pytheum/data/models.py tests/data/test_models.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "data: add Trade / OrderBook / PricePoint fact models"
```

---

## Task 16: DuckDB schema files (six .sql)

**Files:**
- Create: `src/pytheum/data/schema/001_raw_payloads.sql`
- Create: `src/pytheum/data/schema/002_categories_events.sql`
- Create: `src/pytheum/data/schema/003_markets_outcomes.sql`
- Create: `src/pytheum/data/schema/004_trades_orderbook_prices.sql`
- Create: `src/pytheum/data/schema/005_aliases_tags.sql`
- Create: `src/pytheum/data/schema/006_searchable_markets_view.sql`

- [ ] **Step 1: Write `001_raw_payloads.sql`**

Write `src/pytheum/data/schema/001_raw_payloads.sql`:

```sql
CREATE SEQUENCE IF NOT EXISTS seq_raw_payloads START 1;

CREATE TABLE IF NOT EXISTS raw_payloads (
    id             BIGINT        PRIMARY KEY DEFAULT nextval('seq_raw_payloads'),
    venue          VARCHAR       NOT NULL,
    transport      VARCHAR       NOT NULL,
    endpoint       VARCHAR       NOT NULL,
    request_params JSON,
    received_ts    TIMESTAMPTZ   NOT NULL,
    source_ts      TIMESTAMPTZ,
    sequence_no    BIGINT,
    schema_version INT           NOT NULL,
    native_ids     VARCHAR[]     NOT NULL DEFAULT [],
    payload        JSON          NOT NULL,
    status_code    INT,
    duration_ms    INT,
    created_ts     TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (transport IN ('rest', 'ws'))
);

CREATE INDEX IF NOT EXISTS idx_raw_venue_transport_ep
    ON raw_payloads(venue, transport, endpoint, received_ts);
```

- [ ] **Step 2: Write `002_categories_events.sql`**

Write `src/pytheum/data/schema/002_categories_events.sql`:

```sql
CREATE TABLE IF NOT EXISTS categories (
    venue          VARCHAR NOT NULL,
    native_id      VARCHAR NOT NULL,
    native_label   VARCHAR NOT NULL,
    display_label  VARCHAR NOT NULL,
    raw_id         BIGINT NOT NULL,
    schema_version INT NOT NULL,
    updated_ts     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (venue, native_id),
    FOREIGN KEY (raw_id) REFERENCES raw_payloads(id)
);

CREATE TABLE IF NOT EXISTS events (
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
        REFERENCES categories(venue, native_id),
    FOREIGN KEY (raw_id) REFERENCES raw_payloads(id)
);
```

- [ ] **Step 3: Write `003_markets_outcomes.sql`**

Write `src/pytheum/data/schema/003_markets_outcomes.sql`:

```sql
CREATE TABLE IF NOT EXISTS markets (
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
    FOREIGN KEY (event_venue, event_native_id) REFERENCES events(venue, native_id),
    FOREIGN KEY (raw_id) REFERENCES raw_payloads(id)
);

CREATE TABLE IF NOT EXISTS outcomes (
    venue            VARCHAR NOT NULL,
    market_native_id VARCHAR NOT NULL,
    outcome_id       VARCHAR NOT NULL,
    token_id         VARCHAR,
    label            VARCHAR NOT NULL,
    price            DECIMAL(10,6),
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
    FOREIGN KEY (venue, market_native_id) REFERENCES markets(venue, native_id),
    FOREIGN KEY (raw_id) REFERENCES raw_payloads(id)
);

CREATE INDEX IF NOT EXISTS idx_outcomes_token ON outcomes(venue, token_id);
```

- [ ] **Step 4: Write `004_trades_orderbook_prices.sql`**

Write `src/pytheum/data/schema/004_trades_orderbook_prices.sql`:

```sql
CREATE TABLE IF NOT EXISTS trades (
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
    schema_version   INT NOT NULL,
    FOREIGN KEY (raw_id) REFERENCES raw_payloads(id)
);

CREATE INDEX IF NOT EXISTS idx_trades_mkt_out_time
    ON trades(venue, market_native_id, outcome_id, timestamp);

CREATE TABLE IF NOT EXISTS orderbook_snaps (
    venue            VARCHAR NOT NULL,
    market_native_id VARCHAR NOT NULL,
    outcome_id       VARCHAR NOT NULL,
    bids             JSON NOT NULL,
    asks             JSON NOT NULL,
    price_unit       VARCHAR NOT NULL,
    size_unit        VARCHAR NOT NULL,
    timestamp        TIMESTAMPTZ NOT NULL,
    raw_id           BIGINT NOT NULL,
    schema_version   INT NOT NULL,
    FOREIGN KEY (raw_id) REFERENCES raw_payloads(id)
);

CREATE INDEX IF NOT EXISTS idx_book_mkt_out_time
    ON orderbook_snaps(venue, market_native_id, outcome_id, timestamp);

CREATE TABLE IF NOT EXISTS price_points (
    venue            VARCHAR NOT NULL,
    market_native_id VARCHAR NOT NULL,
    outcome_id       VARCHAR NOT NULL,
    timestamp        TIMESTAMPTZ NOT NULL,
    price            DECIMAL(10,6) NOT NULL,
    native_price     DECIMAL(20,6) NOT NULL,
    price_unit       VARCHAR NOT NULL,
    volume           DECIMAL(20,4),
    volume_metric    VARCHAR NOT NULL,
    interval         VARCHAR NOT NULL,
    raw_id           BIGINT NOT NULL,
    schema_version   INT NOT NULL,
    PRIMARY KEY (venue, market_native_id, outcome_id, interval, timestamp),
    FOREIGN KEY (raw_id) REFERENCES raw_payloads(id)
);
```

- [ ] **Step 5: Write `005_aliases_tags.sql`**

Write `src/pytheum/data/schema/005_aliases_tags.sql`:

```sql
CREATE TABLE IF NOT EXISTS market_aliases (
    venue            VARCHAR NOT NULL,
    market_native_id VARCHAR NOT NULL,
    alias            VARCHAR NOT NULL,
    source           VARCHAR NOT NULL,
    PRIMARY KEY (venue, market_native_id, alias),
    FOREIGN KEY (venue, market_native_id) REFERENCES markets(venue, native_id),
    CHECK (source IN ('user', 'heuristic', 'venue'))
);

CREATE TABLE IF NOT EXISTS event_tags (
    event_venue      VARCHAR NOT NULL,
    event_native_id  VARCHAR NOT NULL,
    tag_venue        VARCHAR NOT NULL,
    tag_native_id    VARCHAR NOT NULL,
    PRIMARY KEY (event_venue, event_native_id, tag_venue, tag_native_id),
    FOREIGN KEY (event_venue, event_native_id) REFERENCES events(venue, native_id),
    FOREIGN KEY (tag_venue, tag_native_id)     REFERENCES categories(venue, native_id)
);
```

- [ ] **Step 6: Write `006_searchable_markets_view.sql`**

Write `src/pytheum/data/schema/006_searchable_markets_view.sql`:

```sql
CREATE OR REPLACE VIEW searchable_markets AS
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
    (SELECT list(o.token_id) FROM outcomes o
       WHERE o.venue = m.venue AND o.market_native_id = m.native_id) AS token_ids,
    (SELECT list(o.label) FROM outcomes o
       WHERE o.venue = m.venue AND o.market_native_id = m.native_id) AS outcome_labels,
    (SELECT list(tag_c.native_label)
       FROM event_tags et
       JOIN categories tag_c
         ON et.tag_venue = tag_c.venue AND et.tag_native_id = tag_c.native_id
       WHERE et.event_venue = m.event_venue
         AND et.event_native_id = m.event_native_id) AS tags,
    (SELECT list(a.alias) FROM market_aliases a
       WHERE a.venue = m.venue AND a.market_native_id = m.native_id) AS aliases,
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
        coalesce(array_to_string(
            (SELECT list(o.token_id) FROM outcomes o
              WHERE o.venue = m.venue AND o.market_native_id = m.native_id), ' '), ''),
        coalesce(array_to_string(
            (SELECT list(o.label) FROM outcomes o
              WHERE o.venue = m.venue AND o.market_native_id = m.native_id), ' '), ''),
        coalesce(array_to_string(
            (SELECT list(tag_c.native_label)
               FROM event_tags et
               JOIN categories tag_c
                 ON et.tag_venue = tag_c.venue AND et.tag_native_id = tag_c.native_id
               WHERE et.event_venue = m.event_venue
                 AND et.event_native_id = m.event_native_id), ' '), ''),
        coalesce(array_to_string(
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

Note: spec §5.3 shows `list_string_agg(...)` which is not a DuckDB built-in; the implementation uses `array_to_string(...)` which is the correct DuckDB function. This file is the source of truth — update the spec if the two ever diverge.

- [ ] **Step 7: Do NOT commit yet**

These SQL files are untested in isolation. Task 17 writes the DDL execution + search-view behaviour tests, runs them against these schema files, and produces the combined commit only after all tests pass. If the tests fail, fix the SQL *before* committing.

---

## Task 17: Storage — migration runner + DDL execution test

**Files:**
- Create: `src/pytheum/data/storage.py`
- Test: `tests/data/test_storage.py`

- [ ] **Step 1: Write the failing test (DDL execution test — Phase 1 DoD requirement)**

Write `tests/data/test_storage.py`:

```python
from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from pytheum.data.storage import Storage, SCHEMA_FILES, run_migrations


def test_schema_files_are_discoverable() -> None:
    # sanity — all expected migration files exist and are non-empty
    assert len(SCHEMA_FILES) >= 6
    for name, body in SCHEMA_FILES:
        assert name.endswith(".sql")
        assert len(body.strip()) > 0


def test_all_migrations_execute_cleanly(tmp_path: Path) -> None:
    """Every schema file must apply against a fresh DuckDB without error.

    This is the Phase 1 DoD "DDL execution test" from the spec.
    """
    db_path = tmp_path / "test.duckdb"
    with duckdb.connect(str(db_path)) as conn:
        run_migrations(conn)
        # Expected tables exist:
        expected_tables = {
            "raw_payloads",
            "categories",
            "events",
            "markets",
            "outcomes",
            "market_aliases",
            "event_tags",
            "trades",
            "orderbook_snaps",
            "price_points",
        }
        rows = conn.execute("SELECT table_name FROM information_schema.tables").fetchall()
        found = {r[0] for r in rows}
        missing = expected_tables - found
        assert not missing, f"missing tables: {missing}"

        # View exists and selects cleanly (even with no rows).
        conn.execute("SELECT * FROM searchable_markets LIMIT 0").fetchall()


def test_run_migrations_is_idempotent(tmp_path: Path) -> None:
    db_path = tmp_path / "test.duckdb"
    with duckdb.connect(str(db_path)) as conn:
        run_migrations(conn)
        run_migrations(conn)   # second run must not raise


def test_storage_wraps_connect(tmp_path: Path) -> None:
    db_path = tmp_path / "test.duckdb"
    storage = Storage(db_path)
    storage.migrate()
    with storage.connect() as conn:
        rows = conn.execute("SELECT COUNT(*) FROM raw_payloads").fetchone()
        assert rows is not None
        assert rows[0] == 0


def test_insert_raw_payload_and_normalized_row(tmp_path: Path) -> None:
    """Verify the FK chain: insert a raw_payloads row, then a categories row that references it."""
    db_path = tmp_path / "test.duckdb"
    storage = Storage(db_path)
    storage.migrate()
    with storage.connect() as conn:
        raw_id = conn.execute(
            """
            INSERT INTO raw_payloads (venue, transport, endpoint, received_ts,
                                       schema_version, payload)
            VALUES ('kalshi', 'rest', '/series/FED', CURRENT_TIMESTAMP, 1, '{}')
            RETURNING id
            """
        ).fetchone()
        assert raw_id is not None
        rid = raw_id[0]
        conn.execute(
            """
            INSERT INTO categories (venue, native_id, native_label, display_label,
                                     raw_id, schema_version, updated_ts)
            VALUES ('kalshi', 'FED', 'Economics', 'Economics', ?, 1, CURRENT_TIMESTAMP)
            """,
            [rid],
        )
        count = conn.execute("SELECT COUNT(*) FROM categories").fetchone()
        assert count is not None and count[0] == 1


def test_fk_violation_raises(tmp_path: Path) -> None:
    db_path = tmp_path / "test.duckdb"
    storage = Storage(db_path)
    storage.migrate()
    with storage.connect() as conn:
        with pytest.raises(duckdb.Error):
            # raw_id = 999 does not exist — FK should reject.
            conn.execute(
                """
                INSERT INTO categories (venue, native_id, native_label, display_label,
                                         raw_id, schema_version, updated_ts)
                VALUES ('kalshi', 'X', 'X', 'X', 999, 1, CURRENT_TIMESTAMP)
                """
            )


def _seed_full_chain(conn: duckdb.DuckDBPyConnection) -> None:
    """Insert a minimal Kalshi + Polymarket dataset for the search-view test."""
    # One raw payload per logical row; we reuse an id for simplicity.
    raw_id = conn.execute(
        """
        INSERT INTO raw_payloads (venue, transport, endpoint, received_ts,
                                   schema_version, payload)
        VALUES ('polymarket', 'rest', '/events', CURRENT_TIMESTAMP, 1, '{}')
        RETURNING id
        """
    ).fetchone()
    assert raw_id is not None
    rid = raw_id[0]

    conn.execute(
        """
        INSERT INTO categories (venue, native_id, native_label, display_label,
                                 raw_id, schema_version, updated_ts)
        VALUES ('polymarket', 'politics', 'Politics', 'Politics', ?, 1, CURRENT_TIMESTAMP)
        """,
        [rid],
    )
    conn.execute(
        """
        INSERT INTO events (venue, native_id, title,
                             primary_category_venue, primary_category_native_id,
                             closes_at, market_count, aggregate_volume,
                             volume_metric, url, raw_id, schema_version, updated_ts)
        VALUES ('polymarket', 'nyc-mayor-2026', 'NYC Mayor 2026',
                 'polymarket', 'politics',
                 NULL, 3, 4200.0,
                 'usd_total', 'https://polymarket.com/event/nyc-mayor-2026',
                 ?, 1, CURRENT_TIMESTAMP)
        """,
        [rid],
    )
    conn.execute(
        """
        INSERT INTO markets (venue, native_id, event_venue, event_native_id,
                              title, question, status,
                              total_volume, volume_metric, open_interest, liquidity,
                              closes_at, url, raw_id, schema_version, updated_ts)
        VALUES ('polymarket', 'adams-wins', 'polymarket', 'nyc-mayor-2026',
                 'Eric Adams wins', 'Will Eric Adams win NYC Mayor 2026?', 'open',
                 3100.0, 'usd_24h', NULL, NULL,
                 NULL, 'https://polymarket.com/event/nyc-mayor-2026/adams-wins',
                 ?, 1, CURRENT_TIMESTAMP)
        """,
        [rid],
    )
    for outcome_id, token, label in [
        ("token_yes_001", "token_yes_001", "YES"),
        ("token_no_002", "token_no_002", "NO"),
    ]:
        conn.execute(
            """
            INSERT INTO outcomes (venue, market_native_id, outcome_id, token_id, label,
                                   price, native_price, price_unit,
                                   volume, volume_metric,
                                   raw_id, schema_version, updated_ts)
            VALUES ('polymarket', 'adams-wins', ?, ?, ?,
                    0.24, 0.24, 'usdc',
                    NULL, 'unknown',
                    ?, 1, CURRENT_TIMESTAMP)
            """,
            [outcome_id, token, label, rid],
        )
    # tag
    conn.execute(
        """
        INSERT INTO categories (venue, native_id, native_label, display_label,
                                 raw_id, schema_version, updated_ts)
        VALUES ('polymarket', 'us-elections', 'us-elections', 'US Elections',
                ?, 1, CURRENT_TIMESTAMP)
        """,
        [rid],
    )
    conn.execute(
        """
        INSERT INTO event_tags (event_venue, event_native_id, tag_venue, tag_native_id)
        VALUES ('polymarket', 'nyc-mayor-2026', 'polymarket', 'us-elections')
        """
    )
    # alias
    conn.execute(
        """
        INSERT INTO market_aliases (venue, market_native_id, alias, source)
        VALUES ('polymarket', 'adams-wins', 'eric adams mayor', 'user')
        """
    )


def test_search_blob_contains_every_promised_field(tmp_path: Path) -> None:
    """The search view's search_blob MUST include: title, question, url,
    event_title, primary category label, token_ids, outcome labels,
    event tags, and aliases. Anything missing breaks spec §8.1."""
    db_path = tmp_path / "test.duckdb"
    storage = Storage(db_path)
    storage.migrate()
    with storage.connect() as conn:
        _seed_full_chain(conn)
        row = conn.execute(
            """
            SELECT search_blob
            FROM searchable_markets
            WHERE venue = 'polymarket' AND native_id = 'adams-wins'
            """
        ).fetchone()
    assert row is not None
    blob = row[0]
    for needle in (
        "Eric Adams wins",               # market title
        "Will Eric Adams win NYC",       # question
        "polymarket.com/event/nyc-mayor-2026/adams-wins",  # market url
        "NYC Mayor 2026",                # event title
        "Politics",                      # primary category display label
        "politics",                      # primary category native label
        "token_yes_001",                 # token id
        "token_no_002",                  # token id
        "YES",                           # outcome label
        "NO",                            # outcome label
        "us-elections",                  # event tag
        "eric adams mayor",              # alias
    ):
        assert needle in blob, f"search_blob missing {needle!r}\nblob was: {blob!r}"
```

- [ ] **Step 2: Run test, verify it fails**

```bash
uv run pytest tests/data/test_storage.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement storage + migrations**

Write `src/pytheum/data/storage.py`:

```python
"""DuckDB storage wrapper + migration runner."""
from __future__ import annotations

from contextlib import contextmanager
from importlib import resources
from pathlib import Path
from typing import Iterator

import duckdb

__all__ = ["Storage", "SCHEMA_FILES", "run_migrations"]


def _load_schema_files() -> list[tuple[str, str]]:
    """Return [(filename, sql), …] sorted by filename (numeric prefix order)."""
    pkg = resources.files("pytheum.data.schema")
    out: list[tuple[str, str]] = []
    for entry in pkg.iterdir():
        name = entry.name
        if not name.endswith(".sql"):
            continue
        out.append((name, entry.read_text(encoding="utf-8")))
    out.sort(key=lambda kv: kv[0])
    return out


SCHEMA_FILES: list[tuple[str, str]] = _load_schema_files()


def run_migrations(conn: duckdb.DuckDBPyConnection) -> None:
    """Apply every schema file in numeric order. Idempotent via CREATE ... IF NOT EXISTS."""
    for _name, sql in SCHEMA_FILES:
        conn.execute(sql)


class Storage:
    """Thin wrapper around a DuckDB file. One instance per process."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    def migrate(self) -> None:
        with self.connect() as conn:
            run_migrations(conn)

    @contextmanager
    def connect(self) -> Iterator[duckdb.DuckDBPyConnection]:
        conn = duckdb.connect(str(self.db_path))
        try:
            yield conn
        finally:
            conn.close()
```

- [ ] **Step 4: Configure package data for schema files**

Append to `pytheum-cli/pyproject.toml` under `[tool.hatch.build.targets.wheel]`:

```toml
[tool.hatch.build.targets.wheel]
packages = ["src/pytheum"]

[tool.hatch.build.targets.wheel.force-include]
"src/pytheum/data/schema" = "pytheum/data/schema"
```

Replace the existing `[tool.hatch.build.targets.wheel]` block with the above.

- [ ] **Step 5: Run test, verify it passes**

```bash
uv run pytest tests/data/test_storage.py -v
```

Expected: all 6 tests pass. If `test_fk_violation_raises` fails because DuckDB doesn't enforce FKs by default, replace that test body with a skip: `pytest.skip("DuckDB doesn't enforce FKs at insert time in this version")` and document the limitation — but first try upgrading `duckdb` in `pyproject.toml` to the latest.

- [ ] **Step 6: Commit schema + storage + tests together**

The SQL files written in Task 16 were intentionally held back until now. This commit includes them alongside the migration runner and DDL + search-view behaviour tests, so the repo history never contains untested DDL.

```bash
git add src/pytheum/data/schema/ \
        src/pytheum/data/storage.py \
        tests/data/test_storage.py \
        pyproject.toml
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "data: add DuckDB schema + migration runner + DDL/search-view tests"
```

---

## Task 18: CLI entrypoint — `pytheum doctor` (partial)

**Files:**
- Create: `src/pytheum/cli/doctor.py`
- Modify: `src/pytheum/cli/__init__.py` (register the doctor command)
- Test: `tests/cli/test_doctor.py`

- [ ] **Step 1: Write the failing test**

Write `tests/cli/test_doctor.py`:

```python
from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from pytheum.cli import app

runner = CliRunner()


def test_doctor_runs_and_reports_each_check(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    result = runner.invoke(app, ["doctor"])
    assert result.exit_code in (0, 2), result.output
    # Every line starts with [OK], [WARN], or [FAIL]
    for line in result.output.splitlines():
        s = line.strip()
        if not s or s.startswith(("pytheum", "─", "=")):
            continue
        assert s.startswith(("[OK]", "[WARN]", "[FAIL]")), f"bad line: {s!r}"
    # Must mention the core checks Phase 1 covers
    assert "Python" in result.output
    assert "DuckDB" in result.output
    assert "Config file" in result.output
    assert "Logs dir" in result.output


def test_doctor_exit_zero_in_clean_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    result = runner.invoke(app, ["doctor"])
    # Tolerate exit 2 (WARN only) but never FAIL.
    assert result.exit_code in (0, 2)
    assert "[FAIL]" not in result.output


def test_doctor_fails_when_config_file_invalid(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An existing but malformed config.toml must produce [FAIL] Config file and exit != 0, 2.
    This guards against config errors going silent."""
    monkeypatch.setenv("HOME", str(tmp_path))
    pytheum_dir = tmp_path / ".pytheum"
    pytheum_dir.mkdir()
    # Raw-secret rejection is a ConfigError path; use it to force a FAIL.
    (pytheum_dir / "config.toml").write_text(
        '[venues.polymarket]\nsigner_private_key = "0xdeadbeef"\n'
    )
    result = runner.invoke(app, ["doctor"])
    assert "[FAIL]" in result.output
    assert "Config file" in result.output
    assert result.exit_code == 1
```

- [ ] **Step 2: Run test, verify it fails**

```bash
uv run pytest tests/cli/test_doctor.py -v
```

Expected: `Usage:` error because `doctor` is not yet registered.

- [ ] **Step 3: Implement doctor**

Write `src/pytheum/cli/doctor.py`:

```python
"""pytheum doctor — partial implementation.

Phase 1 covers: Python version, DuckDB file, config file, logs dir,
terminal capability, keyring. Venue-reachability checks arrive in Phase 2.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

import duckdb
import typer
from rich.console import Console

from pytheum.core.config import Config, ConfigError, load_config
from pytheum.data.storage import Storage

console = Console()

MIN_PY = (3, 12)
_EXPECTED_CONFIG_PATH = Path.home() / ".pytheum" / "config.toml"


@dataclass
class Check:
    label: str
    status: str   # "OK" | "WARN" | "FAIL"
    detail: str = ""


def _resolve_config() -> tuple[Check, Config | None]:
    """Try to load the config from the canonical path. Return (check, cfg-or-None).

    If the file exists but is invalid (malformed TOML, raw-secret rejection),
    emit a FAIL check and return None — doctor still continues so other
    checks run, but the exit code will be non-zero.
    """
    if not _EXPECTED_CONFIG_PATH.exists():
        cfg = load_config(config_path=None)
        return Check("Config file", "WARN", f"{_EXPECTED_CONFIG_PATH} not present — using defaults"), cfg
    try:
        cfg = load_config(config_path=_EXPECTED_CONFIG_PATH)
    except ConfigError as e:
        return Check("Config file", "FAIL", f"{_EXPECTED_CONFIG_PATH}: {e}"), None
    return Check("Config file", "OK", str(_EXPECTED_CONFIG_PATH)), cfg


def _check_python() -> Check:
    major, minor = sys.version_info.major, sys.version_info.minor
    if (major, minor) >= MIN_PY:
        return Check("Python", "OK", f"{major}.{minor}.{sys.version_info.micro}")
    return Check("Python", "FAIL", f"need >= {MIN_PY[0]}.{MIN_PY[1]}, got {major}.{minor}")


def _check_duckdb(cfg: Config) -> Check:
    path = cfg.storage.duckdb_path
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        storage = Storage(path)
        storage.migrate()
    except Exception as e:  # noqa: BLE001
        return Check("DuckDB", "FAIL", f"file {path}: {e}")
    size = path.stat().st_size if path.exists() else 0
    return Check("DuckDB", "OK", f"{duckdb.__version__} · file {path} ({size} bytes)")


def _check_logs_dir(cfg: Config) -> Check:
    d = cfg.storage.logs_dir
    d.mkdir(parents=True, exist_ok=True)
    if os.access(d, os.W_OK):
        return Check("Logs dir", "OK", str(d))
    return Check("Logs dir", "FAIL", f"{d} not writable")


def _check_terminal() -> Check:
    term = os.environ.get("TERM", "?")
    colorterm = os.environ.get("COLORTERM", "")
    caps = [term]
    if "truecolor" in colorterm.lower() or "24bit" in colorterm.lower():
        caps.append("truecolor")
    caps.append("unicode")
    return Check("Terminal", "OK", " · ".join(caps))


def _check_keyring() -> Check:
    try:
        import keyring
        backend = type(keyring.get_keyring()).__name__
        return Check("Keyring backend", "OK", backend)
    except Exception as e:  # noqa: BLE001
        return Check("Keyring backend", "WARN", f"unavailable: {e}")


def _symbol(status: str) -> str:
    return {"OK": "[OK]", "WARN": "[WARN]", "FAIL": "[FAIL]"}[status]


def doctor_cmd() -> None:
    """Run health checks against Pytheum's local environment."""
    config_check, cfg = _resolve_config()
    # If the real config failed to load, fall back to in-memory defaults so
    # downstream checks (duckdb path, logs dir) still report useful results.
    effective_cfg = cfg if cfg is not None else load_config(config_path=None)

    checks: list[Check] = [
        _check_python(),
        config_check,
        _check_duckdb(effective_cfg),
        _check_logs_dir(effective_cfg),
        _check_terminal(),
        _check_keyring(),
    ]

    console.print("pytheum doctor")
    console.print("──────────────")
    for c in checks:
        line = f"{_symbol(c.status):<8} {c.label}"
        if c.detail:
            line += f" · {c.detail}"
        console.print(line)

    exit_code = 0
    if any(c.status == "FAIL" for c in checks):
        exit_code = 1
    elif any(c.status == "WARN" for c in checks):
        exit_code = 2
    raise typer.Exit(code=exit_code)
```

- [ ] **Step 4: Register the command in `src/pytheum/cli/__init__.py`**

Replace the existing `__init__.py` with:

```python
"""Typer CLI app — one-shot commands and the TUI launcher."""
from __future__ import annotations

import typer

from pytheum.cli.doctor import doctor_cmd

app = typer.Typer(
    name="pytheum",
    help="Pytheum — Kalshi + Polymarket CLI / TUI",
    no_args_is_help=True,
    add_completion=False,
)
app.command(name="doctor", help="Health checks against the local environment.")(doctor_cmd)
```

- [ ] **Step 5: Run test, verify it passes**

```bash
uv run pytest tests/cli/test_doctor.py -v
```

Expected: both tests pass.

- [ ] **Step 6: Manual smoke test**

```bash
uv run pytheum doctor
```

Expected: printed table of OK/WARN/FAIL lines; exit code 0 or 2 on a dev box.

- [ ] **Step 7: Commit**

```bash
git add src/pytheum/cli/doctor.py src/pytheum/cli/__init__.py tests/cli/test_doctor.py
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "cli: add pytheum doctor (partial — Phase 1 checks only)"
```

---

## Task 19: `.env.example` + final README polish

**Files:**
- Create: `pytheum-cli/.env.example`
- Modify: `pytheum-cli/README.md`

- [ ] **Step 1: Write `.env.example`**

Write `pytheum-cli/.env.example`:

```bash
# Pytheum — local environment overrides.
# Copy to .env and fill in values as needed.
#
# Every PYTHEUM_* variable follows the config path:
#   PYTHEUM_<SECTION>__<SUBSECTION>__<FIELD>=value
#
# Secrets are NOT read directly. Instead, point at an env var NAME
# or keyring service NAME.

# Non-secret config (optional):
# PYTHEUM_VENUES__KALSHI__RATE_LIMIT_PER_SEC=10
# PYTHEUM_VENUES__POLYMARKET__RATE_LIMIT_PER_SEC=10
# PYTHEUM_TUI__THEME=dark

# Kalshi auth (deferred to v2, but config slots exist):
# KALSHI_API_KEY=              # the real secret, referenced by config.toml's api_key_env_var
# PYTHEUM_VENUES__KALSHI__API_KEY_ENV_VAR=KALSHI_API_KEY

# Polymarket auth (deferred):
# POLY_SIGNER_PK=              # the real secret
# PYTHEUM_VENUES__POLYMARKET__SIGNER_PRIVATE_KEY_ENV=POLY_SIGNER_PK
```

- [ ] **Step 2: Update `README.md` with accurate Phase 1 status**

Replace `pytheum-cli/README.md` with:

```markdown
# Pytheum CLI

A keyboard-driven TUI + scriptable CLI for Kalshi and Polymarket prediction markets. REST + WebSockets, DuckDB-backed local storage, venue-native navigation.

**Status:** Phase 1 (foundation) — the core primitives, data layer, and a partial `pytheum doctor` command. Venue clients, app services, and TUI are separate phases.

See `docs/specs/2026-04-24-pytheum-cli-design.md` for the full design.

## Install (development)

Requires Python ≥ 3.12 and [uv](https://docs.astral.sh/uv/).

```bash
git clone <repo-url>
cd pytheum-cli
uv sync
```

## Use

```bash
uv run pytheum doctor     # health checks for Python, DuckDB, config, logs, terminal, keyring
uv run pytheum --help
```

## Run the tests

```bash
uv run pytest -v
uv run mypy src/pytheum
uv run ruff check src tests
```

## Local paths

- `~/.pytheum/config.toml` — non-secret config (optional)
- `~/.pytheum/pytheum.duckdb` — primary storage (created on first `pytheum doctor`)
- `~/.pytheum/watchlist.toml` — hand-editable watchlist (Phase 3+)
- `~/.pytheum/logs/` — daily-rotated JSON logs

## License

MIT — see `LICENSE`.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git -c user.name="Konstantinos Anagnostopoulos" \
    -c user.email="147280494+konstantinosanagn@users.noreply.github.com" \
    commit -m "docs: add .env.example and polish README for Phase 1"
```

---

## Task 20: Final Phase 1 verification

- [ ] **Step 1: Run every test in the repo**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
uv run pytest -v
```

Expected: all tests pass, no skips (except the DuckDB-FK skip if it applied in Task 17).

- [ ] **Step 2: Run mypy strict**

```bash
uv run mypy src/pytheum
```

Expected: `Success: no issues found` across all modules.

- [ ] **Step 3: Run ruff**

```bash
uv run ruff check src tests
uv run ruff format --check src tests
```

Expected: no issues. If `ruff format --check` fails, run `uv run ruff format src tests` and re-commit.

- [ ] **Step 4: Verify `pytheum doctor` end-to-end**

```bash
uv run pytheum doctor
```

Expected: exit code 0 or 2; all lines prefixed `[OK]` / `[WARN]`; at minimum Python, DuckDB, Config file, Logs dir, Terminal, Keyring reported.

- [ ] **Step 5: Verify `~/.pytheum/pytheum.duckdb` is created with the full schema**

```bash
uv run python -c "
import duckdb
conn = duckdb.connect('/Users/kanagn/.pytheum/pytheum.duckdb')
tables = [r[0] for r in conn.execute('SHOW TABLES').fetchall()]
print('tables:', sorted(tables))
views = [r[0] for r in conn.execute('SELECT table_name FROM information_schema.views').fetchall()]
print('views:', sorted(views))
"
```

Expected: prints the 10 normalized tables + `raw_payloads` + the `searchable_markets` view.

- [ ] **Step 6: Tag the phase**

```bash
cd /Users/kanagn/Desktop/pytheum-cli
git tag -a phase-1-foundation -m "Phase 1 (Foundation) complete"
```

(Do not push to a remote yet — that's a separate user decision.)

---

## Phase 1 Definition of Done

- [ ] `pytheum doctor` runs and prints OK/WARN/FAIL lines for Python, DuckDB, config, logs dir, terminal, keyring
- [ ] Every test in `tests/` passes under `uv run pytest -v`
- [ ] `uv run mypy src/pytheum` reports no issues
- [ ] `uv run ruff check src tests` reports no issues
- [ ] DDL execution test (`tests/data/test_storage.py::test_all_migrations_execute_cleanly`) passes — every schema file applies against a fresh DuckDB and the `searchable_markets` view selects cleanly
- [ ] FK chain verified: `raw_payloads` insert → `categories` insert with `raw_id` FK succeeds
- [ ] Tagged `phase-1-foundation` in the `pytheum-cli` repo
- [ ] Next: plan Phase 2 (venue clients) as a separate spec-aligned implementation plan
