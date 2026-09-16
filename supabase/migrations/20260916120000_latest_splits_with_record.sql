-- Senaste passets varv, plus årets bästa tid på samma sträcka.
--
-- Rekordkortet behöver jämföra dagens snabbaste varv mot årets bästa på samma
-- distans. Att skicka hem alla årets varv och jämföra i webbläsaren vore
-- 1 242 rader för den mest aktiva löparen, på appens landningssida. Här görs
-- jämförelsen där datan redan finns och bara svaret skickas.
--
-- Sträckan avrundas till närmaste 50 m. Garmins varvdistans landar sällan på
-- exakt 1000 — 995 och 1003 är samma 1000-meter för en löpare, och utan
-- avrundning hade varje varv blivit sin egen "sträcka" och rekord aldrig
-- kunnat slås.
--
-- Funktionen svarar bara för SENASTE passet, och bara om det har aktiva varv.
-- Ett lugnt distanspass ger noll rader, vilket är avsiktligt: sidan ska inte
-- visa varv från ett annat pass för en dag då man sprang distans.
--
-- SECURITY INVOKER (standard): funktionen läser bara rader anroparen redan
-- kommer åt via RLS på activities.
create or replace function public.latest_splits_with_record(target uuid)
returns table (
  split_index int,
  distance_meters numeric,
  duration_seconds numeric,
  activity_name text,
  activity_category text,
  started timestamptz,
  previous_best numeric
)
language sql
stable
as $$
  with senaste as (
    select a.id, a.name, a.category, a.start_time
    from activities a
    where a.user_id = target
    order by a.start_time desc
    limit 1
  ),
  varv as (
    select sp.split_index, sp.distance_meters, sp.duration_seconds,
           round(sp.distance_meters / 50.0) * 50 as bucket
    from activity_splits sp, senaste s
    where sp.activity_id = s.id
      and sp.split_type = 'active'
      and sp.duration_seconds > 0
  )
  select v.split_index,
         v.distance_meters,
         v.duration_seconds,
         s.name,
         s.category,
         s.start_time,
         (
           select min(sp2.duration_seconds)
           from activity_splits sp2
           join activities a2 on a2.id = sp2.activity_id
           where a2.user_id = target
             and a2.id <> s.id
             and sp2.split_type = 'active'
             and sp2.duration_seconds > 0
             and sp2.start_time >= date_trunc('year', s.start_time)
             and sp2.start_time < s.start_time
             and round(sp2.distance_meters / 50.0) * 50 = v.bucket
         ) as previous_best
  from varv v, senaste s
  order by v.split_index;
$$;

revoke all on function public.latest_splits_with_record(uuid) from public;
grant execute on function public.latest_splits_with_record(uuid) to authenticated;
