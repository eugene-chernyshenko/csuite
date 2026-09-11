CREATE TABLE "documents" (
	"company_id" text NOT NULL,
	"id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"owner_role_id" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"superseded_by" text,
	"body" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("summary", '') || ' ' || coalesce("body", ''))) STORED,
	CONSTRAINT "documents_company_id_id_pk" PRIMARY KEY("company_id","id")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_company_type_idx" ON "documents" USING btree ("company_id","type");--> statement-breakpoint
CREATE INDEX "documents_company_status_idx" ON "documents" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "documents_search_idx" ON "documents" USING gin ("search");