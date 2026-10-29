/**
 * The only place the engine rounds. Every rule favors the pool (architecture §5):
 * a buyer's cost rounds up, a seller's proceeds round down, contracts keep six decimals.
 * Point values are first snapped to a micro-point so floating-point noise (e.g. 500.0000000001)
 * cannot push a value across a whole-point boundary.
 */
const MICRO = 1e6;

function noNegativeZero(x: number): number {
  return x === 0 ? 0 : x;
}

function snapMicro(x: number): number {
  return Math.round(x * MICRO) / MICRO;
}

/** Whole points a buyer pays for a fractional cost. */
export function ceilPoints(x: number): number {
  return noNegativeZero(Math.ceil(snapMicro(x)));
}

/** Whole points a seller receives for fractional proceeds. */
export function floorPoints(x: number): number {
  return noNegativeZero(Math.floor(snapMicro(x)));
}

/** Contracts to six decimals, half away from zero. */
export function roundContracts(x: number): number {
  return noNegativeZero((Math.sign(x) * Math.round(Math.abs(x) * MICRO)) / MICRO);
}

/** Contracts truncated toward zero to six decimals (used when a budget must not be exceeded). */
export function floorContracts(x: number): number {
  return noNegativeZero((Math.sign(x) * Math.floor(Math.abs(x) * MICRO)) / MICRO);
}
