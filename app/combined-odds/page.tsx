import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function CombinedOddsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/combined-odds", searchParams);
}
