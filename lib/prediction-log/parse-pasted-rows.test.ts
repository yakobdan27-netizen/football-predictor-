import assert from "node:assert/strict";
import {
  applyPastedTeamRows,
  parsePastedRows,
} from "./parse-pasted-rows";

{
  const pasted = parsePastedRows("Arsenal\tChelsea\nLiverpool\tEverton\nMan City\tTottenham");
  assert.equal(pasted.length, 3);
  assert.equal(pasted[0]!.home, "Arsenal");
  assert.equal(pasted[2]!.away, "Tottenham");
}

{
  type Row = { id: string; homeTeam: string; awayTeam: string };
  const existing: Row[] = [
    { id: "1", homeTeam: "A", awayTeam: "B" },
    { id: "2", homeTeam: "", awayTeam: "" },
  ];
  let n = 2;
  const next = applyPastedTeamRows(
    existing,
    parsePastedRows("Home1\tAway1\nHome2\tAway2\nHome3\tAway3\nHome4\tAway4"),
    1,
    () => {
      n += 1;
      return { id: String(n), homeTeam: "", awayTeam: "" };
    }
  );
  assert.equal(next.length, 5, "paste beyond remaining rows appends empty matches");
  assert.equal(next[0]!.homeTeam, "A");
  assert.equal(next[1]!.homeTeam, "Home1");
  assert.equal(next[2]!.awayTeam, "Away2");
  assert.equal(next[4]!.homeTeam, "Home4");
  assert.equal(next[4]!.id, "5");
}

console.log("parse-pasted-rows tests passed");
