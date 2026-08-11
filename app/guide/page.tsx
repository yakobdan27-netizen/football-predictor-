import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function GuidePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/guide", searchParams);
}
