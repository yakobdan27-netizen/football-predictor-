import { createHash } from "crypto";
import { getDb, schema } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import type { MarketAdvisoryRunResult } from "./types";

function defHash(marketCode: string, def: Record<string, unknown>): string {
  return createHash("sha256")
    .update(marketCode + JSON.stringify(def))
    .digest("hex")
    .slice(0, 12);
}

export async function persistMarketAdvisoryRun(
  result: MarketAdvisoryRunResult
): Promise<void> {
  try {
    const db = await getDb();
    const now = new Date();

    await db.insert(schema.marketAdvisoryRuns).values({
      advisoryRunId: result.advisoryRunId,
      fixtureId: result.fixtureId,
      generatedAt: new Date(result.generatedAt),
      predictionCutoffAt: new Date(result.predictionCutoffAt),
      msamModelVersion: result.msamModelVersion,
      collaborationPolicyVersion: result.collaborationPolicyVersion,
      dataPolicyVersion: result.dataPolicyVersion,
      status: result.status,
      inputLineageHash: result.inputLineageHash,
      metaJson: JSON.stringify({
        matchId: result.matchId,
        cqsBootstrap: result.cqsBootstrap,
        normalizationBootstrap: result.normalizationBootstrap,
        warnings: result.warnings,
      }),
      createdAt: now,
    });

    for (const c of result.candidates) {
      const hash = defHash(c.marketCode, c.marketDefinition);
      await db.insert(schema.marketAdvisoryCandidates).values({
        advisoryRunId: result.advisoryRunId,
        marketCode: c.marketCode,
        marketFamily: c.marketFamily,
        conflictGroup: c.conflictGroup,
        marketDefinitionHash: hash,
        marketDefinitionJson: JSON.stringify(c.marketDefinition),
        rawProbability: c.rawProbability,
        calibratedProbability: c.calibratedProbability,
        probabilityLower: c.probabilityLower,
        probabilityUpper: c.probabilityUpper,
        eligible: c.eligible ? 1 : 0,
        ineligibilityReasonCodes: JSON.stringify(c.ineligibilityReasonCodes),
        ops: c.dimensions.ops,
        cqs: c.dimensions.cqs,
        ecs: c.dimensions.ecs,
        sss: c.dimensions.sss,
        iss: c.dimensions.iss,
        dis: c.dimensions.dis,
        msamScore: c.msamScore,
        existingNormalizedScore: c.existingNormalizedScore,
        msamNormalizedScore: c.msamNormalizedScore,
        finalAdvisoryScore: c.finalAdvisoryScore,
        selectionRole: c.selectionRole,
        primaryRank: c.primaryRank,
        agreementStatus: c.agreementStatus,
        explanationSnapshotJson: JSON.stringify(c.explanationSnapshot),
        diagnosticSnapshotJson: JSON.stringify(c.diagnosticSnapshot),
        createdAt: now,
      });

      await db.insert(schema.marketAdvisorySourceCoverage).values({
        advisoryRunId: result.advisoryRunId,
        marketCode: c.marketCode,
        featureFamily: c.marketFamily,
        targetApiWeight: c.sourceCoverage.targetApiWeight,
        targetSystemWeight: c.sourceCoverage.targetSystemWeight,
        effectiveApiWeight: c.sourceCoverage.effectiveApiWeight,
        effectiveSystemWeight: c.sourceCoverage.effectiveSystemWeight,
        apiRecordCount: c.sourceCoverage.apiRecordCount,
        systemRecordCount: c.sourceCoverage.systemRecordCount,
        effectiveSampleSize: c.sourceCoverage.effectiveSampleSize,
        completenessJson: JSON.stringify({
          sourceBreakdown: c.sourceCoverage.sourceBreakdown,
          exclusionReasons: c.sourceCoverage.exclusionReasons,
        }),
        createdAt: now,
      });
    }

    await db.insert(schema.marketAdvisoryAuditEvents).values({
      advisoryRunId: result.advisoryRunId,
      eventType: "shadow_comparison",
      payloadJson: JSON.stringify({
        emsTop: result.emsSnapshot.candidates.map((c) => c.marketCode),
        msamTop: result.primary.map((c) => c.marketCode),
        finalTop: result.primary
          .sort(
            (a, b) =>
              (b.finalAdvisoryScore ?? b.msamScore) -
              (a.finalAdvisoryScore ?? a.msamScore)
          )
          .map((c) => c.marketCode),
        integrityFailures: result.integrityFailures,
      }),
      createdAt: now,
    });
  } catch (e) {
    console.warn("[market-advisory] persist skipped:", e);
  }
}

export async function loadLatestAdvisoryRun(
  fixtureId: number
): Promise<MarketAdvisoryRunResult | null> {
  try {
    const db = await getDb();
    const [run] = await db
      .select()
      .from(schema.marketAdvisoryRuns)
      .where(eq(schema.marketAdvisoryRuns.fixtureId, fixtureId))
      .orderBy(desc(schema.marketAdvisoryRuns.generatedAt))
      .limit(1);

    if (!run) return null;

    const candidates = await db
      .select()
      .from(schema.marketAdvisoryCandidates)
      .where(eq(schema.marketAdvisoryCandidates.advisoryRunId, run.advisoryRunId));

    const meta = run.metaJson ? JSON.parse(run.metaJson) : {};

    const mapped = candidates.map((row) => ({
      marketCode: row.marketCode,
      marketFamily: row.marketFamily as import("@/lib/slip-builder/types").MarketFamilyId,
      conflictGroup: row.conflictGroup as import("./types").MsamConflictGroup,
      selectionKey: "",
      selectionLabel: "",
      rawProbability: row.rawProbability ?? 0,
      calibratedProbability: row.calibratedProbability ?? 0,
      probabilityLower: row.probabilityLower,
      probabilityUpper: row.probabilityUpper,
      calibrated: true,
      coherenceOk: true,
      nEffective: 0,
      marketDefinition: row.marketDefinitionJson
        ? JSON.parse(row.marketDefinitionJson)
        : {},
      eligible: row.eligible === 1,
      ineligibilityReasonCodes: row.ineligibilityReasonCodes
        ? JSON.parse(row.ineligibilityReasonCodes)
        : [],
      dimensions: {
        ops: row.ops ?? 0,
        cqs: row.cqs ?? 0,
        ecs: row.ecs ?? 0,
        sss: row.sss ?? 0,
        iss: row.iss ?? 0,
        dis: row.dis ?? 0,
      },
      msamScore: row.msamScore ?? 0,
      sourceCoverage: {
        targetApiWeight: 0.6,
        targetSystemWeight: 0.4,
        effectiveApiWeight: 0.6,
        effectiveSystemWeight: 0.4,
        qApi: 0,
        qSystem: 0,
        apiRecordCount: null,
        systemRecordCount: null,
        effectiveSampleSize: 0,
        sourceBreakdown: "blended",
        exclusionCount: 0,
        exclusionReasons: [],
      },
      diagnosticSnapshot: row.diagnosticSnapshotJson
        ? JSON.parse(row.diagnosticSnapshotJson)
        : {},
      explanationSnapshot: row.explanationSnapshotJson
        ? JSON.parse(row.explanationSnapshotJson)
        : {},
      msamNormalizedScore: row.msamNormalizedScore ?? 0,
      existingNormalizedScore: row.existingNormalizedScore,
      finalAdvisoryScore: row.finalAdvisoryScore,
      agreementStatus: (row.agreementStatus ??
        "Insufficient Data") as import("./types").AgreementStatus,
      selectionRole: (row.selectionRole ?? "rejected") as import("./types").SelectionRole,
      primaryRank: row.primaryRank,
    }));

    return {
      advisoryRunId: run.advisoryRunId,
      fixtureId: run.fixtureId,
      matchId: meta.matchId ?? "",
      generatedAt: run.generatedAt.toISOString(),
      predictionCutoffAt: run.predictionCutoffAt.toISOString(),
      msamModelVersion: run.msamModelVersion,
      collaborationPolicyVersion: run.collaborationPolicyVersion,
      dataPolicyVersion: run.dataPolicyVersion,
      status: run.status as import("./types").AdvisoryRunStatus,
      inputLineageHash: run.inputLineageHash,
      integrityFailures: [],
      sourceCoverageSummary: mapped[0]?.sourceCoverage ?? {
        targetApiWeight: 0.6,
        targetSystemWeight: 0.4,
        effectiveApiWeight: 0.6,
        effectiveSystemWeight: 0.4,
        qApi: 0,
        qSystem: 0,
        apiRecordCount: null,
        systemRecordCount: null,
        effectiveSampleSize: 0,
        sourceBreakdown: "blended",
        exclusionCount: 0,
        exclusionReasons: [],
      },
      candidates: mapped,
      primary: mapped.filter((c) => c.selectionRole === "primary"),
      alternatives: mapped.filter((c) => c.selectionRole === "alternative"),
      rejected: mapped.filter((c) => c.selectionRole === "rejected"),
      warnings: meta.warnings ?? [],
      cqsBootstrap: meta.cqsBootstrap ?? true,
      normalizationBootstrap: meta.normalizationBootstrap ?? true,
      emsSnapshot: { kind: "weekend_picks", candidates: [], snapshotVersion: "loaded" },
    };
  } catch {
    return null;
  }
}
