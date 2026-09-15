import { cpus } from "node:os";
import { findIrrs, newtonIrr } from "../src/irr.js";
import { generateFlows, rng } from "../src/generate.js";
import { rat, toString, type Rat } from "../src/rational.js";

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function time(fn: () => void, minRuns = 5, minMs = 200): number {
  const samples: number[] = [];
  const start = performance.now();
  while (samples.length < minRuns || performance.now() - start < minMs) {
    const t = performance.now();
    fn();
    samples.push(performance.now() - t);
  }
  return median(samples);
}

/** Random distinct rates in [-50%, +100%] with denominators of 100 or 1000, like quoted rates. */
function randomRates(next: () => number, count: number): Rat[] {
  const seen = new Set<string>();
  const out: Rat[] = [];
  while (out.length < count) {
    const r = rat(BigInt(Math.floor(next() * 1501) - 500), 1000n);
    if (!seen.has(toString(r))) {
      seen.add(toString(r));
      out.push(r);
    }
  }
  return out;
}

console.log(`node ${process.version}, ${cpus()[0]?.model ?? "unknown CPU"}\n`);

console.log("## Accuracy on flows with a known set of IRRs (1000 cases per row, seed 1)\n");
console.log("| IRRs per flow | periods | irroots found all, exactly | Newton from 10% converged | Newton IRRs found / present |");
console.log("|---:|---:|---:|---:|---:|");
const next = rng(1);
for (const [count, periods] of [[1, 10], [2, 10], [2, 30], [3, 30], [4, 60]] as const) {
  let allFound = 0;
  let converged = 0;
  let newtonFound = 0;
  const cases = 1000;
  for (let i = 0; i < cases; i++) {
    const rates = randomRates(next, count);
    const flows = generateFlows(rates, periods, Math.floor(next() * 2 ** 31));
    const roots = findIrrs(flows).roots;
    const expected = rates.map(toString).sort().join();
    if (roots.map((r) => (r.exact ? toString(r.exact) : "?")).sort().join() === expected) allFound++;
    const n = newtonIrr(flows);
    if (n !== null) {
      converged++;
      if (rates.some((r) => Math.abs(Number(r.num) / Number(r.den) - n) < 1e-6)) newtonFound++;
    }
  }
  console.log(`| ${count} | ${periods} | ${allFound}/${cases} | ${converged}/${cases} | ${newtonFound}/${cases * count} |`);
}

console.log("\n## Time per call to findIrrs (median, precision 1e-12)\n");
console.log("| periods | IRRs | repeated root | median ms |");
console.log("|---:|---:|:---:|---:|");
const timing: [number, string[], boolean][] = [
  [12, ["0.08"], false],
  [12, ["0.05", "0.3"], false],
  [60, ["0.004", "0.01", "-0.02"], false],
  [120, ["0.004", "0.01", "-0.02"], false],
  [360, ["0.004", "0.01", "-0.02"], false],
  [30, ["0.07", "0.15"], true],
  [60, ["0.07", "0.15"], true],
];
for (const [periods, roots, repeated] of timing) {
  const flows = repeated
    ? generateFlows(roots, periods - 1, 3).reduce<bigint[]>((acc, c, t) => {
        // Multiply NPV by (107x - 100) once more, making 7% a double root.
        acc[t] = (acc[t] ?? 0n) - 100n * c;
        acc[t + 1] = (acc[t + 1] ?? 0n) + 107n * c;
        return acc;
      }, [])
    : generateFlows(roots, periods, 3);
  const found = findIrrs(flows).roots.length;
  console.log(`| ${periods} | ${found} | ${repeated ? "yes" : "no"} | ${time(() => findIrrs(flows)).toFixed(2)} |`);
}

console.log("\n## Irrational IRRs: time to a given precision (-1, 0, ..., 0, 2 over 60 periods)\n");
console.log("| precision | median ms |");
console.log("|---:|---:|");
const irrational = ["-1", ...Array.from({ length: 59 }, () => "0"), "2"];
for (const precision of ["1e-6", "1e-12", "1e-30", "1e-100"]) {
  console.log(`| ${precision} | ${time(() => findIrrs(irrational, { precision })).toFixed(2)} |`);
}
