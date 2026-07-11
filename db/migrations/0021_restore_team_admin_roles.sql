WITH "adminless_teams" AS (
  SELECT DISTINCT domain."team_id"
  FROM "allowed_domains" AS domain
  WHERE NOT EXISTS (
    SELECT 1
    FROM "team_memberships" AS elevated_membership
    WHERE elevated_membership."team_id" = domain."team_id"
      AND elevated_membership."role" IN ('admin', 'owner')
  )
),
"earliest_members" AS (
  SELECT DISTINCT ON (membership."team_id") membership."id"
  FROM "team_memberships" AS membership
  INNER JOIN "adminless_teams" AS team
    ON team."team_id" = membership."team_id"
  WHERE membership."role" <> 'external'
  ORDER BY membership."team_id", membership."created_at", membership."id"
)
UPDATE "team_memberships" AS membership
SET "role" = 'admin', "updated_at" = NOW()
FROM "earliest_members" AS earliest
WHERE membership."id" = earliest."id";
