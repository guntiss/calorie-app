-- Answers from Gemini, kept so the same question is only ever paid for once.
-- A null "response" is an answer too: it records that the model was asked and
-- had nothing usable to say, which is otherwise the case that gets bought
-- again and again.

CREATE TABLE "gemini_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_hash" text NOT NULL,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gemini_cache_request_idx" ON "gemini_cache" USING btree ("request_hash");