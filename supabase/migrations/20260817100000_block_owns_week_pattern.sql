-- Ett block äger sitt eget veckomönster direkt — "mall" (week_templates)
-- tas bort som eget, återanvändbart, coach-ägt objekt matchat mot block via
-- (ägare, fas). Uttrycklig begäran (2026-08-17): en mall som visade sig
-- läcka in mellan olika löpare bara för att den delade fas med ett block
-- ("Grundträning" dök upp under Alice trots att Fredrik skapade den för sig
-- själv i juli, innan coach-rollen ens fanns) var mer förvirrande än det
-- var värt. Ny modell: week_template_items pekar direkt på season_blocks
-- via block_id, ett block har alltid högst ett veckomönster, inget namn,
-- ingen delning mellan block.
--
-- Börjar helt om (uttryckligt val, inget försök att migrera in gammalt
-- innehåll): alla fem befintliga mallar och deras pass raderas.
--
-- Skriven idempotent (säker att köra om) — samma lärdom som tidigare
-- migrationer denna session: Supabase SQL-editorn kör inte ett inklistrat
-- skript atomiskt, så senare steg kan redan ha körts även om ett tidigare
-- steg felar.

-- ---------------------------------------------------------------------------
-- 1. Rensa gammal mall-data (cascadar till week_template_items och
--    template_rep_groups, båda har redan on delete cascade mot sin förälder)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'week_templates') then
    delete from week_templates;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. week_template_items: template_id → block_id
-- ---------------------------------------------------------------------------

alter table week_template_items
  add column if not exists block_id uuid references season_blocks(id) on delete cascade;

-- Tabellen är tom efter steg 1, så NOT NULL går igenom utan backfill.
alter table week_template_items
  alter column block_id set not null;

-- cascade tar automatiskt bort både FK:n mot week_templates och det gamla
-- unika villkoret (template_id, weekday, slot) — ingen anledning att gissa
-- villkorsnamn (samma lärdom som activity_splits-policyn tidigare denna
-- session).
alter table week_template_items
  drop column if exists template_id cascade;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'week_template_items_block_weekday_slot_key'
  ) then
    alter table week_template_items
      add constraint week_template_items_block_weekday_slot_key unique (block_id, weekday, slot);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. planned_workouts: template_id behövs inte längre — block_id (finns
--    redan) räcker helt för att identifiera vilket block ett utrullat pass
--    kom från.
-- ---------------------------------------------------------------------------

alter table planned_workouts
  drop column if exists template_id cascade;

-- ---------------------------------------------------------------------------
-- 4. week_templates tas bort helt
-- ---------------------------------------------------------------------------

drop table if exists week_templates cascade;

-- ---------------------------------------------------------------------------
-- 5. RLS: week_template_items via blockets ägare/coach/löpare i stället för
--    mallens — samma "ägare ELLER coach"-form som season_blocks redan
--    använder (season_blocks policyerna själva rörs inte, så ingen risk för
--    den cirkulära rekursion som fixades i 20260816130000).
-- ---------------------------------------------------------------------------

drop policy if exists "week_template_items: läs via mallens ägare eller coach" on week_template_items;
drop policy if exists "week_template_items: skriv via mallens ocoachade ägare eller coach" on week_template_items;
drop policy if exists "week_template_items: läs via blockets ägare, coach, eller där man är löpare" on week_template_items;
drop policy if exists "week_template_items: skriv via blockets ocoachade ägare eller coach" on week_template_items;

create policy "week_template_items: läs via blockets ägare, coach, eller där man är löpare"
  on week_template_items for select
  using (
    exists (
      select 1 from season_blocks b
      where b.id = week_template_items.block_id
        and (
          b.user_id = auth.uid()
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = b.user_id
          )
          or exists (
            select 1 from season_block_athletes sba
            where sba.block_id = b.id and sba.athlete_id = auth.uid()
          )
        )
    )
  );

create policy "week_template_items: skriv via blockets ocoachade ägare eller coach"
  on week_template_items for all
  using (
    exists (
      select 1 from season_blocks b
      where b.id = week_template_items.block_id
        and (
          (b.user_id = auth.uid() and not exists (
            select 1 from coach_athletes ca2 where ca2.athlete_id = b.user_id
          ))
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = b.user_id
          )
        )
    )
  )
  with check (
    exists (
      select 1 from season_blocks b
      where b.id = week_template_items.block_id
        and (
          (b.user_id = auth.uid() and not exists (
            select 1 from coach_athletes ca2 where ca2.athlete_id = b.user_id
          ))
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = b.user_id
          )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 6. RLS: template_rep_groups, samma mönster, ett led längre ut via
--    week_template_items.block_id.
-- ---------------------------------------------------------------------------

drop policy if exists "template_rep_groups: läs via mallens ägare eller coach" on template_rep_groups;
drop policy if exists "template_rep_groups: skriv via mallens ocoachade ägare eller coach" on template_rep_groups;
drop policy if exists "template_rep_groups: läs via blockets ägare, coach, eller där man är löpare" on template_rep_groups;
drop policy if exists "template_rep_groups: skriv via blockets ocoachade ägare eller coach" on template_rep_groups;

create policy "template_rep_groups: läs via blockets ägare, coach, eller där man är löpare"
  on template_rep_groups for select
  using (
    exists (
      select 1 from week_template_items i
      join season_blocks b on b.id = i.block_id
      where i.id = template_rep_groups.template_item_id
        and (
          b.user_id = auth.uid()
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = b.user_id
          )
          or exists (
            select 1 from season_block_athletes sba
            where sba.block_id = b.id and sba.athlete_id = auth.uid()
          )
        )
    )
  );

create policy "template_rep_groups: skriv via blockets ocoachade ägare eller coach"
  on template_rep_groups for all
  using (
    exists (
      select 1 from week_template_items i
      join season_blocks b on b.id = i.block_id
      where i.id = template_rep_groups.template_item_id
        and (
          (b.user_id = auth.uid() and not exists (
            select 1 from coach_athletes ca2 where ca2.athlete_id = b.user_id
          ))
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = b.user_id
          )
        )
    )
  )
  with check (
    exists (
      select 1 from week_template_items i
      join season_blocks b on b.id = i.block_id
      where i.id = template_rep_groups.template_item_id
        and (
          (b.user_id = auth.uid() and not exists (
            select 1 from coach_athletes ca2 where ca2.athlete_id = b.user_id
          ))
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = b.user_id
          )
        )
    )
  );
