-- What is printed on the packet, so a food can be found by holding a camera
-- over it. Nullable and not unique: most foods are weighed out of something
-- with no barcode on it at all.

ALTER TABLE "foods" ADD COLUMN "barcode" text;--> statement-breakpoint
CREATE INDEX "foods_barcode_idx" ON "foods" USING btree ("barcode");
