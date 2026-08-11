import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function ConcededHalfAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/conceded-half-analysis", searchParams);
}
