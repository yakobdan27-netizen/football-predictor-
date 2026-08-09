import { Suspense } from "react";
import { SlipBuilderApp } from "@/components/slip-builder/slip-builder-app";

export default function SlipBuilderPage() {
  return (
    <Suspense fallback={<p className="page-sub">Loading…</p>}>
      <SlipBuilderApp />
    </Suspense>
  );
}
