import { AppShell } from "@/components/app-shell";
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
          Paste a meeting link for a future recording or upload an MP3 for
          processing when the backend workflow is connected.
        </p>

        <form className="mt-8 flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-white p-5">
          <label htmlFor="meeting-link" className="text-sm font-medium">
            Meeting link
          </label>
          <input
            id="meeting-link"
            name="meeting-link"
            type="url"
            placeholder="https://meet.google.com/example"
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
          />
          <button
            type="button"
            className="w-fit rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white"
          >
            Save meeting link
          </button>
        </form>

        <div className="mt-6">
          <UploadDropzone />
        </div>
      </section>
    </AppShell>
  );
}
