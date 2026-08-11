import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function BetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/bets", searchParams);
}
