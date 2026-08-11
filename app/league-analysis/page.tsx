import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function LeagueAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/league-analysis", searchParams);
}
