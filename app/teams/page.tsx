import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/teams", searchParams);
}
