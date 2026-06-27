import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCurrentUser } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  const user = await requireCurrentUser();

  return (
    <AppShell activeHref="/settings/team">
      <section className="flex max-w-3xl flex-col gap-6">
        <div>
          <p className="text-sm font-medium uppercase tracking-normal text-primary">
            Team settings
          </p>
          <h1 className="mt-3 text-3xl font-semibold">Access rules</h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Signed in as {user?.email ?? "unknown user"}.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Internal domains</CardTitle>
            <CardDescription>
              Control automatic access for internal meeting attendees.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="leading-7 text-muted-foreground">
              Allowed internal domains define which meeting attendees can
              receive automatic transcript access. When a meeting is processed,
              attendees with an allowed domain and matching workspace membership
              can be granted access without a manual share step.
            </p>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
