import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/play", searchParams);
}
