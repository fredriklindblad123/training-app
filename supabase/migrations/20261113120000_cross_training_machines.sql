-- Crosstrainer, rodd och trappmaskin klassas som alternativ träning
-- (2026-11-13). categorize_activity() gjorde elliptical till styrka, så Alices
-- intervallpass på crosstrainer blev blockets enda "styrkepass". indoor_cardio
-- och hiit förblir styrka (cirkel/HIIT).
--
-- Funktionen nedan är databasens AKTUELLA version (pg_get_functiondef
-- 2026-11-13), med bara den första grenen ändrad. Den skiljer sig från
-- 20260727140000 i migrationsmappen — databasen har senare regler (NxM som
-- intervall, distans/uppvärmning/nerjogg som lugnt) som inte finns i någon
-- migrationsfil här. Utgå alltid från pg_get_functiondef, inte från filerna.
--
-- OBS: triggern set_activity_category() räknar om kategorin vid VARJE update av
-- en rad med category_source = 'auto'. En ändring här slår därför igenom på
-- alla sådana rader nästa gång de skrivs.

CREATE OR REPLACE FUNCTION public.categorize_activity(p_activity_type text, p_name text, p_training_effect_label text, p_distance_meters numeric, p_duration_seconds numeric, p_raw_data jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_name text := lower(coalesce(p_name, ''));
  v_event_type text := lower(coalesce(p_raw_data -> 'eventType' ->> 'typeKey', ''));
  v_is_long boolean := coalesce(p_distance_meters, 0) >= 15000
    or coalesce(p_duration_seconds, 0) >= 75 * 60;
begin
  if p_activity_type is not null and p_activity_type not like '%running%' then
    -- Crosstrainer, roddmaskin och trappmaskin är kondition, inte styrka.
    if p_activity_type ~ '(elliptical|rowing|stair)' then
      return 'cross_training';
    end if;
    if p_activity_type ~ '(strength|cardio|hiit|functional)' then
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
  -- Numerisk notation ("5x400m", "10x2min") är lika tydlig som ordet
  -- "intervaller" och fastnade tidigare på etiketten.
  if v_name ~ '(interval|vo2|räck|repetition|\yrep\y|stride|sprint|\yfart\y|[0-9]+ *[x×] *[0-9]+)' then
    return 'interval';
  end if;
  -- Namn som beskriver lugn löpning vinner över Garmins etikett. Det här är
  -- den ändring som flyttar de 221 felklassade passen.
  if v_name ~ '(distans|uppvärmning|nerjogg|nedjogg|nerjigg|\yjogg\y|\yjog\y|löpband|lugn|promenad|återhämtning|recovery)' then
    if v_is_long then
      return 'long_run';
    end if;
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
$function$;

update activities set category_source = category_source
where category_source = 'auto'
  and activity_type !~ 'running'
  and activity_type ~ '(elliptical|rowing|stair)';
