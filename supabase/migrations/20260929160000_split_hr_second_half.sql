-- Snittpuls över andra halvan av varje varv (2026-09-29, uttrycklig begäran).
--
-- Växlarna på /trender (lib/training-gears.ts) mätte tröskel- och
-- intervallrep med varvets snittpuls. Pulsen ligger efter i början av varje
-- rep, så snittet underskattar arbetet. Mätt på Alices 147 kvalitetsrep sedan
-- juni, medianer:
--
--                         snitt   andra halvan   max
--   intervall < 2 min      180        189        193
--   intervall 2–5 min      185        192        195
--   tröskel   < 2 min      182        189        192
--   tröskel   2–5 min      185        191        193
--   tröskel   ≥ 5 min      177        180        186
--
-- Tröskelrep mäts därför med andra halvans snitt (här). Intervallrep mäts med
-- varvets maxpuls, som redan finns i activity_splits.max_hr — det valet görs
-- i lib/training-gears.ts, inte här.
--
-- Varvets tidsfönster i kurvan: start_time minus aktivitetens start. Kurvans
-- offsets räknas från första mätvärdet med puls; på åtta stickprov av
-- kvalitetspass var det samma sekund som passets start (0 s glapp), och
-- synken räknar numera från passets start. Snittet ur kurvan över hela
-- varvet stämde exakt med Garmins avg_hr i kontrollen, så fönstren sitter.

alter table activity_splits add column hr_second_half numeric;

-- Räknar om ett varv (p_split_id) eller alla varv i en aktivitet. Kräver
-- minst hälften av andra halvans sekunder i kurvan — annars null, inte en
-- gissning ur ett par punkter.
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
      extract(epoch from (s.start_time - a.start_time)) + s.duration_seconds / 2 as t_from,
      extract(epoch from (s.start_time - a.start_time)) + s.duration_seconds as t_to,
      s.duration_seconds / 2 as half
    from activity_splits s
    join activities a on a.id = s.activity_id
    where s.activity_id = p_activity_id
      and (p_split_id is null or s.id = p_split_id)
      and s.start_time is not null and s.duration_seconds > 0
  ),
  agg as (
    select w.id,
      case when count(u.hr) >= greatest(3, w.half * 0.5) then avg(u.hr) end as hr
    from win w
    left join activity_hr_streams h on h.activity_id = p_activity_id
    left join lateral unnest(h.offsets, h.hr) as u(off, hr)
      on u.off >= w.t_from and u.off < w.t_to and u.hr > 0
    group by w.id, w.half
  )
  update activity_splits s set hr_second_half = round(agg.hr, 1)
  from agg
  where s.id = agg.id and s.hr_second_half is distinct from round(agg.hr, 1);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function compute_split_hr(uuid, uuid) from public, anon, authenticated;

-- Ny kurva: räkna om aktivitetens zontid (som förut) och dess varv.
create or replace function activity_hr_streams_recompute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform compute_lab_zones(new.user_id, new.activity_id);
  perform compute_split_hr(new.activity_id);
  return new;
end;
$$;

-- Nytt eller ändrat varv: räkna om just det. Bara när tidsfönstret ändras,
-- så funktionens egen update av hr_second_half inte triggar sig själv.
create or replace function activity_splits_recompute_hr()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform compute_split_hr(new.activity_id, new.id);
  return null;
end;
$$;

create trigger activity_splits_recompute_hr
  after insert or update of start_time, duration_seconds on activity_splits
  for each row execute function activity_splits_recompute_hr();

-- Befintliga kurvor.
select compute_split_hr(activity_id) from activity_hr_streams;
