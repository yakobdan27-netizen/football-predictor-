"use client";

import { CORRECT_SCORE_HONESTY_NOTE } from "@/lib/prediction-log/correct-score";

interface CorrectScoreHonestyNoteProps {
  compact?: boolean;
}

export function CorrectScoreHonestyNote({ compact = false }: CorrectScoreHonestyNoteProps) {
  return (
    <p
      style={{
        margin: compact ? "0.35rem 0 0" : "0.75rem 0 0",
        fontSize: compact ? "0.75rem" : "0.8125rem",
        color: "var(--muted)",
        lineHeight: 1.45,
      }}
      title={CORRECT_SCORE_HONESTY_NOTE}
    >
      {CORRECT_SCORE_HONESTY_NOTE}
    </p>
  );
}
