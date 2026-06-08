# cash-ltv-monitor

A NestJS service that monitors the LTV (Loan-to-Value) health of all ether.fi Cash user safes on Optimism mainnet. It polls the `CashLens` contract, stores health snapshots in SQLite, fires Slack alerts when safes approach liquidation, and exposes a REST API for the ops team.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  NestJS Application                 │
│                                                     │
│  SafeIndexerService   ──▶  Discovers safes from        │
│  (onModuleInit)             BeaconProxyDeployed events │
│                                                     │
│  MonitorService        ──▶  Poll loop (every 30s)   │
│  (@Cron)                    multicall → CashLens    │
│                                                     │
│  HealthCalculatorService ▶  Computes HF & risk tier │
│                                                     │
│  AlertService          ──▶  Slack webhook w/cooldown│
│                                                     │
│  ApiController         ──▶  REST endpoints          │
│                                                     │
│  SQLite (TypeORM)      ──▶  Snapshots + registry    │
└─────────────────────────────────────────────────────┘
         │  eth_call / getLogs
         ▼
   Optimism RPC → CashLens, DebtManager, SafeFactory
```

## Database Schema

**`safe_registry`** — known user safes  
**`safe_snapshot`** — periodic health readings (Health Factor, risk tier, borrow/collateral USD)  
**`alert_log`** — record of sent alerts (used for cooldown deduplication)

## Risk Tiers

| Tier | Health Factor |
|---|---|
| `HEALTHY` | HF > 1.3 |
| `WARNING` | 1.1 < HF ≤ 1.3 |
| `CRITICAL` | 1.0 < HF ≤ 1.1 |
| `LIQUIDATABLE` | HF ≤ 1.0 |
| `NO_DEBT` | No outstanding borrow |

Health Factor = `maxBorrowCapacity / totalBorrowed`

## REST API

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe |
| `GET` | `/safes` | All tracked safes with latest snapshot |
| `GET` | `/safes/at-risk` | Safes in WARNING / CRITICAL / LIQUIDATABLE tier |
| `GET` | `/safes/:address` | Detail + history for one safe |
| `POST` | `/safes/register` | Manually add a safe to the registry |
| `POST` | `/monitor/run-now` | Trigger an immediate poll cycle |

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|---|---|
| `RPC_URL` | Chain RPC endpoint (Optimism, Scroll, Base, etc.) |
| `CASH_LENS_ADDRESS` | `CashLens` contract address (same across all chains) |
| `DEBT_MANAGER_ADDRESS` | `DebtManager` contract address (same across all chains) |
| `SAFE_FACTORY_ADDRESS` | Factory that emits `BeaconProxyDeployed` events (same across all chains) |
| `INDEX_FROM_BLOCK` | Block to start scanning for safes (set to factory deploy block on your chain) |
| `POLL_INTERVAL_MS` | Unused — poll cycle is currently hardcoded to 30s |
| `HF_WARNING_THRESHOLD` | Health Factor below which WARNING fires (default 1.3) |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook for alerts |
| `DB_PATH` | SQLite file path (default `./data/ltv_monitor.sqlite`) |

---

See [QUICKSTART.md](./QUICKSTART.md) to get running in under 5 minutes.
