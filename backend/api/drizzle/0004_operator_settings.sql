ALTER TABLE "operators" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Keep the colours the three original companies had before colours were data.
UPDATE "operators" SET "color" = CASE "code" WHEN 'H' THEN '#4f46e5' WHEN 'M' THEN '#0b8f83' WHEN 'S' THEN '#d9620c' END
WHERE "color" IS NULL AND "code" IN ('H', 'M', 'S');
