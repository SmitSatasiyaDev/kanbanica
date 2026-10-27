CREATE TABLE "api_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"scope" text NOT NULL,
	"workspace_id" text,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "integration_settings" ADD COLUMN "mcp_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_token_user_id_idx" ON "api_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_workspace_seq_idx" ON "task" USING btree ("workspace_id","seq_number");