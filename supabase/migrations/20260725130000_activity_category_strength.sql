-- Byt 'recovery' mot 'strength' i kategori-taxonomin: styrketräning ska synas
-- som egen kategori, men den validerade kategoriska paletten har bara åtta
-- säkra slots (se dataviz-riktlinjer i web/src/lib/categories.ts). Lugna
-- återhämtningspass slås därför ihop med 'easy' — de flesta träningsmetoder
-- (bl.a. Daniels VDOT) skiljer ändå inte ut recovery som egen intensitetszon.

update activities set category = 'easy' where category = 'recovery';

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

alter table activities add constraint activities_category_check
  check (category in (
    'easy', 'long_run', 'threshold', 'interval', 'repetition', 'race', 'strength', 'other'
  ));

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
    return 'other';
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

-- Räkna om automatisk kategorisering med den nya logiken (manuella val rörs inte).
update activities set category_source = 'auto' where category_source = 'auto';
