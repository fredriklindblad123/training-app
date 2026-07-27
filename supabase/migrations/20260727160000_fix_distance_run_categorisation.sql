-- Sluta klassa lugna distanspass som tröskel.
--
-- Problemet: 221 av 268 tröskelmärkta pass hade inget kvalitetsord i namnet
-- alls. De hette "Distans" (89), "Uppvärmning" (58), "Nerjogg" (44) och
-- "Jogg" (5) — median 18 minuter. Kategorin kom uteslutande från Garmins
-- training_effect_label, som satte TEMPO på 199 av dem och
-- LACTATE_THRESHOLD på 22.
--
-- Etiketten är inte fel i sig: atletens lugna distanspass ligger på 81 % av
-- maxpuls, så klockan uppfattar dem rimligen som tempoarbete. Men den gör
-- etiketten oanvändbar som kategorisignal för just henne, och resultatet var
-- att 61 % av all distans hamnade under "Tröskel" i statistiken.
--
-- Två ändringar:
--
-- 1. Namn som beskriver lugn löpning avgör kategorin FÖRE etiketten.
--    "Distans", "Uppvärmning" och "Nerjogg" är entydiga.
-- 2. Intervallmönstret får numerisk notation. Pass som "5x400m + 3x300m +
--    4x200m /90sek vila" och "10x2min + 2x1min" fastnade tidigare på
--    etiketten och blev tröskel, trots att namnet säger vad de är.
--
-- Automatnamnen ("Göteborg Löpning", 45 st) lämnas åt etiketten. De saknar
-- all beskrivning, men har snittpuls 166–183, så tröskel/intervall är ett
-- rimligt antagande. Varvantalet vore en bättre signal men duger inte: ett
-- distanspass med autolap per kilometer får lika många varv som ett
-- intervallpass.
--
-- Förväntat utfall (simulerat mot 502 pass): tröskel 268 -> 58, intervall
-- 59 -> 73, lugn distans 160 -> 356. Andelen kvalitetspass går från 65 % till
-- 26 %, vilket ligger nära den norska modellens 23–25 % på/över tröskel.
--
-- ORDNING: funktionen först, sedan omräkning. Triggern
-- activities_set_category skriver annars tillbaka gamla värden.

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
$$;

-- Tvinga omräkning via triggern, som nu kör den nya funktionen.
update activities
set category_source = 'auto'
where category_source = 'auto';
