import { type Rat, ZERO, add, div, mul, neg, rat, sign, sub } from "../src/rational.js";

/**
 * Shrinking is capped by wall-clock time: each case runs exact arithmetic, and an unbounded
 * shrink of a failure could otherwise run long enough to look like a hang in CI.
 */
export const FC = { numRuns: 300, interruptAfterTimeLimit: 60_000, markInterruptAsFailure: true } as const;

type RPoly = Rat[];

const rtrim = (p: RPoly): RPoly => {
  const out = p.slice();
  while (out.length > 0 && sign(out[out.length - 1]!) === 0) out.pop();
  return out;
};

function rrem(a: RPoly, b: RPoly): RPoly {
  let r = rtrim(a);
  const db = b.length - 1;
  while (r.length > 0 && r.length - 1 >= db) {
    const factor = div(r[r.length - 1]!, b[db]!);
    const shift = r.length - 1 - db;
    const next = r.slice();
    for (let i = 0; i <= db; i++) next[i + shift] = sub(next[i + shift]!, mul(factor, b[i]!));
    r = rtrim(next);
  }
  return r;
}

const variations = (values: Rat[]): number => {
  let prev = 0;
  let count = 0;
  for (const v of values) {
    const s = sign(v);
    if (s === 0) continue;
    if (prev !== 0 && s !== prev) count++;
    prev = s;
  }
  return count;
};

/**
 * Independent oracle: the number of distinct roots of sum c_t x^t in x > 0 (every IRR above -100%),
 * by Sturm's theorem. Requires c_0 != 0 so that x = 0 is not a root.
 */
export function sturmPositiveRoots(coeffs: readonly bigint[]): number {
  const p = rtrim(coeffs.map((c) => rat(c)));
  if (p.length <= 1) return 0;
  const seq: RPoly[] = [p, rtrim(p.slice(1).map((c, i) => mul(c, rat(BigInt(i + 1)))))];
  while (seq[seq.length - 1]!.length > 1) {
    const r = rrem(seq[seq.length - 2]!, seq[seq.length - 1]!);
    if (r.length === 0) break;
    seq.push(r.map(neg));
  }
  const atZero = variations(seq.map((q) => q[0] ?? ZERO));
  const atInfinity = variations(seq.map((q) => q[q.length - 1]!));
  return atZero - atInfinity;
}

/** Exact NPV sign at rational rate r > -1: sign of sum c_t (1+r)^(n-t). */
export function npvSign(flows: readonly bigint[], r: Rat): number {
  const growth = add(r, rat(1n));
  let total = ZERO;
  let factor = rat(1n);
  for (let t = flows.length - 1; t >= 0; t--) {
    total = add(total, mul(rat(flows[t]!), factor));
    factor = mul(factor, growth);
  }
  return sign(total);
}
