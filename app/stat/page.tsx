import { redirect } from "next/navigation";

/** Brief alias: `/stat` → `/analysis`, preserving query (e.g. `?batch=REC-…`). */
export default async function StatRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, v);
    } else {
      qs.set(key, value);
    }
  }
  const q = qs.toString();
  redirect(q ? `/analysis?${q}` : "/analysis");
}
