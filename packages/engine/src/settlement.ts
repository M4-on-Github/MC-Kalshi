import { CONTRACT_PAYOUT_POINTS } from "./constants";
import { assertLiquidity, assertOutcome, EngineError, MAX_POINTS } from "./errors";
import { ceilPoints, floorPoints } from "./rounding";
import type { Outcome, PositionLike } from "./types";

/** Worst case the pool can lose on one market: 100·b·ln 2, rounded up (architecture §5). */
export function maxPoolLoss(b: number): number {
  assertLiquidity(b);
  return ceilPoints(CONTRACT_PAYOUT_POINTS * b * Math.LN2);
}

function assertHoldings(position: PositionLike): void {
  const { contractsYes, contractsNo } = position;
  if (
    !Number.isFinite(contractsYes) ||
    !Number.isFinite(contractsNo) ||
    contractsYes < 0 ||
    contractsNo < 0
  ) {
    throw new EngineError(
      "INVALID_CONTRACTS",
      `holdings must be finite and non-negative, got (${contractsYes}, ${contractsNo})`,
    );
  }
}

/** Whole points a position receives when the market resolves to `outcome`; rounds down. */
export function payout(position: PositionLike, outcome: Outcome): number {
  assertOutcome(outcome);
  assertHoldings(position);
  const winning = outcome === "YES" ? position.contractsYes : position.contractsNo;
  return floorPoints(winning * CONTRACT_PAYOUT_POINTS);
}

/** Points returned on a void: exactly the user's net cost basis, which may be negative. */
export function voidRefund(position: PositionLike): number {
  const basis = position.costBasisPoints;
  if (!Number.isInteger(basis) || Math.abs(basis) > MAX_POINTS) {
    throw new EngineError(
      "INVALID_POINTS",
      `cost basis must be an integer number of points within ±${MAX_POINTS}, got ${basis}`,
    );
  }
  return position.costBasisPoints;
}
