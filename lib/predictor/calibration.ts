export interface CalibrationBin {

  bin: string;

  predicted: number;

  observed: number;

  count: number;

}



export interface BinCalibrator {

  nBins: number;

  scales: number[];

  minCount: number;

}



export interface Calibrator1x2 {

  home: BinCalibrator;

  draw: BinCalibrator;

  away: BinCalibrator;

}



function calibratorBinIndex(p: number, nBins: number): number {
  const bins = Math.max(1, nBins || 10);
  const clamped = Math.min(Math.max(p, 0), 1);
  if (!Number.isFinite(clamped)) return 0;
  if (clamped >= 1) return bins - 1;
  return Math.min(bins - 1, Math.max(0, Math.floor(clamped * bins)));
}

export function reliabilityBins(

  predicted: number[],

  actual: number[],

  nBins = 10

): CalibrationBin[] {

  if (predicted.length === 0) return [];

  const binsCount = Math.max(1, nBins || 10);

  const bins: { sumPred: number; sumActual: number; count: number }[] = Array.from(

    { length: binsCount },

    () => ({ sumPred: 0, sumActual: 0, count: 0 })

  );



  for (let i = 0; i < predicted.length; i++) {

    if (!Number.isFinite(predicted[i])) continue;

    const p = Math.min(Math.max(predicted[i], 0), 1);

    const idx = calibratorBinIndex(p, binsCount);

    bins[idx].sumPred += p;

    bins[idx].sumActual += actual[i];

    bins[idx].count++;

  }



  return bins

    .map((b, i) => {

      if (b.count === 0) return null;

      const lo = (i / binsCount) * 100;

      const hi = ((i + 1) / binsCount) * 100;

      return {

        bin: `${lo.toFixed(0)}–${hi.toFixed(0)}%`,

        predicted: b.sumPred / b.count,

        observed: b.sumActual / b.count,

        count: b.count,

      };

    })

    .filter((b): b is CalibrationBin => b != null);

}



export function expectedCalibrationError(bins: CalibrationBin[]): number {

  const total = bins.reduce((s, b) => s + b.count, 0);

  if (total === 0) return 0;

  return bins.reduce(

    (s, b) => s + (b.count / total) * Math.abs(b.predicted - b.observed),

    0

  );

}



export function fitBinCalibrator(

  predicted: number[],

  actual: number[],

  nBins = 10,

  minCount = 5

): BinCalibrator {

  const binsCount = Math.max(1, nBins || 10);

  const sums = Array.from({ length: binsCount }, () => ({

    sumPred: 0,

    sumActual: 0,

    count: 0,

  }));

  for (let i = 0; i < predicted.length; i++) {

    if (!Number.isFinite(predicted[i])) continue;

    const p = Math.min(Math.max(predicted[i], 0), 1);

    const idx = calibratorBinIndex(p, binsCount);

    sums[idx].sumPred += p;

    sums[idx].sumActual += actual[i];

    sums[idx].count++;

  }

  const scales = sums.map((b) =>

    b.count >= minCount && b.sumPred > 0 ? b.sumActual / b.sumPred : 1

  );

  return { nBins: binsCount, scales, minCount };

}



export function applyBinCalibrator(p: number, calibrator: BinCalibrator): number {

  if (!Number.isFinite(p)) return 0.5;

  const clamped = Math.min(Math.max(p, 0), 1);

  const idx = calibratorBinIndex(clamped, calibrator.nBins);

  const scaled = clamped * (calibrator.scales[idx] ?? 1);

  return Math.min(0.99, Math.max(0.01, scaled));

}



export function fitCalibrator1x2(

  pHome: number[],

  pDraw: number[],

  pAway: number[],

  actualHome: number[],

  actualDraw: number[],

  actualAway: number[],

  nBins = 10

): Calibrator1x2 {

  return {

    home: fitBinCalibrator(pHome, actualHome, nBins),

    draw: fitBinCalibrator(pDraw, actualDraw, nBins),

    away: fitBinCalibrator(pAway, actualAway, nBins),

  };

}



export function applyCalibrator1x2(

  probs: [number, number, number],

  calibrator: Calibrator1x2

): [number, number, number] {

  const calibrated: [number, number, number] = [

    applyBinCalibrator(probs[0], calibrator.home),

    applyBinCalibrator(probs[1], calibrator.draw),

    applyBinCalibrator(probs[2], calibrator.away),

  ];

  const sum = calibrated[0] + calibrated[1] + calibrated[2];

  if (sum <= 0) return probs;

  return [calibrated[0] / sum, calibrated[1] / sum, calibrated[2] / sum];

}



export function actualOutcome1x2(hg: number, ag: number): [number, number, number] {

  if (hg > ag) return [1, 0, 0];

  if (hg === ag) return [0, 1, 0];

  return [0, 0, 1];

}


