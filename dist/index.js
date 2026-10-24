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
function summarizeSizing(out) {
  const s = out && typeof out === "object" ? out.sizing : null;
  if (!s || typeof s !== "object" || s.max_safe_notional_usd == null) return "";
  const bits = [];
  const be = s.entry_sim?.this_trade?.roundtrip_breakeven_pct;
  if (typeof be === "number") bits.push(`breakeven ${be}%`);
  if (typeof s.max_safe_notional_usd === "number") {
    bits.push(`max safe size $${Math.round(s.max_safe_notional_usd).toLocaleString("en-US")}`);
  }
  const ex = s.exit_sim?.this_trade;
  if (ex && typeof ex.slippage_pct === "number") {
    const notional = s.this_trade?.notional_usd;
    const rec = typeof ex.net_recovered_usd === "number" && typeof notional === "number" ? ` (recover $${Math.round(ex.net_recovered_usd).toLocaleString("en-US")} of $${Math.round(notional).toLocaleString("en-US")})` : "";
    bits.push(`exit slip ${ex.slippage_pct}%${rec}`);
  }
  return bits.join(" \xB7 ");
}
function sizingValues(out) {
  const s = out && typeof out === "object" ? out.sizing : null;
  if (!s || typeof s !== "object" || s.max_safe_notional_usd == null) return null;
  const en = s.entry_sim?.this_trade || {};
  const ex = s.exit_sim?.this_trade || {};
  return {
    roundtrip_breakeven_pct: typeof en.roundtrip_breakeven_pct === "number" ? en.roundtrip_breakeven_pct : null,
    max_safe_notional_usd: typeof s.max_safe_notional_usd === "number" ? s.max_safe_notional_usd : null,
    exit_slippage_pct: typeof ex.slippage_pct === "number" ? ex.slippage_pct : null,
    exit_net_recovered_usd: typeof ex.net_recovered_usd === "number" ? ex.net_recovered_usd : null
  };
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
  const sizing = summarizeSizing(out);
  if (sizing) bits.push(sizing);
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
function buildPreviewUrl({ token, side = "buy", notionalUsd = 100, base = GATE_BASE } = {}) {
  if (!ADDR_RE.test(String(token || ""))) {
    throw new Error(`invalid Base token address: ${token}`);
  }
  const s = side === "sell" ? "sell" : "buy";
  const n = Number(notionalUsd);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid notional_usd: ${notionalUsd}`);
  const qs = new URLSearchParams({ token, side: s, notional_usd: String(n) });
  return `${base}/gate/swap/preview?${qs.toString()}`;
}
function fundOnrampHint() {
  return "Grey Ridge swap-gate is running in FREE preview mode: the honeypot / sellability / liquidity verdict is live, but the paid exit-simulation and trade sizing are withheld. To unlock them, set SWAP_GATE_PRIVATE_KEY to a Base wallet holding ~1 USDC (covers ~125 checks at $0.008 each, paid inline per call via x402 \u2014 no API key, no subscription).";
}
async function fetchGatePreview(args = {}, { previewFetch } = {}) {
  const f = previewFetch || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) throw new Error("no fetch available for gate preview");
  const url = buildPreviewUrl(args);
  const res = await f(url);
  if (!res.ok && res.status !== 200) {
    throw new Error(`gate preview failed: HTTP ${res.status}`);
  }
  return res.json();
}
async function fetchGateOrPreview(payFetch, args = {}, { hasKey = true, previewFetch } = {}) {
  const withActivation = (out2, reason2) => {
    if (out2 && typeof out2 === "object") {
      out2.paid = false;
      let paidUrl;
      try {
        paidUrl = buildGateUrl(args);
      } catch {
        paidUrl = void 0;
      }
      out2.activation = {
        needed: true,
        mode: "free_preview",
        reason: reason2,
        hint: fundOnrampHint(),
        paid_url: out2.upgrade && out2.upgrade.paid_url || paidUrl,
        price_usdc: "0.008"
      };
    }
    return out2;
  };
  if (!hasKey) {
    const out2 = await fetchGatePreview(args, { previewFetch });
    return withActivation(out2, "no SWAP_GATE_PRIVATE_KEY configured");
  }
  const url = buildGateUrl(args);
  const res = await payFetch(url);
  if (res.ok || res.status === 200) {
    const out2 = await res.json();
    if (out2 && typeof out2 === "object") out2.paid = true;
    return out2;
  }
  const reason = res.status === 402 ? "wallet not funded (paid /gate/swap returned 402)" : `paid /gate/swap returned HTTP ${res.status}`;
  const out = await fetchGatePreview(args, { previewFetch });
  return withActivation(out, reason);
}
async function runGuard(payFetch, args = {}, { maxBreakevenPct = 15, maxExitSlippagePct = 10, hasKey = true, previewFetch } = {}) {
  try {
    const out = await fetchGateOrPreview(payFetch, args, { hasKey, previewFetch });
    const verdict = evaluateTrade(out, { maxBreakevenPct, maxExitSlippagePct });
    const guard_reasons = out && out.activation && out.activation.needed ? [...verdict.reasons, out.activation.hint] : verdict.reasons;
    return {
      ...out,
      proceed: verdict.go,
      guard_reasons,
      summary: summarizeGate(out),
      // The paid moat surfaced for an app that reads values, not the string:
      // breakeven / max-safe-size / exit-slippage — null on a verdict-only body.
      sizing_summary: summarizeSizing(out) || null,
      sizing_values: sizingValues(out)
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
  const hasKey = typeof opts.privateKey === "string" && opts.privateKey.length > 0;
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
      { maxBreakevenPct, maxExitSlippagePct, hasKey }
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
  buildPreviewUrl,
  buildReportUrl,
  createSwapGuard,
  createTokenReport,
  swapGuard as default,
  evaluateReport,
  evaluateTrade,
  extractToken,
  fetchGate,
  fetchGateOrPreview,
  fetchGatePreview,
  fetchTokenReport,
  fundOnrampHint,
  runGuard,
  runTokenReport,
  summarizeGate,
  summarizeReport,
  swapGuard,
  tokenReport
};
//# sourceMappingURL=index.js.map