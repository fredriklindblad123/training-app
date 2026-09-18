-- ETT facit för hur klockans varv slås ihop till repetitioner.
--
-- Regeln fanns på två ställen: i SQL för dashboarden, och i TypeScript
-- (lib/splits.ts) för dagvyns tabell, eftersom den läser varven direkt ur
-- tabellen. Två implementationer av samma domänregel glider isär — det är
-- inte en fråga om OM utan NÄR. Nu bor regeln bara här, och båda vyerna
-- frågar efter samma svar. lib/splits.ts är borttagen.
--
-- REGELN: klockan tar ett autovarv vid varje kilometer även inne i en
-- repetition, så en 1600-metersrepetition ligger som två rader — 1000 m plus
-- 600 m. Vilorna definierar repetitionerna: allt aktivt mellan två vilor är
-- ETT varv, oavsett hur många rader klockan delat upp det i.
--
-- BARA NÄR PASSET HAR VILOR. Alla pass märker inte vilan som `rest` — ett
-- verkligt pass med 6×3 min och joggvila har vilorna märkta `active`, och där
-- finns inga gränser att gruppera på. Skulle man ändå slå ihop blev hela
-- passet ett enda varv, vilket är sämre än att inte slå ihop alls.
--
-- Tar en LISTA av aktiviteter, så dagvyn kan hämta hela dagen i en runda i
-- stället för en fråga per pass.
create or replace function public.merged_splits(activity_ids uuid[])
returns table (
  activity_id uuid,
  split_index int,
  parts int,
  is_rest boolean,
  distance_meters numeric,
  duration_seconds numeric,
  avg_hr numeric
)
language sql
stable
as $$
  with rader as (
    select sp.activity_id, sp.split_index, sp.split_type,
           sp.distance_meters, sp.duration_seconds, sp.avg_hr,
           sum(case when sp.split_type = 'rest' then 1 else 0 end)
             over (partition by sp.activity_id order by sp.split_index
                   rows between unbounded preceding and current row) as vilonr,
           count(*) filter (where sp.split_type = 'rest')
             over (partition by sp.activity_id) as antal_vilor
    from activity_splits sp
    join activities a on a.id = sp.activity_id
    where sp.activity_id = any(activity_ids)
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
  from rader r
  group by r.activity_id,
           -- Vilor grupperas alltid var för sig: två vilor i rad är ovanligt,
           -- och att slå ihop dem skulle dölja att klockan missat en
           -- repetition emellan.
           case when r.split_type = 'rest' then -r.split_index
                when r.antal_vilor > 0 then r.vilonr
                else r.split_index end
  order by r.activity_id, split_index;
$$;

revoke all on function public.merged_splits(uuid[]) from public;
grant execute on function public.merged_splits(uuid[]) to authenticated;


-- Dashboardens funktion använder nu samma facit i stället för en egen kopia.
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

revoke all on function public.latest_splits_with_record(uuid) from public;
grant execute on function public.latest_splits_with_record(uuid) to authenticated;
