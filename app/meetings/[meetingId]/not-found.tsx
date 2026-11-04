import type { Metadata } from "next";

import { BrandedNotFound } from "@/components/branded-not-found";

export const metadata: Metadata = {
  title: "Meeting not found",
};

export default function MeetingNotFound() {
  return (
    <BrandedNotFound
      eyebrow="404 · Meeting"
      title="We can't open this meeting."
      description="This meeting is in another workspace, or it was removed."
      hint="If someone shared it with you, sign in with the Google account they shared it to, or ask them to share it again."
    />
  );
}
