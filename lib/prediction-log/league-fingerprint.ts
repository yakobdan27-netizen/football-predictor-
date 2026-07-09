import type { League, LeagueCharacterProfile, LeagueCharacterTrait } from "./types";

const MIN_SAMPLE = 5;

function traitSentence(
  label: string,
  trait: LeagueCharacterTrait,
  highMsg: string,
  lowMsg: string,
  threshold = 0
): string | null {
  if (trait.value == null || trait.sampleSize < MIN_SAMPLE) return null;
  const delta = trait.baselineDelta ?? 0;
  if (Math.abs(delta) < threshold && threshold > 0) return null;
  if (delta > threshold) return highMsg.replace("{value}", String(trait.value));
  if (delta < -threshold) return lowMsg.replace("{value}", String(trait.value));
  return null;
}

export function generateFingerprintSentences(league: League): string[] {
  const p = league.characterProfile;
  const sentences: Array<{ score: number; text: string }> = [];

  const add = (text: string | null, weight = 1) => {
    if (text) sentences.push({ score: weight, text });
  };

  add(
    traitSentence(
      "early",
      p.early_goal_rate_0_10,
      "Goals rarely come early — only {value}% of matches score in the first 10 minutes.",
      "Fast starts — {value}% of matches see a goal in the first 10 minutes.",
      5
    ),
    Math.abs(p.early_goal_rate_0_10.baselineDelta ?? 0)
  );

  if (p.half_dominance.value != null && p.half_dominance.sampleSize >= MIN_SAMPLE) {
    if (p.half_dominance.value > 1.2) {
      add(
        `Back-loaded league: second half produces ${p.half_dominance.value}× the goals of the first.`,
        Math.abs(p.half_dominance.baselineDelta ?? 0) + 2
      );
    } else if (p.half_dominance.value < 0.85) {
      add(
        `Front-loaded league: first half sees more goals (${p.half_dominance.value}× ratio).`,
        Math.abs(p.half_dominance.baselineDelta ?? 0) + 2
      );
    }
  }

  add(
    traitSentence(
      "late",
      p.late_goal_rate_80_90,
      "Chaotic finishes — {value}% of matches have a goal after 80 minutes.",
      "Quiet endings — only {value}% score late.",
      8
    ),
    Math.abs(p.late_goal_rate_80_90.baselineDelta ?? 0)
  );

  if (p.yellow_cards_per_match_avg.value != null && p.yellow_cards_per_match_avg.sampleSize >= MIN_SAMPLE) {
    const yc = p.yellow_cards_per_match_avg.value;
    if ((p.yellow_cards_per_match_avg.baselineDelta ?? 0) > 0.5) {
      add(`High-card league: ${yc} yellows per match on average.`, Math.abs(p.yellow_cards_per_match_avg.baselineDelta ?? 0));
    }
  }

  if (p.favourite_reliability.value != null && p.favourite_reliability.sampleSize >= MIN_SAMPLE) {
    const fr = p.favourite_reliability.value;
    if (fr >= 65) {
      add(`Predictable results — favourites win ${fr}% of the time.`, Math.abs(p.favourite_reliability.baselineDelta ?? 0) + 1);
    } else if (fr <= 45) {
      add(`Upset-prone league — favourites win only ${fr}% of logged picks.`, Math.abs(p.favourite_reliability.baselineDelta ?? 0) + 2);
    }
  }

  if (p.goals_per_match_avg.value != null && p.goals_per_match_avg.sampleSize >= MIN_SAMPLE) {
    add(
      `Average ${p.goals_per_match_avg.value} goals per match across ${league.matchesLogged} logged games.`,
      1
    );
  }

  if (p.btts_rate.value != null && (p.btts_rate.baselineDelta ?? 0) > 8) {
    add(`Both teams score in ${p.btts_rate.value}% of matches — above typical leagues.`, Math.abs(p.btts_rate.baselineDelta ?? 0));
  }

  if (p.tempo_index.value != null && (p.tempo_index.baselineDelta ?? 0) > 3) {
    add(`High-tempo league (tempo index ${p.tempo_index.value}).`, Math.abs(p.tempo_index.baselineDelta ?? 0));
  }

  if (p.comeback_rate.value != null && (p.comeback_rate.baselineDelta ?? 0) > 5) {
    add(`Leads are unsafe — comebacks in ${p.comeback_rate.value}% of matches.`, Math.abs(p.comeback_rate.baselineDelta ?? 0));
  }

  if (p.scoreline_predictability.value != null && p.scoreline_predictability.sampleSize >= MIN_SAMPLE) {
    if (p.scoreline_predictability.value < 35) {
      add(
        `Scorelines rarely match top estimates — predictability ${p.scoreline_predictability.value}%. Treat correct-score as insight only.`,
        Math.abs(p.scoreline_predictability.baselineDelta ?? 0) + 2
      );
    } else if (p.scoreline_predictability.value >= 60) {
      add(
        `Scorelines are relatively predictable (${p.scoreline_predictability.value}% predictability).`,
        Math.abs(p.scoreline_predictability.baselineDelta ?? 0)
      );
    }
  }

  return sentences
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((s) => s.text);
}

export function confidenceBadgeLabel(level: League["confidenceLevel"]): string {
  if (level === "high") return "High confidence";
  if (level === "medium") return "Medium confidence";
  return "Low confidence";
}
