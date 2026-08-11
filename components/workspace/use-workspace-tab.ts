"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type WorkspaceDef,
  resolveTabId,
} from "@/lib/navigation/workspace-routes";

/**
 * Sync workspace tab with `?tab=` while preserving other query keys.
 */
export function useWorkspaceTab(workspace: WorkspaceDef) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tab = useMemo(
    () => resolveTabId(workspace, searchParams.get("tab")),
    [workspace, searchParams]
  );

  const setTab = useCallback(
    (nextTab: string) => {
      const resolved = resolveTabId(workspace, nextTab);
      const qs = new URLSearchParams(searchParams.toString());
      qs.set("tab", resolved);
      const q = qs.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [workspace, searchParams, router, pathname]
  );

  return { tab, setTab };
}
