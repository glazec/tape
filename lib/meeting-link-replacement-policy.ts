// Pure so the meeting page can decide whether to offer the action without
// loading the database or vendor clients.
export function canReplaceMeetingLink(input: {
  botState?: string | null;
  platform: string;
  status: string;
}) {
  if (input.platform === "upload" || input.platform === "in_person") {
    return false;
  }

  return (
    input.status === "scheduled" ||
    (input.status === "recording" && input.botState === "waiting_room")
  );
}
