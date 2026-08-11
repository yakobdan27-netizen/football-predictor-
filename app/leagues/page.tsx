import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function LeaguesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/leagues", searchParams);
}
