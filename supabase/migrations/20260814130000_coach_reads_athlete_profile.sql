-- Bugfix: getScopedProfile() (lib/auth-scope.ts) läser den länkade löparens
-- `profiles.full_name` för att kunna visa ett namn i löparväljaren — men
-- profiles-policyn breddades aldrig för coach_athletes-relationen i
-- 20260814100000_coach_athletes.sql (den missade den här tabellen helt).
-- Resultatet: coach_athletes-kopplingen finns och är läsbar, men
-- namnuppslaget mot profiles gav tyst noll rader (RLS filtrerade bort
-- löparens profilrad), så löparväljaren visade "Inga löpare kopplade än"
-- trots att kopplingen fanns.
--
-- Bara läsning breddas här (inte skrivning) — en coach ska kunna se vem
-- löparen är, men inte utan vidare ändra löparens profil (namn, personliga
-- tröskelvärden) bara för att en planeringsrelation finns.
drop policy "profiles: läs och ändra egen rad" on profiles;

create policy "profiles: läs och ändra egen rad"
  on profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles: coach läser länkad löpares rad"
  on profiles for select
  using (
    exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = profiles.id
    )
  );
