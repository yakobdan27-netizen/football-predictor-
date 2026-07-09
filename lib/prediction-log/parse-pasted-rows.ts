export interface PastedRow {
  home: string;
  away: string;
}

function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((s) => s.trim());
  if (line.includes(",")) return line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
  return line.split(/\s{2,}/).map((s) => s.trim());
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
