CREATE TABLE "grades" (
	"role_id" varchar(32) PRIMARY KEY NOT NULL,
	"prefix" varchar(16) NOT NULL,
	"direction" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
