import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function LadderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/ladder", searchParams);
}
