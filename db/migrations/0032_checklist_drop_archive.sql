ALTER TABLE "checklist_task_occurrence" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checklist_task" DROP COLUMN "archived_at";