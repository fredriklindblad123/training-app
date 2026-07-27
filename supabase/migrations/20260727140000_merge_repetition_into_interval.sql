-- Slå ihop 'repetition' (Räckor) med 'interval' (Intervaller), och byt
-- etikett på cross_training till "Alternativ träning" (bara i UI:t).
--
-- Varför: uppdelningen bar ingen information. En genomgång av vad som
-- faktiskt hamnade i respektive kategori visade samma sorts pass i båda:
--   repetition: "4x400m + 4x300m + 4x200m /1min vila", "5x1min + 5x45sek
--               + 6x30sek /90sek vila", "800m/3min + 2x5x200m/90sek vila"
--   interval:   "5x1km + 4x500m/60sek vila", "6x1000m + 4x500m /60sek vila"
-- Gränsen mellan dem avgjordes i praktiken av vilket ord passet råkade
-- heta, inte av hur det såg ut. 51 pass hamnade i repetition mot 8 i
-- interval — en snedfördelning som kom av att namnfallbacken skickade allt
-- NxM som inte sade "tröskel" eller "intervall" till repetition.
--
-- ORDNING: categorize_activity måste uppdateras FÖRST. Annars skriver
-- activities_set_category-triggern (before insert/update) tillbaka gamla
-- värden så fort en rad med category_source='auto' uppdateras, och ett
-- vanligt `update ... set category = ...` blir ett no-op trots att det
-- rapporteras som lyckat.

create or replace function categorize_activity(
  p_activity_type text,
  p_name text,
  p_training_effect_label text,
  p_distance_meters numeric,
  p_duration_seconds numeric,
  p_raw_data jsonb
) returns text
language plpgsql
immutable
as $$
declare
  v_name text := lower(coalesce(p_name, ''));
  v_event_type text := lower(coalesce(p_raw_data -> 'eventType' ->> 'typeKey', ''));
  v_is_long boolean := coalesce(p_distance_meters, 0) >= 15000
    or coalesce(p_duration_seconds, 0) >= 75 * 60;
begin
  if p_activity_type is not null and p_activity_type not like '%running%' then
    if p_activity_type ~ '(strength|cardio|hiit|elliptical|functional)' then
      return 'strength';
    end if;
    return 'cross_training';
  end if;

  if v_event_type = 'race' then
    return 'race';
  end if;
  if v_name ~ '(tävling|\yrace\y|\ysm\y|\ydm\y|mästerskap|\yfinal\y|semifinal|\yheat\y)' then
    return 'race';
  end if;

  if v_name ~ '(långpass|long.?run|\ylång\y)' then
    return 'long_run';
  end if;
  if v_name ~ '(tröskel|threshold|tempo)' then
    return 'threshold';
  end if;
  -- Räckor och intervaller är samma kategori nu: båda mönstren -> interval.
  if v_name ~ '(interval|vo2|räck|repetition|\yrep\y|stride|sprint|\yfart\y)' then
    return 'interval';
  end if;
  if v_name ~ '(återhämtning|recovery|\yjog\y)' then
    return 'easy';
  end if;

  if p_training_effect_label is not null then
    case upper(p_training_effect_label)
      when 'RECOVERY' then return 'easy';
      when 'BASE' then
        if v_is_long then
          return 'long_run';
        end if;
        return 'easy';
      when 'TEMPO' then return 'threshold';
      when 'LACTATE_THRESHOLD' then return 'threshold';
      when 'THRESHOLD' then return 'threshold';
      when 'VO2MAX' then return 'interval';
      when 'ANAEROBIC_CAPACITY' then return 'interval';
      when 'SPRINT' then return 'interval';
      else null;
    end case;
  end if;

  if v_is_long then
    return 'long_run';
  end if;

  return 'easy';
end;
$$;

-- Släpp constrainten innan datan städas, annars stoppar den omräkningen.
do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'activities'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%category%'
    and pg_get_constraintdef(oid) not like '%category_source%';
  if v_conname is not null then
    execute format('alter table activities drop constraint %I', v_conname);
  end if;
end $$;

-- Tvinga omräkning via triggern, som nu kör den nya funktionen. Ser ut som
-- ett no-op men är det inte: triggern räknar om category för varje rad.
update activities
set category_source = 'auto'
where category_source = 'auto';

-- Manuellt satta rader rörs inte av triggern och måste flyttas explicit.
update activities
set category = 'interval'
where category = 'repetition'
  and category_source = 'manual';

-- Planerade pass använder samma taxonomi sedan plan och utfall riktades mot
-- varandra, så de behöver samma flytt.
update planned_workouts
set workout_type = 'interval'
where workout_type = 'repetition';

update week_template_items
set workout_type = 'interval'
where workout_type = 'repetition';

alter table activities
  add constraint activities_category_check check (category in (
    'easy', 'long_run', 'threshold', 'interval', 'race', 'strength', 'cross_training'
  ));
