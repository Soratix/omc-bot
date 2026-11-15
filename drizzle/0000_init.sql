CREATE TYPE "public"."absence_status" AS ENUM('en_cours', 'non_confirmee', 'terminee', 'annulee');--> statement-breakpoint
CREATE TABLE "absences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text,
	"status" "absence_status" DEFAULT 'en_cours' NOT NULL,
	"channel_id" varchar(32),
	"message_id" varchar(32),
	"reminded_on" date,
	"extensions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" varchar(32)
);
--> statement-breakpoint
CREATE TABLE "fiches" (
	"user_id" varchar(32) PRIMARY KEY NOT NULL,
	"prenom" varchar(32) NOT NULL,
	"nom" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(32)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(32)
);
--> statement-breakpoint
CREATE INDEX "absences_user_idx" ON "absences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "absences_status_idx" ON "absences" USING btree ("status");