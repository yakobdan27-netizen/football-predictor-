import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function HighestScoringHalfPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/highest-scoring-half", searchParams);
}
