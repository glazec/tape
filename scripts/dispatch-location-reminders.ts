import { inngest } from "../inngest/client";

async function main() {
  if (!process.env.INNGEST_BASE_URL?.trim()) {
    throw new Error(
      "INNGEST_BASE_URL is required so reminder reconciliation targets self-hosted Inngest",
    );
  }

  const result = await inngest.send({
    id: `reconcile-location-reminder-schedules:${new Date().toISOString()}`,
    name: "meeting/reconcile.location-reminder-schedules",
    data: {},
  });

  console.log(
    `Queued location reminder reconciliation event${result.ids.length === 1 ? "" : "s"}: ${result.ids.length}`,
  );
}

void main();
