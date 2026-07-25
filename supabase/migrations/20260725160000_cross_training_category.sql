-- Byt 'other' mot 'cross_training' i kategori-taxonomin. Sedan synken nu
-- filtrerar bort allt utom löpning/styrka/cykel/simning/längdskidåkning
-- (se web/api/index.py), finns det ingen anledning till en vag "Övrigt"-
-- kategori längre — cykel/simning/skidor får en egen, tydlig kategori
-- istället för att klumpas ihop. Passar även på att fånga upp ev.
-- kvarvarande 'recovery'-värden från innan strength-migrationen
-- (20260725130000), ifall den aldrig fick full effekt.
--
-- Ordning spelar roll här: categorize_activity måste uppdateras FÖRST,
-- annars skriver activities_set_category-triggern (before insert/update)
-- tillbaka de gamla värdena så fort en rad med category_source='auto'
-- uppdateras — ett vanligt `update ... set category = ...` blir då ett
-- no-op i praktiken, trots att det rapporteras som lyckat.

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
  -- Synken (web/api/index.py) filtrerar redan bort allt utom löpning,
  -- styrka, cykel, simning och längdskidåkning innan raden ens når hit, så
  -- "inte löpning, inte styrka" betyder cykel/simning/skidor.
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
  if v_name ~ '(interval|vo2)' then
    return 'interval';
  end if;
  if v_name ~ '(räck|repetition|\yrep\y|stride|sprint|\yfart\y)' then
    return 'repetition';
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
      when 'ANAEROBIC_CAPACITY' then return 'repetition';
      when 'SPRINT' then return 'repetition';
      else null;
    end case;
  end if;

  if v_is_long then
    return 'long_run';
  end if;

  return 'easy';
end;
$$;

-- Ta bort gamla constrainten (utan att lägga på den nya än — datan är inte
-- städad förrän omräkningen nedan kört).
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

-- Tvinga fram omräkning via triggern (som nu kör den nya funktionen) för
-- alla auto-kategoriserade rader. Manuellt satta rader (category_source =
-- 'manual') rörs inte.
update activities set category_source = 'auto' where category_source = 'auto';

-- Datan är städad nu — lägg på den nya constrainten.
alter table activities add constraint activities_category_check
  check (category in (
    'easy', 'long_run', 'threshold', 'interval', 'repetition', 'race', 'strength', 'cross_training'
  ));

-- planned_workouts har ingen motsvarande trigger, så en vanlig update räcker.
update planned_workouts set workout_type = 'easy' where workout_type = 'recovery';
update planned_workouts set workout_type = 'cross_training' where workout_type = 'other';
update planned_workouts set workout_type = 'cross_training'
  where workout_type is not null
    and workout_type not in (
      'easy', 'long_run', 'threshold', 'interval', 'repetition', 'race', 'strength', 'cross_training'
    );

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'planned_workouts'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%workout_type%';
  if v_conname is not null then
    execute format('alter table planned_workouts drop constraint %I', v_conname);
  end if;
end $$;

alter table planned_workouts add constraint planned_workouts_workout_type_check
  check (workout_type in (
    'easy', 'long_run', 'threshold', 'interval', 'repetition', 'race', 'strength', 'cross_training'
  ));
