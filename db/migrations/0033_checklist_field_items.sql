CREATE TABLE "daily_checklist_field_item" (
	"field_id" text NOT NULL,
	"template_item_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_checklist_field" ADD COLUMN "applies_to_all" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_checklist_field_item" ADD CONSTRAINT "daily_checklist_field_item_field_id_daily_checklist_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."daily_checklist_field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_checklist_field_item" ADD CONSTRAINT "daily_checklist_field_item_template_item_id_daily_checklist_template_item_id_fk" FOREIGN KEY ("template_item_id") REFERENCES "public"."daily_checklist_template_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_checklist_field_item_uniq" ON "daily_checklist_field_item" USING btree ("field_id","template_item_id");--> statement-breakpoint
CREATE INDEX "daily_checklist_field_item_item_idx" ON "daily_checklist_field_item" USING btree ("template_item_id");