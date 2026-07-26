import { Eye, RotateCcw } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAdminImpersonatedUserId } from "@/lib/admin-access";
import {
  getAdminImpersonationTarget,
  listAdminImpersonationTargets,
} from "@/lib/admin-impersonation";
import { requireAdminUser } from "@/lib/auth-guards";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await requireAdminUser();
  const [targets, impersonatedUserId] = await Promise.all([
    listAdminImpersonationTargets(),
    getAdminImpersonatedUserId(),
  ]);
  const currentTarget = impersonatedUserId
    ? await getAdminImpersonationTarget(impersonatedUserId)
    : null;

  return (
    <AppShell activeHref="/admin">
      <section className="flex flex-col gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Admin
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            User view control
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            Signed in as {admin.email}. Choose a user to view and act as that
            account across the app.
          </p>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Current view</CardTitle>
            <CardDescription>
              {currentTarget
                ? `Currently viewing as ${currentTarget.email}`
                : "You are using your own account."}
            </CardDescription>
          </CardHeader>
          {currentTarget ? (
            <CardContent>
              <form action="/api/admin/impersonation" method="post">
                <input name="action" type="hidden" value="clear" />
                <input name="redirectTo" type="hidden" value="/admin" />
                <button
                  className={cn(buttonVariants({ variant: "outline" }), "w-fit")}
                  type="submit"
                >
                  <RotateCcw aria-hidden="true" />
                  Stop viewing as user
                </button>
              </form>
            </CardContent>
          ) : null}
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Choose user</CardTitle>
            <CardDescription>
              Open the workspace exactly as the selected user sees it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action="/api/admin/impersonation"
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              method="post"
            >
              <input name="redirectTo" type="hidden" value="/dashboard" />
              <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium">
                User
                <select
                  className="h-10 min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  defaultValue={currentTarget?.id ?? ""}
                  name="userId"
                  required
                >
                  <option disabled value="">
                    Select user
                  </option>
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name ? `${target.name} · ` : ""}
                      {target.email}
                      {target.teamName ? ` · ${target.teamName}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={cn(buttonVariants(), "min-h-10 w-fit")}
                type="submit"
              >
                <Eye aria-hidden="true" />
                View as user
              </button>
            </form>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
