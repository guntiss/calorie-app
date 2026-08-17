-- Every logged row must name a food in the library.
--
-- Rows logged before this rule carry a name and a macro snapshot but no food.
-- Each one adopts a food its owner already has under that name, or gets one
-- created for it — priced per item from what the row itself was worth, so the
-- day it belongs to still totals exactly the same.

UPDATE "log_entries" e
SET "food_id" = f."id"
FROM "foods" f
WHERE e."food_id" IS NULL
  AND f."owner_user_id" = e."user_id"
  AND lower(f."name") = lower(e."name_snapshot");
--> statement-breakpoint
INSERT INTO "foods" ("owner_user_id", "household_id", "kind", "name", "basis", "kcal", "protein", "fat", "carbs")
SELECT DISTINCT ON (e."user_id", lower(e."name_snapshot"))
  e."user_id",
  u."household_id",
  'item'::"public"."food_kind",
  e."name_snapshot",
  'per_item'::"public"."macro_basis",
  COALESCE(e."kcal", 0) / COALESCE(NULLIF(e."quantity", 0), 1),
  COALESCE(e."protein", 0) / COALESCE(NULLIF(e."quantity", 0), 1),
  COALESCE(e."fat", 0) / COALESCE(NULLIF(e."quantity", 0), 1),
  COALESCE(e."carbs", 0) / COALESCE(NULLIF(e."quantity", 0), 1)
FROM "log_entries" e
JOIN "users" u ON u."id" = e."user_id"
WHERE e."food_id" IS NULL
ORDER BY e."user_id", lower(e."name_snapshot"), e."updated_at" DESC;
--> statement-breakpoint
-- The rows those foods were made for. A row with no amount becomes one item of
-- the food just priced from it, which is the same number it already showed.
UPDATE "log_entries" e
SET "food_id" = f."id", "quantity" = COALESCE(e."quantity", 1)
FROM "foods" f
WHERE e."food_id" IS NULL
  AND f."owner_user_id" = e."user_id"
  AND lower(f."name") = lower(e."name_snapshot");
--> statement-breakpoint
-- Only reachable by a row with nothing to match a food on, which the column
-- constraints already rule out. Here so the NOT NULL below cannot fail.
DELETE FROM "log_entries" WHERE "food_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "log_entries" DROP CONSTRAINT "log_entries_food_id_foods_id_fk";
--> statement-breakpoint
ALTER TABLE "log_entries" ALTER COLUMN "food_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "log_entries_food_idx" ON "log_entries" USING btree ("food_id");
