-- Rapportens innehåll i appen själv (2026-11-15).
--
-- Rapporterna publicerades som sidor på claude.ai, och en sådan sida kräver
-- ett claude.ai-konto med åtkomst — Alice kunde inte öppna sin egen rapport.
-- Innehållet sparas nu som markdown på raden och visas på /rapport/<id>
-- bakom appens inloggning, med samma läsregler som raden (löparen själv och
-- kopplade coacher). url blir valfri: den pekar på originalet om det finns.
--
-- Det gör det migrationen 20260919140000 undvek — två versioner som kan
-- glida isär. Avvägningen är medveten: en rapport adepten inte kan öppna är
-- värre. Rapporten i appen är den som gäller.
alter table athlete_reports
  add column if not exists body_md text;

alter table athlete_reports
  alter column url drop not null;
