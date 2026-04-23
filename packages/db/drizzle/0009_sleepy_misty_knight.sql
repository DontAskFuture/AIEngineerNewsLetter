WITH duplicate_profiles AS (
  SELECT
    "id",
    "display_name",
    row_number() OVER (
      PARTITION BY "user_id", lower(btrim("display_name"))
      ORDER BY "created_at", "id"
    ) AS "duplicate_index"
  FROM "user_profiles"
)
UPDATE "user_profiles"
SET
  "display_name" = duplicate_profiles."display_name" || ' (copy ' || duplicate_profiles."id" || ')',
  "updated_at" = now()
FROM duplicate_profiles
WHERE "user_profiles"."id" = duplicate_profiles."id"
  AND duplicate_profiles."duplicate_index" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "user_profiles_user_display_name_idx" ON "user_profiles" USING btree ("user_id",lower(btrim("display_name")));
