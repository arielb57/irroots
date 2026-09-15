import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { findIrrs, mirr, newtonIrr, npv } from "../src/irr.js";
import { generateFlows } from "../src/generate.js";
import { cmp, eq, parseDecimal, rat, sign, sub, toString } from "../src/rational.js";
import { FC, npvSign, sturmPositiveRoots } from "./helpers.js";

const exactRates = (flows: (string | bigint)[]) => findIrrs(flows).roots.map((r) => (r.exact ? toString(r.exact) : null));

test("textbook two-IRR project: -1600, 10000, -10000 has IRRs 25% and 400%", () => {
  assert.deepEqual(exactRates(["-1600", "10000", "-10000"]), ["1/4", "4"]);
});

test("a single rational IRR is reported exactly", () => {
  assert.deepEqual(exactRates(["-100", "110"]), ["1/10"]);
  assert.deepEqual(exactRates(["-100", "0", "121"]), ["1/10"]);
});

test("negative IRRs down to -100% are found", () => {
  assert.deepEqual(exactRates(["-100", "50"]), ["-1/2"]);
  assert.deepEqual(exactRates(["-100", "1"]), ["-99/100"]);
});

test("zero IRR is exact, including as a repeated root", () => {
  assert.deepEqual(exactRates(["-100", "100"]), ["0"]);
  const triple = findIrrs(["-1000", "3000", "-3000", "1000"]);
  assert.equal(triple.roots.length, 1);
  assert.equal(triple.roots[0]!.multiplicity, 3);
  assert.ok(triple.roots[0]!.exact && sign(triple.roots[0]!.exact) === 0);
});

test("a double root, where NPV touches zero without crossing, is still found", () => {
  // NPV = -(1.1x - 1)^2 in x = 1/(1+r): negative everywhere except exactly at 10%.
  const result = findIrrs(["-100", "220", "-121"]);
  assert.equal(result.roots.length, 1);
  assert.equal(result.roots[0]!.multiplicity, 2);
  assert.equal(toString(result.roots[0]!.exact!), "1/10");
  assert.ok(npv(["-100", "220", "-121"], 0.05) < 0 && npv(["-100", "220", "-121"], 0.15) < 0);
});

test("irrational IRR sqrt(2) - 1 is bracketed within the requested precision", () => {
  const result = findIrrs(["-1", "0", "2"], { precision: "1e-30" });
  assert.equal(result.roots.length, 1);
  const { lo, hi, exact } = result.roots[0]!;
  assert.equal(exact, null);
  assert.ok(cmp(sub(hi, lo), parseDecimal("1e-30")) <= 0);
  // (1 + r)^2 - 2 changes sign across the interval.
  const f = (r: typeof lo) => sign(sub(rat((r.num + r.den) ** 2n, r.den ** 2n), rat(2n)));
  assert.equal(f(lo), -1);
  assert.equal(f(hi), 1);
});

test("an IRR on a bisection point does not corrupt its neighbour's interval", () => {
  // x = 1/16 (r = 15) is hit exactly while splitting; r = 18 sits in the adjacent interval.
  assert.deepEqual(exactRates(generateFlows(["15", "18"], 2, 0).map(String)), ["15", "18"]);
  assert.deepEqual(exactRates(generateFlows(["-0.5", "-0.3"], 3, 0).map(String)), ["-1/2", "-3/10"]);
});

test("very large IRRs beyond any Newton starting range are found", () => {
  assert.deepEqual(exactRates(["-1", "1000000"]), ["999999"]);
});

test("no sign change proves there is no IRR", () => {
  const result = findIrrs(["100", "50", "25"]);
  assert.equal(result.roots.length, 0);
  assert.equal(result.signChanges, 0);
});

test("sign changes but still no IRR: NPV = 1 - x + x^2 is positive for every rate", () => {
  const result = findIrrs(["1", "-1", "1"]);
  assert.equal(result.signChanges, 2);
  assert.equal(result.roots.length, 0);
});

test("leading and trailing zero flows do not create or hide IRRs", () => {
  assert.deepEqual(exactRates(["0", "0", "-100", "110", "0"]), ["1/10"]);
});

test("decimal flows are handled exactly", () => {
  assert.deepEqual(exactRates(["-0.1", "0.11"]), ["1/10"]);
  assert.deepEqual(exactRates(["-1e3", "1.1e3"]), ["1/10"]);
});

test("invalid inputs fail loudly", () => {
  assert.throws(() => findIrrs([]), /no cash flows/);
  assert.throws(() => findIrrs(["0", "0"]), /every rate is an IRR/);
  assert.throws(() => findIrrs(["-1", "x"]), SyntaxError);
  assert.throws(() => findIrrs(["-1", "1,000"]), SyntaxError);
  assert.throws(() => findIrrs(["-1", "2"], { precision: "0" }), /precision/);
  assert.throws(() => findIrrs(["-1", Number.NaN]), SyntaxError);
});

test("Newton from 10% reports one IRR of a two-IRR project and never the other", () => {
  const flows = ["-1600", "10000", "-10000"];
  const newton = newtonIrr(flows);
  assert.ok(newton !== null && Math.abs(newton - 0.25) < 1e-9);
  assert.equal(findIrrs(flows).roots.length, 2);
  assert.equal(newtonIrr(["1", "-1", "1"]), null);
});

test("MIRR matches the closed form", () => {
  assert.ok(Math.abs(mirr(["-100", "0", "121"], 0.3, 0.7)! - 0.1) < 1e-12);
  // Negative flow at t=1 discounted at 10%, positive at t=0 compounded at 20% over 2 periods.
  const expected = Math.sqrt((50 * 1.44 + 200) / (100 / 1.1)) - 1;
  assert.ok(Math.abs(mirr(["50", "-100", "200"], 0.1, 0.2)! - expected) < 1e-12);
  assert.equal(mirr(["100", "100"], 0.1, 0.1), null);
});

const intFlows = fc
  .array(fc.integer({ min: -30, max: 30 }), { minLength: 2, maxLength: 9 })
  .filter((a) => a[0] !== 0 && a.some((v, i) => i > 0 && v !== 0))
  .map((a) => a.map(BigInt));

test("property: the number of IRRs equals Sturm's count of positive roots", () => {
  fc.assert(
    fc.property(intFlows, (flows) => {
      assert.equal(findIrrs(flows).roots.length, sturmPositiveRoots(flows));
    }),
    FC,
  );
});

test("property: every interval brackets a root, is narrow, and intervals are disjoint", () => {
  const tol = parseDecimal("1e-9");
  fc.assert(
    fc.property(intFlows, (flows) => {
      const { roots } = findIrrs(flows, { precision: tol });
      for (const root of roots) {
        if (root.exact) {
          assert.equal(npvSign(flows, root.exact), 0);
          assert.ok(eq(root.lo, root.hi));
        } else {
          assert.ok(cmp(sub(root.hi, root.lo), tol) <= 0);
          const sLo = npvSign(flows, root.lo);
          const sHi = npvSign(flows, root.hi);
          assert.ok(sLo !== 0 && sHi !== 0);
          // Odd multiplicity crosses zero; even multiplicity comes back to the same sign.
          assert.equal(sLo === sHi, root.multiplicity % 2 === 0);
        }
        assert.ok(cmp(root.lo, rat(-1n)) > 0);
      }
      for (let i = 1; i < roots.length; i++) assert.ok(cmp(roots[i - 1]!.hi, roots[i]!.lo) < 0);
    }),
    FC,
  );
});

test("property: Descartes' rule holds for the reported multiplicities", () => {
  fc.assert(
    fc.property(intFlows, (flows) => {
      const result = findIrrs(flows);
      const total = result.roots.reduce((s, r) => s + r.multiplicity, 0);
      assert.ok(total <= result.signChanges);
      assert.equal((result.signChanges - total) % 2, 0);
    }),
    FC,
  );
});

test("property: when Norstrom's criterion holds there is exactly one IRR above 0%", () => {
  fc.assert(
    fc.property(intFlows, (flows) => {
      const result = findIrrs(flows);
      if (!result.norstromUnique) return;
      assert.equal(result.roots.filter((r) => cmp(r.lo, rat(0n)) >= 0 && r.approx > 0).length, 1);
    }),
    FC,
  );
});

test("property: flows generated with prescribed IRRs give back exactly those IRRs", () => {
  const rate = fc
    .tuple(fc.integer({ min: -99, max: 400 }), fc.constantFrom(1n, 4n, 20n, 100n))
    .map(([n, d]) => rat(BigInt(n), d))
    .filter((r) => r.num + r.den > 0n);
  fc.assert(
    fc.property(
      fc.uniqueArray(rate, { minLength: 0, maxLength: 4, selector: (r) => toString(r) }),
      fc.integer({ min: 0, max: 12 }),
      fc.integer(),
      (rates, extra, seed) => {
        const flows = generateFlows(rates, rates.length + extra + (rates.length === 0 ? 1 : 0), seed);
        const found = findIrrs(flows).roots;
        const expected = rates.slice().sort(cmp).map(toString);
        assert.deepEqual(
          found.map((r) => (r.exact ? toString(r.exact) : `inexact ${r.approx}`)),
          expected,
        );
      },
    ),
    { ...FC, numRuns: 150 },
  );
});

test("a 30-year monthly schedule (360 periods) with three IRRs resolves exactly", () => {
  const flows = generateFlows(["0.004", "0.01", "-0.02"], 360, 7);
  assert.deepEqual(
    findIrrs(flows).roots.map((r) => toString(r.exact!)),
    ["-1/50", "1/250", "1/100"],
  );
});
