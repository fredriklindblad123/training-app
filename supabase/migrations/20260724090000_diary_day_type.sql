-- Explicit dagtyp så kalenderns årsvy kan visa träna/ledig/sjuk/skadad
-- även för dagar utan synkad aktivitet.

alter table diary_entries
  add column day_type text check (day_type in ('training', 'rest', 'sick', 'injured'));
