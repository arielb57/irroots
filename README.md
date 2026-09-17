# irroots

Find every IRR of a cash flow, or prove there is none, using exact root isolation instead of Newton's method.

## The problem

Excel's `IRR`, numpy-financial's `irr` and most financial calculators run Newton's method (or secant) from a single guess and return the first root they reach. A project whose flows change sign more than once, such as a mine with a reclamation cost at the end or a lease with a restoration payment, can have two IRRs, several, or none at all. Those tools return one number, or an error, and say nothing about the others. An analyst comparing a 25% IRR against a hurdle rate has no way to tell that 400% is an equally valid answer, or that "did not converge" really means no IRR exists.

## How it works

The NPV of flows c_0 … c_n is a polynomial in x = 1/(1+r):

    NPV(r) = c_0 + c_1 x + c_2 x^2 + … + c_n x^n,    r > -1  <=>  x > 0

so the IRRs are exactly the positive real roots of that polynomial. irroots finds all of them with exact integer arithmetic and never uses a floating-point guess.

1. **Exact input.** Each flow is parsed as an exact decimal (`12.50` becomes 25/2), and denominators are cleared, giving an integer polynomial P over BigInt. Leading zero flows are divided out as a factor of x.
2. **Square-free factorisation.** A repeated root (NPV touching zero without crossing it) would defeat sign-based isolation, so P is split into coprime factors by multiplicity using Yun's algorithm, with a primitive-PRS GCD. A modular fast path runs first: if gcd(P, P′) has degree 0 modulo a prime that divides neither leading coefficient, P is provably square-free and Yun is skipped. This took a 240-period schedule from 8.3 s to 1 ms.
3. **Root isolation.** Each factor is isolated with Vincent–Collins–Akritas bisection. Descartes' rule of signs applied to (x+1)^n P(1/(x+1)) bounds the roots in (0, 1). A bound of 0 discards the interval, a bound of 1 isolates a root, and anything higher splits the interval in half (a scaling plus a Taylor shift). x in (0, 1) covers rates above 0%. The reversed polynomial on (0, 1) covers rates in (-100%, 0%), and x = 1 (a 0% rate) is tested directly. A root that lands exactly on a bisection point is recorded and divided out.
4. **Refinement.** Each isolating interval is converted to rate space and bisected, evaluating the sign of NPV exactly at rational rates, until it is narrower than `--precision`. The simplest rational in the final interval (the one with the smallest denominator, from continued fractions) is then tested exactly, so an IRR such as 7/100 is reported as exactly 7%.
5. **Evidence.** The output also reports the sign changes in the flows (Descartes' upper bound), the sign changes in cumulative flows (Norstrom's criterion, which proves a unique positive IRR when there is exactly one), and optionally MIRR and the result Newton would give.

Worked example: flows -1600, 10000, -10000 give P(x) = -1600 + 10000x - 10000x^2 (square-free). On (0, 1), Descartes gives a bound of 2, so the interval is split at 1/2. There P(1/2) = 900 ≠ 0, and each half has a bound of 1. The isolating intervals are (0, 1/2) and (1/2, 1). Refinement in rate space converges on 1/4 and 4, and both check exactly to zero: IRRs of 25% and 400%.

## Irregular dates

`irroots xirr` takes dated flows and reports annual rates on the ACT/365 convention, the one Excel's `XIRR` uses. It does not fall back on Newton.

The trick is a substitution. Discounting by actual days means

    NPV(r) = sum_i c_i (1 + r)^(-t_i / 365)

whose exponents are fractional, so this is not a polynomial. Put `y = (1 + r)^(-1/365)` and it becomes `sum_i c_i y^(t_i)`, a sparse polynomial whose exponents are whole numbers of days. The return trip is what makes this worth doing rather than approximating: `r = y^(-365) - 1`, and a rational `y = p/q` gives `r = q^365 / p^365 - 1`, which is rational. No root is ever extracted, so a bracket in `y` becomes an exact bracket in the rate.

```
$ cat leap.csv
2020-01-01,-1600
2021-01-01,10000
2022-01-01,-10000

$ irroots xirr leap.csv
3 dated flows over 731 days, ACT/365
sign changes: 2 (Descartes' upper bound on the number of XIRRs)
XIRR 25.025516%
XIRR 397.076089%
complete: as many roots as the sign-change bound allows, so these are all of them
```

Those are the two IRRs of the worked example above, moved off 25% and 400% because 2020 is a leap year and the flows sit 366 and 731 days apart rather than one and two years. Excel's `XIRR` returns one of them, chosen by its guess.

Two things carry over from the polynomial path and one does not:

- **Descartes' rule still bounds the count.** It holds for arbitrary real exponents, not only integers, so the sign changes in the flows bound the number of XIRRs exactly as they do for evenly spaced periods.
- **Norstrom's criterion still proves uniqueness.** One sign change in the running total means exactly one positive root, which covers most real schedules — and the output says so rather than leaving it implied.
- **The isolation is not certified.** The evenly spaced path proves it has found every root; the dated path brackets what it finds on a grid and reports `not proven complete` when it finds fewer than the bound allows. A pair of roots closer together than the grid can still hide, and the tool says that instead of implying otherwise.

The grid is laid out in rate space rather than in `y`, which matters more than it sounds: `y` runs from 0 to infinity but every realistic rate is crammed against 1, and at `y = 0.99` the rate is already 3,820%. A grid with a sensible-looking step in `y` steps straight over the whole interesting range — and over both roots above, which then look like none at all.

## Install and usage

Requires Node.js 20 or later.

    git clone <this repository> irroots && cd irroots
    npm ci
    npm run build
    npm link            # optional: puts `irroots` on your PATH

Input is a file with one flow per line, or `period,amount` rows (a header line is skipped), or `--flows` inline. `-` reads stdin.

    $ irroots examples/pit-mine.csv --compare-newton --finance-rate 0.08 --reinvest-rate 0.1
    3 cash flows over 2 periods
    sign changes in flows: 2 (at most 2 IRRs)
    sign changes in cumulative flows: 2

    2 IRRs:
      25%                exact: r = 1/4
      400%               exact: r = 4

    MIRR: 3.983285178%
    Newton from 10%: 25% (reports one IRR and misses 1)

Irrational IRRs are reported as intervals guaranteed to contain exactly one IRR:

    $ irroots --flows -100,250,-155 --precision 1e-9 --compare-newton
    3 cash flows over 2 periods
    sign changes in flows: 2 (at most 2 IRRs)
    sign changes in cumulative flows: 2

    2 IRRs:
      13.81966009%       r in (0.1381966006, 0.1381966013)
      36.18033991%       r in (0.3618033987, 0.3618033994)

    Newton from 10%: 13.81966011% (reports one IRR and misses 1)

Proving there is none, where Newton merely fails:

    $ irroots --flows -1000,500,500,500,-600 --compare-newton
    5 cash flows over 4 periods
    sign changes in flows: 2 (at most 2 IRRs)
    sign changes in cumulative flows: 2

    no IRR: exact root isolation found no rate above -100% where NPV is zero

    Newton from 10%: did not converge

`--json` gives exact bounds as fractions:

    $ irroots --flows=-1,0,0,0,0,2 --precision 1e-20 --json
    {
      "irrs": [
        {
          "approx": 0.14869835499703501,
          "lo": "10972001995247658409/73786976294838206464",
          "hi": "21944003990495316819/147573952589676412928",
          "exact": null,
          "multiplicity": 1
        }
      ],
      "signChanges": 1,
      "cumulativeSignChanges": 1,
      "norstromUnique": true
    }

`generate` builds integer flows whose IRRs are exactly the rates given, which is useful for testing other tools:

    $ irroots generate --roots 0.05,0.12,-0.4 --periods 6 --seed 4
    -22500
    54825
    -39980
    8641
    -173
    -2667
    1764

Exit code is 0 on success (including "no IRR") and 2 on bad input.

As a library:

```ts
import { findIrrs } from "irroots";

const { roots } = findIrrs(["-1600", "10000", "-10000"], { precision: "1e-12" });
// roots[i]: { lo, hi, exact, approx, multiplicity }, with lo/hi/exact as exact BigInt rationals
```

Tests and benchmark:

    npm test        # builds, then runs node --test
    npm run bench

## Results

Measured with `npm run bench` on an Apple M2 with Node v24.12.0. The benchmark is seeded, so the accuracy counts are identical on every machine. Timings will vary with hardware.

**Accuracy.** Each row uses 1000 flows built by `generate` with IRRs drawn from -50% to +100% in steps of 0.1%. Newton means Newton's method from a 10% guess (50 iterations, step tolerance 1e-10), as spreadsheet IRR functions work.

| IRRs per flow | periods | irroots found all, exactly | Newton from 10% converged | Newton IRRs found / present |
|---:|---:|---:|---:|---:|
| 1 | 10 | 1000/1000 | 727/1000 | 727/1000 |
| 2 | 10 | 1000/1000 | 931/1000 | 931/2000 |
| 2 | 30 | 1000/1000 | 889/1000 | 889/2000 |
| 3 | 30 | 1000/1000 | 967/1000 | 967/3000 |
| 4 | 60 | 1000/1000 | 973/1000 | 973/4000 |

Newton can only ever return one root, so with k IRRs present it finds at most 1/k of them. Even with a single IRR it returned nothing on 27% of these cases: it diverged, stepped below -100%, or ran out of iterations. The generated flows are not typical project flows, so treat that rate as a stress-test figure, not a field estimate.

**Speed.** Median time per `findIrrs` call at precision 1e-12:

| periods | IRRs | repeated root | median ms |
|---:|---:|:---:|---:|
| 12 | 1 | no | 0.05 |
| 12 | 2 | no | 0.10 |
| 60 | 3 | no | 1.22 |
| 120 | 3 | no | 4.40 |
| 360 | 3 | no | 49.71 |
| 30 | 2 | yes | 1.73 |
| 60 | 2 | yes | 22.98 |

Irrational IRR of -1, 0, …, 0, 2 over 60 periods, by requested precision: 0.10 ms at 1e-6, 0.17 ms at 1e-12, 1.05 ms at 1e-30, 19.04 ms at 1e-100.

**Correctness checks** in the test suite, beyond fixed examples:

- The number of IRRs matches an independent Sturm-sequence count on random flows.
- Every non-exact interval brackets a sign change, or no sign change for even multiplicity.
- Exact roots evaluate to exactly zero.
- Intervals are disjoint and within precision.
- Reported multiplicities satisfy Descartes' bound and parity.
- Norstrom's criterion always agrees with the result.
- Generated flows give back exactly their prescribed IRRs.

Property tests use fast-check with a run count and a wall-clock cap, so a failure is reported with its input rather than shrinking indefinitely.

## Design notes

The main decision was to pay for exact BigInt arithmetic everywhere rather than isolate roots in floating point. Cash-flow polynomials are badly conditioned: a 360-period schedule has x^360 terms, and the sign of NPV near a root depends on cancellation that doubles cannot represent. A floating-point Descartes test can miss a pair of close roots, or invent one, which would defeat the point of a tool whose claim is "these are all of them". Exact arithmetic makes the no-IRR answer a proof rather than a failure to find one. The cost shows on long or repeated-root inputs: coefficients grow by up to n bits per bisection level, and the general square-free path uses a PRS GCD whose intermediate coefficients grow quickly.

The modular square-free test is a deliberate asymmetry. A degree-0 GCD modulo a good prime is a proof of square-freeness, but a nontrivial modular GCD proves nothing (the prime might be unlucky), so it only ever skips work and never decides an answer. Nearly all real cash flows are square-free, so the expensive exact Yun factorisation runs only when there really is, or might be, a repeated IRR. The second choice was to refine in rate space rather than in x: the precision a user asks for is a width in r, and bisecting x near 0 (very high rates) gives badly uneven rate intervals.

## Limitations

- Irregular dates go through `irroots xirr`, which is exact in the same sense but proves less. The evenly spaced path certifies the root count with Descartes' rule on a shifted polynomial; shifting a degree-3,650 polynomial is not affordable, so the dated path certifies only when the sign-change bound is met or Norstrom's criterion applies, and says which. Floating point picks the grid points it probes; nothing it reports passes through a float.
- `irroots xirr` costs about a second on a ten-year monthly schedule at `--precision 1e-9`, because a sign test raises a rational to the power of the day count. Short schedules are milliseconds.
- Rates are per period and must be above -100%. There is no annualisation or day-count convention.
- Irrational IRRs are reported as intervals plus a float midpoint. Exact rationals are recognised only when they are the simplest rational in the final interval, which in practice means denominators up to about 1/sqrt(precision).
- A polynomial with repeated roots and many periods is slow: the table shows 23 ms at 60 periods, and the exact PRS GCD grows super-linearly beyond that. A modular GCD with reconstruction would fix this but is not implemented.
- MIRR and the Newton comparison are computed in floating point. Only the IRR search is exact.
- If every flow is zero, every rate is an IRR. irroots reports that as an error rather than an answer.

## License

MIT. See [LICENSE](LICENSE).
