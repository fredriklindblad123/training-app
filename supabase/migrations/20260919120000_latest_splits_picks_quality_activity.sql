-- latest_splits_with_record tog SENASTE AKTIVITETEN. Ett intervallpass består
-- nästan alltid av tre: uppvärmning, huvudpass, nerjogg — och den sista är
-- nerjoggen, som inte har några varv alls. Följden var att dashboarden ritade
-- distanslayouten (distans/fart/tid/puls) för ett intervallpass, trots att
-- varven fanns i databasen.
--
-- Konkret exempel: 2026-09-19 sprang Alice
-- "4x4min/2min vila + 4x2min/1min vila + 6x30sek" med 14 aktiva varv. Kortet
-- visade "13,39 km · 5:11/km · 1 h 9 min", alltså summan av uppvärmning,
-- huvudpass och nerjogg — precis den vilseledande vyn som varvgrafen finns
-- för att ersätta.
--
-- Funktionen grupperar nu aktiviteter till PASS på samma sätt som appen gör
-- (lib/sessions.ts): ett nytt pass börjar när glappet till föregående
-- aktivitets slut överstiger 2,5 timmar. Ur det senaste passet väljs den
-- aktivitet som bär kvalitetsarbetet — den med flest aktiva varv. Saknar
-- passet varv helt returneras inget, och anroparen faller tillbaka på
-- distanslayouten, vilket är rätt för ett rent distanspass.

create or replace function public.latest_splits_with_record(target uuid)
returns table (
  split_index integer,
  distance_meters numeric,
  duration_seconds numeric,
  activity_name text,
  activity_category text,
  started timestamptz,
  previous_best numeric,
  canonical_distance integer
)
language sql
stable
as $$
  with kanoniska(d) as (
    values (200),(300),(400),(500),(600),(800),(1000),(1200),(1500),(1600),
           (2000),(3000),(5000),(10000)
  ),
  -- Samma passgruppering som lib/sessions.ts: 2,5 timmars glapp bryter.
  ordnade as (
    select a.id, a.name, a.category, a.start_time,
           lag(a.start_time + make_interval(secs => coalesce(a.duration_seconds, 0)))
             over (order by a.start_time) as forra_slut
    from activities a
    where a.user_id = target
  ),
  markerade as (
    select o.*,
           case
             when o.forra_slut is null
               or o.start_time - o.forra_slut > interval '2.5 hours'
             then 1 else 0
           end as nytt_pass
    from ordnade o
  ),
  grupperade as (
    select m.*,
           sum(m.nytt_pass) over (
             order by m.start_time rows between unbounded preceding and current row
           ) as pass_nr
    from markerade m
  ),
  senaste_pass as (
    select g.id, g.name, g.category, g.start_time
    from grupperade g
    where g.pass_nr = (select max(pass_nr) from grupperade)
  ),
  -- Kvalitetsaktiviteten: den i passet som har flest aktiva varv. Vid lika
  -- antal vinner den som startade först, alltså huvudpasset före nerjoggen.
  med_antal as (
    select s.id, s.name, s.category, s.start_time,
           (select count(*)
              from public.merged_splits(array[s.id]) m
             where not m.is_rest and m.duration_seconds > 0) as antal_varv
    from senaste_pass s
  ),
  senaste as (
    select id, name, category, start_time
    from med_antal
    where antal_varv > 0
    order by antal_varv desc, start_time
    limit 1
  ),
  varv as (
    select m.split_index, m.distance_meters, m.duration_seconds
    from senaste s, public.merged_splits(array[s.id]) m
    where not m.is_rest and m.duration_seconds > 0
  ),
  med_kanon as (
    select v.*,
           (select k.d from kanoniska k
             where abs(v.distance_meters - k.d) <= k.d * 0.02
             order by abs(v.distance_meters - k.d) limit 1) as kanon
    from varv v
  ),
  upprepade as (
    select kanon from med_kanon where kanon is not null
    group by kanon having count(*) >= 2
  )
  select v.split_index, v.distance_meters, v.duration_seconds,
         s.name, s.category, s.start_time,
         case when v.kanon in (select kanon from upprepade) then (
           select min(sp2.duration_seconds)
           from activity_splits sp2
           join activities a2 on a2.id = sp2.activity_id
           where a2.user_id = target
             and a2.id <> s.id
             and sp2.split_type = 'active'
             and sp2.duration_seconds > 0
             and sp2.start_time >= date_trunc('year', s.start_time)
             and sp2.start_time < s.start_time
             and abs(sp2.distance_meters - v.kanon) <= v.kanon * 0.02
         ) end as previous_best,
         v.kanon
  from med_kanon v, senaste s
  order by v.split_index;
$$;
