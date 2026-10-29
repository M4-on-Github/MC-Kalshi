import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { B_MAX, B_MIN, EngineError } from "./errors";
import { costFunction, probabilityYes, tradeCost } from "./lmsr";
import type { MarketState, Side } from "./types";

const q = fc.double({ min: -1e6, max: 1e6, noNaN: true });
const b = fc.double({ min: B_MIN, max: B_MAX, noNaN: true });
const stateArb: fc.Arbitrary<MarketState> = fc.record({ qYes: q, qNo: q, b });
const sideArb: fc.Arbitrary<Side> = fc.constantFrom("YES", "NO");

// Beyond this gap-to-b ratio, 1 − p is smaller than one ulp of 1 and p rounds to exactly 1.
const STRICT_GAP = 36;

const fresh = (bValue = 100): MarketState => ({ qYes: 0, qNo: 0, b: bValue });

describe("probabilityYes", () => {
  it("is exactly one half on a fresh market", () => {
    expect(probabilityYes(fresh())).toBe(0.5);
    expect(probabilityYes(fresh(B_MIN))).toBe(0.5);
    expect(probabilityYes(fresh(B_MAX))).toBe(0.5);
  });

  it("rises as YES contracts are sold and falls as NO contracts are sold", () => {
    expect(probabilityYes({ qYes: 10, qNo: 0, b: 100 })).toBeGreaterThan(0.5);
    expect(probabilityYes({ qYes: 0, qNo: 10, b: 100 })).toBeLessThan(0.5);
  });

  it("matches the closed form e^(qY/b) / (e^(qY/b) + e^(qN/b))", () => {
    const expected = Math.exp(0.3) / (Math.exp(0.3) + Math.exp(0.1));
    expect(probabilityYes({ qYes: 30, qNo: 10, b: 100 })).toBeCloseTo(expected, 12);
  });

  it("stays finite at extreme states where naive exp would overflow", () => {
    expect(probabilityYes({ qYes: 1e6, qNo: -1e6, b: B_MIN })).toBe(1);
    expect(probabilityYes({ qYes: -1e6, qNo: 1e6, b: B_MIN })).toBe(0);
    expect(probabilityYes({ qYes: 1e6, qNo: 1e6 - 50, b: B_MIN })).toBeCloseTo(
      Math.exp(1) / (Math.exp(1) + 1),
      12,
    );
  });

  it("rejects an invalid state", () => {
    expect(() => probabilityYes({ qYes: 0, qNo: 0, b: 10 })).toThrow(EngineError);
  });

  it("property (invariant 1): p in [0, 1], p(YES) + p(NO) = 1, strictly inside (0, 1) while the gap is representable", () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        const p = probabilityYes(state);
        const pSwapped = probabilityYes({ qYes: state.qNo, qNo: state.qYes, b: state.b });
        expect(Number.isFinite(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
        expect(Math.abs(p + pSwapped - 1)).toBeLessThanOrEqual(1e-12);
        if (Math.abs(state.qYes - state.qNo) / state.b < STRICT_GAP) {
          expect(p).toBeGreaterThan(0);
          expect(p).toBeLessThan(1);
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe("costFunction", () => {
  it("is 100·b·ln 2 on a fresh market", () => {
    expect(costFunction(fresh())).toBeCloseTo(100 * 100 * Math.LN2, 9);
    expect(costFunction(fresh(B_MAX))).toBeCloseTo(100 * B_MAX * Math.LN2, 9);
  });

  it("is finite at extreme states", () => {
    expect(Number.isFinite(costFunction({ qYes: 1e6, qNo: -1e6, b: B_MIN }))).toBe(true);
    expect(costFunction({ qYes: 1e6, qNo: -1e6, b: B_MIN })).toBeCloseTo(100 * 1e6, 3);
  });

  it("property: shifting both sides by k contracts adds exactly 100·k points", () => {
    fc.assert(
      fc.property(stateArb, fc.double({ min: -1e4, max: 1e4, noNaN: true }), (state, k) => {
        const shifted = { ...state, qYes: state.qYes + k, qNo: state.qNo + k };
        const lhs = costFunction(shifted) - costFunction(state);
        expect(Math.abs(lhs - 100 * k)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(100 * k)));
      }),
      { numRuns: 500 },
    );
  });

  it("property: cost is never below 100·max(q) and never above that plus 100·b·ln 2", () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        const c = costFunction(state);
        const floor = 100 * Math.max(state.qYes, state.qNo);
        expect(c).toBeGreaterThanOrEqual(floor - 1e-6);
        expect(c).toBeLessThanOrEqual(floor + 100 * state.b * Math.LN2 + 1e-6);
      }),
      { numRuns: 500 },
    );
  });
});

describe("tradeCost", () => {
  it("equals the difference of cost-function values where that difference is well conditioned", () => {
    fc.assert(
      fc.property(
        fc.record({
          qYes: fc.double({ min: -1e3, max: 1e3, noNaN: true }),
          qNo: fc.double({ min: -1e3, max: 1e3, noNaN: true }),
          b,
        }),
        sideArb,
        fc.double({ min: -500, max: 500, noNaN: true }),
        (state, side, delta) => {
          const after =
            side === "YES"
              ? { ...state, qYes: state.qYes + delta }
              : { ...state, qNo: state.qNo + delta };
          const viaDifference = costFunction(after) - costFunction(state);
          expect(tradeCost(state, side, delta)).toBeCloseTo(viaDifference, 6);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("costs half a point per contract at even odds, to first order", () => {
    expect(tradeCost(fresh(), "YES", 0.01)).toBeCloseTo(0.5, 3);
    expect(tradeCost(fresh(), "NO", -0.01)).toBeCloseTo(-0.5, 3);
  });

  it("is zero for zero contracts and rejects non-finite amounts", () => {
    expect(tradeCost(fresh(), "YES", 0)).toBe(0);
    expect(() => tradeCost(fresh(), "YES", Number.NaN)).toThrow(EngineError);
  });
});
