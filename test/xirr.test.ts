import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDecimal, toNumber } from "../src/rational.js";
import { type DatedFlow, findXirrs, npvSign, norstromUnique, rateFromY, signChanges } from "../src/xirr.js";

const R = (s: string) => parseDecimal(s);
const flow = (day: number, amount: string): DatedFlow => ({ day, amount: R(amount) });

/**
 * NPV in floating point, from the definition Excel's XIRR uses. Only a
 * cross-check: nothing in the library goes through it.
 */
function floatXnpv(flows: readonly DatedFlow[], rate: number): number {
  return flows.reduce((sum, f) => sum + toNumber(f.amount) / (1 + rate) ** (f.day / 365), 0);
}

describe("the substitution that makes irregular dates a polynomial", () => {
  it("turns a rational y back into an exactly rational rate", () => {
    // y = (1 + r)^(-1/365), so r = y^(-365) - 1 = q^365 / p^365 - 1. No root
    // is ever extracted, which is what keeps the bounds exact.
    const y = rateFromY({ num: 1n, den: 2n });
    assert.equal(y.den, 1n);
    assert.equal(y.num, 2n ** 365n - 1n);
  });

  it("refuses a non-positive y rather than returning nonsense", () => {
    assert.throws(() => rateFromY({ num: 0n, den: 1n }), RangeError);
    assert.throws(() => rateFromY({ num: -1n, den: 2n }), RangeError);
  });

  it("evaluates the sign exactly, including on the root", () => {
    // -1000 at day 0 and 1100 at day 365: the root is r = 10%, y = 1.1^(-1/365).
    const flows = [flow(0, "-1000"), flow(365, "1100")];
    assert.equal(npvSign(flows, { num: 1n, den: 1n }), 1); // r = 0%: NPV = 100
    assert.equal(npvSign(flows, { num: 9n, den: 10n }), -1);
  });
});

describe("XIRR", () => {
  it("gets a whole year exactly right", () => {
    const [root] = findXirrs([flow(0, "-1000"), flow(365, "1100")]).roots;
    assert.ok(root);
    assert.ok(Math.abs(root.rate - 0.1) < 1e-9, `got ${root.rate}`);
  });

  it("agrees with the definition on irregular dates", () => {
    const flows = [flow(0, "-10000"), flow(100, "3000"), flow(250, "4000"), flow(400, "4500")];
    const result = findXirrs(flows, 1e-10);
    assert.equal(result.roots.length, 1);
    assert.ok(result.unique, "one sign change in the running total proves uniqueness");
    // The library never evaluates NPV in floating point; this is the check.
    assert.ok(Math.abs(floatXnpv(flows, result.roots[0]!.rate)) < 1e-4, "NPV should vanish at the reported rate");
  });

  it("finds both roots where a single guess finds one", () => {
    // The two-IRR classic, on dates rather than periods: 2020 is a leap year,
    // so the flows sit 366 and 731 days apart and the rates are near but not
    // at 25% and 400%.
    const flows = [flow(0, "-1600"), flow(366, "10000"), flow(731, "-10000")];
    const result = findXirrs(flows, 1e-10);
    assert.equal(result.signChanges, 2);
    assert.equal(result.roots.length, 2);
    assert.ok(result.complete, "two roots against a bound of two is all of them");
    assert.ok(Math.abs(result.roots[0]!.rate - 0.25025516) < 1e-6, `${result.roots[0]!.rate}`);
    assert.ok(Math.abs(result.roots[1]!.rate - 3.97076089) < 1e-6, `${result.roots[1]!.rate}`);
    for (const r of result.roots) assert.ok(Math.abs(floatXnpv(flows, r.rate)) < 1e-3);
  });

  it("brackets every root in exact rationals that really contain it", () => {
    const flows = [flow(0, "-1600"), flow(366, "10000"), flow(731, "-10000")];
    for (const r of findXirrs(flows, 1e-9).roots) {
      const lo = toNumber(r.low);
      const hi = toNumber(r.high);
      assert.ok(lo <= r.rate && r.rate <= hi, `${lo} <= ${r.rate} <= ${hi}`);
      // Opposite signs at the ends is what makes the bracket a proof.
      assert.ok(floatXnpv(flows, lo) * floatXnpv(flows, hi) <= 0, "the bracket should straddle the root");
    }
  });

  it("says no XIRR exists rather than guessing", () => {
    const result = findXirrs([flow(0, "-1000"), flow(365, "-1000"), flow(730, "-1000")]);
    assert.equal(result.signChanges, 0);
    assert.equal(result.roots.length, 0);
    assert.ok(result.complete, "no sign change means no positive root, which is a proof");
  });

  it("rejects input it cannot read as a schedule", () => {
    assert.throws(() => findXirrs([flow(0, "-1000")]), RangeError);
    assert.throws(() => findXirrs([flow(5, "-1000"), flow(10, "1100")]), RangeError);
    assert.throws(() => findXirrs([flow(0, "-1000"), flow(0, "1100")]), RangeError);
  });

  it("matches the evenly spaced solver when the dates are evenly spaced", async () => {
    // A year apart is 365 days, so xirr and irr must agree to the precision
    // both were asked for. They share no code beyond the rational type.
    const { findIrrs } = await import("../src/irr.js");
    const yearly = ["-1000", "400", "400", "400"];
    const periodic = findIrrs(yearly, { precision: "1e-12" });
    const dated = findXirrs(
      yearly.map((a, i) => flow(365 * i, a)),
      1e-10,
    );
    assert.equal(dated.roots.length, periodic.roots.length);
    assert.ok(Math.abs(dated.roots[0]!.rate - periodic.roots[0]!.approx) < 1e-7);
  });
});

describe("the bounds the search reports", () => {
  it("counts sign changes the way Descartes does", () => {
    assert.equal(signChanges([R("-1"), R("2"), R("-3")]), 2);
    assert.equal(signChanges([R("-1"), R("0"), R("2")]), 1, "zeros are skipped, not counted");
    assert.equal(signChanges([R("1"), R("2"), R("3")]), 0);
  });

  it("applies Norstrom's criterion to the running total, not the flows", () => {
    assert.ok(norstromUnique([R("-1000"), R("600"), R("600")]));
    // Two sign changes in the flows, but the running total turns once.
    assert.ok(norstromUnique([R("-1000"), R("1200"), R("-100"), R("500")]));
    assert.ok(!norstromUnique([R("1000"), R("-600")]), "a positive first flow is outside the criterion");
  });
});
