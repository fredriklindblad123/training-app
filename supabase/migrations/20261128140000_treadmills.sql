-- Löpband och deras kalibrering (2026-11-28).
--
-- Ett löpband visar sällan rätt fart. Appen mäter bandet en gång (längd med
-- måttband, varvtid med kamera eller knackning vid några inställda farter)
-- och sparar linjen mellan visad och verklig fart. Se web/src/lib/treadmill.ts.
--
-- Banden är gemensamma för alla inloggade: står två i gruppen på samma band
-- ska den andra inte behöva mäta om det. Den som skapat ett band (eller en
-- kalibrering) är den som kan ändra eller ta bort den.
--
-- En ny mätning skriver en ny rad i treadmill_calibrations, den skriver
-- aldrig över en gammal. Senaste raden gäller. Band slits och gym
-- kalibrerar om sina band, så historiken behövs för att se när ett band
-- ändrats.

create table treadmills (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  belt_length_cm numeric not null check (belt_length_cm between 100 and 1000),
  created_by uuid not null references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table treadmill_calibrations (
  id uuid primary key default gen_random_uuid(),
  treadmill_id uuid not null references treadmills(id) on delete cascade,
  measured_by uuid not null references profiles(id) default auth.uid(),
  measured_on date not null default current_date,
  -- Längden som användes, ifall bandets längd ändras i efterhand.
  belt_length_cm numeric not null,
  -- [{setKmh, actualKmh, revs, seconds, method}] på tomt band.
  points jsonb not null,
  -- Verklig fart (tomt band) = slope * inställd + intercept, km/h.
  slope numeric not null,
  intercept numeric not null,
  -- Verklig fart med löpare / på tomt band, ur en kontrollmätning. null =
  -- inte mätt, och då gäller kalibreringen tomt band.
  loaded_factor numeric,
  loaded_point jsonb,
  created_at timestamptz not null default now()
);

create index treadmill_calibrations_treadmill_idx
  on treadmill_calibrations(treadmill_id, created_at desc);

-- Löparens eget band: det som gäller hennes löpbandspass och "ställ bandet
-- på" i dagens pass.
alter table profiles add column treadmill_id uuid references treadmills(id) on delete set null;

alter table treadmills enable row level security;
alter table treadmill_calibrations enable row level security;

create policy "treadmills: alla inloggade läser"
  on treadmills for select to authenticated using (true);
create policy "treadmills: inloggade skapar"
  on treadmills for insert to authenticated with check (created_by = auth.uid());
create policy "treadmills: skaparen ändrar"
  on treadmills for update to authenticated using (created_by = auth.uid());
create policy "treadmills: skaparen tar bort"
  on treadmills for delete to authenticated using (created_by = auth.uid());

create policy "treadmill_calibrations: alla inloggade läser"
  on treadmill_calibrations for select to authenticated using (true);
create policy "treadmill_calibrations: inloggade mäter"
  on treadmill_calibrations for insert to authenticated with check (measured_by = auth.uid());
create policy "treadmill_calibrations: mätaren ändrar"
  on treadmill_calibrations for update to authenticated using (measured_by = auth.uid());
create policy "treadmill_calibrations: mätaren tar bort"
  on treadmill_calibrations for delete to authenticated using (measured_by = auth.uid());
