import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.js";
import { parseFlowsText } from "../src/input.js";

test("parseFlowsText accepts headers, period,amount rows and comments", () => {
  assert.deepEqual(parseFlowsText("period,amount\n0,-1600\n# build\n1,10000\n\n2,-10000\n"), ["-1600", "10000", "-10000"]);
  assert.deepEqual(parseFlowsText("-100\r\n110\r\n"), ["-100", "110"]);
  assert.throws(() => parseFlowsText("-100\nabc\n"), /line 2/);
});

test("CLI reads a file and lists every IRR", () => {
  const dir = mkdtempSync(join(tmpdir(), "irroots-"));
  const file = join(dir, "flows.csv");
  writeFileSync(file, "period,amount\n0,-1600\n1,10000\n2,-10000\n");
  const { code, stdout } = main([file, "--compare-newton"]);
  assert.equal(code, 0);
  assert.match(stdout, /2 IRRs:/);
  assert.match(stdout, /25% +exact: r = 1\/4/);
  assert.match(stdout, /400% +exact: r = 4/);
  assert.match(stdout, /Newton from 10%: 25% \(reports one IRR and misses 1\)/);
});

test("CLI proves absence of an IRR", () => {
  const { code, stdout } = main(["--flows", "1,-1,1"]);
  assert.equal(code, 0);
  assert.match(stdout, /no IRR: exact root isolation/);
});

test("CLI JSON output carries exact bounds", () => {
  const { code, stdout } = main(["--flows", "-1,0,2", "--precision", "1e-6", "--json", "--finance-rate", "0.1", "--reinvest-rate", "0.1"]);
  assert.equal(code, 0);
  const json = JSON.parse(stdout);
  assert.equal(json.irrs.length, 1);
  assert.equal(json.irrs[0].exact, null);
  assert.ok(Math.abs(json.irrs[0].approx - (Math.SQRT2 - 1)) < 1e-6);
  assert.equal(typeof json.mirr, "number");
});

test("CLI generate round-trips through the solver", () => {
  const gen = main(["generate", "--roots", "0.05,0.12,-0.4", "--periods", "15", "--seed", "4"]);
  assert.equal(gen.code, 0);
  const { stdout } = main(["--flows", gen.stdout.split("\n").join(","), "--json"]);
  assert.deepEqual(JSON.parse(stdout).irrs.map((r: { exact: string }) => r.exact), ["-2/5", "1/20", "3/25"]);
});

test("CLI usage errors exit with code 2 and a message", () => {
  for (const args of [[], ["--flows"], ["--flows", "0,0"], ["--flows", "-1,2", "--finance-rate", "0.1"], ["generate", "--roots", "0.1"], ["/no/such/file"]]) {
    const { code, stderr } = main(args);
    assert.equal(code, 2, args.join(" "));
    assert.match(stderr, /^irroots: /);
  }
});
