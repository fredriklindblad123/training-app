-- Fri text per träningsfaktor-grupp på ett block — speglar Excel-mallens
-- Årsplan-flik, där en sammanslagen cell över blockets veckor beskriver
-- coachens avsedda prioritering ("3 pass/vecka Distans (30-60 min), 1
-- Tröskel, 2 Intervall"). Uttryckligen fri text/prognos, INTE en räkning
-- mot de faktiska pass-taggarna i Detaljplan — den detaljnivån är och
-- förblir per pass (se migration 20260816120000_training_factor_per_pass.sql,
-- som tog bort motsvarande fält från blocket av just det skälet). Den här
-- kolumnen är ett annat syfte: en kort avsiktsförklaring coachen skriver
-- själv, inte något appen räknar fram.
--
-- Ett jsonb-fält keyat på träningsfaktor-grupp (lib/training-factors.ts:
-- "snabbhet"|"uthallighet"|"ovrigt"|"styrka"|"rorlighet") i stället för
-- fem egna kolumner — samma mönster som multi_year_plans.result_targets.

alter table season_blocks
  add column if not exists factor_notes jsonb not null default '{}'::jsonb;
