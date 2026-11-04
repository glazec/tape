ALTER TABLE "intel_searches" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "intel_searches" ADD COLUMN "completed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "intel_searches" ADD COLUMN "total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "intel_searches" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "intel_searches" ADD COLUMN "error" text;
--> statement-breakpoint
GRANT UPDATE (status, completed, total, result, error) ON public.intel_searches TO tape_authenticated;
