/**
 * Irregular dates, exactly.
 *
 * The rest of this library rests on the NPV of evenly spaced flows being a
 * polynomial in `x = 1/(1+r)`. Real schedules are not evenly spaced, and the
 * usual reading of that — Excel's XIRR, and everyone's after it — discounts by
 * actual days over 365:
 *
 *     NPV(r) = sum_i c_i (1 + r)^(-t_i / 365),   t_i = days from the first date
 *
 * Those exponents are fractional, so this is not a polynomial and the
 * README listed irregular dates as unsupported. It is one substitution away
 * from being one. Put
 *
 *     y = (1 + r)^(-1/365)   so   NPV = sum_i c_i y^(t_i)
 *
 * and the exponents are whole numbers of days. The result is a polynomial
 * again — a sparse one of degree `t_n`, with as many terms as there are flows.
 *
 * The return trip is the part that makes this worth doing rather than
 * approximating. `r = y^(-365) - 1`, and a rational `y = p/q` gives
 * `r = q^365 / p^365 - 1`, which is rational. Every bound this module produces
 * is therefore exact in rate space too: no root extraction, no float anywhere
 * on the path from a bracket in `y` to a bracket in `r`.
 *
 * What is *not* inherited is the certified root count. The polynomial path
 * isolates with Descartes' rule on a shifted polynomial, and shifting a degree
 * 3,650 polynomial is not affordable. Two things stand in for it:
 *
 *  - Descartes' rule still bounds the roots from the sparse form. It holds for
 *    arbitrary real exponents, not just integer ones, so the number of sign
 *    changes in the flows is an upper bound on the number of XIRRs — the same
 *    bound the evenly spaced case reports.
 *  - Norstrom's criterion still proves uniqueness. One sign change in the
 *    running total means exactly one positive root, which covers the schedules
 *    people actually have.
 *
 * Where neither settles it, this module brackets what it can find by bisection
 * and says plainly that it may not be all of them. That is a weaker promise
 * than the evenly spaced path makes, and the difference is reported rather
 * than glossed.
 */

import { type Rat, cmp, mid, rat, sign, ZERO } from "./rational.js";

/** Days per year in the ACT/365 convention Excel's XIRR uses. */
export const DAYS_PER_YEAR = 365n;

export interface DatedFlow {
  /** Whole days from the first date. Must be non-negative and increasing. */
  readonly day: number;
  readonly amount: Rat;
}

export interface XirrRoot {
  /** Exact rational bounds on the rate, low first. */
  readonly low: Rat;
  readonly high: Rat;
  /** Midpoint as a float, for reading. */
  readonly rate: number;
  /** True when the rate is exactly this rational and NPV is exactly zero there. */
  readonly exact: Rat | null;
}

export interface XirrResult {
  readonly roots: readonly XirrRoot[];
  /** Descartes' bound: sign changes in the flows. */
  readonly signChanges: number;
  /** True when Norstrom's criterion proves the root found is the only one. */
  readonly unique: boolean;
  /**
   * True when the roots listed are provably all of them. False means the
   * search found fewer than the bound allows and cannot rule out more.
   */
  readonly complete: boolean;
}

/** Sign changes in a sequence, ignoring zeros. Descartes' upper bound. */
export function signChanges(values: readonly Rat[]): number {
  let changes = 0;
  let last = 0;
  for (const v of values) {
    const s = sign(v);
    if (s === 0) continue;
    if (last !== 0 && s !== last) changes += 1;
    last = s;
  }
  return changes;
}

/**
 * Norstrom's criterion: with a negative first flow and exactly one sign change
 * in the running total, there is exactly one positive root.
 */
export function norstromUnique(flows: readonly Rat[]): boolean {
  if (flows.length === 0 || sign(flows[0]) >= 0) return false;
  const running: Rat[] = [];
  let total = ZERO;
  for (const f of flows) {
    total = { num: total.num * f.den + f.num * total.den, den: total.den * f.den };
    total = rat(total.num, total.den);
    running.push(total);
  }
  return sign(running[running.length - 1]) > 0 && signChanges(running) === 1;
}

/**
 * Sign of `sum_i c_i y^(t_i)` at a positive rational `y`, computed exactly.
 *
 * Every term is multiplied through by `q^(t_max)` so the comparison is between
 * integers. The powers are large — a ten-year schedule reaches `p^3650` — but
 * there is one per flow, not one per day, which is what keeps this affordable.
 */
export function npvSign(flows: readonly DatedFlow[], y: Rat): number {
  if (y.num <= 0n) throw new RangeError("y must be positive");
  const maxDay = BigInt(flows[flows.length - 1].day);
  let commonDen = 1n;
  for (const f of flows) commonDen *= f.amount.den;
  let total = 0n;
  for (const f of flows) {
    const d = BigInt(f.day);
    // c_i * p^d * q^(maxDay - d), scaled by the common denominator of the amounts.
    const scale = commonDen / f.amount.den;
    total += f.amount.num * scale * y.num ** d * y.den ** (maxDay - d);
  }
  return total < 0n ? -1 : total > 0n ? 1 : 0;
}

/** `r = y^(-365) - 1`, exactly. */
export function rateFromY(y: Rat): Rat {
  if (y.num <= 0n) throw new RangeError("y must be positive");
  return rat(y.den ** DAYS_PER_YEAR - y.num ** DAYS_PER_YEAR, y.num ** DAYS_PER_YEAR);
}

/**
 * Every XIRR of a dated cash flow, as exact rational brackets.
 *
 * `precision` is the width the rate bracket is narrowed to. Rates above -100%
 * correspond to `y` in `(0, infinity)`; the search walks `y` down from 1 and up
 * from 1 on a geometric grid, brackets each sign change it meets, and bisects.
 */
export function findXirrs(flows: readonly DatedFlow[], precision = 1e-9): XirrResult {
  if (flows.length < 2) throw new RangeError("need at least two dated flows");
  for (let i = 1; i < flows.length; i++) {
    if (flows[i].day <= flows[i - 1].day) throw new RangeError("days must be strictly increasing");
  }
  if (flows[0].day !== 0) throw new RangeError("the first flow must sit on day 0");

  const amounts = flows.map((f) => f.amount);
  const bound = signChanges(amounts);
  const unique = norstromUnique(amounts);
  if (bound === 0) return { roots: [], signChanges: 0, unique: false, complete: true };

  const grid = rateGrid();

  const roots: XirrRoot[] = [];
  let previous = { y: grid[0], s: npvSign(flows, grid[0]) };
  if (previous.s === 0) roots.push(exactRoot(previous.y));
  for (let i = 1; i < grid.length; i++) {
    const y = grid[i];
    const s = npvSign(flows, y);
    if (s === 0) {
      roots.push(exactRoot(y));
    } else if (previous.s !== 0 && s !== previous.s) {
      roots.push(bisect(flows, previous.y, y, previous.s, precision));
    }
    previous = { y, s };
  }

  // Rates are reported low to high; y runs the other way.
  roots.sort((a, b) => cmp(a.low, b.low));
  return { roots, signChanges: bound, unique, complete: unique ? roots.length === 1 : roots.length === bound };
}

/**
 * The rate as a float, for reading.
 *
 * Not `Number(num) / Number(den)`: those are `q^365` and `p^365`, which
 * overflow a double long before they divide, and the quotient comes out NaN.
 * Going through `y` keeps both operands small.
 */
function rateAsFloat(y: Rat): number {
  return Number(y.den) / Number(y.num) === 0 ? Number.NaN : (Number(y.num) / Number(y.den)) ** -365 - 1;
}

/**
 * Where to look, as exact rationals near the rates a reader cares about.
 *
 * A uniform grid in `y` is useless: `y` runs from 0 to infinity but every
 * realistic rate is crammed against 1. At `y = 0.99` the rate is already
 * 3,820%, so a grid with a sensible-looking step in `y` steps straight over
 * the whole interesting range — and over both roots of a two-IRR schedule,
 * which then look like no roots at all.
 *
 * So the grid is laid out in rate space, log-spaced from -99.99% upwards, and
 * each point is turned into the nearest rational with a fixed denominator.
 * Floating point chooses *where to look* and nothing else: every sign test and
 * every bound this module reports is exact rational arithmetic, so a grid
 * point landing a little off only moves a bracket, never an answer.
 */
const GRID_DENOMINATOR = 10n ** 15n;

function rateGrid(): Rat[] {
  const rates: number[] = [];
  for (let i = 0; i <= 60; i++) rates.push(-1 + 10 ** (-4 + (4 * i) / 60));
  for (let i = 0; i <= 140; i++) rates.push(10 ** (-4 + (10 * i) / 140));
  const ys = new Set<bigint>();
  for (const r of rates) {
    const y = (1 + r) ** (-1 / 365);
    if (!(y > 0) || !Number.isFinite(y)) continue;
    const scaled = BigInt(Math.round(y * Number(GRID_DENOMINATOR)));
    if (scaled > 0n) ys.add(scaled);
  }
  return [...ys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((n) => rat(n, GRID_DENOMINATOR));
}

function exactRoot(y: Rat): XirrRoot {
  return { low: rateFromY(y), high: rateFromY(y), rate: rateAsFloat(y), exact: rateFromY(y) };
}

function bisect(flows: readonly DatedFlow[], a: Rat, b: Rat, signAtA: number, precision: number): XirrRoot {
  let lo = a;
  let hi = b;
  // The bracket is narrowed in y, but the stopping test is in rate space:
  // the map from one to the other stretches by a factor of 365, so a bracket
  // that looks tight in y can be loose in the number anyone reads.
  for (let i = 0; i < 200; i++) {
    // The width is measured in floats, not by subtracting the exact rates:
    // those are ratios of 365th powers, `Number` sends both to Infinity, and
    // Infinity / Infinity is NaN — which fails the loop test and leaves the
    // bracket at its starting width without complaining.
    const width = rateAsFloat(lo) - rateAsFloat(hi);
    if (!(width > precision)) break;
    const m = mid(lo, hi);
    const s = npvSign(flows, m);
    if (s === 0) return exactRoot(m);
    if (s === signAtA) lo = m;
    else hi = m;
  }
  return { low: rateFromY(hi), high: rateFromY(lo), rate: rateAsFloat(mid(lo, hi)), exact: null };
}
