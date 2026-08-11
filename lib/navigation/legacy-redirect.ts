import { redirect } from "next/navigation";
import { legacyRedirectTarget } from "./workspace-routes";

/**
 * Server redirect from a legacy standalone path to its workspace tab,
 * preserving meaningful query params.
 */
export async function redirectLegacyPath(
  legacyPath: string,
  searchParams: Promise<Record<string, string | string[] | undefined>>
): Promise<never> {
  const params = await searchParams;
  const target = legacyRedirectTarget(legacyPath, params);
  if (!target) {
    throw new Error(`No legacy redirect for ${legacyPath}`);
  }
  redirect(target);
}
