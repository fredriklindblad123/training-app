-- En coach får läsa sina adepters Garmin-STATUS (2026-09-14).
--
-- Bakgrund: uppdatera-knappen i sidhuvudet visade "aldrig synkad" trots att
-- synken körts. Orsaken var inte synken utan läsrätten — policyn var
-- `auth.uid() = user_id`, alltså bara den egna raden. Mätt före ändringen:
-- Daniel såg 0 rader (han har ingen egen koppling), Fredrik såg 1 (sin egen,
-- aldrig adepternas). Etiketten kunde därmed aldrig visa det knappen faktiskt
-- gör, eftersom knappen synkar hela ens ansvar.
--
-- Samma lucka gjorde att en tränare omöjligt kunde se VEM av adepterna som
-- saknar Garmin-koppling — vilket är den enskilt vanligaste orsaken till att
-- en adepts vy står tom.
--
-- Säkert eftersom tokens INTE bor här. garmin_tokens är en egen tabell helt
-- utan policies (bara service_role når den, se migration 20260725150000).
-- Det som exponeras är status, last_synced_at och last_error — alltså om och
-- när en synk lyckades, inte några uppgifter att logga in med.
--
-- Verifierat efteråt med satta jwt-claims: Daniel ser nu 1 rad (Alice, 22:42),
-- och Alice ser fortfarande bara sin egen — noll andras.

drop policy "garmin_connections: läs egen status" on garmin_connections;

create policy "garmin_connections: läs egen eller coachad löpares status"
  on garmin_connections for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = garmin_connections.user_id
    )
  );
