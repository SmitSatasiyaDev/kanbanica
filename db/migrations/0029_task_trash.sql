ALTER TABLE "task" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "deleted_with_parent_id" text;--> statement-breakpoint
CREATE INDEX "task_deleted_at_idx" ON "task" USING btree ("workspace_id","deleted_at") WHERE "task"."deleted_at" IS NOT NULL;