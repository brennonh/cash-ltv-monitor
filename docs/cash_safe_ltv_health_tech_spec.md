# Tech Spec: Cash Safe LTV Health Monitoring System

**Author:** Engineering  
**Status:** Draft  
**Last Updated:** 2026-05-28  
**Repo:** [etherfi-protocol/cash-v3](https://github.com/etherfi-protocol/cash-v3/tree/master)

---

## 1. Overview

This document describes the design and implementation plan for a monitoring service that tracks the LTV (Loan-to-Value) health of all ether.fi Cash user safes. The system must identify safes approaching or breaching their liquidation threshold and surface this information to the ether.fi operations team.

---

## 2. Background & Domain Model

### 2.1 How Borrowing Works

ether.fi Cash users hold assets inside an `EtherFiSafe` — a multi-signature smart contract wallet. When a user spends via their Cash card in **Credit (Borrow) Mode**, the `CashModule` calls `spend()` on the safe, which in turn borrows USDC from the `DebtManager` contract. The debt is recorded on-chain in the `DebtManager`.

```
User Card Spend
      │
      ▼
EtherFiSafe.spend()
      │  (if Credit Mode)
      ▼
DebtManager.borrow()
      │
      ├─ Records debt against safe
      └─ Transfers USDC to settlement
```

### 2.2 LTV Health Formula

Each asset held by the safe has a configured **LTV ratio** (e.g. liquidUSD @ 80%, USDC @ 90%, liquidETH @ 50%). The **maximum borrowable amount** is:

```
Max Borrow = Σ (asset_balance_usd × asset_ltv)
```

The safe becomes eligible for **liquidation** when:

```
Total Borrowed USD > Σ (asset_balance_usd × liquidation_threshold_ltv)
```

A **Health Factor** can be derived as:

```
Health Factor = Max Borrow Capacity / Total Borrowed
```

- Health Factor > 1.0 → Safe (room to borrow)
- Health Factor = 1.0 → At limit
- Health Factor < 1.0 → Liquidatable

### 2.3 Relevant Contracts

| Contract | Role |
|---|---|
| `EtherFiSafe` | User's multi-sig wallet holding collateral assets |
| `CashModule` | Financial operations module (spending, mode switching) |
| `DebtManager` | Tracks outstanding USDC debt per safe |
| `CashLens` | Read-only view contract — aggregates health data from CashModule, DebtManager, PriceProvider |
| `PriceProvider` | Oracle for asset USD prices |
| `EtherFiDataProvider` | System-wide config aggregator |

**The `CashLens` contract is the primary read interface** and should be the entry point for all health queries. Key methods:
- `getSafeCashData(vault)` — returns comprehensive account state including collateral, debt, mode, and max spendable
- `canSpend(vault, ...)` — pre-flight validation that checks health constraints
- `getMaxSpendCredit(vault)` — returns the remaining credit capacity

---

## 3. Goals

- Monitor the LTV health of **all** user safes in real time (or near real-time)
- Alert the ether.fi ops team when a safe's health factor crosses defined warning and critical thresholds
- Store historical health snapshots for audit and trend analysis
- Provide a simple operational dashboard or queryable API
- Be runnable with a quick-start setup (Docker or single command)

### 3.1 Non-Goals (v1)

- Automated on-chain liquidation triggering (ops team acts manually)
- User-facing UI
- Cross-chain aggregation beyond the primary deployment chain (Scroll mainnet, chain ID 534352)

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Monitoring Service                 │
│                                                     │
│  ┌────────────┐   ┌──────────────┐   ┌───────────┐  │
│  │Safe Indexer│──▶│Health Calc   │──▶│Alert Eng. │  │
│  │(RPC poller)│   │(LTV + HF)    │   │(thresholds│  │
│  └────────────┘   └──────┬───────┘   └───────────┘  │
│                          │                          │
│                   ┌──────▼───────┐                  │
│                   │  Storage DB  │                  │
│                   │ (Postgres or │                  │
│                   │  SQLite)     │                  │
│                   └──────────────┘                  │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  REST API / CLI query interface              │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
         │
         ▼ (reads via eth_call)
┌─────────────────────┐
│   Scroll RPC Node   │
│  CashLens contract  │
│  DebtManager        │
│  EtherFiDataProvider│
└─────────────────────┘
```

### 4.1 Components

**Safe Indexer**
- Maintains the set of known safe addresses
- Discovers new safes by indexing `SafeDeployed` events from the factory contract (or bootstrapped from `EtherFiDataProvider`)
- Polls on a configurable interval (default: every block or every 30s)

**Health Calculator**
- For each safe: calls `CashLens.getSafeCashData(vault)` via `eth_call`
- Computes Health Factor and flags risk tier
- Batches calls using `eth_call` multicall to minimise RPC round trips

**Alert Engine**
- Evaluates health thresholds and emits alerts
- Supports webhook (Slack/PagerDuty) and log-based notification
- Deduplicates alerts (don't re-fire if already alerted for same safe/tier)

**Storage**
- Persists periodic health snapshots per safe (timestamp, HF, borrow amount, collateral value)
- Enables trend queries (e.g. safes whose HF has been declining over the past hour)

**API / CLI**
- `GET /safes` — list all tracked safes with current health
- `GET /safes/:address` — health detail for one safe
- `GET /safes/at-risk` — filter to warning/critical tier only
- CLI: `npm run report` — prints a table of all safes sorted by Health Factor

---

## 5. Data Model

### 5.1 `safe_snapshot` table

| Column | Type | Description |
|---|---|---|
| `id` | SERIAL PK | |
| `safe_address` | TEXT | Checksum address of the EtherFiSafe |
| `captured_at` | TIMESTAMPTZ | When the snapshot was taken |
| `block_number` | BIGINT | Block at time of snapshot |
| `total_collateral_usd` | NUMERIC | Sum of all asset values in USD |
| `total_borrowed_usd` | NUMERIC | Outstanding USDC debt |
| `max_borrow_capacity_usd` | NUMERIC | Σ(balance × LTV) |
| `health_factor` | NUMERIC | `max_borrow_capacity / total_borrowed` (NULL if no debt) |
| `risk_tier` | TEXT | `HEALTHY`, `WARNING`, `CRITICAL`, `LIQUIDATABLE` |
| `is_in_borrow_mode` | BOOLEAN | Whether the safe is in Credit Mode |
| `raw_lens_data` | JSONB | Full `getSafeCashData` response for auditability |

### 5.2 `safe_registry` table

| Column | Type | Description |
|---|---|---|
| `safe_address` | TEXT PK | |
| `owner_address` | TEXT | EOA owner |
| `first_seen_block` | BIGINT | Block the safe was first discovered |
| `last_checked_at` | TIMESTAMPTZ | Last successful health poll |
| `active` | BOOLEAN | Whether to keep monitoring |

### 5.3 Risk Tier Thresholds (configurable)

| Tier | Health Factor Range |
|---|---|
| `HEALTHY` | HF > 1.3 |
| `WARNING` | 1.1 < HF ≤ 1.3 |
| `CRITICAL` | 1.0 < HF ≤ 1.1 |
| `LIQUIDATABLE` | HF ≤ 1.0 |

> These thresholds should be environment-variable configurable.

---

## 6. Implementation Plan

### 6.1 Tech Stack (recommended)

- **Language:** TypeScript (Node.js)
- **Blockchain library:** `viem` (lightweight, typed ABI calls) or `ethers.js v6`
- **Database:** PostgreSQL (production) / SQLite (local quick-start)
- **ORM/query:** `drizzle-orm` or raw `pg`
- **Scheduler:** Simple `setInterval` loop or `node-cron`
- **Alerts:** Axios POST to Slack Incoming Webhook URL
- **Config:** `.env` file with `dotenv`

### 6.2 Milestones

**Milestone 1 — On-chain Read (Day 1)**
- Set up repo, `tsconfig`, `viem` client pointed at Scroll mainnet RPC
- Load `CashLens` ABI from the public repo
- Write `getSafeHealth(safeAddress: Address)` that calls `CashLens.getSafeCashData` and returns a typed health object
- Write unit test with a mocked RPC response

**Milestone 2 — Safe Discovery (Day 1–2)**
- Implement `SafeIndexer`: subscribe to or replay `SafeCreated` / equivalent factory events to build the initial safe registry
- Persist discovered safes to `safe_registry`
- Validate against the Dune dashboard totals as a sanity check

**Milestone 3 — Poll Loop & Storage (Day 2)**
- Implement batched multicall over all known safes
- Insert `safe_snapshot` rows on each poll cycle
- Implement Health Factor calculation and risk tier assignment

**Milestone 4 — Alerting (Day 2)**
- Alert Engine reads latest snapshots
- Fires Slack webhook when a safe transitions into WARNING, CRITICAL, or LIQUIDATABLE tier
- Adds cooldown to prevent alert spam (re-alert only after 1h or on tier change)

**Milestone 5 — API & README (Day 2)**
- Thin Express (or Fastify) HTTP layer exposing the three endpoints above
- `README.md` with architecture overview and environment variables table
- `QUICKSTART.md` with Docker Compose setup

### 6.3 Environment Variables

```bash
# RPC
SCROLL_RPC_URL=https://rpc.scroll.io

# Contract addresses (Scroll mainnet, chain 534352)
CASH_LENS_ADDRESS=0x...
DEBT_MANAGER_ADDRESS=0x...
SAFE_FACTORY_ADDRESS=0x...

# Polling
POLL_INTERVAL_MS=30000
POLL_BATCH_SIZE=50

# Thresholds
HF_WARNING_THRESHOLD=1.3
HF_CRITICAL_THRESHOLD=1.1
HF_LIQUIDATABLE_THRESHOLD=1.0

# Alerts
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
ALERT_COOLDOWN_MS=3600000

# DB
DATABASE_URL=postgres://user:pass@localhost:5432/ltv_monitor
```

---

## 7. Key Contract Calls

### 7.1 Fetching safe health via CashLens

```typescript
import { createPublicClient, http } from 'viem'
import { scroll } from 'viem/chains'

const client = createPublicClient({
  chain: scroll,
  transport: http(process.env.SCROLL_RPC_URL),
})

// CashLens.getSafeCashData(address vault) returns SafeCashData
const data = await client.readContract({
  address: CASH_LENS_ADDRESS,
  abi: cashLensAbi,
  functionName: 'getSafeCashData',
  args: [safeAddress],
})
```

### 7.2 Batching with multicall

```typescript
const calls = safeAddresses.map(addr => ({
  address: CASH_LENS_ADDRESS,
  abi: cashLensAbi,
  functionName: 'getSafeCashData',
  args: [addr],
}))

const results = await client.multicall({ contracts: calls, allowFailure: true })
```

### 7.3 Health Factor calculation

```typescript
function computeHealthFactor(data: SafeCashData): number | null {
  if (data.totalBorrowedUsd === 0n) return null // no debt, no risk
  const hf = Number(data.maxBorrowCapacityUsd) / Number(data.totalBorrowedUsd)
  return hf
}
```

---

## 8. Repo Structure

```
cash-ltv-monitor/
├── src/
│   ├── indexer/
│   │   └── safeIndexer.ts       # Event-based safe discovery
│   ├── health/
│   │   ├── lensClient.ts        # CashLens read calls
│   │   └── calculator.ts        # Health factor + tier logic
│   ├── alerts/
│   │   └── slackAlerter.ts      # Webhook notifications
│   ├── db/
│   │   ├── schema.ts            # Table definitions
│   │   └── queries.ts           # Insert/select helpers
│   ├── api/
│   │   └── server.ts            # Express routes
│   └── index.ts                 # Entry point / poll loop
├── abis/
│   ├── CashLens.json
│   └── DebtManager.json
├── docker-compose.yml
├── .env.example
├── README.md
└── QUICKSTART.md
```

---

## 9. Testing

- **Unit tests** (`vitest` or `jest`): mock RPC calls, test HF calculation and tier assignment edge cases (zero debt, zero collateral, exactly at threshold)
- **Integration test**: fork Scroll mainnet with `anvil --fork-url $SCROLL_RPC_URL`, run the indexer against real contract state, assert that known at-risk safes are flagged correctly
- **Snapshot regression**: capture `getSafeCashData` output for a set of known safes and assert the health calculation is stable

---

## 10. Deliverables

- [ ] GitHub repo with all source code
- [ ] `README.md` — architecture overview, env vars, how it works
- [ ] `QUICKSTART.md` — `docker compose up` or `npm install && npm run dev`
- [ ] `.env.example` with all required variables documented
- [ ] At least one passing integration test against forked mainnet

---

## 11. Open Questions / Decisions for Pair Programming Session

1. **Safe discovery source of truth** — Is there a canonical `SafeCreated` event in the factory, or should we bootstrap from an existing Dune query / subgraph?
2. **Liquidation threshold vs LTV** — Does `CashLens.getSafeCashData` already expose the liquidation threshold separately from the borrow LTV, or do we need to read collateral config from `DebtManager` directly?
3. **Chain scope** — Is the monitoring needed only on Scroll (534352), or also on other chains (Base, Arbitrum)?
4. **Alert recipients** — Who receives alerts? Slack channel + PagerDuty on-call rotation?
5. **Historical retention** — How long should snapshots be retained? Should old snapshots be archived or pruned?
