import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function StatRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/stat", searchParams);
}
