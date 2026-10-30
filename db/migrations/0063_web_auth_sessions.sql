CREATE TABLE "web_auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "web_auth_users" (
	"banned" boolean DEFAULT false NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_auth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "web_auth_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "web_auth_accounts" ADD CONSTRAINT "web_auth_accounts_user_id_web_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."web_auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_auth_sessions" ADD CONSTRAINT "web_auth_sessions_user_id_web_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."web_auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "web_auth_accounts_user_idx" ON "web_auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "web_auth_accounts_provider_idx" ON "web_auth_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "web_auth_sessions_user_idx" ON "web_auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "web_auth_verifications_identifier_idx" ON "web_auth_verifications" USING btree ("identifier");
--> statement-breakpoint
-- Preserve identity without copying managed provider credentials or sessions.
DO $$
BEGIN
  IF to_regclass('neon_auth.user') IS NOT NULL THEN
    INSERT INTO web_auth_users (id, name, email, email_verified, image, created_at, updated_at, banned)
    SELECT id, name, email, "emailVerified", image, "createdAt", "updatedAt",
      coalesce(banned, false) AND ("banExpires" IS NULL OR "banExpires" > now())
    FROM neon_auth."user"
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO web_auth_accounts (id, account_id, provider_id, user_id, created_at, updated_at)
    SELECT a.id, a."accountId", a."providerId", a."userId", a."createdAt", a."updatedAt"
    FROM neon_auth.account a JOIN web_auth_users u ON u.id = a."userId"
    WHERE a."providerId" = 'google'
    ON CONFLICT (provider_id, account_id) DO NOTHING;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE web_auth_users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE web_auth_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE web_auth_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE web_auth_verifications ENABLE ROW LEVEL SECURITY;
