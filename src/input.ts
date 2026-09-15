import { parseDecimal } from "./rational.js";

/**
 * Cash flows from text. One flow per line; if a line has several comma- or tab-separated fields
 * the last one is the amount, so "period,amount" exports work. A first line whose amount is not a
 * number is treated as a header. Blank lines and lines starting with # are ignored.
 */
export function parseFlowsText(text: string): string[] {
  const flows: string[] = [];
  let first = true;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("#")) continue;
    const fields = line.split(/[,\t;]/).map((f) => f.trim());
    const amount = fields[fields.length - 1]!;
    try {
      parseDecimal(amount);
    } catch {
      if (first) {
        first = false;
        continue;
      }
      throw new SyntaxError(`line ${i + 1}: not a number: ${JSON.stringify(amount)}`);
    }
    first = false;
    flows.push(amount);
  }
  return flows;
}
