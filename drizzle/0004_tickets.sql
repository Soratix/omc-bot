CREATE TYPE "public"."ticket_opener" AS ENUM('verifie', 'personnel', 'tous');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('ouvert', 'ferme');--> statement-breakpoint
CREATE TABLE "ticket_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(45) NOT NULL,
	"slug" varchar(20) NOT NULL,
	"emoji" varchar(64),
	"description" varchar(100),
	"staff_role_ids" text[] DEFAULT '{}' NOT NULL,
	"opener" "ticket_opener" DEFAULT 'verifie' NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"type_id" integer NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"channel_id" varchar(32),
	"status" "ticket_status" DEFAULT 'ouvert' NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claimed_by" varchar(32),
	"claimed_at" timestamp with time zone,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" varchar(32),
	"close_reason" text
);
--> statement-breakpoint
CREATE INDEX "tickets_user_idx" ON "tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tickets_channel_idx" ON "tickets" USING btree ("channel_id");