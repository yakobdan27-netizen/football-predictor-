"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { WorkspaceDef } from "@/lib/navigation/workspace-routes";
import { useWorkspaceTab } from "./use-workspace-tab";

export type WorkspacePanel = {
  id: string;
  content: ReactNode;
};

type Props = {
  workspace: WorkspaceDef;
  panels: WorkspacePanel[];
  /** Optional subtitle under the workspace title. */
  subtitle?: string;
};

/**
 * Tabbed workspace shell: URL-synced tabs, lazy-mount then keep mounted.
 */
export function WorkspaceShell({ workspace, panels, subtitle }: Props) {
  const { tab, setTab } = useWorkspaceTab(workspace);
  const [mounted, setMounted] = useState<Set<string>>(() => new Set([tab]));

  useEffect(() => {
    setMounted((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, [tab]);

  return (
    <div className="workspace-shell">
      <header style={{ marginBottom: "0.75rem" }}>
        <h1 className="page-title">{workspace.title}</h1>
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
      </header>

      <div
        className="workspace-tabs"
        role="tablist"
        aria-label={`${workspace.title} sections`}
      >
        {workspace.tabs.map((t) => {
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`workspace-tab${selected ? " active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="workspace-panels">
        {panels.map((panel) => {
          if (!mounted.has(panel.id)) return null;
          const active = panel.id === tab;
          return (
            <div
              key={panel.id}
              role="tabpanel"
              hidden={!active}
              className="workspace-panel"
            >
              {panel.content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
