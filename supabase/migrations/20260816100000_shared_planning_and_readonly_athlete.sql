-- Två saker, båda uttryckligen beställda:
--
-- 1. Delad träningsplanering: Daniel coachar både Alice och Nike, och de
--    tränar mestadels tillsammans — samma block/veckomall ska kunna gälla
--    flera löpare, i stället för att matas in en gång per löpare. En ny
--    kopplingstabell (season_block_athletes) avgör VILKA löpare ett block
--    gäller för; season_blocks.user_id blir "vem äger/redigerar blocket"
--    (coachen för ett delat block, löparen själv för ett självcoachat) i
--    stället för "vem gäller det för". Utrullningen till planned_workouts
--    förblir helt individuell — en rad per löpare och datum, som idag — den
--    körs nu bara per löpare i season_block_athletes i stället för bara en.
--    week_templates behöver ingen egen kopplingstabell: en mall matchas mot
--    block via (ägare, fas) precis som idag, och "vilka löpare" ärvs helt
--    från blocket mallen rullas ut i.
--
-- 2. Skrivskyddad planering för en coachad löpare: en löpare med en coach
--    ska kunna LÄSA sitt eget block/mallar (vet vad som väntar och varför)
--    men inte skapa/ändra dem — det är coachens jobb. En löpare UTAN coach
--    (självcoachat läge, appens ursprungliga enanvändarläge) behåller full
--    redigeringsrätt över sin egen planering, som innan Fas 0.
--
--    RLS-mönstret för skrivning: `(jag äger raden OCH jag har ingen coach)
--    ELLER (jag coachar radens ägare)`. Läsmönstret breddas separat med en
--    egen policy (season_block_athletes-medlemskap) så en löpare fortfarande
--    ser ett delat block även om hen inte äger raden.

-- ---------------------------------------------------------------------------
-- season_block_athletes: vilka löpare ett block gäller för
-- ---------------------------------------------------------------------------

create table season_block_athletes (
  block_id uuid not null references season_blocks(id) on delete cascade,
  athlete_id uuid not null references profiles(id) on delete cascade,
  primary key (block_id, athlete_id)
);

create index season_block_athletes_athlete_idx on season_block_athletes(athlete_id);

-- Backfill: alla befintliga block (ägda direkt av löparen själv) gäller
-- fortsatt bara den löparen — annars skulle de försvinna ur vyn så fort
-- läsvägen i appen börjar gå via den här tabellen i stället för user_id.
insert into season_block_athletes (block_id, athlete_id)
select id, user_id from season_blocks;

alter table season_block_athletes enable row level security;

create policy "season_block_athletes: läs om man äger, coachar eller är målet"
  on season_block_athletes for select
  using (
    athlete_id = auth.uid()
    or exists (
      select 1 from season_blocks b
      where b.id = season_block_athletes.block_id
        and (
          b.user_id = auth.uid()
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = b.user_id
          )
        )
    )
  );

create policy "season_block_athletes: skriv om man äger blocket (ocoachad) eller coachar ägaren"
  on season_block_athletes for all
  using (
    exists (
      select 1 from season_blocks b
      where b.id = season_block_athletes.block_id
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
      where b.id = season_block_athletes.block_id
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
-- season_blocks: läs breddas (medlemskap via season_block_athletes), skriv
-- spärras för en coachad löpares egna rader.
-- ---------------------------------------------------------------------------

drop policy "season_blocks: egna rader eller coachad löpares" on season_blocks;

create policy "season_blocks: läs egna, coachad löpares, eller där man är löpare"
  on season_blocks for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = season_blocks.user_id
    )
    or exists (
      select 1 from season_block_athletes sba
      where sba.block_id = season_blocks.id and sba.athlete_id = auth.uid()
    )
  );

create policy "season_blocks: skriv om ocoachad ägare eller coach"
  on season_blocks for insert
  with check (
    (auth.uid() = user_id and not exists (
      select 1 from coach_athletes ca2 where ca2.athlete_id = user_id
    ))
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = user_id
    )
  );

create policy "season_blocks: ändra om ocoachad ägare eller coach"
  on season_blocks for update
  using (
    (auth.uid() = user_id and not exists (
      select 1 from coach_athletes ca2 where ca2.athlete_id = user_id
    ))
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = user_id
    )
  )
  with check (
    (auth.uid() = user_id and not exists (
      select 1 from coach_athletes ca2 where ca2.athlete_id = user_id
    ))
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = user_id
    )
  );

create policy "season_blocks: ta bort om ocoachad ägare eller coach"
  on season_blocks for delete
  using (
    (auth.uid() = user_id and not exists (
      select 1 from coach_athletes ca2 where ca2.athlete_id = user_id
    ))
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = user_id
    )
  );

-- ---------------------------------------------------------------------------
-- week_templates: samma skriv-spärr som season_blocks. Läsvägen är
-- oförändrad (egen rad eller coachad löpares) — mallar delas redan implicit
-- via (ägare, fas)-matchningen mot block, ingen egen medlemskapstabell behövs.
-- ---------------------------------------------------------------------------

drop policy "week_templates: egna rader eller coachad löpares" on week_templates;

create policy "week_templates: läs egna eller coachad löpares"
  on week_templates for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = week_templates.user_id
    )
  );

create policy "week_templates: skriv om ocoachad ägare eller coach"
  on week_templates for insert
  with check (
    (auth.uid() = user_id and not exists (
      select 1 from coach_athletes ca2 where ca2.athlete_id = user_id
    ))
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = user_id
    )
  );

create policy "week_templates: ändra om ocoachad ägare eller coach"
  on week_templates for update
  using (
    (auth.uid() = user_id and not exists (
      select 1 from coach_athletes ca2 where ca2.athlete_id = user_id
    ))
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = user_id
    )
  )
  with check (
    (auth.uid() = user_id and not exists (
      select 1 from coach_athletes ca2 where ca2.athlete_id = user_id
    ))
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = user_id
    )
  );

create policy "week_templates: ta bort om ocoachad ägare eller coach"
  on week_templates for delete
  using (
    (auth.uid() = user_id and not exists (
      select 1 from coach_athletes ca2 where ca2.athlete_id = user_id
    ))
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = user_id
    )
  );

-- ---------------------------------------------------------------------------
-- week_template_items: samma mönster, via mallens ägare.
-- ---------------------------------------------------------------------------

drop policy "week_template_items: via egen mall eller coachad löpares" on week_template_items;

create policy "week_template_items: läs via mallens ägare eller coach"
  on week_template_items for select
  using (
    exists (
      select 1 from week_templates t
      where t.id = week_template_items.template_id
        and (
          t.user_id = auth.uid()
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = t.user_id
          )
        )
    )
  );

create policy "week_template_items: skriv via mallens ocoachade ägare eller coach"
  on week_template_items for all
  using (
    exists (
      select 1 from week_templates t
      where t.id = week_template_items.template_id
        and (
          (t.user_id = auth.uid() and not exists (
            select 1 from coach_athletes ca2 where ca2.athlete_id = t.user_id
          ))
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = t.user_id
          )
        )
    )
  )
  with check (
    exists (
      select 1 from week_templates t
      where t.id = week_template_items.template_id
        and (
          (t.user_id = auth.uid() and not exists (
            select 1 from coach_athletes ca2 where ca2.athlete_id = t.user_id
          ))
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = t.user_id
          )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- template_rep_groups: samma mönster, via mallradens mall.
-- ---------------------------------------------------------------------------

drop policy "template_rep_groups: via egen mall eller coachad löpares" on template_rep_groups;

create policy "template_rep_groups: läs via mallens ägare eller coach"
  on template_rep_groups for select
  using (
    exists (
      select 1 from week_template_items i
      join week_templates t on t.id = i.template_id
      where i.id = template_rep_groups.template_item_id
        and (
          t.user_id = auth.uid()
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = t.user_id
          )
        )
    )
  );

create policy "template_rep_groups: skriv via mallens ocoachade ägare eller coach"
  on template_rep_groups for all
  using (
    exists (
      select 1 from week_template_items i
      join week_templates t on t.id = i.template_id
      where i.id = template_rep_groups.template_item_id
        and (
          (t.user_id = auth.uid() and not exists (
            select 1 from coach_athletes ca2 where ca2.athlete_id = t.user_id
          ))
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = t.user_id
          )
        )
    )
  )
  with check (
    exists (
      select 1 from week_template_items i
      join week_templates t on t.id = i.template_id
      where i.id = template_rep_groups.template_item_id
        and (
          (t.user_id = auth.uid() and not exists (
            select 1 from coach_athletes ca2 where ca2.athlete_id = t.user_id
          ))
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = t.user_id
          )
        )
    )
  );
