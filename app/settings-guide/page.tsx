import { Suspense } from "react";
import { GuideContent } from "@/components/guide/guide-content";
import { SettingsGuideWorkspace } from "@/components/workspace/settings-guide-workspace";

export default function SettingsGuidePage() {
  return (
    <Suspense fallback={<p className="page-sub">Loading Settings & Guide…</p>}>
      <SettingsGuideWorkspace guide={<GuideContent />} />
    </Suspense>
  );
}
