CREATE TABLE "daily_checklist_day" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"template_id" text,
	"date" date NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_checklist_item" (
	"id" text PRIMARY KEY NOT NULL,
	"day_id" text NOT NULL,
	"template_item_id" text,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"priority" text DEFAULT 'NONE' NOT NULL,
	"due_time" text,
	"notes" text,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_checklist_template" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'TEAM' NOT NULL,
	"recurrence" text DEFAULT 'WEEKDAYS' NOT NULL,
	"recurrence_days" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"start_date" date NOT NULL,
	"end_date" date,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_checklist_template_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"user_id" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_checklist_template_item" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'NONE' NOT NULL,
	"due_time" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_checklist_day" ADD CONSTRAINT "daily_checklist_day_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_checklist_day" ADD CONSTRAINT "daily_checklist_day_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_checklist_day" ADD CONSTRAINT "daily_checklist_day_template_id_daily_checklist_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."daily_checklist_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_checklist_item" ADD CONSTRAINT "daily_checklist_item_day_id_daily_checklist_day_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."daily_checklist_day"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_checklist_item" ADD CONSTRAINT "daily_checklist_item_template_item_id_daily_checklist_template_item_id_fk" FOREIGN KEY ("template_item_id") REFERENCES "public"."daily_checklist_template_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_checklist_item" ADD CONSTRAINT "daily_checklist_item_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_checklist_template" ADD CONSTRAINT "daily_checklist_template_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_checklist_template" ADD CONSTRAINT "daily_checklist_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_checklist_template_assignment" ADD CONSTRAINT "daily_checklist_template_assignment_template_id_daily_checklist_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."daily_checklist_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_checklist_template_assignment" ADD CONSTRAINT "daily_checklist_template_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_checklist_template_item" ADD CONSTRAINT "daily_checklist_template_item_template_id_daily_checklist_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."daily_checklist_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_checklist_day_personal_uniq" ON "daily_checklist_day" USING btree ("workspace_id","user_id","date") WHERE "daily_checklist_day"."type" = 'PERSONAL';--> statement-breakpoint
CREATE UNIQUE INDEX "daily_checklist_day_team_uniq" ON "daily_checklist_day" USING btree ("workspace_id","user_id","template_id","date") WHERE "daily_checklist_day"."type" = 'TEAM';--> statement-breakpoint
CREATE INDEX "daily_checklist_day_workspace_date_idx" ON "daily_checklist_day" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE INDEX "daily_checklist_day_user_date_idx" ON "daily_checklist_day" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "daily_checklist_day_template_date_idx" ON "daily_checklist_day" USING btree ("template_id","date");--> statement-breakpoint
CREATE INDEX "daily_checklist_item_day_order_idx" ON "daily_checklist_item" USING btree ("day_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_checklist_item_day_template_item_uniq" ON "daily_checklist_item" USING btree ("day_id","template_item_id") WHERE "daily_checklist_item"."template_item_id" is not null;--> statement-breakpoint
CREATE INDEX "daily_checklist_template_workspace_active_idx" ON "daily_checklist_template" USING btree ("workspace_id","is_active","is_archived");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_checklist_assignment_template_user_idx" ON "daily_checklist_template_assignment" USING btree ("template_id","user_id");--> statement-breakpoint
CREATE INDEX "daily_checklist_assignment_user_idx" ON "daily_checklist_template_assignment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "daily_checklist_template_item_order_idx" ON "daily_checklist_template_item" USING btree ("template_id","sort_order");