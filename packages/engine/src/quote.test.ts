import { describe, expect, it } from "vitest";
import { EngineError } from "./errors";
import { quoteContracts } from "./lmsr";
import type { MarketState } from "./types";

const fresh: MarketState = { qYes: 0, qNo: 0, b: 100 };

// Buying 10 YES on a fresh b=100 market: C(10,0) − C(0,0) = 10⁴·(ln(e^0.1 + 1) − ln 2) ≈ 512.495 points.
describe("quoteContracts: buying", () => {
  it("prices 10 YES on a fresh market at 513 points (cost rounds up)", () => {
    const quote = quoteContracts(fresh, "YES", 10);
    expect(quote.side).toBe("YES");
    expect(quote.contracts).toBe(10);
    expect(quote.costPoints).toBe(513);
    expect(quote.avgPrice).toBe(51);
    expect(quote.probBefore).toBe(0.5);
    expect(quote.probAfter).toBeCloseTo(Math.exp(0.1) / (Math.exp(0.1) + 1), 12);
    expect(quote.payoutIfWin).toBe(1000);
    expect(quote.stateAfter).toEqual({ qYes: 10, qNo: 0, b: 100 });
  });

  it("is symmetric for NO", () => {
    const quote = quoteContracts(fresh, "NO", 10);
    expect(quote.costPoints).toBe(513);
    expect(quote.probAfter).toBeCloseTo(1 - Math.exp(0.1) / (Math.exp(0.1) + 1), 12);
    expect(quote.stateAfter).toEqual({ qYes: 0, qNo: 10, b: 100 });
  });

  it("floors a fractional payout and keeps contracts to six decimals", () => {
    const quote = quoteContracts(fresh, "YES", 9.7618345);
    expect(quote.contracts).toBe(9.761835);
    expect(quote.payoutIfWin).toBe(976);
  });

  it("clamps the average price into 1..99 for pathological sizes", () => {
    expect(quoteContracts(fresh, "YES", 0.000001).avgPrice).toBe(99);
    expect(quoteContracts({ qYes: -1e6, qNo: 1e6, b: 50 }, "YES", 1).avgPrice).toBe(1);
  });
});

describe("quoteContracts: selling", () => {
  it("returns proceeds as a negative cost that rounds down", () => {
    const bought = quoteContracts(fresh, "YES", 10);
    const sold = quoteContracts(bought.stateAfter, "YES", -10);
    expect(sold.contracts).toBe(-10);
    expect(sold.costPoints).toBe(-512);
    expect(sold.avgPrice).toBe(51);
    expect(sold.payoutIfWin).toBe(0);
    expect(sold.stateAfter).toEqual(fresh);
    expect(sold.probAfter).toBe(0.5);
  });
});

describe("quoteContracts: validation", () => {
  it("rejects zero, non-finite, and sub-micro contract amounts", () => {
    for (const bad of [0, Number.NaN, Number.POSITIVE_INFINITY, 0.0000001]) {
      expect(() => quoteContracts(fresh, "YES", bad)).toThrow(EngineError);
    }
  });

  it("rejects an invalid state before doing any math", () => {
    expect(() => quoteContracts({ qYes: 0, qNo: 0, b: 1 }, "YES", 1)).toThrow(EngineError);
  });
});
