import { roundContracts } from "./rounding";
import type { MarketState, Outcome, PositionLike, Side } from "./types";

export type EngineErrorCode =
  | "INVALID_STATE"
  | "INVALID_CONTRACTS"
  | "INVALID_POINTS"
  | "INVALID_SIDE";

/** Thrown for invalid inputs; the server maps `code` to a user message without parsing text. */
export class EngineError extends RangeError {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

/** Liquidity bounds in contracts (architecture §5: default 100, moderators may set 50–500). */
export const B_MIN = 50;
export const B_MAX = 500;

/**
 * Largest |qYes|, |qNo| in a state and largest |contracts| in one trade. At 1e9 the six-decimal
 * grid (1e15 micro-contracts) and 100 points per contract (1e11 points) stay safe integers.
 */
export const MAX_CONTRACTS = 1e9;
/** Largest budget and largest |cost basis|, in points. */
export const MAX_POINTS = 1e12;

export function assertLiquidity(b: number): void {
  if (!Number.isFinite(b) || b < B_MIN || b > B_MAX) {
    throw new EngineError("INVALID_STATE", `b must be within ${B_MIN}..${B_MAX}, got ${String(b)}`);
  }
}

function isGridContracts(q: unknown): q is number {
  return (
    typeof q === "number" &&
    Number.isFinite(q) &&
    Math.abs(q) <= MAX_CONTRACTS &&
    roundContracts(q) === q
  );
}

export function assertState(state: MarketState): void {
  if (typeof state !== "object" || state === null) {
    throw new EngineError("INVALID_STATE", `state must be an object, got ${String(state)}`);
  }
  const { qYes, qNo, b } = state as { qYes: unknown; qNo: unknown; b: unknown };
  if (!isGridContracts(qYes) || !isGridContracts(qNo)) {
    throw new EngineError(
      "INVALID_STATE",
      `q must be finite, within ±${MAX_CONTRACTS} and on the six-decimal grid, got (${String(qYes)}, ${String(qNo)})`,
    );
  }
  if (typeof b !== "number") {
    throw new EngineError("INVALID_STATE", `b must be a number, got ${String(b)}`);
  }
  assertLiquidity(b);
}

export function assertFiniteContracts(contracts: number): void {
  if (!Number.isFinite(contracts) || Math.abs(contracts) > MAX_CONTRACTS) {
    throw new EngineError(
      "INVALID_CONTRACTS",
      `contracts must be finite and within ±${MAX_CONTRACTS}, got ${String(contracts)}`,
    );
  }
}

export function assertContracts(contracts: number): void {
  assertFiniteContracts(contracts);
  if (contracts === 0) {
    throw new EngineError("INVALID_CONTRACTS", "contracts must be non-zero");
  }
}

export function assertPoints(points: number): void {
  if (!Number.isInteger(points) || points < 1 || points > MAX_POINTS) {
    throw new EngineError(
      "INVALID_POINTS",
      `points must be an integer in 1..${MAX_POINTS}, got ${String(points)}`,
    );
  }
}

function assertYesNo(value: unknown, what: string): void {
  if (value !== "YES" && value !== "NO") {
    throw new EngineError("INVALID_SIDE", `${what} must be "YES" or "NO", got ${String(value)}`);
  }
}

export function assertSide(value: unknown): asserts value is Side {
  assertYesNo(value, "side");
}

export function assertOutcome(value: unknown): asserts value is Outcome {
  assertYesNo(value, "outcome");
}

/**
 * A settlement input: an object with holdings in 0..MAX_CONTRACTS on each side and an integer
 * cost basis within ±MAX_POINTS. Hostile values raise EngineError, never a TypeError.
 */
export function assertPosition(position: PositionLike): void {
  if (typeof position !== "object" || position === null) {
    throw new EngineError("INVALID_STATE", `position must be an object, got ${String(position)}`);
  }
  const { contractsYes, contractsNo, costBasisPoints } = position as {
    contractsYes: unknown;
    contractsNo: unknown;
    costBasisPoints: unknown;
  };
  if (!isHolding(contractsYes) || !isHolding(contractsNo)) {
    throw new EngineError(
      "INVALID_CONTRACTS",
      `holdings must be finite and within 0..${MAX_CONTRACTS}, got (${String(contractsYes)}, ${String(contractsNo)})`,
    );
  }
  if (!Number.isInteger(costBasisPoints) || Math.abs(costBasisPoints as number) > MAX_POINTS) {
    throw new EngineError(
      "INVALID_POINTS",
      `cost basis must be an integer number of points within ±${MAX_POINTS}, got ${String(costBasisPoints)}`,
    );
  }
}

function isHolding(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= MAX_CONTRACTS;
}
