# @grey-ridge/vercel-ai-swap-gate

**Pre-trade token-safety gate for Base trading agents — a Vercel AI SDK tool.** Drop one `tool` into your agent and it runs *before every swap*: is this token a honeypot, can you actually sell it, do its admin controls let the deployer rug it, and is your order too big for the pool? Your model gets the full verdict plus a single `proceed` boolean it can branch on — in one fast call.

Paid inline per call with **x402 USDC — $0.008/call**. No API key, no dashboard, no subscription. Base-native. **Fails closed:** if the gate is ever unreachable the tool returns `proceed: false`, so an outage can never green-light a swap.

```
A honeypot or a 30% round-trip tax costs your agent real funds on a single trade.
This check costs $0.008 and runs in one tool call before the swap fires.
```

## Why this over the alternatives

| | vercel-ai-swap-gate | GoPlus token API | 1inch / router safety | roll-your-own tool |
|---|---|---|---|---|
| Ships as an AI SDK `tool` (drop into `generateText`) | ✅ | you wrap it | you wrap it | you build it |
| Honeypot + **sellability** sim | ✅ | partial | — | you build it |
| **Liquidity-vs-your-size** price-impact guard | ✅ | — | partial | you build it |
| **Round-trip** entry+exit slippage sizing | ✅ | — | — | you build it |
| Admin-control / mint / blacklist checks | ✅ | ✅ | — | you build it |
| **Fails closed** on outage (never a silent go) | ✅ | you handle it | you handle it | you build it |
| Pay-per-call, no key, no signup | ✅ x402 USDC | API-key tiers | key/SDK | — |
| Base-native | ✅ | multi-chain | multi-chain | — |

Price point: **~1/25th** of pre-trade checks that bill up to $0.25/call.

## Install

```bash
npm install github:rezearcher/vercel-ai-swap-gate ai zod
# or: pnpm add github:rezearcher/vercel-ai-swap-gate ai zod
```

The build is committed, so the git install needs no compile step.

`ai` (Vercel AI SDK v4/v5) and `zod` are peer dependencies — the SDK you already build your agent with.

## Use

```ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { createSwapGuard } from "@grey-ridge/vercel-ai-swap-gate";

const swapGuard = createSwapGuard({
  privateKey: process.env.PRIVATE_KEY, // agent's Base wallet; signs the $0.008 x402 payment
  defaultNotionalUsd: 100,
  maxBreakevenPct: 15,
  maxExitSlippagePct: 10,
});

const { text } = await generateText({
  model: openai("gpt-4o"),
  tools: { swapGuard },
  prompt: "Should I buy $50 of 0x4ed4e862860bed51a9570b96d89af5e1b0efefed on Base?",
});
```

The tool returns the full gate response **plus** three fields your agent can act on directly:

```jsonc
{
  "decision": "go",
  "risk_score": 20,
  "liquidity_usd": 250147,
  "flags": ["transfers can be paused"],
  "sizing": { "entry_sim": { /* … */ }, "exit_sim": { /* … */ } },
  "proceed": true,                       // ← branch on this
  "guard_reasons": ["cleared"],
  "summary": "GO: token passes safety checks · risk 20/100 · liquidity $250,147"
}
```

Branch your trade on `proceed`. It is `true` only when the gate says `go` **and** the round-trip friction and exit slippage are within your thresholds; it is `false` on any BLOCK/HOLD, any threshold breach, or any gate error (fail-closed).

### Zero-config

A pre-built `swapGuard` reads `PRIVATE_KEY` (and optional `SWAP_GATE_BASE_URL`) from the environment:

```ts
import { swapGuard } from "@grey-ridge/vercel-ai-swap-gate";
await generateText({ model, tools: { swapGuard }, prompt });
```

## Second tool: `tokenReport` (token screening)

`swapGuard` is the final gate *at the moment you swap*, sized to a notional. `tokenReport` is the companion for **screening a candidate token earlier** — a research or watchlist step that answers "is this token worth trading at all?" without a trade size. It wraps `/chain/token-report` (**$0.01 USDC/call**) and returns a `SAFE | CAUTION | AVOID` verdict with `risk_score`, the full security breakdown, and a single `safe` boolean. Like the gate, it **fails closed** (`safe: false`, verdict `AVOID`) if the route is unreachable.

```ts
import { createTokenReport } from "@grey-ridge/vercel-ai-swap-gate";

const tokenReport = createTokenReport({ privateKey: process.env.PRIVATE_KEY });

const { text } = await generateText({
  model: openai("gpt-4o"),
  tools: { tokenReport },            // screen first…
  prompt: "Is 0x4ed4e862860bed51a9570b96d89af5e1b0efefed worth trading on Base?",
});
```

```jsonc
{
  "verdict": "SAFE",
  "risk_score": 20,
  "security": { "isHoneypot": false, "sellable": true, "ownerRenounced": false, "canPause": true },
  "liquidity": { "wethPoolUsd": 251940 },
  "safe": true,                          // ← branch on this
  "guard_reasons": ["cleared — SAFE"],
  "summary": "SAFE: risk 20/100 · liquidity $251,940 · transfers can be paused"
}
```

A zero-config `tokenReport` is exported too (reads `PRIVATE_KEY` from env). Wire **both** tools into one agent — `tokenReport` to screen candidates, `swapGuard` to clear the actual order.

## Configure

`createSwapGuard(options)`:

| Option | Default | Purpose |
|---|---|---|
| `privateKey` | — | Hex key of the agent's Base wallet; signs the x402 USDC payment. Omit → free preview path only. |
| `defaultNotionalUsd` | `100` | Default trade size for the liquidity / sizing checks when the model omits `notional_usd`. |
| `maxBreakevenPct` | `15` | Set `proceed:false` on a `go` whose round-trip friction exceeds this %. |
| `maxExitSlippagePct` | `10` | Set `proceed:false` on a `go` whose modelled exit slippage exceeds this %. |
| `base` | hosted Worker | Override the gate endpoint base URL. |
| `payFetch` | derived from `privateKey` | Inject a pre-built x402 fetch (mainly for tests). |

The tool's input schema (what the model fills) is `{ token, side?: "buy"|"sell", notional_usd? }`.

## Scope & honesty

This is a **heuristic, static pre-trade risk signal** — not financial advice and not a guarantee. `go` means our checks found no blocker at scan time; it is **not** a promise the token is safe, and on-chain state changes after the scan. Size positions accordingly. Every response carries a `disclaimer` field.

## What the gate checks

Honeypot & transfer-tax simulation · sellability (can you exit) · admin controls (mint, blacklist, pausable, ownership) · Uniswap v3 WETH-pool liquidity vs. your notional (price-impact guard) · entry-leg and exit-leg slippage with a `$100 / $1k / $10k / $50k` sizing ladder.

## Try it free

```bash
curl "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=degen"
```

Free, no-wallet preview (rate-limited). The paid tool call adds the full `sizing` block.

## Links

- Endpoint & docs: https://x402-data-api.sigrunner.workers.dev
- By Grey Ridge Signals Group LLC

MIT licensed.
