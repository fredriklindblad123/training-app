-- Fas 0 (docs-lös just nu, se konversationshistorik): grunden för att en
-- coach ska kunna hantera flera löpares planering i samma app, inte bara sin
-- egen. Appen har hittills bara haft en enda betydelse av "user_id" — den
-- inloggade personens egna rader. Den här migrationen lägger till en explicit
-- coach↔löpare-relation och breddar RLS på de tabeller /sasongen (och de
-- kommande Flerårsplan/Årsplan-sidorna) äger, så att en coach kan läsa och
-- skriva en länkad löpares rader utan att vara inloggad som löparen.
--
-- Medvetet INTE ändrat här: activities, diary_entries, planned_workouts,
-- daily_metrics, kalendern, dashboarden, trender, tävlingsresultat. En löpare
-- loggar fortfarande in med sitt eget konto för att se sin egen dagliga logg
-- — bara säsongsplaneringen (block, tävlingar, veckomallar, tillgänglighet)
-- och de nya planeringstabellerna blir coach-åtkomliga i det här steget.
-- Se plan-dokumentet för fas 0 för motiveringen till den avgränsningen.

-- --------------------------------------------------------------------------
-- Roll på profilen
-- --------------------------------------------------------------------------
alter table profiles
  add column role text not null default 'athlete' check (role in ('athlete', 'coach'));

comment on column profiles.role is
  'athlete = ser bara sin egen data (default). coach = kan länkas till flera löpare via coach_athletes och växla mellan dem på planeringssidorna.';

-- --------------------------------------------------------------------------
-- coach_athletes: vem coachar vem
-- --------------------------------------------------------------------------
create table coach_athletes (
  coach_id uuid not null references profiles(id) on delete cascade,
  athlete_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (coach_id, athlete_id),
  constraint coach_athletes_not_self check (coach_id <> athlete_id)
);

create index coach_athletes_athlete_idx on coach_athletes(athlete_id);

alter table coach_athletes enable row level security;

-- Coachen äger relationen — kan lägga till/ta bort löpare under sig.
create policy "coach_athletes: coachen hanterar sina egna kopplingar"
  on coach_athletes for all
  using (auth.uid() = coach_id)
  with check (auth.uid() = coach_id);

-- Löparen får bara se vem som coachar hen, inte ändra det själv.
create policy "coach_athletes: löparen ser sina egna kopplingar"
  on coach_athletes for select
  using (auth.uid() = athlete_id);

-- --------------------------------------------------------------------------
-- Bredda RLS på befintliga planeringstabeller: egen rad ELLER en löpare
-- man coachar. Rent additivt — en löpares åtkomst till sina egna rader är
-- oförändrad.
-- --------------------------------------------------------------------------

-- season_blocks
drop policy "season_blocks: full åtkomst till egna rader" on season_blocks;
create policy "season_blocks: egna rader eller coachad löpares"
  on season_blocks for all
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = season_blocks.user_id
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = season_blocks.user_id
    )
  );

-- competitions
drop policy "competitions: full åtkomst till egna rader" on competitions;
create policy "competitions: egna rader eller coachad löpares"
  on competitions for all
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = competitions.user_id
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = competitions.user_id
    )
  );

-- competition_events (ärver via competitions, samma tvåstegsmönster som redan fanns)
drop policy "competition_events: via egen tävling" on competition_events;
create policy "competition_events: via egen tävling eller coachad löpares"
  on competition_events for all
  using (
    exists (
      select 1 from competitions c
      where c.id = competition_events.competition_id
        and (
          c.user_id = auth.uid()
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = c.user_id
          )
        )
    )
  )
  with check (
    exists (
      select 1 from competitions c
      where c.id = competition_events.competition_id
        and (
          c.user_id = auth.uid()
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = c.user_id
          )
        )
    )
  );

-- week_templates
drop policy "week_templates: full åtkomst till egna rader" on week_templates;
create policy "week_templates: egna rader eller coachad löpares"
  on week_templates for all
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = week_templates.user_id
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = week_templates.user_id
    )
  );

-- week_template_items (ärver via week_templates)
drop policy "week_template_items: via egen mall" on week_template_items;
create policy "week_template_items: via egen mall eller coachad löpares"
  on week_template_items for all
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
  )
  with check (
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

-- template_rep_groups (ärver via week_template_items → week_templates)
drop policy "template_rep_groups: via egen mall" on template_rep_groups;
create policy "template_rep_groups: via egen mall eller coachad löpares"
  on template_rep_groups for all
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
  )
  with check (
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

-- availability_periods
drop policy "availability_periods: full åtkomst till egna rader" on availability_periods;
create policy "availability_periods: egna rader eller coachad löpares"
  on availability_periods for all
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = availability_periods.user_id
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = availability_periods.user_id
    )
  );
