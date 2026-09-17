#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findIrrs, mirr, newtonIrr, type IrrResult } from "./irr.js";
import { generateFlows } from "./generate.js";
import { parseFlowsText } from "./input.js";
import { findXirrs, type DatedFlow } from "./xirr.js";
import { parseDecimal, toFixedCeil, toFixedFloor, toNumber, toString } from "./rational.js";

const USAGE = `usage:
  irroots [FILE | -] [--flows c0,c1,...] [--precision 1e-12]
          [--finance-rate R --reinvest-rate R] [--compare-newton] [--json]
  irroots generate --roots r1,r2,... --periods N [--seed S]
  irroots xirr FILE [--precision 1e-9] [--json]

FILE holds one cash flow per line (or "period,amount"); "-" reads stdin.
For xirr, each line is "YYYY-MM-DD,amount" or "days,amount" from the first date.
Rates are decimals: 0.1 means 10%. xirr rates are annual, ACT/365.`;

class UsageError extends Error {}

function parseArgs(argv: string[]): { positional: string[]; flags: Map<string, string | true> } {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const boolean = new Set(["--json", "--compare-newton", "--help", "-h"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("-") && a !== "-" && !/^-[\d.]/.test(a)) {
      const eqAt = a.indexOf("=");
      if (eqAt > 0) flags.set(a.slice(0, eqAt), a.slice(eqAt + 1));
      else if (boolean.has(a)) flags.set(a, true);
      else if (i + 1 < argv.length) flags.set(a, argv[++i]!);
      else throw new UsageError(`${a} needs a value`);
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function stringFlag(flags: Map<string, string | true>, name: string): string | undefined {
  const v = flags.get(name);
  if (v === true) throw new UsageError(`${name} needs a value`);
  return v;
}

function numberFlag(flags: Map<string, string | true>, name: string): number | undefined {
  const v = stringFlag(flags, name);
  if (v === undefined) return undefined;
  return toNumber(parseDecimal(v));
}

function percent(rate: number): string {
  return `${(rate * 100).toPrecision(10).replace(/\.?0+$/, "")}%`;
}

function render(result: IrrResult, digits: number, extras: string[]): string {
  const out: string[] = [];
  const n = result.flows.length - 1;
  out.push(`${result.flows.length} cash flows over ${n} period${n === 1 ? "" : "s"}`);
  out.push(`sign changes in flows: ${result.signChanges} (at most ${result.signChanges} IRRs)`);
  out.push(
    `sign changes in cumulative flows: ${result.cumulativeSignChanges}` +
      (result.norstromUnique ? " (Norstrom: exactly one IRR above 0%)" : ""),
  );
  out.push("");
  if (result.roots.length === 0) {
    out.push(
      result.signChanges === 0
        ? "no IRR: the flows never change sign, so NPV has no root at any rate above -100%"
        : "no IRR: exact root isolation found no rate above -100% where NPV is zero",
    );
  } else {
    out.push(`${result.roots.length} IRR${result.roots.length === 1 ? "" : "s"}:`);
    for (const root of result.roots) {
      const touches = root.multiplicity % 2 === 0 ? ", NPV touches zero without changing sign" : "";
      const mult = root.multiplicity > 1 ? `  (multiplicity ${root.multiplicity}${touches})` : "";
      if (root.exact) {
        out.push(`  ${percent(root.approx).padEnd(18)} exact: r = ${toString(root.exact)}${mult}`);
      } else {
        const interval = `r in (${toFixedFloor(root.lo, digits)}, ${toFixedCeil(root.hi, digits)})`;
        out.push(`  ${percent(root.approx).padEnd(18)} ${interval}${mult}`);
      }
    }
  }
  if (extras.length > 0) out.push("", ...extras);
  return out.join("\n");
}

function readInput(positional: string[], flags: Map<string, string | true>): string[] {
  const inline = stringFlag(flags, "--flows");
  if (inline !== undefined) {
    if (positional.length > 0) throw new UsageError("give either FILE or --flows, not both");
    return inline.split(",").map((s) => s.trim());
  }
  if (positional.length !== 1) throw new UsageError("expected exactly one FILE, or --flows");
  const text = positional[0] === "-" ? readFileSync(0, "utf8") : readFileSync(positional[0]!, "utf8");
  return parseFlowsText(text);
}

export function main(argv: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const { positional, flags } = parseArgs(argv);
    if (flags.has("--help") || flags.has("-h")) return { code: 0, stdout: USAGE, stderr: "" };

    if (positional[0] === "generate") {
      const roots = stringFlag(flags, "--roots");
      const periods = stringFlag(flags, "--periods");
      if (roots === undefined || periods === undefined) throw new UsageError("generate needs --roots and --periods");
      const rates = roots.split(",").map((s) => s.trim()).filter((s) => s !== "");
      const flows = generateFlows(rates, Number(periods), Number(stringFlag(flags, "--seed") ?? "1"));
      return { code: 0, stdout: flows.join("\n"), stderr: "" };
    }

    if (positional[0] === "xirr") {
      return runXirr(positional.slice(1), flags);
    }

    const flows = readInput(positional, flags);
    const precisionText = stringFlag(flags, "--precision") ?? "1e-12";
    const result = findIrrs(flows, { precision: precisionText });

    const finance = numberFlag(flags, "--finance-rate");
    const reinvest = numberFlag(flags, "--reinvest-rate");
    if ((finance === undefined) !== (reinvest === undefined)) {
      throw new UsageError("--finance-rate and --reinvest-rate go together");
    }
    const modified = finance !== undefined ? mirr(flows, finance, reinvest!) : undefined;
    const newton = flags.has("--compare-newton") ? newtonIrr(flows) : undefined;

    if (flags.has("--json")) {
      const json = {
        irrs: result.roots.map((r) => ({
          approx: r.approx,
          lo: toString(r.lo),
          hi: toString(r.hi),
          exact: r.exact ? toString(r.exact) : null,
          multiplicity: r.multiplicity,
        })),
        signChanges: result.signChanges,
        cumulativeSignChanges: result.cumulativeSignChanges,
        norstromUnique: result.norstromUnique,
        ...(modified !== undefined ? { mirr: modified } : {}),
        ...(newton !== undefined ? { newton } : {}),
      };
      return { code: 0, stdout: JSON.stringify(json, null, 2), stderr: "" };
    }

    const extras: string[] = [];
    if (modified !== undefined) {
      extras.push(modified === null ? "MIRR: undefined (needs both negative and positive flows)" : `MIRR: ${percent(modified)}`);
    }
    if (newton !== undefined) {
      if (newton === null) {
        extras.push("Newton from 10%: did not converge");
      } else {
        const others = result.roots.length - 1;
        extras.push(
          `Newton from 10%: ${percent(newton)}` +
            (others > 0 ? ` (reports one IRR and misses ${others})` : ""),
        );
      }
    }
    const tol = toNumber(parseDecimal(precisionText));
    const digits = Math.min(40, Math.max(2, Math.ceil(-Math.log10(tol)) + 1));
    return { code: 0, stdout: render(result, digits, extras), stderr: "" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const usage = err instanceof UsageError ? `\n\n${USAGE}` : "";
    return { code: 2, stdout: "", stderr: `irroots: ${message}${usage}` };
  }
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const { code, stdout, stderr } = main(process.argv.slice(2));
  if (stdout) process.stdout.write(`${stdout}\n`);
  if (stderr) process.stderr.write(`${stderr}\n`);
  process.exitCode = code;
}

/** Days from the first date, for "YYYY-MM-DD" or a plain day count. */
function dayOf(token: string, first: string): number {
  if (/^\d+$/.test(token)) return Number(token);
  const day = Date.parse(`${token}T00:00:00Z`);
  const base = Date.parse(`${first}T00:00:00Z`);
  if (Number.isNaN(day) || Number.isNaN(base)) throw new UsageError(`not a date or day count: ${token}`);
  return Math.round((day - base) / 86_400_000);
}

function runXirr(
  positional: string[],
  flags: Map<string, string | true>,
): { code: number; stdout: string; stderr: string } {
  const text = positional[0] === undefined || positional[0] === "-" ? readFileSync(0, "utf8") : readFileSync(positional[0], "utf8");
  const rows = text
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter((l) => l !== "")
    .map((l) => l.split(","));
  if (rows.length < 2) throw new UsageError("xirr needs at least two dated flows");
  if (rows.some((r) => r.length !== 2)) throw new UsageError('each xirr line is "date,amount"');
  const first = rows[0]![0]!.trim();
  const flows: DatedFlow[] = rows.map((r) => ({
    day: dayOf(r[0]!.trim(), first),
    amount: parseDecimal(r[1]!.trim()),
  }));

  const precision = Number(stringFlag(flags, "--precision") ?? "1e-9");
  const result = findXirrs(flows, precision);

  if (flags.has("--json")) {
    return {
      code: 0,
      stdout: `${JSON.stringify(
        {
          xirrs: result.roots.map((r) => ({ approx: r.rate, lo: toString(r.low), hi: toString(r.high) })),
          signChanges: result.signChanges,
          unique: result.unique,
          complete: result.complete,
        },
        null,
        2,
      )}\n`,
      stderr: "",
    };
  }

  const lines: string[] = [];
  lines.push(`${flows.length} dated flows over ${flows[flows.length - 1]!.day} days, ACT/365`);
  lines.push(`sign changes: ${result.signChanges} (Descartes' upper bound on the number of XIRRs)`);
  if (result.roots.length === 0) lines.push("no XIRR exists");
  for (const r of result.roots) {
    const exact = r.exact ? " (exact)" : "";
    lines.push(`XIRR ${(100 * r.rate).toFixed(6)}%${exact}`);
  }
  lines.push(
    result.unique
      ? "unique: Norstrom's criterion proves this is the only one"
      : result.complete
        ? "complete: as many roots as the sign-change bound allows, so these are all of them"
        : "not proven complete: fewer roots than the bound allows, so others may exist",
  );
  return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}
