import { redirectLegacyPath } from "@/lib/navigation/legacy-redirect";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectLegacyPath("/settings", searchParams);
}
