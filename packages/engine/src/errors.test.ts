import { describe, expect, it } from "vitest";
import { assertContracts, assertPoints, assertState, B_MAX, B_MIN, EngineError } from "./errors";

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof EngineError ? e.code : "not-an-EngineError";
  }
}

describe("EngineError", () => {
  it("is a RangeError carrying a machine-readable code", () => {
    const err = new EngineError("INVALID_POINTS", "points must be a positive integer");
    expect(err).toBeInstanceOf(RangeError);
    expect(err).toBeInstanceOf(EngineError);
    expect(err.code).toBe("INVALID_POINTS");
    expect(err.name).toBe("EngineError");
    expect(err.message).toContain("positive integer");
  });
});

describe("assertState", () => {
  it("accepts finite q and b within the liquidity range", () => {
    expect(() => assertState({ qYes: 0, qNo: 0, b: B_MIN })).not.toThrow();
    expect(() => assertState({ qYes: -12.5, qNo: 1e6, b: B_MAX })).not.toThrow();
  });

  it.each([
    ["NaN qYes", { qYes: Number.NaN, qNo: 0, b: 100 }],
    ["infinite qNo", { qYes: 0, qNo: Number.POSITIVE_INFINITY, b: 100 }],
    ["b below range", { qYes: 0, qNo: 0, b: B_MIN - 1 }],
    ["b above range", { qYes: 0, qNo: 0, b: B_MAX + 1 }],
    ["NaN b", { qYes: 0, qNo: 0, b: Number.NaN }],
  ])("rejects %s with INVALID_STATE", (_label, state) => {
    expect(codeOf(() => assertState(state))).toBe("INVALID_STATE");
  });
});

describe("assertContracts", () => {
  it("accepts any finite non-zero amount, including sells and micro-contracts", () => {
    expect(() => assertContracts(1)).not.toThrow();
    expect(() => assertContracts(-1)).not.toThrow();
    expect(() => assertContracts(0.000001)).not.toThrow();
  });

  it.each([0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects %s with INVALID_CONTRACTS",
    (value) => {
      expect(codeOf(() => assertContracts(value))).toBe("INVALID_CONTRACTS");
    },
  );
});

describe("assertPoints", () => {
  it("accepts positive integers", () => {
    expect(() => assertPoints(1)).not.toThrow();
    expect(() => assertPoints(1_000_000)).not.toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %s with INVALID_POINTS",
    (value) => {
      expect(codeOf(() => assertPoints(value))).toBe("INVALID_POINTS");
    },
  );
});
