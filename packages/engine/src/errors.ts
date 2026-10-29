import type { MarketState } from "./types";

export type EngineErrorCode = "INVALID_STATE" | "INVALID_CONTRACTS" | "INVALID_POINTS";

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

export function assertLiquidity(b: number): void {
  if (!Number.isFinite(b) || b < B_MIN || b > B_MAX) {
    throw new EngineError("INVALID_STATE", `b must be within ${B_MIN}..${B_MAX}, got ${b}`);
  }
}

export function assertState(state: MarketState): void {
  if (!Number.isFinite(state.qYes) || !Number.isFinite(state.qNo)) {
    throw new EngineError("INVALID_STATE", `q must be finite, got (${state.qYes}, ${state.qNo})`);
  }
  assertLiquidity(state.b);
}

export function assertFiniteContracts(contracts: number): void {
  if (!Number.isFinite(contracts)) {
    throw new EngineError("INVALID_CONTRACTS", `contracts must be finite, got ${contracts}`);
  }
}

export function assertContracts(contracts: number): void {
  assertFiniteContracts(contracts);
  if (contracts === 0) {
    throw new EngineError("INVALID_CONTRACTS", "contracts must be non-zero");
  }
}

export function assertPoints(points: number): void {
  if (!Number.isInteger(points) || points < 1) {
    throw new EngineError("INVALID_POINTS", `points must be a positive integer, got ${points}`);
  }
}
