// src/tool.ts
import { tool } from "ai";
import { z } from "zod";

// src/client.ts
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
var cached = null;
function makePayFetch(privateKey) {
  if (!privateKey) return fetch;
  if (cached) return cached;
  const client = new x402Client();
  registerExactEvmScheme(client, {
    signer: privateKeyToAccount(privateKey)
  });
  cached = wrapFetchWithPayment(fetch, client);
  return cached;
}

// src/gate.mjs
var GATE_BASE = "https://x402-data-api.sigrunner.workers.dev";
var ADDR_RE = /0x[a-fA-F0-9]{40}/;
function extractToken(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(ADDR_RE);
  return m ? m[0] : null;
}
function buildGateUrl({ token, side = "buy", notionalUsd = 100, base = GATE_BASE } = {}) {
  if (!ADDR_RE.test(String(token || ""))) {
    throw new Error(`invalid Base token address: ${token}`);
  }
  const s = side === "sell" ? "sell" : "buy";
  const n = Number(notionalUsd);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid notional_usd: ${notionalUsd}`);
  const qs = new URLSearchParams({ token, side: s, notional_usd: String(n) });
  return `${base}/gate/swap?${qs.toString()}`;
}
function summarizeGate(out) {
  if (!out || typeof out !== "object") return "no gate response";
  const decision = String(out.decision || "unknown").toUpperCase();
  const bits = [];
  if (out.reason) bits.push(out.reason);
  if (typeof out.risk_score === "number") bits.push(`risk ${out.risk_score}/100`);
  if (typeof out.liquidity_usd === "number") {
    bits.push(`liquidity $${Math.round(out.liquidity_usd).toLocaleString("en-US")}`);
  }
  return `${decision}: ${bits.join(" \xB7 ") || "no detail"}`;
}
function evaluateTrade(out, { maxBreakevenPct = 15, maxExitSlippagePct = 10 } = {}) {
  const reasons = [];
  if (!out || typeof out !== "object") return { go: false, reasons: ["no gate response"] };
  if (out.decision !== "go") {
    reasons.push(`gate ${String(out.decision).toUpperCase()}: ${out.reason || "not cleared"}`);
    return { go: false, reasons };
  }
  const en = out.sizing?.entry_sim?.this_trade;
  if (en && typeof en.roundtrip_breakeven_pct === "number" && en.roundtrip_breakeven_pct > maxBreakevenPct) {
    reasons.push(
      `round-trip breakeven ${en.roundtrip_breakeven_pct}% > ${maxBreakevenPct}% \u2014 friction eats the thesis`
    );
  }
  const ex = out.sizing?.exit_sim?.this_trade;
  if (ex && typeof ex.slippage_pct === "number" && ex.slippage_pct > maxExitSlippagePct) {
    reasons.push(
      `exit slippage ${ex.slippage_pct}% > ${maxExitSlippagePct}% \u2014 recover only $${ex.net_recovered_usd}`
    );
  }
  return { go: reasons.length === 0, reasons: reasons.length ? reasons : ["cleared"] };
}
async function fetchGate(payFetch, { token, side = "buy", notionalUsd = 100, base = GATE_BASE } = {}) {
  const url = buildGateUrl({ token, side, notionalUsd, base });
  const res = await payFetch(url);
  if (!res.ok && res.status !== 200) {
    throw new Error(`gate request failed: HTTP ${res.status}`);
  }
  return res.json();
}
async function runGuard(payFetch, args = {}, { maxBreakevenPct = 15, maxExitSlippagePct = 10 } = {}) {
  try {
    const out = await fetchGate(payFetch, args);
    const verdict = evaluateTrade(out, { maxBreakevenPct, maxExitSlippagePct });
    return {
      ...out,
      proceed: verdict.go,
      guard_reasons: verdict.reasons,
      summary: summarizeGate(out)
    };
  } catch (err) {
    const reason = `gate unavailable: ${err?.message || err}; fail closed`;
    return {
      decision: "block",
      proceed: false,
      reason,
      guard_reasons: ["gate unreachable \u2014 fail closed"],
      summary: "BLOCK: gate unreachable \u2014 fail closed"
    };
  }
}
function buildReportUrl({ token, base = GATE_BASE } = {}) {
  if (!ADDR_RE.test(String(token || ""))) {
    throw new Error(`invalid Base token address: ${token}`);
  }
  const qs = new URLSearchParams({ token });
  return `${base}/chain/token-report?${qs.toString()}`;
}
function summarizeReport(out) {
  if (!out || typeof out !== "object") return "no token-report response";
  const verdict = String(out.verdict || "unknown").toUpperCase();
  const bits = [];
  if (typeof out.risk_score === "number") bits.push(`risk ${out.risk_score}/100`);
  const liq = out.liquidity?.wethPoolUsd;
  if (typeof liq === "number") {
    bits.push(`liquidity $${Math.round(liq).toLocaleString("en-US")}`);
  }
  if (Array.isArray(out.reasons) && out.reasons.length) {
    bits.push(out.reasons.slice(0, 3).join("; "));
  }
  return `${verdict}: ${bits.join(" \xB7 ") || "no detail"}`;
}
function evaluateReport(out, { maxRiskScore = 60 } = {}) {
  const reasons = [];
  if (!out || typeof out !== "object") return { safe: false, reasons: ["no token-report response"] };
  const verdict = String(out.verdict || "").toUpperCase();
  const sec = out.security || {};
  if (sec.isHoneypot === true) reasons.push("honeypot: a real wallet cannot sell this token");
  if (sec.sellable === false) reasons.push("not sellable");
  if (verdict === "AVOID") {
    reasons.push(`verdict AVOID: ${(out.reasons || []).slice(0, 3).join("; ") || "high risk"}`);
  }
  if (typeof out.risk_score === "number" && out.risk_score > maxRiskScore) {
    reasons.push(`risk_score ${out.risk_score} > ${maxRiskScore}`);
  }
  if (verdict === "CAUTION" && reasons.length === 0) {
    reasons.push(`verdict CAUTION: ${(out.reasons || []).slice(0, 2).join("; ") || "review before trading"}`);
  }
  const safe = reasons.length === 0 && verdict === "SAFE";
  return { safe, reasons: reasons.length ? reasons : ["cleared \u2014 SAFE"] };
}
async function fetchTokenReport(payFetch, { token, base = GATE_BASE } = {}) {
  const url = buildReportUrl({ token, base });
  const res = await payFetch(url);
  if (!res.ok && res.status !== 200) {
    throw new Error(`token-report request failed: HTTP ${res.status}`);
  }
  return res.json();
}
async function runTokenReport(payFetch, args = {}, { maxRiskScore = 60 } = {}) {
  try {
    const out = await fetchTokenReport(payFetch, args);
    const ev = evaluateReport(out, { maxRiskScore });
    return {
      ...out,
      safe: ev.safe,
      guard_reasons: ev.reasons,
      summary: summarizeReport(out)
    };
  } catch (err) {
    const reason = `token-report unavailable: ${err?.message || err}; fail closed`;
    return {
      verdict: "AVOID",
      risk_score: 100,
      safe: false,
      reason,
      guard_reasons: ["token-report unreachable \u2014 fail closed"],
      summary: "AVOID: token-report unreachable \u2014 fail closed"
    };
  }
}

// src/tool.ts
function createSwapGuard(opts = {}) {
  const base = opts.base || GATE_BASE;
  const payFetch = opts.payFetch || makePayFetch(opts.privateKey);
  const defaultNotionalUsd = typeof opts.defaultNotionalUsd === "number" && opts.defaultNotionalUsd > 0 ? opts.defaultNotionalUsd : 100;
  const maxBreakevenPct = opts.maxBreakevenPct ?? 15;
  const maxExitSlippagePct = opts.maxExitSlippagePct ?? 10;
  return tool({
    description: "Pre-trade safety gate for a Base ERC-20: honeypot, sellability, admin-control and liquidity-vs-size checks via Grey Ridge /gate/swap ($0.008 USDC/call, paid inline with x402). Call BEFORE every swap. Returns the full verdict plus a sizing-aware `proceed` boolean; fails closed (proceed:false) if the gate is unreachable.",
    inputSchema: z.object({
      token: z.string().describe("Base ERC-20 contract address (0x followed by 40 hex chars) to check."),
      side: z.enum(["buy", "sell"]).default("buy").describe("Trade direction: buy (default) or sell."),
      notional_usd: z.number().positive().default(defaultNotionalUsd).describe("Trade size in USD, used for the liquidity / price-impact / sizing checks.")
    }),
    execute: async ({ token, side, notional_usd }) => runGuard(
      payFetch,
      { token, side, notionalUsd: notional_usd, base },
      { maxBreakevenPct, maxExitSlippagePct }
    )
  });
}
var swapGuard = createSwapGuard({
  privateKey: typeof process !== "undefined" ? process.env?.PRIVATE_KEY : void 0,
  base: typeof process !== "undefined" ? process.env?.SWAP_GATE_BASE_URL : void 0
});
function createTokenReport(opts = {}) {
  const base = opts.base || GATE_BASE;
  const payFetch = opts.payFetch || makePayFetch(opts.privateKey);
  const maxRiskScore = opts.maxRiskScore ?? 60;
  return tool({
    description: "Token-safety report for a Base ERC-20: SAFE | CAUTION | AVOID verdict with risk_score (0-100) and reasons \u2014 honeypot/sellability sim, owner-renounce + mint/pause/blacklist/fee-setter/upgradeable-proxy checks, measured transfer tax, and Uniswap v3 WETH-pool liquidity. Via Grey Ridge /chain/token-report ($0.01 USDC/call, paid inline with x402). Use to SCREEN a candidate token; returns the full report plus a `safe` boolean. Fails closed (safe:false) if the route is unreachable.",
    inputSchema: z.object({
      token: z.string().describe("Base ERC-20 contract address (0x followed by 40 hex chars) to vet.")
    }),
    execute: async ({ token }) => runTokenReport(payFetch, { token, base }, { maxRiskScore })
  });
}
var tokenReport = createTokenReport({
  privateKey: typeof process !== "undefined" ? process.env?.PRIVATE_KEY : void 0,
  base: typeof process !== "undefined" ? process.env?.SWAP_GATE_BASE_URL : void 0
});
export {
  GATE_BASE,
  buildGateUrl,
  buildReportUrl,
  createSwapGuard,
  createTokenReport,
  swapGuard as default,
  evaluateReport,
  evaluateTrade,
  extractToken,
  fetchGate,
  fetchTokenReport,
  runGuard,
  runTokenReport,
  summarizeGate,
  summarizeReport,
  swapGuard,
  tokenReport
};
//# sourceMappingURL=index.js.map