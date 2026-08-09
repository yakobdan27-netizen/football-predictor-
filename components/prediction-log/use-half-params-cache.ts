"use client";

import { useEffect, useState } from "react";
import {
  setCachedHalfParams,
  type HalfParamsStore,
} from "@/lib/hist/half-params-types";
import { clearCanonicalFixtureCache } from "@/lib/prediction-log/canonical-fixture-estimate";

/**
 * Load fitted half-share / κ params into the client CFE cache.
 */
export function useHalfParamsCache(): {
  store: HalfParamsStore | null;
  loading: boolean;
  error: string | null;
} {
  const [store, setStore] = useState<HalfParamsStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetch("/api/hist/half-params")
      .then(async (r) => {
        const data = (await r.json()) as {
          ok?: boolean;
          store?: HalfParamsStore;
          error?: string;
        };
        if (cancelled) return;
        if (!r.ok || !data.ok || !data.store) {
          setError(data.error ?? "Half params unavailable");
          setStore(null);
          return;
        }
        setCachedHalfParams(data.store);
        clearCanonicalFixtureCache();
        setStore(data.store);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { store, loading, error };
}
