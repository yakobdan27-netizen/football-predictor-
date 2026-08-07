import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getAdminUsersSlug } from "@/lib/ext-bets/admin-auth";
import { AdminUsersApp } from "@/components/ext-bets/admin-users-app";

export default async function AdminUsersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const expected = getAdminUsersSlug();
  if (!expected) {
    return (
      <div className="card" style={{ maxWidth: 480, margin: "2rem auto" }}>
        <h1 className="page-title" style={{ fontSize: "1.25rem" }}>
          Admin users unavailable
        </h1>
        <p className="page-sub">
          Set ADMIN_USERS_SLUG in the environment to enable this page.
        </p>
      </div>
    );
  }
  if (slug !== expected) {
    notFound();
  }
  return (
    <Suspense
      fallback={
        <p className="page-sub" style={{ maxWidth: 960, margin: "2rem auto" }}>
          Loading users…
        </p>
      }
    >
      <AdminUsersApp slug={slug} />
    </Suspense>
  );
}
