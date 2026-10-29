export type Side = "YES" | "NO";
export type Outcome = "YES" | "NO";

export interface MarketState {
  /** Contracts the AMM has sold on YES (may be negative after sells). */
  readonly qYes: number;
  /** Contracts the AMM has sold on NO. */
  readonly qNo: number;
  /** Liquidity in contracts, B_MIN..B_MAX. */
  readonly b: number;
}

export interface PositionLike {
  readonly contractsYes: number;
  readonly contractsNo: number;
  /** Net points paid into this market; negative if the user has taken more out than in. */
  readonly costBasisPoints: number;
}
