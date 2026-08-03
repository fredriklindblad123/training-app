-- K1 (docs/tranarperspektiv.md): strukturerad ordination.
--
-- Bakgrund: en tränare skriver "5x1000m @ 3:15/km, 2 min jogg". Idag hamnar
-- hela den meningen i planned_workouts.description som fritext. Utfallet
-- finns däremot strukturerat sedan tidigare (activity_splits, 3 206 varv) och
-- web/src/lib/session-signature.ts räknar redan fram en signatur som
-- "2x1000+4x600" ur den datan. Utan en motsvarande struktur i planen kan
-- appen aldrig jämföra det som ordinerades med det som faktiskt sprangs
-- (K2), och en veckomall kan inte återanvända ett kvalitetspass — bara
-- texten kopieras, inte innehållet.
--
-- Varför en egen tabell och inte fler kolumner på planned_workouts /
-- week_template_items: ett pass har flera repgrupper i följd. "2×1000 m +
-- 4×600 m" är INTE ett pass med en repdistans — det är två grupper med olika
-- antal, distans, fart och vila. Det är en 1:N-relation (ett planerat pass →
-- flera repgrupper), och kolumner kan inte uttrycka "noll eller flera" utan
-- att antingen tvinga fram ett fast antal fält (rep_1_distance,
-- rep_2_distance, ...) eller platta ut allt i en textsträng igen — vilket är
-- precis det problem den här migrationen löser.
--
-- Två tabeller, identisk form, en per föräldertabell:
--   planned_rep_groups   → ett enskilt planerat pass (planned_workouts)
--   template_rep_groups  → en rad i en veckomall (week_template_items)
-- De hålls medvetet identiska så att lib/planning.ts kan kopiera rader
-- rakt av från den ena till den andra när en mall rullas ut (se
-- generateFromTemplate och syncTemplateIntoBlock i planering/actions.ts).
--
-- Nyckelkopplingen till K2: lib/session-signature.ts har (i samma commit)
-- fått plannedSignatureKey/-Label som bygger exakt samma nyckelformat
-- ("Nx Y" separerat med "+") ur de här raderna som buildSessionSignature gör
-- ur activity_splits. Skulle formaten glida isär går den jämförelsen sönder
-- tyst — därför bor båda funktionerna i samma fil, med samma kommentar om
-- risken.
--
-- distance_meters/duration_seconds är alternativ, inte båda obligatoriska:
-- de flesta kvalitetspass är distansbaserade ("5×1000 m"), men tidsbaserade
-- fartlekspass ("5×3 min") förekommer och har ingen naturlig distans.
-- rep_has_a_measure kräver minst ett av de två, annars är raden meningslös.
--
-- target_hr_low/high finns med från början (samma form som K1-dokumentets
-- förslag) men är medvetet obrukbar UI-mässigt tills K8 (tröskeltest) har
-- fyllt i ett personligt tröskelband — se anteckningen i web/AGENTS.md-läsna
-- delen av tranarperspektiv.md, avsnitt K1 fallgrop 2. Kolumnen kostar
-- ingenting att ha med nu och slipper en ny migration när K8 är klart.
--
-- RLS: ingen av tabellerna har en egen user_id — ett repgrupp-id säger
-- ingenting om ägarskap på egen hand. Policyn går därför via förälderns
-- user_id (planned_rep_groups: direkt via planned_workouts;
-- template_rep_groups: två led via week_template_items → week_templates,
-- samma mönster som redan används för competition_events → competitions och
-- week_template_items → week_templates i 20260727120000_planning.sql).
--
-- OBS: den här migrationen är INTE körd i den här omgången (inget
-- supabase/psql tillgängligt i den miljö den skrevs i) — den ska köras
-- manuellt. All TypeScript som läser de här tabellerna är skriven
-- defensivt (`?? []`) så att en tillfälligt saknad tabell inte kraschar
-- dagvyn eller planeringssidan.

-- --------------------------------------------------------------------------
-- planned_rep_groups: repgrupper på ett enskilt planerat pass
-- --------------------------------------------------------------------------
create table planned_rep_groups (
  id uuid primary key default gen_random_uuid(),
  planned_workout_id uuid not null
    references planned_workouts(id) on delete cascade,
  -- Ordningen grupperna springs i — "2×1000 m + 4×600 m" är inte samma pass
  -- som "4×600 m + 2×1000 m", och session-signature.ts nyckel/etikett bygger
  -- på just den ordningen.
  sort_order smallint not null default 0,
  reps smallint not null check (reps > 0),
  distance_meters integer,               -- 1000
  duration_seconds integer,              -- alternativ till distans: "5x3min"
  target_pace_seconds_per_km integer,    -- 195 = 3:15/km
  target_hr_low smallint,                -- personligt tröskelband, se K8 — oanvänd i UI tills dess
  target_hr_high smallint,
  recovery_seconds integer,              -- 120
  recovery_kind text check (recovery_kind in ('jogg','stående','gång')),
  note text,                             -- "sista i tävlingsfart om det känns bra"
  constraint rep_has_a_measure
    check (distance_meters is not null or duration_seconds is not null)
);

create index planned_rep_groups_workout_idx on planned_rep_groups(planned_workout_id);

alter table planned_rep_groups enable row level security;
create policy "planned_rep_groups: via eget planerat pass"
  on planned_rep_groups for all
  using (
    exists (
      select 1 from planned_workouts w
      where w.id = planned_rep_groups.planned_workout_id and w.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from planned_workouts w
      where w.id = planned_rep_groups.planned_workout_id and w.user_id = auth.uid()
    )
  );

-- --------------------------------------------------------------------------
-- template_rep_groups: samma form, för en rad i en veckomall
-- --------------------------------------------------------------------------
-- Identisk med planned_rep_groups ovan bortsett från vilken förälder den
-- pekar på. Hålls som en separat tabell (inte en nullable dubbelriktad FK på
-- samma tabell) av samma skäl som week_template_items och planned_workouts
-- redan är två separata tabeller: en mallrad och ett faktiskt planerat pass
-- har olika livscykel — mallraden lever kvar och rullas ut om och om igen,
-- det planerade passet är en engångsföreteelse för ett specifikt datum.
create table template_rep_groups (
  id uuid primary key default gen_random_uuid(),
  template_item_id uuid not null
    references week_template_items(id) on delete cascade,
  sort_order smallint not null default 0,
  reps smallint not null check (reps > 0),
  distance_meters integer,
  duration_seconds integer,
  target_pace_seconds_per_km integer,
  target_hr_low smallint,
  target_hr_high smallint,
  recovery_seconds integer,
  recovery_kind text check (recovery_kind in ('jogg','stående','gång')),
  note text,
  constraint template_rep_has_a_measure
    check (distance_meters is not null or duration_seconds is not null)
);

create index template_rep_groups_item_idx on template_rep_groups(template_item_id);

alter table template_rep_groups enable row level security;
create policy "template_rep_groups: via egen mall"
  on template_rep_groups for all
  using (
    exists (
      select 1 from week_template_items i
      join week_templates t on t.id = i.template_id
      where i.id = template_rep_groups.template_item_id and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from week_template_items i
      join week_templates t on t.id = i.template_id
      where i.id = template_rep_groups.template_item_id and t.user_id = auth.uid()
    )
  );
