# M1 — Market engine (LMSR)
Status: in-progress · Milestone: M1 · Research: docs/research/kalshi/order-ticket.md (ticket semantics) · ADRs: 0002 (LMSR), 0004 (TDD)

## Problem
Every later slice (order ticket, trade action, resolution, void, leaderboard) needs one trusted source of market math. If prices, costs, and payouts are computed in more than one place, or with floating-point carelessness, points leak and the ledger stops balancing. M1 builds that math once, pure and property-tested, before any of it touches a database or a screen.

## Objective
`packages/engine` exposes a small, pure API that turns a market's AMM state and a trade intent into a quote (contracts, cost, prices, payout, new state), inverts a points budget into contracts, computes settlement payouts and void refunds, and reports the pool's maximum liability. The six invariants in architecture §5 hold under property testing, and line coverage is at least 95 %.

## Assumptions (made without a reviewer; correct them and the spec changes first)
1. Points are integers; contracts are numbers kept to 6 decimal places; probabilities are numbers in (0, 1); displayed prices are integers 1–99. Rounding always favors the pool: buy cost rounds up, sell proceeds round down, payouts round down.
2. The engine never sees positions or balances except where a function takes one explicitly (`payout`, `voidRefund`). Whether a user may sell what they sell, and whether they can afford a buy, is the server's job in M3.
3. "Sell YES" is `contracts < 0` on side YES (reduces `q_yes`); "buy NO" is `contracts > 0` on side NO (increases `q_no`). They are different state changes and both are first-class.
4. One new dev dependency, `@vitest/coverage-v8`, is justified by the milestone's coverage exit criterion.
5. Slippage comparison stays server-side (M3): the engine exposes `avgPrice` and `probAfter`; the server decides whether a move beyond the user's tolerance is a rejection.
6. `b` is validated to the range 50–500 at the engine boundary, matching architecture §5; a market with `b` outside it is a data bug, not a user error.

## Scope
In:
- `packages/engine/src/lmsr.ts`: cost function, probability, quote by contracts, quote by points (budget inversion), max pool loss; log-sum-exp throughout.
- `packages/engine/src/rounding.ts`: points up/down helpers and the 6-dp contract rounding, used nowhere else.
- `packages/engine/src/settlement.ts`: payout for a position given an outcome; void refund for a position.
- `packages/engine/src/index.ts`: public surface and types only; `clampProbability` stays.
- Property tests for invariants 1–6 of architecture §5 plus the worked example, with `numRuns ≥ 500`.
- Coverage threshold (95 % lines, 95 % branches) enforced in `packages/engine/vitest.config.ts`.
- `docs/architecture.md` §5 updated if any formula or rounding rule changes during the work.

Out:
- Any database, server action, UI, or chart. No slippage policy, no position bookkeeping, no rate limits.
- Multi-outcome markets, fees, or a variable `b` during a market's life.

## API (public surface of `@mc-kalshi/engine`)
```ts
export type Side = "YES" | "NO";
export type Outcome = "YES" | "NO";

export interface MarketState {
  readonly qYes: number; // contracts the AMM has sold on YES (may be negative after sells)
  readonly qNo: number;
  readonly b: number;    // liquidity, in contracts, 50..500
}

export interface Quote {
  readonly side: Side;
  readonly contracts: number;    // signed, 6 dp: + buy, − sell
  readonly costPoints: number;   // signed integer: + the user pays, − the user receives
  readonly avgPrice: number;     // integer 1..99, cost per contract in points
  readonly probBefore: number;   // p_yes before
  readonly probAfter: number;    // p_yes after
  readonly payoutIfWin: number;  // integer points the position pays if `side` resolves true (0 for sells)
  readonly stateAfter: MarketState;
}

export interface PositionLike {
  readonly contractsYes: number;
  readonly contractsNo: number;
  readonly costBasisPoints: number; // signed integer, net points paid into this market
}

export function probabilityYes(state: MarketState): number;
export function costFunction(state: MarketState): number;              // C(q) in points, unrounded
export function quoteContracts(state: MarketState, side: Side, contracts: number): Quote;
export function quotePoints(state: MarketState, side: Side, points: number): Quote; // buy with a budget
export function maxPoolLoss(b: number): number;                          // integer points, 100·b·ln 2 rounded up
export function payout(position: PositionLike, outcome: Outcome): number; // integer points, rounded down
export function voidRefund(position: PositionLike): number;             // = costBasisPoints
export class EngineError extends RangeError { readonly code: "INVALID_STATE" | "INVALID_CONTRACTS" | "INVALID_POINTS" }
```
Errors are thrown as `EngineError` with a `code` so the server can map them to user messages without parsing text.

## Acceptance criteria
- [ ] Given any finite `MarketState` with `b` in 50..500, when `probabilityYes` runs, then `0 < p < 1` and `p + probabilityYes(swapped sides) = 1` within 1e-12 (invariant 1).
- [ ] Given a state, when `quoteContracts(state, side, 0)` runs, then it throws `INVALID_CONTRACTS`; for `Δ > 0` the unrounded cost is strictly increasing and convex in `Δ` (invariant 2).
- [ ] Given a state and `Δ > 0`, when a buy of `Δ` is followed by a sell of `Δ` on the same side from `stateAfter`, then `proceeds ≤ cost` after rounding (invariant 3).
- [ ] Given any random sequence of up to 200 quotes applied in order, when the pool's liability (`costFunction(state) − costFunction(initial)` versus worst-case payout) is tracked, then it never exceeds `maxPoolLoss(b)` (invariant 4).
- [ ] Given a state and a budget `c ≥ 1` point, when `quotePoints` runs, then `costPoints ≤ c` and `c − costPoints < 1` whenever `c` buys at least one micro-contract, and the function terminates within three rounding adjustments (invariant 5).
- [ ] Given any set of positions and the trades that produced them, when every trade is reversed in reverse order and `voidRefund` is paid, then each user's net points equal zero (invariant 6).
- [ ] Given `b = 100`, `q = (0, 0)`, when 500 points buy YES, then `contracts` is within 0.01 of 9.76, `avgPrice` is 51, `probAfter` is within 0.001 of 0.524, and `payoutIfWin` is 976 (worked example, architecture §5).
- [ ] Given extreme but finite states (`|q| up to 10⁶`, `b = 50` or `500`), when any function runs, then no result is `NaN` or `±Infinity` (log-sum-exp).
- [ ] Given `npx vitest run --coverage` in `packages/engine`, then lines and branches are both at least 95 % and the run fails below that.
- [ ] Given `npm run typecheck && npm run lint && npm test` at the root, then all exit 0; CI green on the branch.

## Tech stack
No change to the stack table in `m0-scaffold.md`. New dev dependency: `@vitest/coverage-v8` (same major as Vitest 5).

## Commands
```
npm test -w packages/engine                 unit + property tests
npx vitest run --coverage -w packages/engine   coverage with thresholds (fails under 95 %)
npm run typecheck && npm run lint && npm test  local gate
```

## Project structure
```
packages/engine/src/
  index.ts          public exports and types only
  lmsr.ts           costFunction, probabilityYes, quoteContracts, quotePoints, maxPoolLoss
  rounding.ts       ceilPoints, floorPoints, roundContracts (6 dp)
  settlement.ts     payout, voidRefund
  errors.ts         EngineError
  *.test.ts         next to each module; properties in lmsr.properties.test.ts
packages/engine/vitest.config.ts   coverage provider v8, thresholds 95/95
```

## Code style
As M0. One addition: every exported engine function begins by validating its inputs with the `assert*` helpers in `errors.ts`, and never reads `Date`, `Math.random`, `process`, or any global state.

```ts
// packages/engine/src/lmsr.ts (shape, not final code)
export function probabilityYes(state: MarketState): number {
  assertState(state);
  const m = Math.max(state.qYes, state.qNo) / state.b;
  const ey = Math.exp(state.qYes / state.b - m);
  const en = Math.exp(state.qNo / state.b - m);
  return ey / (ey + en);
}
```

## Testing strategy
- TDD per module: the failing test lands before the implementation in every commit.
- Unit tests pin the worked example and each error code; property tests (fast-check, `numRuns: 500`, fixed `seed` printed on failure) cover the six invariants with generators for `b ∈ [50, 500]`, `q ∈ [−10⁶, 10⁶]`, `Δ ∈ (0, 10⁴]`, budgets `∈ [1, 10⁶]`.
- `doubt-driven-development` adversarial pass before merge (development model: engine math gets one).
- No mocks; nothing here does I/O.

## Data touched
None.

## UX
None. The quote's fields are what the M3 order ticket displays (see `docs/research/kalshi/order-ticket.md`: contracts, average price, payout if win, price after).

## Boundaries
- Always: validate inputs at the boundary; round only in `rounding.ts`; keep the engine free of Node types (`"types": []` stays); update architecture §5 in the same PR as any formula change.
- Ask first: any dependency beyond `@vitest/coverage-v8`; changing the rounding direction; widening the `b` range; adding fees.
- Never: compute a price outside the engine; let a rounding rule favor the user; read the clock or randomness.

## Risks / open questions
- Budget inversion with pool-favoring rounding can overshoot the budget by the final rounding step; the spec allows up to three micro-contract reductions. If a property run finds a case needing more, the approach changes to a bounded bisection on cost.
- Liability tracking for invariant 4 needs a precise definition: liability = worst-case payout across outcomes minus points collected. The plan step fixes the formula in the test before code is written.
- Floating-point: `Math.exp` near `|q|/b ≈ 700` overflows without log-sum-exp; the extreme-state criterion exists to catch regressions.

## Tasks (from /agent-skills:plan)
Dependency graph: errors and rounding → probability and cost → quote by contracts → quote by points → settlement and liability → public surface and coverage gate → adversarial pass and docs. Every task lands its failing test first (TDD is mandatory here); the local gate is `npm run typecheck && npm run lint && npm test`.

1. **Errors and rounding** (S, 4 files: `src/errors.ts`, `src/errors.test.ts`, `src/rounding.ts`, `src/rounding.test.ts`) — Acceptance: `EngineError` carries `code`; `assertState` rejects non-finite `q`, `b` outside 50..500; `ceilPoints`/`floorPoints` return integers and never favor the caller (`ceilPoints(0.000001) = 1`, `floorPoints(0.999999) = 0`); `roundContracts` keeps 6 dp and maps `-0` to `0`. Verify by: `npm test -w packages/engine`.
2. **Probability and cost** (S, 2 files: `src/lmsr.ts`, `src/lmsr.test.ts`) — Acceptance: `probabilityYes({0,0,b}) = 0.5`; `costFunction({0,0,b}) = 100·b·ln 2`; both finite for `|q| ≤ 10⁶` and `b ∈ {50, 500}`; property for invariant 1 (`0 < p < 1`, `p(q) + p(swapped) = 1`). Verify by: tests; `fc.assert` with `numRuns: 500`.
3. **Quote by contracts** (M, same 2 files + `src/lmsr.properties.test.ts`) — Acceptance: `quoteContracts` returns signed `contracts`, `costPoints` (ceil for buys, floor for sells), integer `avgPrice` 1..99, `probBefore/After`, `payoutIfWin` (floor of contracts × 100, 0 for sells), `stateAfter`; throws `INVALID_CONTRACTS` for 0, NaN, or non-finite; properties for invariants 2 (strictly increasing, convex unrounded cost) and 3 (buy then sell never profits). Verify by: tests.
   - **Checkpoint A**: local gate green; commit per task so far.
4. **Quote by points (budget inversion)** (M, same files) — Acceptance: closed-form `Δ` with log-sum-exp, floored to 6 dp, then at most three micro-contract reductions until `costPoints ≤ points`; throws `INVALID_POINTS` for `points < 1` or non-integer; worked example (`b = 100`, fresh market, 500 points → contracts within 0.01 of 9.76, `avgPrice` 51, `probAfter` within 0.001 of 0.524, `payoutIfWin` 976); property for invariant 5 (`costPoints ≤ points`, `points − costPoints < 1`, adjustments ≤ 3). Verify by: tests.
5. **Settlement and liability** (S, 3 files: `src/settlement.ts`, `src/settlement.test.ts`, properties file) — Acceptance: `maxPoolLoss(b) = ceil(100·b·ln 2)` (6,932 for `b = 100`); `payout` floors `winningContracts × 100`; `voidRefund` returns `costBasisPoints`; property for invariant 4: over random sequences of ≤ 200 buys and sells (sells never exceed what the sequence bought on that side), `100·max(qYes, qNo) − Σ costPoints ≤ maxPoolLoss(b)`; property for invariant 6: replaying a sequence and refunding `voidRefund` leaves every simulated user at net zero. Verify by: tests.
6. **Public surface and coverage gate** (S, 4 files: `src/index.ts`, `packages/engine/vitest.config.ts`, `packages/engine/package.json`, `.github/workflows/ci.yml`) — Acceptance: `index.ts` exports only the API in this spec plus `clampProbability` and the constants; `@vitest/coverage-v8` added; thresholds 95 % lines and branches; `npm run coverage -w packages/engine` exists and CI runs it after `npm test`. Verify by: `npm run coverage -w packages/engine` passes; deleting one test file makes it fail; CI green on the branch.
   - **Checkpoint B**: coverage ≥ 95 %; CI green; review passes (`/code-review`, `/agent-skills:review`) and the `doubt-driven-development` adversarial pass on the math, with findings recorded below.
7. **Docs and ship** (S, 2 files: `docs/architecture.md` §5 if anything changed, this spec) — Acceptance: §5 matches the code's rounding and the worked example as computed; spec DoD ticked; `/agent-skills:ship`; squash-merge; mark `done`.

## Definition of Done
- [ ] Acceptance criteria met and demonstrated (test or screenshot)
- [ ] Unit tests for logic; Playwright for any user-visible flow that moves points (none in M1)
- [ ] `npm run typecheck && npm run lint && npm test` green locally and in CI
- [ ] No secrets in code; new env vars documented in `.env.example` (none in M1)
- [ ] Docs or ADR updated when behavior or a decision changed
- [ ] Preview deploy checked by a human (not applicable: no user-visible change)

## Next
_Updated at the end of each session._
