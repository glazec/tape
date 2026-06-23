type ShareDialogProps = {
  meetingId: string;
};

export function ShareDialog({ meetingId }: ShareDialogProps) {
  return (
    <section
      aria-labelledby="share-dialog-title"
      className="rounded-lg border border-[var(--border)] bg-white p-5"
    >
      <p className="text-xs font-medium uppercase tracking-normal text-[var(--primary)]">
        Sharing
      </p>
      <h2 id="share-dialog-title" className="mt-2 text-lg font-semibold">
        Create a controlled link
      </h2>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        Links are disabled by default. New links expire after 14 days and can be
        revoked from this meeting.
      </p>
      <button
        type="button"
        className="mt-5 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white"
      >
        Create share link
      </button>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Meeting ID: {meetingId}
      </p>
    </section>
  );
}
