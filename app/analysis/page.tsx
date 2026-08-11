import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/analysis", searchParams);
}
