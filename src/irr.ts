import { type Poly, degree, exactDiv, lead, reverse, signAt, signVariations, squareFree, trim } from "./poly.js";
import { isolate01 } from "./isolate.js";
import {
  type Rat,
  ONE,
  add,
  bgcd,
  cmp,
  mid,
  parseDecimal,
  rat,
  simplestBetween,
  sub,
  toNumber,
} from "./rational.js";

export type FlowInput = string | number | bigint | Rat;

export interface IrrRoot {
  /** Rate interval guaranteed to contain this IRR and no other: lo < irr < hi, or lo = irr = hi when exact. */
  lo: Rat;
  hi: Rat;
  /** The IRR itself when it was proven to be this rational number. */
  exact: Rat | null;
  approx: number;
  /** Multiplicity as a root of NPV. Even multiplicity means NPV touches zero without changing sign. */
  multiplicity: number;
}

export interface IrrResult {
  flows: Rat[];
  roots: IrrRoot[];
  /** Sign changes in the flows: Descartes' upper bound on the number of IRRs (counted with multiplicity). */
  signChanges: number;
  /** Sign changes in the cumulative flows. */
  cumulativeSignChanges: number;
  /** Norstrom's criterion holds, which proves there is exactly one IRR above 0%. */
  norstromUnique: boolean;
}

export interface IrrOptions {
  /** Maximum width of each reported rate interval. Default 1e-12. */
  precision?: string | number | Rat;
}

const toRat = (x: FlowInput): Rat => (typeof x === "object" ? rat(x.num, x.den) : parseDecimal(x));

/** Integer polynomial with the same positive roots as NPV(x) = sum c_t x^t, x = 1/(1+r). */
export function flowsToPoly(flows: readonly Rat[]): Poly {
  let lcm = 1n;
  for (const f of flows) lcm = (lcm / bgcd(lcm, f.den)) * f.den;
  return trim(flows.map((f) => (f.num * lcm) / f.den));
}

/** Sign of NPV at rate a/b (b > 0, a + b > 0) for a polynomial in x = 1/(1+r). */
const signAtRate = (p: Poly, r: Rat): number => signAt(p, r.den, r.num + r.den);

function refine(p: Poly, lo: Rat, hi: Rat | null, sLo: number, tol: Rat, multiplicity: number): IrrRoot {
  const done = (x: Rat): IrrRoot => ({ lo: x, hi: x, exact: x, approx: toNumber(x), multiplicity });
  while (hi === null || cmp(sub(hi, lo), tol) > 0) {
    // With an unbounded interval, jump outward until NPV changes sign.
    const m = hi === null ? add(add(lo, lo), ONE) : mid(lo, hi);
    const s = signAtRate(p, m);
    if (s === 0) return done(m);
    if (s === sLo) lo = m;
    else hi = m;
  }
  const candidate = simplestBetween(lo, hi);
  if (signAtRate(p, candidate) === 0) return done(candidate);
  return { lo, hi, exact: null, approx: toNumber(mid(lo, hi)), multiplicity };
}

/**
 * Every internal rate of return of the flows c_0, c_1, ..., c_n (c_t paid at the end of period t),
 * over the whole domain r > -1. Each IRR is isolated in its own interval, so an empty result is a
 * proof that NPV has no root at any rate above -100%.
 */
export function findIrrs(input: readonly FlowInput[], options: IrrOptions = {}): IrrResult {
  const flows = input.map(toRat);
  const tol = toRat(options.precision ?? "1e-12");
  if (tol.num <= 0n) throw new RangeError("precision must be positive");
  if (flows.length === 0) throw new RangeError("no cash flows given");

  let p = flowsToPoly(flows);
  if (p.length === 0) throw new RangeError("all cash flows are zero, so every rate is an IRR");
  // Leading zero flows contribute a factor x^k, whose root x = 0 is the rate +infinity.
  let low = 0;
  while (p[low] === 0n) low++;
  p = p.slice(low);

  const roots: IrrRoot[] = [];
  for (const { factor, multiplicity } of squareFree(p)) {
    let f = factor;
    if (signAt(f, 1n, 1n) === 0) {
      roots.push({ lo: rat(0n), hi: rat(0n), exact: rat(0n), approx: 0, multiplicity });
      f = exactDiv(f, [-1n, 1n]);
    }
    if (degree(f) < 1) continue;

    // x in (0,1): r = 1/x - 1 in (0, infinity).
    const xs = isolate01(f);
    for (const { num, den } of xs.exact) {
      const r = rat(den - num, num);
      roots.push({ lo: r, hi: r, exact: r, approx: toNumber(r), multiplicity });
      // A root found on a bisection point is the endpoint of its neighbours' intervals; it must
      // be divided out, or refinement would see NPV = 0 at that endpoint.
      f = exactDiv(f, [-num, den]);
    }
    for (const { k, c } of xs.intervals) {
      const scale = 1n << BigInt(c);
      const lo = rat(scale - (k + 1n), k + 1n);
      const hi = k === 0n ? null : rat(scale - k, k);
      roots.push(refine(f, lo, hi, signAtRate(f, lo), tol, multiplicity));
    }

    // y = 1/x in (0,1): r = y - 1 in (-1, 0).
    const ys = isolate01(reverse(f));
    for (const { num, den } of ys.exact) {
      const r = rat(num - den, den);
      roots.push({ lo: r, hi: r, exact: r, approx: toNumber(r), multiplicity });
      f = exactDiv(f, [-den, num]);
    }
    // As r -> -1, x -> infinity and the sign of NPV is the sign of the leading coefficient.
    const sMinusOne = lead(f) < 0n ? -1 : 1;
    for (const { k, c } of ys.intervals) {
      const scale = 1n << BigInt(c);
      const lo = rat(k - scale, scale);
      const hi = rat(k + 1n - scale, scale);
      const sLo = k === 0n ? sMinusOne : signAtRate(f, lo);
      roots.push(refine(f, lo, hi, sLo, tol, multiplicity));
    }
  }
  roots.sort((a, b) => cmp(a.lo, b.lo));

  const cumulative: bigint[] = [];
  let running = 0n;
  const ints = flowsToPoly(flows);
  for (let t = 0; t < flows.length; t++) {
    running += ints[t] ?? 0n;
    cumulative.push(running);
  }
  const cumulativeSignChanges = signVariations(cumulative);
  return {
    flows,
    roots,
    signChanges: signVariations(ints),
    cumulativeSignChanges,
    norstromUnique: flows[0]!.num !== 0n && running !== 0n && cumulativeSignChanges === 1,
  };
}

/** Net present value at a decimal rate, in floating point. */
export function npv(flows: readonly FlowInput[], rate: number): number {
  let total = 0;
  flows.forEach((f, t) => {
    total += toNumber(toRat(f)) / Math.pow(1 + rate, t);
  });
  return total;
}

/**
 * Modified IRR: negative flows discounted to t = 0 at the finance rate, positive flows compounded
 * to t = n at the reinvestment rate. Null when the flows lack either a negative or a positive flow.
 */
export function mirr(flows: readonly FlowInput[], financeRate: number, reinvestRate: number): number | null {
  const values = flows.map((f) => toNumber(toRat(f)));
  const n = values.length - 1;
  if (n < 1) return null;
  let pvNegative = 0;
  let fvPositive = 0;
  values.forEach((v, t) => {
    if (v < 0) pvNegative += v / Math.pow(1 + financeRate, t);
    else fvPositive += v * Math.pow(1 + reinvestRate, n - t);
  });
  if (pvNegative === 0 || fvPositive === 0) return null;
  return Math.pow(fvPositive / -pvNegative, 1 / n) - 1;
}

/**
 * Newton's method on NPV from a single guess, the way spreadsheet IRR functions work. Returns
 * null when it fails to converge. Included for comparison, not used by findIrrs.
 */
export function newtonIrr(flows: readonly FlowInput[], guess = 0.1, maxIterations = 50, tolerance = 1e-10): number | null {
  const values = flows.map((f) => toNumber(toRat(f)));
  let r = guess;
  for (let i = 0; i < maxIterations; i++) {
    let f = 0;
    let df = 0;
    for (let t = 0; t < values.length; t++) {
      const d = Math.pow(1 + r, -t);
      f += values[t]! * d;
      df -= t * values[t]! * d / (1 + r);
    }
    if (!Number.isFinite(f) || !Number.isFinite(df) || df === 0) return null;
    const next = r - f / df;
    if (!Number.isFinite(next) || next <= -1) return null;
    if (Math.abs(next - r) < tolerance) return next;
    r = next;
  }
  return null;
}
