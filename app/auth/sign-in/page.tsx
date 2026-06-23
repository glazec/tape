import { SignInForm } from "./sign-in-form";

export default function SignInPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-12 text-foreground sm:px-6 sm:py-16">
      <section className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-3xl flex-col justify-center">
        <p className="text-sm font-medium uppercase tracking-normal text-primary">
          Meeting Transcript
        </p>
        <h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-6xl">
          Sign in to your workspace.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
          Use your company Google account to access internal transcripts.
        </p>
        <SignInForm />
      </section>
    </main>
  );
}
