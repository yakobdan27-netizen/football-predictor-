import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function HalfComparisonAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/half-comparison-analysis", searchParams);
}
