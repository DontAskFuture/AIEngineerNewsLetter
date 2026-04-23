DROP INDEX IF EXISTS "user_profiles_slug_idx";--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "user_id" bigint;--> statement-breakpoint
UPDATE "user_profiles"
SET "user_id" = (
  SELECT "id"
  FROM "auth_users"
  ORDER BY "id"
  LIMIT 1
)
WHERE "user_id" IS NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "user_profiles"
    WHERE "user_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Unable to backfill user_profiles.user_id because no auth user exists.';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "user_profiles" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_profiles_user_slug_idx" ON "user_profiles" USING btree ("user_id","slug");
