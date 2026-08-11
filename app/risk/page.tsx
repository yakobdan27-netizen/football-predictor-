import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function RiskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/risk", searchParams);
}
