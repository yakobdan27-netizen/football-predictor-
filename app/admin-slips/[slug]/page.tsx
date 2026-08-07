import { notFound } from "next/navigation";
import { getAdminSlipsSlug } from "@/lib/ext-bets/admin-auth";
import { AdminSlipsApp } from "@/components/ext-bets/admin-slips-app";

export default async function AdminSlipsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const expected = getAdminSlipsSlug();
  if (!expected) {
    return (
      <div className="card" style={{ maxWidth: 480, margin: "2rem auto" }}>
        <h1 className="page-title" style={{ fontSize: "1.25rem" }}>
          Admin slips unavailable
        </h1>
        <p className="page-sub">
          Set ADMIN_SLIPS_SLUG in the environment to enable this page.
        </p>
      </div>
    );
  }
  if (slug !== expected) {
    notFound();
  }
  return <AdminSlipsApp slug={slug} />;
}
