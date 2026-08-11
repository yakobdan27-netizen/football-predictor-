import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function BacktestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/backtest", searchParams);
}
