import { Container, FadeIn } from "./landing-section";

export function LandingLaunchFilm() {
  return (
    <section
      id="launch-film"
      aria-label="Tape launch film"
      className="border-b border-ink/8 bg-mist/70"
    >
      <Container className="py-16 sm:py-20 lg:py-24">
        <FadeIn>
          <div className="overflow-hidden rounded-sm border border-ink/10 bg-ink shadow-[0_32px_80px_-48px_oklch(0.195_0.012_30/0.35)]">
            <video
              aria-label="Tape product launch film"
              className="aspect-video w-full"
              controls
              playsInline
              poster="/media/tape-launch-v4-poster.jpg"
              preload="metadata"
            >
              <source src="/media/tape-launch-v4.mp4" type="video/mp4" />
              <track
                default
                kind="captions"
                label="English"
                src="/media/tape-launch-v4-en.vtt"
                srcLang="en"
              />
              Your browser does not support embedded video.{" "}
              <a href="/media/tape-launch-v4.mp4">Watch the Tape launch film</a>.
            </video>
          </div>
          <div className="mt-5 flex flex-col gap-2 font-mono text-label uppercase tracking-[0.16em] text-ash sm:flex-row sm:items-center sm:justify-between">
            <p>Tape launch film · 30 seconds</p>
            <p>English captions included</p>
          </div>
        </FadeIn>
      </Container>
    </section>
  );
}
