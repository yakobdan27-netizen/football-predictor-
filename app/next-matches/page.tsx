import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function NextMatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/next-matches", searchParams);
}
