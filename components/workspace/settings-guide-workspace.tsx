"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { getWorkspace } from "@/lib/navigation/workspace-routes";
import { SettingsApp } from "@/components/prediction-log/settings-app";
import { WorkspaceShell } from "./workspace-shell";

const workspace = getWorkspace("settings-guide");

export function SettingsGuideWorkspace({ guide }: { guide: ReactNode }) {
  return (
    <WorkspaceShell
      workspace={workspace}
      subtitle="Configuration and operating guide. Secrets and server keys stay server-side."
      panels={[
        {
          id: "settings",
          content: (
            <div>
              <p className="page-sub">
                Batch entry preferences and combined-odds engine configuration. Stored locally in
                your browser.
              </p>
              <p style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
                <Link href="/admin/manual-results" style={{ color: "var(--muted)" }}>
                  Admin → Manual Results
                </Link>
              </p>
              <SettingsApp />
            </div>
          ),
        },
        { id: "guide", content: guide },
      ]}
    />
  );
}
