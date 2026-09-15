import { type FlowInput } from "./irr.js";
import { parseDecimal, rat, type Rat } from "./rational.js";

/** mulberry32: small, seedable, and identical on every platform, so generated flows reproduce. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function polyMul(a: bigint[], b: bigint[]): bigint[] {
  const out = new Array<bigint>(a.length + b.length - 1).fill(0n);
  a.forEach((x, i) => b.forEach((y, j) => (out[i + j]! += x * y)));
  return out;
}

/**
 * Integer cash flows over `periods` periods whose IRRs are exactly the given rates (each > -1).
 * NPV is built as prod((1+r_i) x - 1) times a polynomial with positive coefficients, which has
 * no positive root, so no other IRR can exist.
 */
export function generateFlows(rates: readonly FlowInput[], periods: number, seed: number): bigint[] {
  if (!Number.isInteger(periods) || periods < rates.length || periods < 1) {
    throw new RangeError(`periods must be an integer >= max(1, number of rates), got ${periods}`);
  }
  let p: bigint[] = [1n];
  for (const input of rates) {
    const r: Rat = typeof input === "object" ? rat(input.num, input.den) : parseDecimal(input);
    if (r.num + r.den <= 0n) throw new RangeError("every rate must be above -1");
    // Root x = 1/(1+r) = den/(num+den).
    p = polyMul(p, [-r.den, r.num + r.den]);
  }
  const next = rng(seed);
  const extra = Array.from({ length: periods - rates.length + 1 }, () => BigInt(1 + Math.floor(next() * 9)));
  p = polyMul(p, extra);
  return p[0]! > 0n ? p.map((c) => -c) : p;
}
