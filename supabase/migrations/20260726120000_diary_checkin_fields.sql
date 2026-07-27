-- P0.4 (docs/insikter-roadmap.md): daglig subjektiv check-in med radikalt
-- lägre friktion än det gamla dagboksformuläret. rpe/mood/soreness är null i
-- samtliga 268 befintliga dagboksrader — inte för att datan är oviktig, utan
-- för att fälten satt bakom flera klick i ett stort formulär på dagvyn
-- (calendar/[year]/[month]/[day]), blandat med redigering av dagbokstext.
-- feeling/motivation/soreness_level är de nya fälten: en 1–5-skala med ord
-- och färg (inte sifferfält), tänkt ifyllda via en knapprad direkt på
-- kalendersidan. rpe (1–10) behålls som det är men matas i UI från en
-- 5-gradig knapprad × 2, så samma knapprads-mönster kan återanvändas.
alter table diary_entries
  add column feeling smallint check (feeling between 1 and 5),
  add column motivation smallint check (motivation between 1 and 5),
  add column soreness_level smallint check (soreness_level between 1 and 5);
