import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { cmp, parseDecimal, rat, simplestBetween, toFixedCeil, toFixedFloor, toNumber, toString } from "../src/rational.js";
import { FC } from "./helpers.js";

test("parseDecimal is exact and rejects ambiguous input", () => {
  assert.equal(toString(parseDecimal("-1600")), "-1600");
  assert.equal(toString(parseDecimal("12.50")), "25/2");
  assert.equal(toString(parseDecimal("-.25")), "-1/4");
  assert.equal(toString(parseDecimal("1e-3")), "1/1000");
  assert.equal(toString(parseDecimal(0.1)), "1/10");
  for (const bad of ["", ".", "1,000", "1 000", "abc", "1e", "--1"]) {
    assert.throws(() => parseDecimal(bad), SyntaxError, bad);
  }
  assert.throws(() => parseDecimal("1e999999"), RangeError);
  assert.throws(() => rat(1n, 0n), RangeError);
});

test("directed rounding brackets the value", () => {
  const third = rat(1n, 3n);
  assert.equal(toFixedFloor(third, 4), "0.3333");
  assert.equal(toFixedCeil(third, 4), "0.3334");
  assert.equal(toFixedFloor(rat(-1n, 3n), 2), "-0.34");
  assert.equal(toFixedCeil(rat(-1n, 3n), 2), "-0.33");
  assert.equal(toNumber(rat(10n ** 400n, 3n * 10n ** 400n)), 1 / 3);
});

test("simplestBetween picks the smallest denominator strictly inside", () => {
  assert.equal(toString(simplestBetween(rat(3n, 10n), rat(4n, 10n))), "1/3");
  assert.equal(toString(simplestBetween(rat(-1n), rat(1n))), "0");
  assert.equal(toString(simplestBetween(rat(1n), rat(2n))), "3/2");
  assert.equal(toString(simplestBetween(rat(-5n, 2n), rat(-2n))), "-7/3");
  assert.throws(() => simplestBetween(rat(1n), rat(1n)), RangeError);
});

test("property: simplestBetween is inside and no smaller denominator fits", () => {
  const r = fc.tuple(fc.integer({ min: -200, max: 200 }), fc.integer({ min: 1, max: 60 })).map(([n, d]) => rat(BigInt(n), BigInt(d)));
  fc.assert(
    fc.property(r, r, (a, b) => {
      if (cmp(a, b) === 0) return;
      const [lo, hi] = cmp(a, b) < 0 ? [a, b] : [b, a];
      const s = simplestBetween(lo, hi);
      assert.ok(cmp(lo, s) < 0 && cmp(s, hi) < 0);
      for (let q = 1n; q < s.den; q++) {
        // Smallest numerator p with p/q > lo; it must not also be below hi.
        const p = (lo.num * q) / lo.den + 1n - (lo.num < 0n && (lo.num * q) % lo.den !== 0n ? 1n : 0n);
        assert.ok(cmp(rat(p, q), hi) >= 0, `${p}/${q} fits in (${toString(lo)}, ${toString(hi)})`);
      }
    }),
    FC,
  );
});
