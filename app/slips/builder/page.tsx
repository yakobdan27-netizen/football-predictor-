import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function SlipBuilderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/slips/builder", searchParams);
}
