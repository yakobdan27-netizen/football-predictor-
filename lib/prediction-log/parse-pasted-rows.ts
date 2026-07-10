import type { ResultGridField } from "./result-grid-fields";

function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((s) => s.trim());
  if (line.includes(",")) return line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
  return line.split(/\s{2,}/).map((s) => s.trim());
}

export interface PastedRow {
  home: string;
  away: string;
}

export function parsePastedRows(text: string): PastedRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows: PastedRow[] = [];
  for (const line of lines) {
    const parts = splitLine(line).filter(Boolean);
    if (parts.length >= 2) {
      rows.push({ home: parts[0]!, away: parts[1]! });
    }
  }
  return rows;
}

/** TSV/CSV paste starting at `startField`, filling fields rightward then rows downward. */
export function parsePastedResultGrid(
  text: string,
  startField: ResultGridField,
  fields: ResultGridField[]
): Array<Partial<Record<ResultGridField, string>>> {
  const startIdx = fields.indexOf(startField);
  if (startIdx < 0) return [];

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const patches: Array<Partial<Record<ResultGridField, string>>> = [];
  for (const line of lines) {
    const cells = splitLine(line);
    const patch: Partial<Record<ResultGridField, string>> = {};
    for (let c = 0; c < cells.length; c++) {
      const field = fields[startIdx + c];
      if (!field) break;
      patch[field] = cells[c] ?? "";
    }
    if (Object.keys(patch).length > 0) patches.push(patch);
  }
  return patches;
}
