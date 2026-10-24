import * as ai from 'ai';

// Types for the dependency-free core (gate.mjs).

declare const GATE_BASE: string;

interface GateArgs {
  token: string;
  side?: "buy" | "sell";
  notionalUsd?: number;
  base?: string;
}

interface GateResponse {
  token?: string;
  side?: "buy" | "sell";
  notional_usd?: number;
  decision?: "go" | "hold" | "block" | string;
  reason?: string;
  verdict?: string;
  risk_score?: number;
  liquidity_usd?: number;
  impact_pct_of_pool?: number;
  flags?: string[];
  token_meta?: { symbol?: string; name?: string; decimals?: number };
  analyzed_at?: string;
  disclaimer?: string;
  sizing?: {
    max_safe_notional_usd?: number;
    this_trade?: { price_impact_pct?: number };
    entry_sim?: { this_trade?: { roundtrip_breakeven_pct?: number } };
    exit_sim?: { this_trade?: { slippage_pct?: number; net_recovered_usd?: number } };
  };
  [k: string]: unknown;
}

interface TradeDecision {
  go: boolean;
  reasons: string[];
}

declare function extractToken(text: string | null | undefined): string | null;
declare function buildGateUrl(args?: GateArgs): string;
declare function summarizeGate(out: GateResponse | null | undefined): string;
declare function evaluateTrade(
  out: GateResponse | null | undefined,
  opts?: { maxBreakevenPct?: number; maxExitSlippagePct?: number }
): TradeDecision;
declare function fetchGate(
  payFetch: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<GateResponse> }>,
  args?: GateArgs
): Promise<GateResponse>;

interface GuardResult extends GateResponse {
  proceed: boolean;
  guard_reasons: string[];
  summary: string;
}

declare function runGuard(
  payFetch: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<GateResponse> }>,
  args?: GateArgs,
  opts?: { maxBreakevenPct?: number; maxExitSlippagePct?: number }
): Promise<GuardResult>;

type PayFetch = (url: string) => Promise<Response>;

interface SwapGuardOptions {
    /** Pre-built x402-paying fetch; overrides `privateKey`. Mainly for tests. */
    payFetch?: PayFetch;
    /** Hex private key of the agent's Base wallet; signs the $0.008 USDC x402 payment. Omit for the free preview path only. */
    privateKey?: string;
    /** Override the gate base URL (defaults to the hosted Grey Ridge Worker). */
    base?: string;
    /** Default trade size (USD) for the liquidity / price-impact / sizing checks. */
    defaultNotionalUsd?: number;
    /** Skip a trade whose round-trip friction (entry+exit) exceeds this percent. */
    maxBreakevenPct?: number;
    /** Skip a trade whose modelled exit slippage exceeds this percent. */
    maxExitSlippagePct?: number;
}
/**
 * Build a Vercel AI SDK tool that gates a Base swap on token safety.
 *
 * Wraps Grey Ridge `/gate/swap` (honeypot + sellability + admin-control +
 * liquidity-vs-size), paid inline per call via x402 USDC ($0.008) — no API key,
 * no subscription. The tool returns the full verdict plus a sizing-aware
 * `proceed` boolean the model can branch on, and fails CLOSED (`proceed:false`)
 * if the gate is ever unreachable, so an outage can never green-light a swap.
 *
 * ```ts
 * import { generateText } from "ai";
 * import { createSwapGuard } from "@grey-ridge/vercel-ai-swap-gate";
 * const swapGuard = createSwapGuard({ privateKey: process.env.PRIVATE_KEY });
 * await generateText({ model, tools: { swapGuard }, prompt: "Buy $50 of 0x… on Base" });
 * ```
 */
declare function createSwapGuard(opts?: SwapGuardOptions): ai.Tool<{
    token: string;
    side?: "buy" | "sell";
    notional_usd?: number;
}, GuardResult>;
/**
 * Zero-config tool: reads `PRIVATE_KEY` (the agent's Base wallet) and the
 * optional `SWAP_GATE_BASE_URL` from the environment. Import and drop straight
 * into `generateText({ tools: { swapGuard } })`.
 */
declare const swapGuard: ai.Tool<{
    token: string;
    side?: "buy" | "sell";
    notional_usd?: number;
}, GuardResult>;

export { GATE_BASE, type GateArgs, type GateResponse, type GuardResult, type SwapGuardOptions, type TradeDecision, buildGateUrl, createSwapGuard, swapGuard as default, evaluateTrade, extractToken, fetchGate, runGuard, summarizeGate, swapGuard };
