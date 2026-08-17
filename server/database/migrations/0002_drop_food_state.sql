ALTER TABLE "foods" DROP COLUMN "reference_state";--> statement-breakpoint
ALTER TABLE "foods" DROP COLUMN "cooked_yield_ratio";--> statement-breakpoint
ALTER TABLE "log_entries" DROP COLUMN "logged_state";--> statement-breakpoint
ALTER TABLE "recipe_components" DROP COLUMN "state";--> statement-breakpoint
DROP TYPE "public"."food_state";