import type { ReactNode } from "react";
import Link from "next/link";
import { readFileSync } from "fs";
import { join } from "path";

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: ReactNode[] = [];
  let inTable = false;
  let tableRows: string[][] = [];

  function flushTable() {
    if (!tableRows.length) return;
    elements.push(
      <div key={`table-${elements.length}`} style={{ overflowX: "auto", marginBottom: "1rem" }}>
        <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
          <tbody>
            {tableRows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    style={{
                      padding: "0.5rem 0.75rem",
                      borderBottom: "1px solid var(--border)",
                      fontWeight: i === 0 ? 700 : 400,
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableRows = [];
    inTable = false;
  }

  for (const line of lines) {
    if (line.startsWith("|") && line.includes("|")) {
      if (line.match(/^\|[-| ]+\|$/)) continue;
      inTable = true;
      tableRows.push(
        line
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim())
      );
      continue;
    }
    if (inTable) flushTable();

    if (line.startsWith("# ")) {
      elements.push(
        <h1 key={elements.length} className="page-title" style={{ marginTop: "1.5rem" }}>
          {line.slice(2)}
        </h1>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h2 key={elements.length} style={{ fontWeight: 700, marginTop: "1.25rem", marginBottom: "0.5rem" }}>
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith("```")) {
      continue;
    } else if (line.startsWith("- ")) {
      elements.push(
        <li key={elements.length} style={{ marginLeft: "1.25rem", marginBottom: "0.25rem", color: "var(--muted)" }}>
          {line.slice(2)}
        </li>
      );
    } else if (line.trim()) {
      elements.push(
        <p key={elements.length} style={{ marginBottom: "0.75rem", lineHeight: 1.6 }}>
          {line}
        </p>
      );
    }
  }
  if (inTable) flushTable();
  return <>{elements}</>;
}

export default function GuidePage() {
  const path = join(process.cwd(), "docs", "OPERATING.md");
  const text = readFileSync(path, "utf-8");

  return (
    <div>
      <Link href="/" style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
        ← Dashboard
      </Link>
      <SimpleMarkdown text={text} />
    </div>
  );
}
