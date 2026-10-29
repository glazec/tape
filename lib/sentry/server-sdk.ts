import * as SentryModule from "@sentry/nextjs";

// Next bundles named exports; standalone Node loads the CommonJS default.
export const Sentry: typeof SentryModule = typeof SentryModule.isEnabled === "function"
  ? SentryModule
  : Reflect.get(SentryModule, "default");
