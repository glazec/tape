import { AppShell } from "@/components/app-shell";
import { MeetingLinkForm } from "@/components/meeting-link-form";
import { UploadDropzone } from "@/components/upload-dropzone";

export default function NewMeetingPage() {
  return (
    <AppShell>
      <section className="max-w-3xl">
        <p className="text-sm font-medium uppercase tracking-normal text-[var(--primary)]">
          New meeting
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Add a transcript source</h1>
        <p className="mt-3 text-base leading-7 text-[var(--muted)]">
          Paste a meeting link for a future recording or upload an MP3 to queue
          transcription.
        </p>

        <MeetingLinkForm />

        <div className="mt-6">
          <UploadDropzone />
        </div>
      </section>
    </AppShell>
  );
}
