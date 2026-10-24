import { test } from "node:test";
import assert from "node:assert/strict";
import { runGuard } from "../src/gate.mjs";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

// runGuard is the exact money-logic the Vercel AI SDK tool's execute() hands
// back to the model. Testing it with a fake payFetch proves the enriched shape
// and — critically — the fail-closed guarantee, without the AI SDK runtime.

function fakeFetch(body, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, json: async () => body });
}

test("runGuard enriches a clean go with proceed:true + summary", async () => {
  const body = {
    decision: "go",
    reason: "passes checks",
    risk_score: 20,
    liquidity_usd: 250000,
    sizing: {
      entry_sim: { this_trade: { roundtrip_breakeven_pct: 2 } },
      exit_sim: { this_trade: { slippage_pct: 1 } },
    },
  };
  const r = await runGuard(fakeFetch(body), { token: USDC, notionalUsd: 100 });
  assert.equal(r.proceed, true);
  assert.equal(r.decision, "go");
  assert.match(r.summary, /^GO:/);
  assert.ok(Array.isArray(r.guard_reasons));
  assert.equal(r.liquidity_usd, 250000); // original gate fields preserved
});

test("runGuard refuses a go whose round-trip friction is too high", async () => {
  const body = {
    decision: "go",
    sizing: { entry_sim: { this_trade: { roundtrip_breakeven_pct: 40 } } },
  };
  const r = await runGuard(fakeFetch(body), { token: USDC }, { maxBreakevenPct: 15 });
  assert.equal(r.proceed, false);
  assert.match(r.guard_reasons.join(" "), /breakeven 40%/);
});

test("runGuard surfaces a BLOCK verdict as proceed:false", async () => {
  const r = await runGuard(fakeFetch({ decision: "block", reason: "honeypot" }), { token: USDC });
  assert.equal(r.proceed, false);
  assert.match(r.guard_reasons[0], /BLOCK/);
});

test("runGuard DEGRADES OPEN to the free preview when the wallet is unfunded (402)", async () => {
  // Paid side 402s (unfunded wallet); the free preview returns a real verdict,
  // so the install still gets a GO instead of an opaque throw — plus the hint.
  const previewBody = { decision: "go", reason: "passes checks", risk_score: 20, liquidity_usd: 300000 };
  const previewFetch = async () => ({ ok: true, status: 200, json: async () => previewBody });
  const r = await runGuard(fakeFetch({}, { ok: false, status: 402 }), { token: USDC }, { previewFetch });
  assert.equal(r.proceed, true); // safety verdict still enforced, from the preview
  assert.equal(r.decision, "go");
  assert.equal(r.paid, false);
  assert.ok(r.activation && r.activation.needed, "free-mode must carry an activation block");
  assert.match(r.guard_reasons.join(" "), /FREE preview mode/);
});

test("runGuard with no key reads the preview directly (never wastes a 402 on payFetch)", async () => {
  const previewBody = { decision: "block", reason: "honeypot: cannot sell" };
  const previewFetch = async () => ({ ok: true, status: 200, json: async () => previewBody });
  // payFetch must NOT be called when hasKey:false — make it throw to prove it.
  const payFetch = async () => {
    throw new Error("payFetch must not run without a configured key");
  };
  const r = await runGuard(payFetch, { token: USDC }, { hasKey: false, previewFetch });
  assert.equal(r.proceed, false); // a preview BLOCK still blocks (degrade-open ≠ unsafe)
  assert.equal(r.paid, false);
  assert.ok(r.activation.needed);
});

test("runGuard FAILS CLOSED when BOTH the paid route and the preview are down (true outage)", async () => {
  const previewFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const r = await runGuard(fakeFetch({}, { ok: false, status: 402 }), { token: USDC }, { previewFetch });
  assert.equal(r.proceed, false);
  assert.equal(r.decision, "block");
  assert.match(r.reason, /fail closed/);
});

test("runGuard FAILS CLOSED when payFetch throws (network/outage)", async () => {
  const throwingFetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  const r = await runGuard(throwingFetch, { token: USDC });
  assert.equal(r.proceed, false);
  assert.equal(r.decision, "block");
  assert.match(r.reason, /ECONNREFUSED/);
  assert.match(r.summary, /fail closed/);
});

test("runGuard FAILS CLOSED on a malformed token (never silently pays/greenlights)", async () => {
  // buildGateUrl inside fetchGate throws on a bad address -> caught -> block.
  const r = await runGuard(fakeFetch({ decision: "go" }), { token: "0xdead" });
  assert.equal(r.proceed, false);
  assert.equal(r.decision, "block");
});
