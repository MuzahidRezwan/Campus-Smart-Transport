CREATE TABLE "rider_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"semester_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_bdt" integer NOT NULL,
	"reason" text NOT NULL,
	"set_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "fee_rules_semester_category_uq";--> statement-breakpoint
ALTER TABLE "fee_rules" ALTER COLUMN "category" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_rules" ADD COLUMN "route_id" uuid;--> statement-breakpoint
ALTER TABLE "fee_rules" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "fee_rules" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rider_fees" ADD CONSTRAINT "rider_fees_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_fees" ADD CONSTRAINT "rider_fees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rider_fees_semester_user_uq" ON "rider_fees" USING btree ("semester_id","user_id");--> statement-breakpoint
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_scope_uq" UNIQUE NULLS NOT DISTINCT("semester_id","category","route_id");