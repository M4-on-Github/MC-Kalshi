import { CONTRACT_PAYOUT_POINTS } from "./constants";
import { assertState } from "./errors";
import type { MarketState } from "./types";

/**
 * Logarithmic market scoring rule, two outcomes (ADR-0002, architecture §5):
 *   C(qY, qN) = 100 · b · ln(e^{qY/b} + e^{qN/b})
 *   p_yes     = e^{qY/b} / (e^{qY/b} + e^{qN/b})
 * Everything is computed through log-sum-exp (subtract max(q)/b first) so no exponent overflows.
 */
interface Scaled {
  readonly m: number;
  readonly ey: number;
  readonly en: number;
}

function scaled(state: MarketState): Scaled {
  const m = Math.max(state.qYes, state.qNo) / state.b;
  return {
    m,
    ey: Math.exp(state.qYes / state.b - m),
    en: Math.exp(state.qNo / state.b - m),
  };
}

/** Instantaneous probability of YES. Saturates to exactly 0 or 1 once |qY − qN| / b exceeds ~700. */
export function probabilityYes(state: MarketState): number {
  assertState(state);
  const { ey, en } = scaled(state);
  return ey / (ey + en);
}

/** Cost function C(q) in points, unrounded. */
export function costFunction(state: MarketState): number {
  assertState(state);
  const { m, ey, en } = scaled(state);
  return CONTRACT_PAYOUT_POINTS * state.b * (m + Math.log(ey + en));
}
