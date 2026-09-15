import { type Poly, degree, exactDiv, positiveContentFree, signVariations, taylorShift1 } from "./poly.js";

/** The open dyadic interval (k / 2^c, (k+1) / 2^c). */
export interface Dyadic {
  k: bigint;
  c: number;
}

export interface Isolation {
  /** Each interval contains exactly one root, and no endpoint is a root. */
  intervals: Dyadic[];
  /** Roots that landed exactly on a bisection point, as numerator and power-of-two denominator. */
  exact: { num: bigint; den: bigint }[];
}

/** Descartes' bound on the number of roots of q in (0, 1): variations of (x+1)^n q(1/(x+1)). */
export function descartes01(q: Poly): number {
  const reversed = q.slice().reverse();
  return signVariations(taylorShift1(reversed));
}

/**
 * Vincent-Collins-Akritas bisection. Isolates every root of a square-free integer polynomial p
 * in the open interval (0, 1). p(0) and p(1) must be non-zero.
 */
export function isolate01(p: Poly): Isolation {
  const intervals: Dyadic[] = [];
  const exact: { num: bigint; den: bigint }[] = [];
  // Each node holds q(x) = 2^(c n) p((x + k) / 2^c) up to a positive constant, so roots of q
  // in (0,1) are exactly the roots of p in the node's dyadic interval.
  const stack: { q: Poly; k: bigint; c: number }[] = [{ q: positiveContentFree(p), k: 0n, c: 0 }];
  while (stack.length > 0) {
    const { q, k, c } = stack.pop()!;
    if (degree(q) < 1) continue;
    const v = descartes01(q);
    if (v === 0) continue;
    if (v === 1) {
      intervals.push({ k, c });
      continue;
    }
    const n = degree(q);
    let left: Poly = q.map((coef, i) => coef << BigInt(n - i));
    let atHalf = 0n;
    for (const coef of left) atHalf += coef;
    if (atHalf === 0n) {
      exact.push({ num: 2n * k + 1n, den: 1n << BigInt(c + 1) });
      // Gauss's lemma: x - 1 divides left over the integers, and removing it keeps the
      // midpoint out of both children, where it would sit on an endpoint.
      left = exactDiv(left, [-1n, 1n]);
    }
    left = positiveContentFree(left);
    stack.push({ q: taylorShift1(left), k: 2n * k + 1n, c: c + 1 });
    stack.push({ q: left, k: 2n * k, c: c + 1 });
  }
  return { intervals, exact };
}
