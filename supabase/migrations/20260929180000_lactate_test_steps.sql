-- Laktattestets stegdata, så att testet kan ritas på Form-sidan som i
-- testrapporten: puls, fart, laktat och Borg per steg, med zonerna bakom
-- (2026-09-29, uttrycklig begäran).
--
-- hr_zone_sets bär redan testets fem zoner. Rapportens diagram ritar
-- däremot 3-zonsskalan, som bygger på trösklarna — och LT2 (197) är ingen
-- zongräns i 5-zonsskalan (Z4 börjar 193). Trösklarna sparas därför för sig
-- i stället för att härledas ur zonerna.

-- ---------------------------------------------------------------------------
-- 1. Trösklarna på testet. Null för uppsättningar som inte kommer från ett
--    laktattest.
-- ---------------------------------------------------------------------------
alter table hr_zone_sets
  add column lt1_hr integer,
  add column lt2_hr integer,
  add column lt1_speed_kmh numeric(4,1),
  add column lt2_speed_kmh numeric(4,1),
  add constraint hr_zone_sets_lt_order check (lt1_hr is null or lt2_hr is null or lt1_hr < lt2_hr);

-- ---------------------------------------------------------------------------
-- 2. Ett stick per rad. offset_seconds är när sticket togs, räknat från
--    teststart; speed_kmh är farten på steget som just avslutats. Vilovärdet
--    före första steget har ingen fart, puls eller Borg.
-- ---------------------------------------------------------------------------
create table lactate_test_steps (
  id uuid primary key default gen_random_uuid(),
  zone_set_id uuid not null references hr_zone_sets(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  offset_seconds integer not null check (offset_seconds >= 0),
  speed_kmh numeric(4,1),
  heart_rate integer,
  lactate_mmol numeric(4,1),
  rpe integer check (rpe between 6 and 20),
  unique (zone_set_id, offset_seconds)
);

create index lactate_test_steps_zone_set_id_idx on lactate_test_steps(zone_set_id);

alter table lactate_test_steps enable row level security;

create policy "lactate_test_steps: egna rader eller coachad löpares"
  on lactate_test_steps for all
  using (
    auth.uid() = user_id
    or exists (select 1 from coach_athletes ca
               where ca.coach_id = auth.uid() and ca.athlete_id = lactate_test_steps.user_id)
  )
  with check (
    auth.uid() = user_id
    or exists (select 1 from coach_athletes ca
               where ca.coach_id = auth.uid() and ca.athlete_id = lactate_test_steps.user_id)
  );

-- ---------------------------------------------------------------------------
-- 3. Alices test 2026-09-29 (Aktivitus, start 10 km/h, +1 km/h var 4:e min).
--    Avläst ur rapportens diagram och tabeller. Uppdateringen av
--    hr_zone_sets triggar compute_lab_zones, men zonerna är oförändrade så
--    inga pass skrivs om.
-- ---------------------------------------------------------------------------
update hr_zone_sets
set lt1_hr = 183, lt2_hr = 197, lt1_speed_kmh = 13.0, lt2_speed_kmh = 15.0
where user_id = '7db90b90-adc9-45c6-bc33-6f28b4939c2a' and valid_from = '2026-09-29';

insert into lactate_test_steps (zone_set_id, user_id, offset_seconds, speed_kmh, heart_rate, lactate_mmol, rpe)
select z.id, z.user_id, s.offset_seconds, s.speed_kmh, s.heart_rate, s.lactate_mmol, s.rpe
from hr_zone_sets z
cross join (values
  (   0, null::numeric, null::integer,  1.3, null::integer),
  ( 240, 10.0, 152,  0.9,  9),
  ( 480, 11.0, 168,  0.9, 10),
  ( 720, 12.0, 176,  1.3, 11),
  ( 960, 13.0, 183,  1.6, 12),
  (1200, 14.0, 192,  2.8, 14),
  (1440, 15.0, 197,  5.0, 16),
  (1680, 16.0, 202, 11.7, 18)
) as s(offset_seconds, speed_kmh, heart_rate, lactate_mmol, rpe)
where z.user_id = '7db90b90-adc9-45c6-bc33-6f28b4939c2a' and z.valid_from = '2026-09-29';
