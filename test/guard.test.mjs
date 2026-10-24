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

test("runGuard FAILS CLOSED when the gate returns an unpaid 402", async () => {
  const r = await runGuard(fakeFetch({}, { ok: false, status: 402 }), { token: USDC });
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
