-- Rekord bara på riktiga sträckor, aldrig på ett tidsintervalls biprodukt.
--
-- RAPPORTERAT FEL: Daniel körde 3-minutersintervaller. Varje varv var exakt
-- 181 sekunder och distansen blev 757-775 m beroende på dagsform. Den gamla
-- funktionen avrundade distansen till närmaste 50 m och påstod att han satte
-- personbästa på 750 m — men 750 m var aldrig målet, det var utfallet av en
-- fast tid. Tiden kunde per definition inte bli bättre än 181 sekunder.
--
-- Två spärrar, båda krävs:
--
--   1. Sträckan måste ligga inom 2% av en riktig tävlings- eller
--      intervallsträcka. 757 m är 5% från 800 och 26% från 600 — alltså ingen
--      sträcka alls, utan ett utfall. Ett verkligt 1000-metersvarv mäter
--      995-1005 och klarar gränsen.
--
--   2. Passet måste innehålla MINST TVÅ varv på samma sträcka. Ett ensamt
--      varv är lika gärna uppvärmning eller nedjogg som en repetition, och
--      "snabbaste 1000 m i år" ska inte kunna utlösas av att någon råkade
--      springa en kilometer på väg hem.
--
-- Jämförelsen sker mot varv som klarar samma spärrar, så en tidsintervalls
-- 757 m varken sätter eller slår ett rekord.
drop function if exists public.latest_splits_with_record(uuid);

create function public.latest_splits_with_record(target uuid)
returns table (
  split_index int,
  distance_meters numeric,
  duration_seconds numeric,
  activity_name text,
  activity_category text,
  started timestamptz,
  previous_best numeric,
  canonical_distance int
)
language sql
stable
as $$
  with kanoniska(d) as (
    values (200),(300),(400),(500),(600),(800),(1000),(1200),(1500),(1600),
           (2000),(3000),(5000),(10000)
  ),
  senaste as (
    select a.id, a.name, a.category, a.start_time
    from activities a
    where a.user_id = target
    order by a.start_time desc
    limit 1
  ),
  varv as (
    select sp.split_index, sp.distance_meters, sp.duration_seconds,
           (select k.d from kanoniska k
             where abs(sp.distance_meters - k.d) <= k.d * 0.02
             order by abs(sp.distance_meters - k.d) limit 1) as kanon
    from activity_splits sp, senaste s
    where sp.activity_id = s.id
      and sp.split_type = 'active'
      and sp.duration_seconds > 0
  ),
  upprepade as (
    select kanon from varv where kanon is not null
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
  from varv v, senaste s
  order by v.split_index;
$$;

revoke all on function public.latest_splits_with_record(uuid) from public;
grant execute on function public.latest_splits_with_record(uuid) to authenticated;
