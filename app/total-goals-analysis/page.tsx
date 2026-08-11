import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function TotalGoalsAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/total-goals-analysis", searchParams);
}
