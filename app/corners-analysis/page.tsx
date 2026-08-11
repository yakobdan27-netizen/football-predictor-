import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function CornersAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/corners-analysis", searchParams);
}
