"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { resolveBatchByQuery } from "@/lib/prediction-log/snapshot-readers";
import type { PredictionBatch } from "@/lib/prediction-log/types";

/**
 * Single-batch selection for result pages: default newest eligible,
 * honor `?batch=` when valid, keep URL in sync on change.
 */
export function useSelectedBatchId(eligible: PredictionBatch[]) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const batchQuery = searchParams.get("batch");

  const fromQuery = useMemo(
    () => resolveBatchByQuery(eligible, batchQuery),
    [eligible, batchQuery]
  );

  const [batchId, setBatchIdState] = useState("");

  useEffect(() => {
    if (fromQuery) {
      setBatchIdState(fromQuery.id);
      return;
    }
    setBatchIdState((prev) => {
      if (prev && eligible.some((b) => b.id === prev)) return prev;
      return eligible[0]?.id ?? "";
    });
  }, [fromQuery, eligible]);

  const setBatchId = useCallback(
    (next: string) => {
      setBatchIdState(next);
      const qs = new URLSearchParams(searchParams.toString());
      if (next) qs.set("batch", next);
      else qs.delete("batch");
      const q = qs.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const selected = useMemo(
    () => eligible.find((b) => b.id === batchId) ?? null,
    [eligible, batchId]
  );

  return { batchId, setBatchId, selected };
}
