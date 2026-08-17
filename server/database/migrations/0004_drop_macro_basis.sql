-- Every food's macros are per 100 g. The basis a food could be entered on is
-- gone, and with it the serving columns that only ever described a per-item one.
--
-- A per-item food is restated per 100 g, and every amount ever logged of one is
-- restated in grams, so the two together come to exactly what they came to
-- before. One item is taken to weigh `serving_grams`, or 100 g when it never
-- said — which is the case for the foods migration 0003 priced per item out of
-- the rows that had no food. Per-100ml foods need no arithmetic: their macros
-- were already per 100 units of an amount that was already the number logged.

UPDATE "log_entries" e
SET "quantity" = e."quantity" * COALESCE(f."serving_grams", 100)
FROM "foods" f
WHERE f."id" = e."food_id"
  AND f."basis" = 'per_item'
  AND e."quantity" IS NOT NULL;
--> statement-breakpoint
UPDATE "recipe_components" c
SET "quantity" = c."quantity" * COALESCE(f."serving_grams", 100)
FROM "foods" f
WHERE f."id" = c."child_food_id"
  AND f."basis" = 'per_item';
--> statement-breakpoint
UPDATE "foods"
SET "kcal" = "kcal" * 100 / COALESCE("serving_grams", 100),
    "protein" = "protein" * 100 / COALESCE("serving_grams", 100),
    "fat" = "fat" * 100 / COALESCE("serving_grams", 100),
    "carbs" = "carbs" * 100 / COALESCE("serving_grams", 100)
WHERE "basis" = 'per_item';
--> statement-breakpoint
ALTER TABLE "foods" DROP COLUMN "basis";--> statement-breakpoint
ALTER TABLE "foods" DROP COLUMN "serving_name";--> statement-breakpoint
ALTER TABLE "foods" DROP COLUMN "serving_grams";--> statement-breakpoint
DROP TYPE "public"."macro_basis";
