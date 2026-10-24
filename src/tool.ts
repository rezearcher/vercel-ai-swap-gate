import { tool } from "ai";
import { z } from "zod";
import { makePayFetch, type PayFetch } from "./client.js";
// Core money-logic lives in a dependency-free module so it is unit-tested
// without the AI SDK runtime. Imported with the .mjs extension on purpose.
import { runGuard, GATE_BASE } from "./gate.mjs";

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
