CREATE TABLE "daily_checklist_field" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_checklist_field_option" (
	"id" text PRIMARY KEY NOT NULL,
	"field_id" text NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_checklist_item_field_value" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"field_id" text,
	"field_name" text NOT NULL,
	"field_type" text NOT NULL,
	"field_required" boolean DEFAULT false NOT NULL,
	"field_options" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_checklist_field" ADD CONSTRAINT "daily_checklist_field_template_id_daily_checklist_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."daily_checklist_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_checklist_field_option" ADD CONSTRAINT "daily_checklist_field_option_field_id_daily_checklist_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."daily_checklist_field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_checklist_item_field_value" ADD CONSTRAINT "daily_checklist_item_field_value_item_id_daily_checklist_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."daily_checklist_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_checklist_item_field_value" ADD CONSTRAINT "daily_checklist_item_field_value_field_id_daily_checklist_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."daily_checklist_field"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_checklist_field_template_order_idx" ON "daily_checklist_field" USING btree ("template_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_checklist_field_option_field_value_idx" ON "daily_checklist_field_option" USING btree ("field_id","value");--> statement-breakpoint
CREATE INDEX "daily_checklist_field_option_order_idx" ON "daily_checklist_field_option" USING btree ("field_id","sort_order");--> statement-breakpoint
CREATE INDEX "daily_checklist_item_field_value_item_idx" ON "daily_checklist_item_field_value" USING btree ("item_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_checklist_item_field_value_item_field_uniq" ON "daily_checklist_item_field_value" USING btree ("item_id","field_id") WHERE "daily_checklist_item_field_value"."field_id" is not null;