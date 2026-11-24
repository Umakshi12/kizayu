-- AlterTable
ALTER TABLE "SosContact" ADD COLUMN     "relation" TEXT;

-- Emergency contacts are now one list (shown on the emergency card and texted during an SOS).
-- Copy each person's existing single emergency contact into it, keeping only well-formed international
-- numbers and skipping numbers that are already in their list. The old columns stay, unused, so nothing is lost.
INSERT INTO "SosContact" ("id", "userId", "name", "relation", "phone", "createdAt")
SELECT gen_random_uuid()::text, e."userId",
       COALESCE(NULLIF(e."contactName", ''), 'Emergency contact'), NULL,
       regexp_replace(e."contactPhone", '[^+0-9]', '', 'g'), now()
FROM "EmergencyInfo" e
WHERE e."contactPhone" IS NOT NULL
  AND regexp_replace(e."contactPhone", '[^+0-9]', '', 'g') ~ '^\+[1-9][0-9]{7,14}$'
  AND NOT EXISTS (
    SELECT 1 FROM "SosContact" c
    WHERE c."userId" = e."userId" AND c."phone" = regexp_replace(e."contactPhone", '[^+0-9]', '', 'g')
  );
