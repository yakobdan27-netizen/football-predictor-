import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function DrawEitherHalfAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/draw-either-half-analysis", searchParams);
}
