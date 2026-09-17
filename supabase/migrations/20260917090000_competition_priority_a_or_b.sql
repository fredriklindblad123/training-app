-- Tävlingsprioritet är A eller B. C ("träningstävling") utgår.
--
-- Begärt 2026-09-17: två nivåer räcker. Ett lopp är antingen ett man
-- periodiserar mot eller ett man springer på vägen dit.
--
-- 153 av 174 rader låg på C, alltså nästan hela historiken. De blir B, som är
-- den närmaste betydelsen — en tävling man kör utan att toppa formen. Att låta
-- dem ligga kvar på ett värde gränssnittet inte längre kan skapa hade gett 153
-- rader i ett tredje tillstånd som inget i appen kan förklara.
--
-- Ordningen är viktig: spärren måste släppas innan raderna kan skrivas om, och
-- sättas tillbaka först när ingen rad bryter mot den.
alter table public.competitions drop constraint if exists competitions_priority_check;

update public.competitions set priority = 'B' where priority = 'C';

alter table public.competitions
  add constraint competitions_priority_check check (priority in ('A', 'B'));
