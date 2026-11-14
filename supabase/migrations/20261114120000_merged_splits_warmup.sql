-- merged_splits: uppvärmning och nerjogg slås inte längre ihop med repen
-- (2026-11-14).
--
-- Alla aktiva varv mellan två vilor slås ihop till en repetition — klockan
-- delar ett rep vid varje kilometer. Före första vilan finns ingen gräns, så
-- uppvärmningen hamnade i rep 1 (Alice 2026-11-12: 3 km uppvärmning + 2000 m
-- blev ett "rep" på 5175 m, och "Så gick passet" sa 4 rep på 2043 m i 4:22
-- i stället för 2000/1500/1000/500 i 4:00). Oftast blev felet att rep 1
-- försvann helt: gruppen blev för långsam och sållades bort i
-- session-review — "15x90sek" gav 14 rep, "5x1km" 4.
--
-- Regeln, uppmätt mot alla 316 kvalitetspass med varv (dataverifiering
-- 2026-11-14): 32 pass får rätt antal rep, inget som var rätt blir fel.
--   * Bara aktiviteter med minst 2 vilovarv. Fredriks rullande pass
--     ("Rolling 300s", "Over and Unders") har exakt 1 och rörs inte.
--   * Bara gruppen före första vilan och gruppen efter sista vilan. Grupper
--     mellan vilor slås ihop som förut.
--   * Före första vilan: ett varv som är minst 1,15 gånger SNABBARE än
--     föregående aktiva varv börjar en ny grupp (uppvärmning -> rep 1).
--   * Efter sista vilan: första varvet som är minst 1,15 gånger LÅNGSAMMARE
--     än föregående börjar nerjoggen, som tar med resten av varven.
--   * Varv under 100 m börjar aldrig en ny grupp (en svans på 36 m hör till
--     repet före).
-- Ett rep som klockan delat har nästan samma fart i delarna (median 1,017,
-- p90 1,052), så 1,15 har god marginal.

create or replace function public.merged_splits(activity_ids uuid[])
returns table(activity_id uuid, split_index integer, parts integer, is_rest boolean, distance_meters numeric, duration_seconds numeric, avg_hr numeric)
language sql
stable
as $function$
  with rader as (
    select sp.activity_id, sp.split_index, sp.split_type,
           sp.distance_meters, sp.duration_seconds, sp.avg_hr,
           case when sp.distance_meters > 0 and sp.duration_seconds > 0
                then sp.duration_seconds / sp.distance_meters end as fart,
           -- Löpnummer som ökar för varje vila: alla aktiva rader mellan två
           -- vilor får samma nummer och hör därmed till samma repetition.
           sum(case when sp.split_type = 'rest' then 1 else 0 end)
             over (partition by sp.activity_id order by sp.split_index
                   rows between unbounded preceding and current row) as vilonr,
           count(*) filter (where sp.split_type = 'rest')
             over (partition by sp.activity_id) as antal_vilor
    from activity_splits sp
    join activities a on a.id = sp.activity_id
    where sp.activity_id = any(activity_ids)
  ),
  med_forra as (
    select r.*,
           lag(r.split_type) over w as forra_typ,
           lag(r.fart) over w as forra_fart
    from rader r
    window w as (partition by r.activity_id order by r.split_index)
  ),
  flaggade as (
    select m.*,
           -- Uppvärmning -> rep 1: ett tydligt snabbare varv före första vilan.
           case when m.antal_vilor >= 2 and m.vilonr = 0 and m.split_type = 'active'
                 and m.forra_typ = 'active' and m.distance_meters >= 100
                 and m.fart is not null and m.forra_fart is not null
                 and m.forra_fart / m.fart >= 1.15
                then 1 else 0 end as ny_fore,
           -- Sista rep -> nerjogg: ett tydligt långsammare varv efter sista vilan.
           case when m.antal_vilor >= 2 and m.vilonr = m.antal_vilor and m.split_type = 'active'
                 and m.forra_typ = 'active' and m.distance_meters >= 100
                 and m.fart is not null and m.forra_fart is not null
                 and m.fart / m.forra_fart >= 1.15
                then m.split_index end as nerjogg_start
    from med_forra m
  ),
  delade as (
    select f.*,
           case
             when f.vilonr = 0 then
               sum(f.ny_fore) over (partition by f.activity_id order by f.split_index
                                    rows between unbounded preceding and current row)
             when f.vilonr = f.antal_vilor and f.split_index >= coalesce(
                    min(f.nerjogg_start) over (partition by f.activity_id), 2147483647)
               then 1
             else 0
           end as del
    from flaggade f
  )
  select r.activity_id,
         min(r.split_index)::int as split_index,
         count(*)::int as parts,
         bool_or(r.split_type = 'rest') as is_rest,
         sum(r.distance_meters) as distance_meters,
         sum(r.duration_seconds) as duration_seconds,
         -- Tidsviktad puls: ett rakt medelvärde hade gett ett 600-metersvarv
         -- samma tyngd som ett på 1000.
         case when sum(r.duration_seconds) filter (where r.avg_hr is not null) > 0
              then round(
                     sum(r.avg_hr * r.duration_seconds) filter (where r.avg_hr is not null)
                     / sum(r.duration_seconds) filter (where r.avg_hr is not null)
                   )
         end as avg_hr
  from delade r
  group by r.activity_id,
           -- Vilor grupperas alltid var för sig: två vilor i rad är ovanligt,
           -- och att slå ihop dem skulle dölja att klockan missat en
           -- repetition emellan.
           case when r.split_type = 'rest' then -r.split_index
                when r.antal_vilor > 0 then r.vilonr
                else r.split_index end,
           case when r.split_type = 'rest' then 0 else r.del end
  order by r.activity_id, split_index;
$function$;
