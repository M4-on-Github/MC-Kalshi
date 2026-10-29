import { describe, expect, it } from "vitest";
import { EngineError } from "./errors";
import { maxPoolLoss, payout, voidRefund } from "./settlement";

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof EngineError ? e.code : "not-an-EngineError";
  }
}

describe("maxPoolLoss", () => {
  it("is 100·b·ln 2 rounded up to whole points", () => {
    expect(maxPoolLoss(100)).toBe(6932);
    expect(maxPoolLoss(50)).toBe(3466);
    expect(maxPoolLoss(500)).toBe(34658);
  });

  it("rejects b outside the liquidity range", () => {
    expect(codeOf(() => maxPoolLoss(10))).toBe("INVALID_STATE");
    expect(codeOf(() => maxPoolLoss(Number.NaN))).toBe("INVALID_STATE");
  });
});

describe("payout", () => {
  it("pays 100 points per winning contract, rounded down", () => {
    const position = { contractsYes: 9.761835, contractsNo: 0, costBasisPoints: 500 };
    expect(payout(position, "YES")).toBe(976);
    expect(payout(position, "NO")).toBe(0);
  });

  it("pays only the winning side of a mixed position", () => {
    const position = { contractsYes: 1.5, contractsNo: 2.25, costBasisPoints: 300 };
    expect(payout(position, "YES")).toBe(150);
    expect(payout(position, "NO")).toBe(225);
  });

  it("rejects negative or non-finite holdings", () => {
    expect(
      codeOf(() => payout({ contractsYes: -1, contractsNo: 0, costBasisPoints: 0 }, "YES")),
    ).toBe("INVALID_CONTRACTS");
    expect(
      codeOf(() => payout({ contractsYes: 0, contractsNo: Number.NaN, costBasisPoints: 0 }, "NO")),
    ).toBe("INVALID_CONTRACTS");
  });
});

describe("voidRefund", () => {
  it("returns exactly the net points the user paid in, which may be negative", () => {
    expect(voidRefund({ contractsYes: 3, contractsNo: 0, costBasisPoints: 150 })).toBe(150);
    expect(voidRefund({ contractsYes: 0, contractsNo: 0, costBasisPoints: -40 })).toBe(-40);
    expect(voidRefund({ contractsYes: 0, contractsNo: 0, costBasisPoints: 0 })).toBe(0);
  });

  it("rejects a non-integer cost basis", () => {
    expect(
      codeOf(() => voidRefund({ contractsYes: 0, contractsNo: 0, costBasisPoints: 1.5 })),
    ).toBe("INVALID_POINTS");
    expect(
      codeOf(() => voidRefund({ contractsYes: 0, contractsNo: 0, costBasisPoints: Number.NaN })),
    ).toBe("INVALID_POINTS");
  });
});
