-- merged_splits: ett ensamt långt uppvärmnings- eller nerjoggsvarv räknas
-- inte som rep (2026-11-28). Se kommentaren vid med_kant nedan.
--
-- Hittat av dataverifieringen inför löparprofilen: 31/10 räknades
-- uppvärmningen (3111 m) och nerjoggen (2008 m) som rep, så "4x4min" gav 6.
-- 141 av 275 kvalitetspass med vilor har ett sådant kantvarv.

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
  , grupper as (
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
  ),
  /* Ett ENDA långt uppvärmnings- eller nerjoggsvarv (2026-11-28). Regeln
     ovan delar bara gruppen före första och efter sista vilan när den har
     flera varv. Har klockan lagt hela uppvärmningen i ett varv (3,1 km i
     5:07/km före 4x4 min, 31/10) blev det ett rep. Första och sista gruppen
     räknas som vila (uppvärmning/nerjogg) när passet har minst 2 vilor,
     gruppen är minst 800 m och minst 1,15 gånger långsammare än medianen
     av de övriga repen — samma kvot som ovan. Mätt mot passnamnen
     (4x4min ska ge 4 rep): 70 -> 85 av 135 pass rätt, 17 blev rätt, 2 som
     "stämde" visade sig stämma av en slump (en uppvärmning hade fyllt ut ett
     saknat rep) och blir nu det klockan faktiskt har. */
  med_kant as (
    select g.*,
           g.duration_seconds / nullif(g.distance_meters, 0) as fart,
           min(g.split_index) over w as forsta,
           max(g.split_index) over w as sista,
           count(*) filter (where g.is_rest) over w as vilor
    from grupper g
    window w as (partition by g.activity_id)
  ),
  median_fart as (
    select mk.activity_id, percentile_cont(0.5) within group (order by mk.fart) as mf
    from med_kant mk
    where not mk.is_rest and mk.split_index not in (mk.forsta, mk.sista) and mk.fart is not null
    group by mk.activity_id
  )
  select k.activity_id, k.split_index, k.parts,
         k.is_rest or coalesce(
           k.vilor >= 2 and k.split_index in (k.forsta, k.sista)
           and k.distance_meters >= 800 and m.mf is not null and k.fart >= m.mf * 1.15, false
         ) as is_rest,
         k.distance_meters, k.duration_seconds, k.avg_hr
  from med_kant k
  left join median_fart m on m.activity_id = k.activity_id
  order by k.activity_id, k.split_index;
$function$;
