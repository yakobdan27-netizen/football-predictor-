import { readAdminSessionFromCookies, getAdminSecret } from "@/lib/admin/auth";
import { AdminUnlockForm } from "@/components/admin/admin-unlock-form";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!getAdminSecret()) {
    return (
      <div className="card" style={{ maxWidth: 480, margin: "2rem auto" }}>
        <h1 className="page-title" style={{ fontSize: "1.25rem" }}>
          Admin unavailable
        </h1>
        <p className="page-sub">
          Set <code>ADMIN_SECRET</code> in the environment, then reload.
        </p>
      </div>
    );
  }

  const ok = await readAdminSessionFromCookies();
  if (!ok) {
    return <AdminUnlockForm />;
  }

  return <>{children}</>;
}
