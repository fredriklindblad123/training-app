-- Slå ihop varv som Garmin delat mitt i en repetition.
--
-- RAPPORTERAT FEL: ett pass på 2 km uppvärmning, 5×1600 m med 120 s vila och
-- nedjogg visades som korta varv, inte som 1600-metrarna. Orsaken syns i
-- datan: klockan tar ett autovarv vid varje kilometer ÄVEN INNE I en
-- repetition, så varje 1600:a ligger som två rader — 1000 m plus 600 m.
-- Appen såg tio korta varv där löparen sprang fem långa.
--
-- Lösningen är att låta VILORNA definiera repetitionerna: allt aktivt mellan
-- två vilor är ett varv, oavsett hur många rader klockan delat upp det i.
-- Verifierat mot passet: 2000 m uppvärmning, fem varv på 1600 m (384–392 s),
-- och 549 m nedjogg — exakt det som sprangs.
--
-- MEN BARA NÄR PASSET FAKTISKT HAR VILOR. Alla pass märker inte vilan som
-- rest: ett annat verkligt pass (6×3 min med joggvila) har vilorna märkta
-- 'active', och där finns inga gränser att gruppera på. Skulle man ändå slå
-- ihop blev hela passet ETT varv. Därför faller funktionen tillbaka på
-- oförändrade varv när inga rest-rader finns.
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
  rader as (
    select sp.split_index, sp.split_type, sp.distance_meters, sp.duration_seconds,
           -- Löpnummer som ökar för varje vila: alla aktiva rader mellan två
           -- vilor får samma nummer och hör därmed till samma repetition.
           sum(case when sp.split_type = 'rest' then 1 else 0 end)
             over (order by sp.split_index
                   rows between unbounded preceding and current row) as vilonr,
           count(*) filter (where sp.split_type = 'rest') over () as antal_vilor
    from activity_splits sp, senaste s
    where sp.activity_id = s.id
  ),
  varv as (
    select min(r.split_index) as split_index,
           sum(r.distance_meters) as distance_meters,
           sum(r.duration_seconds) as duration_seconds
    from rader r
    where r.split_type = 'active' and r.duration_seconds > 0
    -- Utan vilor finns inga gränser: gruppera då på raden själv, alltså
    -- ingen hopslagning alls.
    group by case when r.antal_vilor > 0 then r.vilonr else r.split_index end
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
