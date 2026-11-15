CREATE TYPE "public"."dossier_event_type" AS ENUM('embauche', 'depart', 'reintegration', 'grade', 'absence', 'avertissement', 'sanction', 'note');--> statement-breakpoint
CREATE TABLE "dossier_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"type" "dossier_event_type" NOT NULL,
	"details" text NOT NULL,
	"by_user_id" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dossiers" (
	"user_id" varchar(32) PRIMARY KEY NOT NULL,
	"thread_id" varchar(32),
	"archived" boolean DEFAULT false NOT NULL,
	"hired_on" date NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dossier_events_user_idx" ON "dossier_events" USING btree ("user_id");