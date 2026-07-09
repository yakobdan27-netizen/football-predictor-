import assert from "node:assert/strict";
import { blend1x2, blendBinary } from "./blend";
import { applyBinCalibrator, fitBinCalibrator } from "./calibration";
import { deVig1x2, deVigBinary, impliedProb } from "./odds";

assert.ok(impliedProb(2) === 0.5);
assert.ok(impliedProb(1) === null);

const market = deVig1x2(2, 3.5, 4);
assert.ok(market);
const sum = market!.pHome + market!.pDraw + market!.pAway;
assert.ok(Math.abs(sum - 1) < 1e-9);

const binary = deVigBinary(1.9, 1.95);
assert.ok(binary);
assert.ok(Math.abs(binary!.over + binary!.under - 1) < 1e-9);

const model: [number, number, number] = [0.5, 0.25, 0.25];
const blended = blend1x2(model, market!, 0.5);
assert.ok(Math.abs(blended[0] + blended[1] + blended[2] - 1) < 1e-9);

const bOver = blendBinary(0.6, 0.55, 0.5);
assert.ok(bOver > 0.57 && bOver < 0.59);

const cal = fitBinCalibrator([0.2, NaN, 0.8, 1], [0, 1, 1, 1]);
assert.equal(cal.scales.length, 10);
assert.ok(Number.isFinite(applyBinCalibrator(0.5, cal)));

console.log("odds + blend tests passed");
