-- Pulsen vid repets slut (2026-10-09, uttrycklig begäran).
--
-- Form-vyn mätte tröskelrep med snittpulsen över andra halvan och
-- intervallrep med maxpulsen. Tränaren vill i stället se vilken puls repet
-- AVSLUTADES på — det är den han läser av på klockan efter ett rep.
--
-- Uppmätt på Alices 1 466 kvalitetsrep sedan juli 2025: på rep ≥ 90 s ligger
-- slutpuls (sista 10 s), andra halvan och max inom 1–2,5 slag från varandra,
-- och 15 s ger samma värde som 10 s. På rep < 45 s har pulsen inte hunnit
-- upp när repet slutar — den stiger i snitt 5 slag till efter repet — så där
-- säger slutpulsen mer om vilan än om repet.
--
-- Samma tidsfönster och samma kurva som hr_second_half; bara fönstret är de
-- sista 10 sekunderna. Kräver minst 5 sekunder med puls i fönstret, annars
-- null i stället för en gissning ur en enstaka punkt.

alter table activity_splits add column if not exists hr_end numeric;

create or replace function compute_split_hr(p_activity_id uuid, p_split_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with win as (
    select s.id,
      extract(epoch from (s.start_time - a.start_time)) as t_start,
      s.duration_seconds as dur
    from activity_splits s
    join activities a on a.id = s.activity_id
    where s.activity_id = p_activity_id
      and (p_split_id is null or s.id = p_split_id)
      and s.start_time is not null and s.duration_seconds > 0
  ),
  agg as (
    select w.id,
      case
        when count(u.hr) filter (where u.off >= w.t_start + w.dur / 2) >= greatest(3, w.dur / 2 * 0.5)
        then avg(u.hr) filter (where u.off >= w.t_start + w.dur / 2)
      end as hr_half,
      case
        when w.dur >= 10 and count(u.hr) filter (where u.off >= w.t_start + w.dur - 10) >= 5
        then avg(u.hr) filter (where u.off >= w.t_start + w.dur - 10)
      end as hr_end
    from win w
    left join activity_hr_streams h on h.activity_id = p_activity_id
    left join lateral unnest(h.offsets, h.hr) as u(off, hr)
      on u.off >= w.t_start + least(w.dur / 2, greatest(w.dur - 10, 0))
     and u.off < w.t_start + w.dur
     and u.hr > 0
    group by w.id, w.dur
  )
  update activity_splits s
  set hr_second_half = round(agg.hr_half, 1),
      hr_end = round(agg.hr_end, 1)
  from agg
  where s.id = agg.id
    and (s.hr_second_half is distinct from round(agg.hr_half, 1)
      or s.hr_end is distinct from round(agg.hr_end, 1));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function compute_split_hr(uuid, uuid) from public, anon, authenticated;

-- Befintliga kurvor: fyll hr_end (hr_second_half räknas om till samma värde).
select compute_split_hr(activity_id) from activity_hr_streams;
