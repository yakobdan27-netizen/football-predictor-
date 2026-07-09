"use client";

interface ScoreGridHeatmapProps {
  grid: number[][];
  highlightHomeWin?: boolean;
  highlightAwayWin?: boolean;
  highlightCell?: { home: number; away: number };
  maxDisplayGoals?: number;
}

export function ScoreGridHeatmap({
  grid,
  highlightHomeWin = false,
  highlightAwayWin = false,
  highlightCell,
  maxDisplayGoals,
}: ScoreGridHeatmapProps) {
  if (!grid.length) return null;

  const displayRows =
    maxDisplayGoals != null ? grid.slice(0, maxDisplayGoals + 1) : grid;
  const max = Math.max(...displayRows.flat(), 0.001);

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: "0.7rem" }}>
        <thead>
          <tr>
            <th style={{ padding: "0.25rem" }}>H\A</th>
            {displayRows[0]!.map((_, away) => (
              <th key={away} style={{ padding: "0.25rem", minWidth: "2rem" }}>
                {away}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, home) => (
            <tr key={home}>
              <th style={{ padding: "0.25rem" }}>{home}</th>
              {row.map((prob, away) => {
                const isHomeWin = home > away;
                const isAwayWin = away > home;
                const highlighted =
                  (highlightHomeWin && isHomeWin) || (highlightAwayWin && isAwayWin);
                const isTopCell =
                  highlightCell != null &&
                  highlightCell.home === home &&
                  highlightCell.away === away;
                const intensity = prob / max;
                return (
                  <td
                    key={away}
                    title={`${(prob * 100).toFixed(2)}%`}
                    style={{
                      padding: "0.25rem",
                      textAlign: "center",
                      background: `rgba(34, 197, 94, ${intensity * 0.85})`,
                      outline: isTopCell
                        ? "2px solid var(--accent)"
                        : highlighted
                          ? "2px solid var(--accent)"
                          : undefined,
                      color: intensity > 0.5 ? "#000" : "inherit",
                    }}
                  >
                    {(prob * 100).toFixed(1)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
