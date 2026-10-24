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

interface TokenReportResponse {
  token?: string;
  chain?: string;
  token_meta?: { symbol?: string; name?: string; decimals?: number };
  security?: {
    isHoneypot?: boolean;
    sellable?: boolean;
    transferTaxBps?: number | null;
    taxMutable?: boolean;
    ownerRenounced?: boolean;
    upgradeableProxy?: boolean;
    canMint?: boolean;
    canPause?: boolean;
    hasBlacklist?: boolean;
    simStatus?: string;
    [k: string]: unknown;
  };
  liquidity?: { wethPoolUsd?: number; dex?: string; [k: string]: unknown };
  verdict?: "SAFE" | "CAUTION" | "AVOID" | string;
  risk_score?: number;
  reasons?: string[];
  analyzed_at?: string;
  disclaimer?: string;
  [k: string]: unknown;
}

interface ReportDecision {
  safe: boolean;
  reasons: string[];
}

interface TokenReportResult extends TokenReportResponse {
  safe: boolean;
  guard_reasons: string[];
  summary: string;
}

declare function buildReportUrl(args?: { token: string; base?: string }): string;
declare function summarizeReport(out: TokenReportResponse | null | undefined): string;
declare function evaluateReport(
  out: TokenReportResponse | null | undefined,
  opts?: { maxRiskScore?: number }
): ReportDecision;
declare function fetchTokenReport(
  payFetch: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<TokenReportResponse> }>,
  args?: { token: string; base?: string }
): Promise<TokenReportResponse>;
declare function runTokenReport(
  payFetch: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<TokenReportResponse> }>,
  args?: { token: string; base?: string },
  opts?: { maxRiskScore?: number }
): Promise<TokenReportResult>;

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
interface TokenReportOptions {
    /** Pre-built x402-paying fetch; overrides `privateKey`. Mainly for tests. */
    payFetch?: PayFetch;
    /** Hex private key of the agent's Base wallet; signs the $0.01 USDC x402 payment. Omit for the free preview path only. */
    privateKey?: string;
    /** Override the gate base URL (defaults to the hosted Grey Ridge Worker). */
    base?: string;
    /** Treat a token whose risk_score exceeds this (0-100) as unsafe. Default 60. */
    maxRiskScore?: number;
}
/**
 * Build a Vercel AI SDK tool that vets a Base ERC-20 for safety — the research
 * / watchlist-screening companion to `swapGuard`.
 *
 * Wraps Grey Ridge `/chain/token-report` (honeypot + sellability sim,
 * owner-renounce + mint/pause/blacklist/fee-setter/upgradeable-proxy checks,
 * measured transfer tax, and Uniswap v3 WETH-pool liquidity), paid inline per
 * call via x402 USDC ($0.01) — no API key. Use it to screen a candidate token
 * BEFORE deciding to trade it (where `swapGuard` is the final pre-swap gate
 * sized to a specific notional). Returns the full report plus a `safe` boolean,
 * and fails CLOSED (`safe:false`, verdict AVOID) if the route is unreachable.
 *
 * ```ts
 * import { generateText } from "ai";
 * import { createTokenReport } from "@grey-ridge/vercel-ai-swap-gate";
 * const tokenReport = createTokenReport({ privateKey: process.env.PRIVATE_KEY });
 * await generateText({ model, tools: { tokenReport }, prompt: "Is 0x… worth trading on Base?" });
 * ```
 */
declare function createTokenReport(opts?: TokenReportOptions): ai.Tool<{
    token: string;
}, TokenReportResult>;
/**
 * Zero-config token-report tool: reads `PRIVATE_KEY` and the optional
 * `SWAP_GATE_BASE_URL` from the environment.
 */
declare const tokenReport: ai.Tool<{
    token: string;
}, TokenReportResult>;

export { GATE_BASE, type GateArgs, type GateResponse, type GuardResult, type ReportDecision, type SwapGuardOptions, type TokenReportOptions, type TokenReportResponse, type TokenReportResult, type TradeDecision, buildGateUrl, buildReportUrl, createSwapGuard, createTokenReport, swapGuard as default, evaluateReport, evaluateTrade, extractToken, fetchGate, fetchTokenReport, runGuard, runTokenReport, summarizeGate, summarizeReport, swapGuard, tokenReport };
