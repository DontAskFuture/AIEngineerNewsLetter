ALTER TABLE "user_profiles" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;

WITH first_active_profiles AS (
  SELECT
    "id",
    row_number() OVER (PARTITION BY "user_id" ORDER BY "created_at" ASC, "id" ASC) AS profile_rank
  FROM "user_profiles"
  WHERE "is_active" = true
)
UPDATE "user_profiles"
SET "is_default" = true
FROM first_active_profiles
WHERE "user_profiles"."id" = first_active_profiles."id"
  AND first_active_profiles.profile_rank = 1;

CREATE UNIQUE INDEX "user_profiles_user_active_default_idx" ON "user_profiles" USING btree ("user_id") WHERE "user_profiles"."is_default" = true AND "user_profiles"."is_active" = true;