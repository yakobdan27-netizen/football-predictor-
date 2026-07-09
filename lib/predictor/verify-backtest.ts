import fs from "node:fs";
import { parseCsv } from "../csv";
import { backtestCompare } from "./backtest-enhance";

const csvPath = process.argv[2] ?? "data/raw/E0_2425.csv";
if (!fs.existsSync(csvPath)) {
  console.error("Missing CSV:", csvPath);
  process.exit(1);
}

const text = fs.readFileSync(csvPath, "utf-8");
const rows = parseCsv(text);
const withOdds = rows.filter((r) => r.B365H && r.B365D && r.B365A);
console.log("rows", rows.length, "with B365", withOdds.length);

const base = backtestCompare(rows, 0.2, 50, 0.002, {});
const enhanced = backtestCompare(rows, 0.2, 50, 0.002, {
  blendOdds: true,
  blendAlpha: 0.5,
  calibrate: true,
});

console.log("model-only Brier", base.metrics.brier1x2.toFixed(4), "ECE", base.metrics.ece1x2?.toFixed(4));
if (enhanced.metricsEnhanced) {
  console.log(
    "enhanced Brier",
    enhanced.metricsEnhanced.brier1x2.toFixed(4),
    "ECE",
    enhanced.metricsEnhanced.ece1x2?.toFixed(4)
  );
  console.log(
    "delta Brier",
    (enhanced.metricsEnhanced.brier1x2 - base.metrics.brier1x2).toFixed(4),
    "delta ECE",
    ((enhanced.metricsEnhanced.ece1x2 ?? 0) - (base.metrics.ece1x2 ?? 0)).toFixed(4)
  );
} else {
  console.error("No enhanced metrics — check B365 coverage");
  process.exit(1);
}
