import { bgcd } from "./rational.js";

/** Integer polynomial, coefficients in ascending order of degree, with no trailing zeros. */
export type Poly = bigint[];

export function trim(p: readonly bigint[]): Poly {
  let n = p.length;
  while (n > 0 && p[n - 1] === 0n) n--;
  return p.slice(0, n);
}

export const degree = (p: Poly): number => p.length - 1;
export const isZero = (p: Poly): boolean => p.length === 0;
export const lead = (p: Poly): bigint => p[p.length - 1]!;

export function derivative(p: Poly): Poly {
  return trim(p.slice(1).map((c, i) => c * BigInt(i + 1)));
}

export function content(p: Poly): bigint {
  let g = 0n;
  for (const c of p) {
    g = bgcd(g, c);
    if (g === 1n) break;
  }
  return g;
}

/** Divide out the content and make the leading coefficient positive. Signs of p(x) may flip. */
export function primitive(p: Poly): Poly {
  if (isZero(p)) return [];
  let g = content(p);
  if (lead(p) < 0n) g = -g;
  return p.map((c) => c / g);
}

/** Divide out the positive content only, so the sign of p(x) is preserved at every x. */
export function positiveContentFree(p: Poly): Poly {
  if (isZero(p)) return [];
  const g = content(p);
  return g === 1n ? p.slice() : p.map((c) => c / g);
}

export function sub(a: Poly, b: Poly): Poly {
  const out: bigint[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) out.push((a[i] ?? 0n) - (b[i] ?? 0n));
  return trim(out);
}

/** Pseudo-remainder: lc(b)^(deg a - deg b + 1) * a mod b, computed without fractions. */
export function prem(a: Poly, b: Poly): Poly {
  if (isZero(b)) throw new RangeError("division by zero polynomial");
  let r = a.slice();
  const db = degree(b);
  const lb = lead(b);
  while (r.length > 0 && degree(r) >= db) {
    const shift = degree(r) - db;
    const lr = lead(r);
    const next = r.map((c) => c * lb);
    for (let i = 0; i <= db; i++) next[i + shift]! -= lr * b[i]!;
    r = trim(next);
  }
  return r;
}

/** Primitive GCD with positive leading coefficient. gcd(0, 0) is the zero polynomial. */
export function gcd(a: Poly, b: Poly): Poly {
  let x = primitive(a);
  let y = primitive(b);
  if (x.length < y.length) [x, y] = [y, x];
  while (!isZero(y)) {
    const r = primitive(prem(x, y));
    x = y;
    y = r;
  }
  return x;
}

/** Exact quotient a / b over the integers. Throws if b does not divide a exactly. */
export function exactDiv(a: Poly, b: Poly): Poly {
  if (isZero(b)) throw new RangeError("division by zero polynomial");
  const r = a.slice();
  const db = degree(b);
  const lb = lead(b);
  if (r.length < b.length) {
    if (isZero(trim(r))) return [];
    throw new RangeError("inexact polynomial division");
  }
  const q: bigint[] = new Array<bigint>(r.length - db).fill(0n);
  for (let k = q.length - 1; k >= 0; k--) {
    const top = r[k + db]!;
    if (top % lb !== 0n) throw new RangeError("inexact polynomial division");
    const qk = top / lb;
    q[k] = qk;
    for (let i = 0; i <= db; i++) r[k + i]! -= qk * b[i]!;
  }
  if (!isZero(trim(r))) throw new RangeError("inexact polynomial division");
  return trim(q);
}

/** Sign of p(u/v) for v > 0, computed as the sign of v^n p(u/v) with integer Horner. */
export function signAt(p: Poly, u: bigint, v: bigint): number {
  if (v <= 0n) throw new RangeError("denominator must be positive");
  let acc = 0n;
  let vPow = 1n;
  for (let i = p.length - 1; i >= 0; i--) {
    acc = acc * u + p[i]! * vPow;
    vPow *= v;
  }
  return acc < 0n ? -1 : acc > 0n ? 1 : 0;
}

export function reverse(p: Poly): Poly {
  return trim(p.slice().reverse());
}

/** p(x + 1), by repeated synthetic division (O(n^2) additions, no multiplications). */
export function taylorShift1(p: Poly): Poly {
  const a = p.slice();
  const n = a.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = n - 2; j >= i; j--) a[j]! += a[j + 1]!;
  }
  return a;
}

/** Number of sign changes in the coefficient sequence, zeros skipped. */
export function signVariations(p: readonly bigint[]): number {
  let count = 0;
  let prev = 0;
  for (const c of p) {
    const s = c < 0n ? -1 : c > 0n ? 1 : 0;
    if (s === 0) continue;
    if (prev !== 0 && s !== prev) count++;
    prev = s;
  }
  return count;
}

function modPow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  b %= m;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

/** Degree of gcd(a mod m, b mod m) over the field Z/m, for prime m. -1 when both reduce to zero. */
export function gcdDegreeMod(a: Poly, b: Poly, m: bigint): number {
  const reduce = (p: Poly): bigint[] => trim(p.map((c) => ((c % m) + m) % m));
  let x = reduce(a);
  let y = reduce(b);
  while (y.length > 0) {
    const inv = modPow(y[y.length - 1]!, m - 2n, m);
    const r = x.slice();
    const dy = y.length - 1;
    while (r.length > 0 && r.length - 1 >= dy) {
      const factor = (r[r.length - 1]! * inv) % m;
      const shift = r.length - 1 - dy;
      for (let i = 0; i <= dy; i++) r[i + shift] = (((r[i + shift]! - factor * y[i]!) % m) + m) % m;
      while (r.length > 0 && r[r.length - 1] === 0n) r.pop();
    }
    x = y;
    y = r;
  }
  return x.length - 1;
}

const FAST_PATH_PRIMES = [2147483647n, 1000000007n, 998244353n];

/**
 * True when a modular image proves p square-free. If a prime m divides neither lc(p) nor
 * lc(p'), the degree of gcd(p, p') mod m is at least its degree over Q, so degree 0 mod m is a
 * proof. A false result proves nothing; the caller falls back to exact factorisation.
 */
export function provablySquareFree(p: Poly): boolean {
  const dp = derivative(p);
  if (isZero(dp)) return false;
  for (const m of FAST_PATH_PRIMES) {
    if (lead(p) % m === 0n || lead(dp) % m === 0n) continue;
    if (gcdDegreeMod(p, dp, m) === 0) return true;
  }
  return false;
}

/**
 * Yun's square-free factorisation. Returns pairwise coprime primitive factors f_i, with the
 * multiplicity i of every root of f_i in p. Constant factors are omitted.
 */
export function squareFree(p: Poly): { factor: Poly; multiplicity: number }[] {
  if (isZero(p)) throw new RangeError("zero polynomial has no square-free factorisation");
  const out: { factor: Poly; multiplicity: number }[] = [];
  if (degree(p) === 0) return out;
  if (provablySquareFree(p)) return [{ factor: primitive(p), multiplicity: 1 }];
  const dp = derivative(p);
  const a0 = gcd(p, dp);
  let b = exactDiv(p, a0);
  let c = exactDiv(dp, a0);
  let d = sub(c, derivative(b));
  for (let i = 1; degree(b) > 0; i++) {
    const a = isZero(d) ? primitive(b) : gcd(b, d);
    if (degree(a) > 0) out.push({ factor: a, multiplicity: i });
    b = exactDiv(b, a);
    c = exactDiv(d, a);
    d = sub(c, derivative(b));
  }
  return out;
}
