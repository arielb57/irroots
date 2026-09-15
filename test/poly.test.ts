import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { exactDiv, gcd, gcdDegreeMod, primitive, provablySquareFree, prem, signAt, squareFree, taylorShift1, trim, type Poly } from "../src/poly.js";
import { isolate01 } from "../src/isolate.js";
import { FC } from "./helpers.js";

function mulP(a: Poly, b: Poly): Poly {
  const out = new Array<bigint>(a.length + b.length - 1).fill(0n);
  a.forEach((x, i) => b.forEach((y, j) => (out[i + j]! += x * y)));
  return trim(out);
}
const powP = (a: Poly, k: number): Poly => (k === 0 ? [1n] : mulP(a, powP(a, k - 1)));
const evalAt = (p: Poly, x: bigint): bigint => p.reduceRight((acc, c) => acc * x + c, 0n);

const linear = fc.tuple(fc.integer({ min: -9, max: 9 }), fc.integer({ min: 1, max: 9 })).map(([a, b]) => [BigInt(a), BigInt(b)]);

test("signAt evaluates the sign of p(u/v) exactly", () => {
  const p: Poly = [-1n, 0n, 2n]; // 2x^2 - 1
  assert.equal(signAt(p, 1n, 2n), -1);
  assert.equal(signAt(p, 3n, 4n), 1);
  assert.equal(signAt([-1n, 2n], 1n, 2n), 0);
  assert.throws(() => signAt(p, 1n, 0n));
});

test("exactDiv rejects inexact division and division by zero", () => {
  assert.deepEqual(exactDiv([-1n, 0n, 1n], [-1n, 1n]), [1n, 1n]);
  assert.throws(() => exactDiv([1n, 0n, 1n], [-1n, 1n]), /inexact/);
  assert.throws(() => exactDiv([1n, 1n], []), /zero/);
  assert.throws(() => prem([1n, 1n], []), /zero/);
});

test("property: taylorShift1 computes p(x + 1)", () => {
  fc.assert(
    fc.property(fc.array(fc.bigInt({ min: -50n, max: 50n }), { minLength: 1, maxLength: 8 }), fc.bigInt({ min: -5n, max: 5n }), (p, x) => {
      assert.equal(evalAt(taylorShift1(p), x), evalAt(p, x + 1n));
    }),
    FC,
  );
});

test("property: gcd recovers a common factor", () => {
  fc.assert(
    fc.property(linear, linear, linear, (common, a, b) => {
      const g = gcd(mulP(common, a), mulP(common, b));
      // The gcd is divisible by the common factor and divides both products.
      exactDiv(g, primitive(common));
      exactDiv(mulP(common, a), g);
      exactDiv(mulP(common, b), g);
    }),
    FC,
  );
});

test("property: square-free factorisation reassembles the polynomial with the right multiplicities", () => {
  fc.assert(
    fc.property(fc.array(fc.tuple(linear, fc.integer({ min: 1, max: 3 })), { minLength: 1, maxLength: 4 }), (parts) => {
      let p: Poly = [1n];
      for (const [f, k] of parts) p = mulP(p, powP(f, k));
      const factors = squareFree(p);
      let rebuilt: Poly = [1n];
      for (const { factor, multiplicity } of factors) {
        assert.equal(primitive(gcd(factor, trim(factor.slice(1).map((c, i) => c * BigInt(i + 1))))).length, 1);
        rebuilt = mulP(rebuilt, powP(factor, multiplicity));
      }
      // Equal up to a constant: each divides the other.
      exactDiv(primitive(p), primitive(rebuilt));
      assert.equal(primitive(rebuilt).length, p.length);
    }),
    FC,
  );
  assert.throws(() => squareFree([]));
});

test("property: the modular square-free proof never accepts a polynomial with a repeated root", () => {
  fc.assert(
    fc.property(fc.array(fc.tuple(linear, fc.integer({ min: 1, max: 3 })), { minLength: 1, maxLength: 4 }), (parts) => {
      let p: Poly = [1n];
      for (const [f, k] of parts) p = mulP(p, powP(f, k));
      if (p.length < 2) return;
      const exactGcdDegree = gcd(p, trim(p.slice(1).map((c, i) => c * BigInt(i + 1)))).length - 1;
      if (provablySquareFree(p)) assert.equal(exactGcdDegree, 0);
    }),
    FC,
  );
  // (x - 2)^2 = x^2 - 4x + 4 is caught; x^2 - 2 is proven square-free.
  assert.equal(provablySquareFree([4n, -4n, 1n]), false);
  assert.equal(provablySquareFree([-2n, 0n, 1n]), true);
  // Modulo 3, x^2 + 3 is x^2, which has a repeated root although x^2 + 3 does not.
  assert.equal(gcdDegreeMod([3n, 0n, 1n], [0n, 2n], 3n), 1);
});

test("isolate01 separates close roots and reports dyadic roots exactly", () => {
  // Roots 1/3, 1/2 and 0.34: close together, one landing exactly on a bisection point.
  const p = mulP(mulP([-1n, 3n], [-1n, 2n]), [-17n, 50n]);
  const { intervals, exact } = isolate01(p);
  assert.deepEqual(exact, [{ num: 1n, den: 2n }]);
  assert.equal(intervals.length, 2);
  for (const { k, c } of intervals) {
    const den = 1n << BigInt(c);
    assert.notEqual(signAt(p, k, den), signAt(p, k + 1n, den));
  }
});
