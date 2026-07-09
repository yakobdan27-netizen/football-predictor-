import type { Match } from "@/lib/db/schema";

import type { MatchRow } from "@/lib/predictor/types";



export function dbMatchToRow(m: Match): MatchRow {

  return {

    Date: m.matchDate ?? undefined,

    HomeTeam: m.homeTeam,

    AwayTeam: m.awayTeam,

    FTHG: m.fthg,

    FTAG: m.ftag,

    HTHG: m.hthg ?? undefined,

    HTAG: m.htag ?? undefined,

    HS: m.hs ?? undefined,

    AS: m.awayShots ?? undefined,

    HST: m.hst ?? undefined,

    AST: m.ast ?? undefined,

    HO: m.ho ?? undefined,

    AO: m.ao ?? undefined,

    HC: m.hc ?? undefined,
    AC: m.ac ?? undefined,
    HTI: m.hti ?? undefined,
    ATI: m.ati ?? undefined,
    B365H: m.b365Home ?? undefined,
    B365D: m.b365Draw ?? undefined,
    B365A: m.b365Away ?? undefined,
    B365Over25: m.b365Over25 ?? undefined,
    B365Under25: m.b365Under25 ?? undefined,
  };
}



export function parseCsv(text: string): MatchRow[] {

  const lines = text.trim().split(/\r?\n/);

  if (lines.length < 2) return [];



  const headers = lines[0].split(",").map((h) => h.trim());

  const rows: MatchRow[] = [];



  for (let i = 1; i < lines.length; i++) {

    const values = lines[i].split(",").map((v) => v.trim());

    if (values.length < headers.length) continue;



    const row: Record<string, string> = {};

    headers.forEach((h, j) => {

      row[h] = values[j];

    });



    const home = row.HomeTeam ?? row.home_team;

    const away = row.AwayTeam ?? row.away_team;

    const fthg = parseInt(row.FTHG ?? row.fthg ?? row.home_goals ?? "", 10);

    const ftag = parseInt(row.FTAG ?? row.ftag ?? row.away_goals ?? "", 10);



    if (!home || !away || isNaN(fthg) || isNaN(ftag)) continue;



    const match: MatchRow = {

      Date: row.Date ?? row.date ?? undefined,

      HomeTeam: home,

      AwayTeam: away,

      FTHG: fthg,

      FTAG: ftag,

    };



    const optional: [keyof MatchRow, string[]][] = [

      ["HTHG", ["HTHG", "hthg", "ht_home_goals"]],

      ["HTAG", ["HTAG", "htag", "ht_away_goals"]],

      ["HS", ["HS", "hs", "home_shots"]],

      ["AS", ["AS", "away_shots"]],

      ["HST", ["HST", "hst", "home_sot"]],

      ["AST", ["AST", "ast", "away_sot"]],

      ["HO", ["HO", "ho"]],

      ["AO", ["AO", "ao"]],

      ["HC", ["HC", "hc", "home_corners"]],
      ["AC", ["AC", "ac", "away_corners"]],
      ["HTI", ["HTI", "hti", "HomeThrowIns"]],
      ["ATI", ["ATI", "ati", "AwayThrowIns"]],
    ];

    const floatOptional: [keyof MatchRow, string[]][] = [
      ["B365H", ["B365H", "b365_home", "b365Home"]],
      ["B365D", ["B365D", "b365_draw", "b365Draw"]],
      ["B365A", ["B365A", "b365_away", "b365Away"]],
      ["B365Over25", ["B365>2.5", "B365Over25", "b365_over25", "b365Over25"]],
      ["B365Under25", ["B365<2.5", "B365Under25", "b365_under25", "b365Under25"]],
    ];



    for (const [key, aliases] of optional) {
      for (const alias of aliases) {
        const v = parseInt(row[alias] ?? "", 10);
        if (!isNaN(v)) {
          if (key === "HTHG") match.HTHG = v;
          else if (key === "HTAG") match.HTAG = v;
          else if (key === "HS") match.HS = v;
          else if (key === "AS") match.AS = v;
          else if (key === "HST") match.HST = v;
          else if (key === "AST") match.AST = v;
          else if (key === "HO") match.HO = v;
          else if (key === "AO") match.AO = v;
          else if (key === "HC") match.HC = v;
          else if (key === "AC") match.AC = v;
          else if (key === "HTI") match.HTI = v;
          else if (key === "ATI") match.ATI = v;
          break;
        }
      }
    }

    for (const [key, aliases] of floatOptional) {
      for (const alias of aliases) {
        const v = parseFloat(row[alias] ?? "");
        if (!isNaN(v) && v > 1) {
          if (key === "B365H") match.B365H = v;
          else if (key === "B365D") match.B365D = v;
          else if (key === "B365A") match.B365A = v;
          else if (key === "B365Over25") match.B365Over25 = v;
          else if (key === "B365Under25") match.B365Under25 = v;
          break;
        }
      }
    }



    rows.push(match);

  }



  return rows;

}



export function parseDateForDb(d?: string): string | null {

  if (!d) return null;

  const parts = d.split(/[/-]/);

  if (parts.length === 3) {

    const day = parts[0].padStart(2, "0");

    const month = parts[1].padStart(2, "0");

    let year = parseInt(parts[2], 10);

    if (year < 100) year += year > 50 ? 1900 : 2000;

    return `${year}-${month}-${day}`;

  }

  return d;

}



export function rowToDbInsert(row: MatchRow) {

  return {

    matchDate: parseDateForDb(row.Date),

    homeTeam: row.HomeTeam,

    awayTeam: row.AwayTeam,

    fthg: row.FTHG,

    ftag: row.FTAG,

    hthg: row.HTHG ?? null,

    htag: row.HTAG ?? null,

    hs: row.HS ?? null,

    awayShots: row.AS ?? null,

    hst: row.HST ?? null,

    ast: row.AST ?? null,

    ho: row.HO ?? null,

    ao: row.AO ?? null,

    hc: row.HC ?? null,
    ac: row.AC ?? null,
    hti: row.HTI ?? null,
    ati: row.ATI ?? null,
    b365Home: row.B365H ?? null,
    b365Draw: row.B365D ?? null,
    b365Away: row.B365A ?? null,
    b365Over25: row.B365Over25 ?? null,
    b365Under25: row.B365Under25 ?? null,
  };
}


