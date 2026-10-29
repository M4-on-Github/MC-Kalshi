import { CONTRACT_PAYOUT_POINTS, PRICE_MAX, PRICE_MIN } from "./constants";
import { assertContracts, assertState, EngineError } from "./errors";
import { ceilPoints, floorPoints, roundContracts } from "./rounding";
import type { MarketState, Quote, Side } from "./types";

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

/**
 * Instantaneous probability of YES. In double precision it reaches exactly 1 once
 * (qY − qN) / b exceeds about 36.7 (ln 2⁵³) and exactly 0 below about −745.
 */
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

/**
 * Exact cost of moving `delta` contracts on `side`, in points, unrounded:
 *   C(q + Δ·e_side) − C(q) = 100 · b · ln(p_other + p_side · e^{Δ/b})
 * The other side's probability is taken from its own exponential, never as 1 − p, so a sell at a
 * price within a few ulps of 1 cannot cancel catastrophically. Three branches keep full precision:
 * log1p/expm1 for every buy and for sells of up to one b, and log-sum-exp forms beyond that.
 */
export function tradeCost(state: MarketState, side: Side, delta: number): number {
  assertState(state);
  if (!Number.isFinite(delta)) {
    throw new EngineError("INVALID_CONTRACTS", `contracts must be finite, got ${delta}`);
  }
  const { ey, en } = scaled(state);
  const total = ey + en;
  const pSide = (side === "YES" ? ey : en) / total;
  const pOther = (side === "YES" ? en : ey) / total;
  const d = delta / state.b;
  let value: number;
  if (d >= -1 && d <= 700) {
    // Well conditioned for every buy and for sells of up to one b: the argument stays above −0.64.
    value = Math.log1p(pSide * Math.expm1(d));
  } else if (d > 700) {
    // expm1 would overflow; the cost is huge here so the subtraction's absolute error is immaterial.
    value = d + Math.log(pOther * Math.exp(-d) + pSide);
  } else {
    // Large sell: both terms are positive, and pOther comes from its own exponential, not 1 − p.
    value = Math.log(pOther + pSide * Math.exp(d));
  }
  return CONTRACT_PAYOUT_POINTS * state.b * value;
}

function applyContracts(state: MarketState, side: Side, delta: number): MarketState {
  return side === "YES"
    ? { qYes: state.qYes + delta, qNo: state.qNo, b: state.b }
    : { qYes: state.qYes, qNo: state.qNo + delta, b: state.b };
}

function clampPrice(price: number): number {
  return Math.min(PRICE_MAX, Math.max(PRICE_MIN, price));
}

/**
 * Quote (and, server-side, fill) a trade of `contracts` on `side`: positive buys, negative sells.
 * Cost rounds up for buys and proceeds round down for sells; contracts keep six decimals.
 */
export function quoteContracts(state: MarketState, side: Side, contracts: number): Quote {
  assertState(state);
  assertContracts(contracts);
  const delta = roundContracts(contracts);
  if (delta === 0) {
    throw new EngineError(
      "INVALID_CONTRACTS",
      `contracts round to zero at six decimals: ${contracts}`,
    );
  }
  const stateAfter = applyContracts(state, side, delta);
  const rawCost = tradeCost(state, side, delta);
  let costPoints: number;
  if (delta > 0) {
    costPoints = ceilPoints(rawCost);
  } else {
    const proceeds = floorPoints(-rawCost);
    costPoints = proceeds === 0 ? 0 : -proceeds;
  }
  const avgPrice = clampPrice(Math.round(Math.abs(costPoints) / Math.abs(delta)));
  return {
    side,
    contracts: delta,
    costPoints,
    avgPrice,
    probBefore: probabilityYes(state),
    probAfter: probabilityYes(stateAfter),
    payoutIfWin: delta > 0 ? floorPoints(delta * CONTRACT_PAYOUT_POINTS) : 0,
    stateAfter,
  };
}
