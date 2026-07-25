-- Kategorisering av träningspass efter etablerad medeldistans-taxonomi
-- (lugn distans / långpass / tröskel / intervaller / räckor / tävling /
-- återhämtning / övrigt). Kategoriseras automatiskt utifrån Garmin-data vid
-- synk, men kan alltid override:as manuellt (category_source styr vem som
-- "äger" värdet). Se docs/data-model.md.

alter table activities
  add column category text check (category in (
    'easy', 'long_run', 'threshold', 'interval', 'repetition', 'race', 'recovery', 'other'
  )),
  add column category_source text not null default 'auto'
    check (category_source in ('auto', 'manual'));

-- categorize_activity ------------------------------------------------------
-- Härleder en kategori från de fält vi redan synkar från Garmin. Prioritet:
-- 1) icke-löppass -> 'other'
-- 2) explicit tävlingsmarkering (eventType/namn)
-- 3) nyckelord i passnamnet (kommer ofta från en strukturerad träningsplan,
--    t.ex. "W1 Fri Tempo" eller "W1 Wed Intervals")
-- 4) Garmins egen trainingEffectLabel (BASE/TEMPO/VO2MAX/...)
-- 5) fallback på distans/tid (långt lugnt pass -> långpass, annars lugn distans)

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
    return 'recovery';
  end if;

  if p_training_effect_label is not null then
    case upper(p_training_effect_label)
      when 'RECOVERY' then return 'recovery';
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

create or replace function set_activity_category()
returns trigger
language plpgsql
as $$
begin
  if new.category_source is null then
    new.category_source := 'auto';
  end if;
  -- Rör aldrig category när användaren har satt den manuellt.
  if new.category_source = 'auto' then
    new.category := categorize_activity(
      new.activity_type,
      new.name,
      new.training_effect_label,
      new.distance_meters,
      new.duration_seconds,
      new.raw_data
    );
  end if;
  return new;
end;
$$;

create trigger activities_set_category
  before insert or update on activities
  for each row execute procedure set_activity_category();

-- Backfill: kategorisera redan synkade pass.
update activities set category_source = 'auto';
