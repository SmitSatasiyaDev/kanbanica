CREATE TABLE "checklist_task" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"space_id" text,
	"title" text NOT NULL,
	"due_time" text,
	"priority" "priority" DEFAULT 'NONE' NOT NULL,
	"repeat" text DEFAULT 'NONE' NOT NULL,
	"repeat_interval" integer DEFAULT 1 NOT NULL,
	"repeat_unit" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_task_occurrence" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"occurrence_date" date NOT NULL,
	"status" text DEFAULT 'INCOMPLETE' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"title_override" text,
	"due_time_override" text,
	"priority_override" "priority",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_task_occurrence_item_date_uq" UNIQUE("item_id","occurrence_date")
);
--> statement-breakpoint
ALTER TABLE "checklist_task" ADD CONSTRAINT "checklist_task_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_task" ADD CONSTRAINT "checklist_task_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_task_occurrence" ADD CONSTRAINT "checklist_task_occurrence_item_id_checklist_task_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."checklist_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_task_user_idx" ON "checklist_task" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "checklist_task_occurrence_date_idx" ON "checklist_task_occurrence" USING btree ("occurrence_date");