import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function CombinedOddsExtendedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/combined-odds-extended", searchParams);
}
