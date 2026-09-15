/** Exact rational numbers over BigInt, always stored in lowest terms with a positive denominator. */
export interface Rat {
  readonly num: bigint;
  readonly den: bigint;
}

export function babs(a: bigint): bigint {
  return a < 0n ? -a : a;
}

export function bgcd(a: bigint, b: bigint): bigint {
  a = babs(a);
  b = babs(b);
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

export function rat(num: bigint, den: bigint = 1n): Rat {
  if (den === 0n) throw new RangeError("zero denominator");
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = bgcd(num, den);
  if (g > 1n) {
    num /= g;
    den /= g;
  }
  return { num, den };
}

export const ZERO: Rat = { num: 0n, den: 1n };
export const ONE: Rat = { num: 1n, den: 1n };

export const add = (a: Rat, b: Rat): Rat => rat(a.num * b.den + b.num * a.den, a.den * b.den);
export const sub = (a: Rat, b: Rat): Rat => rat(a.num * b.den - b.num * a.den, a.den * b.den);
export const mul = (a: Rat, b: Rat): Rat => rat(a.num * b.num, a.den * b.den);
export const div = (a: Rat, b: Rat): Rat => rat(a.num * b.den, a.den * b.num);
export const neg = (a: Rat): Rat => ({ num: -a.num, den: a.den });
export const cmp = (a: Rat, b: Rat): number => {
  const d = a.num * b.den - b.num * a.den;
  return d < 0n ? -1 : d > 0n ? 1 : 0;
};
export const sign = (a: Rat): number => (a.num < 0n ? -1 : a.num > 0n ? 1 : 0);
export const eq = (a: Rat, b: Rat): boolean => a.num === b.num && a.den === b.den;
export const mid = (a: Rat, b: Rat): Rat => rat(a.num * b.den + b.num * a.den, 2n * a.den * b.den);

/** Largest integer <= a. */
export function floor(a: Rat): bigint {
  const q = a.num / a.den;
  return a.num < 0n && q * a.den !== a.num ? q - 1n : q;
}

const DECIMAL = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * Parse a decimal literal ("-1600", "12.50", "1e3", "-.25") exactly. Thousands separators and
 * whitespace are rejected rather than guessed at, because "1,000" is ambiguous in CSV input.
 */
export function parseDecimal(input: string | number | bigint): Rat {
  if (typeof input === "bigint") return rat(input);
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new SyntaxError(`not a finite number: ${input}`);
    // String(n) is the shortest decimal that round-trips, which is what a person typed.
    return parseDecimal(String(input));
  }
  const s = input.trim();
  const m = DECIMAL.exec(s);
  if (!m || ((m[2] ?? "") === "" && (m[3] ?? "") === "")) {
    throw new SyntaxError(`not a decimal number: ${JSON.stringify(input)}`);
  }
  const intPart = m[2] ?? "";
  const fracPart = m[3] ?? "";
  const exp = m[4] ? Number(m[4]) : 0;
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 10000) {
    throw new RangeError(`exponent out of range: ${JSON.stringify(input)}`);
  }
  let num = BigInt((intPart + fracPart) || "0");
  if (m[1] === "-") num = -num;
  const scale = exp - fracPart.length;
  return scale >= 0 ? rat(num * 10n ** BigInt(scale)) : rat(num, 10n ** BigInt(-scale));
}

/** Round toward negative infinity to `digits` decimal places. */
export function toFixedFloor(a: Rat, digits: number): string {
  return formatScaled(floor(rat(a.num * 10n ** BigInt(digits), a.den)), digits);
}

/** Round toward positive infinity to `digits` decimal places. */
export function toFixedCeil(a: Rat, digits: number): string {
  return formatScaled(-floor(rat(-a.num * 10n ** BigInt(digits), a.den)), digits);
}

function formatScaled(v: bigint, digits: number): string {
  const negative = v < 0n;
  const s = babs(v).toString().padStart(digits + 1, "0");
  const body = digits === 0 ? s : `${s.slice(0, s.length - digits)}.${s.slice(s.length - digits)}`;
  return negative ? `-${body}` : body;
}

export function toNumber(a: Rat): number {
  const n = Number(a.num);
  const d = Number(a.den);
  if (Number.isFinite(n) && Number.isFinite(d)) return n / d;
  // Both sides overflow a double: shift them down together so the ratio survives.
  const shift = BigInt(Math.max(a.num.toString(2).length, a.den.toString(2).length) - 1000);
  return Number(a.num >> shift) / Number(a.den >> shift);
}

export function toString(a: Rat): string {
  return a.den === 1n ? a.num.toString() : `${a.num}/${a.den}`;
}

/**
 * The rational with the smallest denominator strictly inside (lo, hi), found by walking the
 * continued fraction expansions of both ends. Any rational p/q inside an interval narrower than
 * 1/q^2 is necessarily this number, which is how exact rational IRRs are recognised.
 */
export function simplestBetween(lo: Rat, hi: Rat): Rat {
  if (cmp(lo, hi) >= 0) throw new RangeError("empty interval");
  if (sign(lo) < 0 && sign(hi) > 0) return ZERO;
  if (sign(hi) <= 0) return neg(simplestBetween(neg(hi), neg(lo)));
  const f = floor(lo);
  if (cmp(rat(f + 1n), hi) < 0) return rat(f + 1n);
  const a = sub(lo, rat(f));
  const b = sub(hi, rat(f));
  // lo is in [f, f+1) and hi <= f+1, so the answer is f + 1/y with y simplest in (1/b, 1/a).
  const inner = sign(a) === 0 ? rat(floor(div(ONE, b)) + 1n) : simplestBetween(div(ONE, b), div(ONE, a));
  return add(rat(f), div(ONE, inner));
}
