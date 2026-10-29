import { CONTRACT_PAYOUT_POINTS, PRICE_MAX, PRICE_MIN } from "./constants";
import {
  assertContracts,
  assertFiniteContracts,
  assertPoints,
  assertState,
  EngineError,
} from "./errors";
import { ceilPoints, floorContracts, floorPoints, roundContracts } from "./rounding";
import type { MarketState, Quote, Side } from "./types";

/**
 * Logarithmic market scoring rule, two outcomes (ADR-0002, architecture §5):
 *   C(qY, qN) = 100 · b · ln(e^{qY/b} + e^{qN/b})
 *   p_yes     = e^{qY/b} / (e^{qY/b} + e^{qN/b})
 * Probabilities are computed through log-sum-exp (subtract max(q)/b first) so no exponent
 * overflows. Trade costs and budget inversion work in the log domain, where ln p_yes and ln p_no
 * stay finite for every finite q even when the probabilities themselves underflow to 0.
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

interface LogProbs {
  readonly logPYes: number;
  readonly logPNo: number;
}

function logProbabilities(state: MarketState): LogProbs {
  const ay = state.qYes / state.b;
  const an = state.qNo / state.b;
  const m = Math.max(ay, an);
  const logSum = m + Math.log(Math.exp(ay - m) + Math.exp(an - m));
  return { logPYes: ay - logSum, logPNo: an - logSum };
}

/** ln(e^a + e^b) without overflow. */
function logAddExp(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return hi + Math.log1p(Math.exp(lo - hi));
}

/** ln(1 + e^t) without overflow. */
function softplus(t: number): number {
  return t > 36 ? t + Math.log1p(Math.exp(-t)) : Math.log1p(Math.exp(t));
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
 * (C(q + Δ·e_side) − C(q)) / (100·b) = ln(p_other + p_side · e^{d}) with d = Δ / b.
 * Three branches keep full precision: log1p/expm1 for every buy and for sells of up to one b
 * (the argument stays above −0.64, so nothing cancels), and log-sum-exp forms beyond that.
 */
function tradeValue(lp: LogProbs, side: Side, d: number): number {
  const logPSide = side === "YES" ? lp.logPYes : lp.logPNo;
  const logPOther = side === "YES" ? lp.logPNo : lp.logPYes;
  if (d >= -1 && d <= 700) {
    return Math.log1p(Math.exp(logPSide) * Math.expm1(d));
  }
  if (d > 700) {
    return d + logAddExp(logPOther - d, logPSide);
  }
  return logAddExp(logPOther, logPSide + d);
}

/** Exact cost of moving `delta` contracts on `side`, in points, unrounded. */
export function tradeCost(state: MarketState, side: Side, delta: number): number {
  assertState(state);
  assertFiniteContracts(delta);
  const value = tradeValue(logProbabilities(state), side, delta / state.b);
  return CONTRACT_PAYOUT_POINTS * state.b * value;
}

function applyContracts(state: MarketState, side: Side, delta: number): MarketState {
  // Keep q on the six-decimal grid; fifty 0.1-contract buys would otherwise drift to 4.999999999999998.
  return side === "YES"
    ? { qYes: roundContracts(state.qYes + delta), qNo: state.qNo, b: state.b }
    : { qYes: state.qYes, qNo: roundContracts(state.qNo + delta), b: state.b };
}

function clampPrice(price: number): number {
  return Math.min(PRICE_MAX, Math.max(PRICE_MIN, price));
}

/**
 * Quote (and, server-side, fill) a trade of `contracts` on `side`: positive buys, negative sells.
 * Cost rounds up for buys and is never below one point; proceeds round down for sells;
 * contracts keep six decimals.
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
  const value = tradeValue(logProbabilities(state), side, delta / state.b);
  const rawCost = CONTRACT_PAYOUT_POINTS * state.b * value;
  let costPoints: number;
  if (delta > 0) {
    costPoints = Math.max(1, ceilPoints(rawCost));
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

/**
 * Buy with a points budget: the largest six-decimal amount of contracts whose rounded cost does
 * not exceed `points`. The closed form from architecture §5 in the log domain:
 *   Δ / b = ln(1 + expm1(c / (100·b)) / p_side) = softplus( ln expm1(c/(100·b)) − ln p_side )
 * which stays finite for any budget and any representable state.
 */
export function quotePoints(state: MarketState, side: Side, points: number): Quote {
  assertState(state);
  assertPoints(points);
  const lp = logProbabilities(state);
  const logPSide = side === "YES" ? lp.logPYes : lp.logPNo;
  const x = points / (CONTRACT_PAYOUT_POINTS * state.b);
  const logExpm1 = x > 700 ? x : Math.log(Math.expm1(x));
  const exact = state.b * softplus(logExpm1 - logPSide);
  if (!Number.isFinite(exact)) {
    throw new EngineError("INVALID_POINTS", `${points} points cannot be priced on this market`);
  }
  return fitContractsToBudget(state, side, exact, points);
}

/**
 * Floor `exactDelta` to six decimals and make sure its rounded cost fits `points`. Flooring keeps
 * the cost at or under the budget up to floating-point noise, and the nanocontract nudge keeps
 * grid-exact answers (e.g. 16031.58 − 1e-12) from flooring one micro-contract short; when the
 * nudge or noise overshoots by a point, the bounded loop steps back a micro-contract at a time.
 * Exported for tests; not part of the package's public surface.
 */
export function fitContractsToBudget(
  state: MarketState,
  side: Side,
  exactDelta: number,
  points: number,
): Quote {
  let delta = floorContracts(exactDelta + 1e-9);
  for (let attempt = 0; attempt < 4; attempt++) {
    if (delta <= 0) {
      throw new EngineError("INVALID_POINTS", `${points} points buy less than one micro-contract`);
    }
    const quote = quoteContracts(state, side, delta);
    if (quote.costPoints <= points) {
      return quote;
    }
    delta = roundContracts(delta - 0.000001);
  }
  throw new EngineError("INVALID_POINTS", `budget inversion did not converge for ${points} points`);
}
