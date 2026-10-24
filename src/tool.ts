import { tool } from "ai";
import { z } from "zod";
import { makePayFetch, type PayFetch } from "./client.js";
// Core money-logic lives in a dependency-free module so it is unit-tested
// without the AI SDK runtime. Imported with the .mjs extension on purpose.
import { runGuard, runTokenReport, GATE_BASE } from "./gate.mjs";

export interface SwapGuardOptions {
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
export function createSwapGuard(opts: SwapGuardOptions = {}) {
  const base = opts.base || GATE_BASE;
  const payFetch: PayFetch = opts.payFetch || makePayFetch(opts.privateKey);
  const defaultNotionalUsd =
    typeof opts.defaultNotionalUsd === "number" && opts.defaultNotionalUsd > 0
      ? opts.defaultNotionalUsd
      : 100;
  const maxBreakevenPct = opts.maxBreakevenPct ?? 15;
  const maxExitSlippagePct = opts.maxExitSlippagePct ?? 10;

  return tool({
    description:
      "Pre-trade safety gate for a Base ERC-20: honeypot, sellability, admin-control and liquidity-vs-size checks via Grey Ridge /gate/swap ($0.008 USDC/call, paid inline with x402). Call BEFORE every swap. Returns the full verdict plus a sizing-aware `proceed` boolean; fails closed (proceed:false) if the gate is unreachable.",
    inputSchema: z.object({
      token: z
        .string()
        .describe("Base ERC-20 contract address (0x followed by 40 hex chars) to check."),
      side: z
        .enum(["buy", "sell"])
        .default("buy")
        .describe("Trade direction: buy (default) or sell."),
      notional_usd: z
        .number()
        .positive()
        .default(defaultNotionalUsd)
        .describe("Trade size in USD, used for the liquidity / price-impact / sizing checks."),
    }),
    execute: async ({ token, side, notional_usd }: { token: string; side?: "buy" | "sell"; notional_usd?: number }) =>
      runGuard(
        payFetch,
        { token, side, notionalUsd: notional_usd, base },
        { maxBreakevenPct, maxExitSlippagePct }
      ),
  });
}

/**
 * Zero-config tool: reads `PRIVATE_KEY` (the agent's Base wallet) and the
 * optional `SWAP_GATE_BASE_URL` from the environment. Import and drop straight
 * into `generateText({ tools: { swapGuard } })`.
 */
export const swapGuard = createSwapGuard({
  privateKey: typeof process !== "undefined" ? process.env?.PRIVATE_KEY : undefined,
  base: typeof process !== "undefined" ? process.env?.SWAP_GATE_BASE_URL : undefined,
});

export interface TokenReportOptions {
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
export function createTokenReport(opts: TokenReportOptions = {}) {
  const base = opts.base || GATE_BASE;
  const payFetch: PayFetch = opts.payFetch || makePayFetch(opts.privateKey);
  const maxRiskScore = opts.maxRiskScore ?? 60;

  return tool({
    description:
      "Token-safety report for a Base ERC-20: SAFE | CAUTION | AVOID verdict with risk_score (0-100) and reasons — honeypot/sellability sim, owner-renounce + mint/pause/blacklist/fee-setter/upgradeable-proxy checks, measured transfer tax, and Uniswap v3 WETH-pool liquidity. Via Grey Ridge /chain/token-report ($0.01 USDC/call, paid inline with x402). Use to SCREEN a candidate token; returns the full report plus a `safe` boolean. Fails closed (safe:false) if the route is unreachable.",
    inputSchema: z.object({
      token: z
        .string()
        .describe("Base ERC-20 contract address (0x followed by 40 hex chars) to vet."),
    }),
    execute: async ({ token }: { token: string }) =>
      runTokenReport(payFetch, { token, base }, { maxRiskScore }),
  });
}

/**
 * Zero-config token-report tool: reads `PRIVATE_KEY` and the optional
 * `SWAP_GATE_BASE_URL` from the environment.
 */
export const tokenReport = createTokenReport({
  privateKey: typeof process !== "undefined" ? process.env?.PRIVATE_KEY : undefined,
  base: typeof process !== "undefined" ? process.env?.SWAP_GATE_BASE_URL : undefined,
});
