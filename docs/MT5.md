# MetaTrader 5 in SAM — read-only, real data only

SAM can show your **real** MetaTrader 5 account: balance, equity, open positions and a trade journal with
risk metrics. It is **read-only** (there is no way to place, change or close a trade from SAM) and it shows
**only real numbers** — there is no sample or demo data anywhere in the product.

| Where | What |
|---|---|
| Tools | `mt5_account`, `mt5_positions`, `mt5_history` (safe tier, auto-run) |
| HUD | Command palette → **MetaTrader 5 (read-only)** |
| API | `GET /api/mt5/summary?days=30` → `{connected:false, reason}` or `{connected:true, …}` |

## Not connected is a normal state
With nothing configured the tools say *"MetaTrader 5 isn't connected"* and the HUD shows a **Not connected**
panel. SAM never fills the gap with made-up numbers. (Earlier builds defaulted to a mock backend that showed a
fake account; that was removed. `MT5_BACKEND=mock` is now refused with an error, and the mock lives in test
code only.)

## Connecting
SAM reads one JSON file that a program running **inside** your MT5 terminal writes (an Expert Advisor):

```bash
MT5_FILE=/path/to/mt5.json npm start
```

| Variable | Meaning |
|---|---|
| `MT5_FILE` | Path to the JSON file (schema below). Setting it is the opt-in. |
| `MT5_ALLOW_LIVE_READ=1` | Also allow a **real-money** account to be read. Off by default: demo/contest only. |
| `MT5_BACKEND` | Optional. Only `file` is accepted. `mock` is refused. |

If the file doesn't exist yet (the terminal hasn't written it), SAM reports *not connected*, not an error.

## Safety
- **Read-only by construction** — the adapter interface has no write methods.
- **The file is untrusted input.** It comes from a program SAM can't see, so SAM validates it strictly: exact
  schema, finite numbers, a **masked** account number only (`***123`, never a full login), size/row caps
  (1 MB, 200 positions, 1,000 deals), unknown fields ignored. A malformed or half-written file is rejected
  with a clear error and is never guessed around.
- **Honest freshness.** Every answer carries an *as-of* time and is labelled **STALE** if the reading is more
  than 30 minutes old (for example the terminal was closed).
- **Realised P/L** is `profit + commission + swap` per closing deal.

## Schema `flipit-mt5/1`
```json
{
  "schema": "flipit-mt5/1", "asOf": "2026-09-26T21:00:00Z",
  "terminal": { "build": 5000, "company": "Broker Ltd", "server": "Broker-Demo" },
  "account": { "loginMasked": "***321", "currency": "USD", "balance": 10000, "equity": 10012.5, "margin": 100,
               "freeMargin": 9912.5, "leverage": 100, "mode": "demo", "tradeAllowed": false },
  "positions": [{ "ticket": 1, "symbol": "EURUSD", "side": "buy", "volume": 0.1, "openPrice": 1.085,
                  "price": 1.088, "profit": 30, "swap": 0, "sl": 0, "tp": null, "openedAt": "2026-09-26T08:00:00Z" }],
  "deals": [{ "ticket": 9, "symbol": "GBPUSD", "side": "sell", "volume": 0.1, "price": 1.27, "profit": -12.5,
              "commission": -0.7, "swap": -0.3, "closedAt": "2026-09-25T15:00:00Z" }],
  "historyDays": 30, "truncated": { "positions": false, "deals": false }
}
```
`mode` is `demo`, `contest`, `real` or `unknown`. A deal's `side` is the **deal's** direction (a *sell* closes a
long). Any program that writes this shape works; the reference writer is the *FlipItReporter* Expert Advisor.

## Limits (honest)
- The reference Expert Advisor is new and had not been compiled or run against a live terminal when this
  page was written. The test files in this repo are **synthetic**: they prove SAM's parser is strict, not that
  a particular terminal emits exactly this output.
- No live quotes: the file carries account, positions and closed deals only.
- SAM does not trade. Nothing here is financial advice.
