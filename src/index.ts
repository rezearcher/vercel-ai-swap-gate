/**
 * Grey Ridge pre-trade safety gate for Vercel AI SDK trading agents.
 *
 * `createSwapGuard()` returns an AI SDK `tool` that wraps the Base-native
 * /gate/swap route (honeypot + sellability + admin-control + liquidity-vs-size),
 * paid inline per call via x402 USDC ($0.008) — no API key, no subscription.
 * `swapGuard` is a zero-config instance that reads the agent wallet key from env.
 */
export { createSwapGuard, swapGuard } from "./tool.js";
export type { SwapGuardOptions } from "./tool.js";
// Token-safety report tool — the screening companion to swapGuard.
export { createTokenReport, tokenReport } from "./tool.js";
export type { TokenReportOptions } from "./tool.js";
// Dependency-free core, re-exported for agents that want the raw primitives.
export {
  extractToken,
  buildGateUrl,
  summarizeGate,
  evaluateTrade,
  fetchGate,
  buildPreviewUrl,
  fundOnrampHint,
  fetchGatePreview,
  fetchGateOrPreview,
  runGuard,
  buildReportUrl,
  summarizeReport,
  evaluateReport,
  fetchTokenReport,
  runTokenReport,
  GATE_BASE,
} from "./gate.mjs";
export type { GateArgs, GateResponse, GateActivation, TradeDecision, GuardResult } from "./gate.mjs";
export type {
  TokenReportResponse,
  ReportDecision,
  TokenReportResult,
} from "./gate.mjs";

export { swapGuard as default } from "./tool.js";
