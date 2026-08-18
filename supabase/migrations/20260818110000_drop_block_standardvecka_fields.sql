-- Tar bort blockets manuella "standardvecka"-fält helt (sessions_count/
-- days_count/starts_count/hours_count/has_test) och det nyss tillagda
-- factor_notes — uttrycklig begäran 2026-08-18: en manuellt ifylld gissning
-- ska inte finnas kvar som ett alternativ när man i stället kan rulla ut ett
-- riktigt veckomönster (dag + passtyp) direkt vid blockskapandet. Detsamma
-- gäller factor_notes (fri text per träningsfaktor-grupp, tillagd tidigare
-- samma dag) — ersatt av samma dag-för-dag-mönster, aldrig hunnit användas
-- av en riktig användare.
--
-- Antal pass/dagar/timmar i Årsplan-rutnätet räknas redan alltid live ur
-- planned_workouts (se lib/arsplan-grid.ts) — de här kolumnerna var bara en
-- förvalsgissning innan ett mönster fanns, aldrig sanningen. Antal
-- tävlingsstarter har redan räknats live ur `competitions` sedan tidigare
-- (aldrig kopplat till ett block över huvud taget, se startsByWeek i
-- arsplan-grid.ts) — starts_count-kolumnen här har alltså inte använts på
-- länge.

alter table season_blocks
  drop column if exists sessions_count,
  drop column if exists days_count,
  drop column if exists starts_count,
  drop column if exists hours_count,
  drop column if exists has_test,
  drop column if exists factor_notes;
