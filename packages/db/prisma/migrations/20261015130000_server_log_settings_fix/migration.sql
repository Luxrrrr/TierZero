-- The previous migration copied the "moderators can open it" switch as 0 or 1, and settings hold true or false.
UPDATE "GuildModule"
SET "settings" = json_set(
    "settings",
    '$.modsCanView',
    json(CASE WHEN json_extract("settings", '$.modsCanView') = 1 THEN 'true' ELSE 'false' END)
)
WHERE "moduleId" = 'serverlog'
  AND json_valid("settings")
  AND json_type("settings", '$.modsCanView') = 'integer';
