ALTER TYPE "public"."boarding_method" ADD VALUE 'barcode';--> statement-breakpoint
CREATE TABLE "id_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value_hash" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"linked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "id_card_boarding" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "id_cards" ADD CONSTRAINT "id_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "id_cards_kind_value_uq" ON "id_cards" USING btree ("kind","value_hash");--> statement-breakpoint
CREATE INDEX "id_cards_user_idx" ON "id_cards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_university_id_digits_idx" ON "users" USING btree (replace("university_id", '-', ''));