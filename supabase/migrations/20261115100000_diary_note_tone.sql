-- Färgkodningen i träningsdagboken (2026-11-15).
--
-- Alice skriver dagboken i ett dokument där kommentarerna är färgade enligt
-- FIG:s mall: grönt = bra kommentarer (genombrott, bra inställning), rosa =
-- mindre bra (skador, bristande motivation). Färgen följde inte med när
-- texten importerades. Den läses nu ur PDF:erna (scripts/import_diary_tone.py)
-- och sparas som antal tecken i varje färg — hennes egen markering, inte en
-- tolkning av texten.
alter table diary_entries
  add column if not exists notes_good_chars integer,
  add column if not exists notes_bad_chars integer;

comment on column diary_entries.notes_good_chars is
  'Tecken i grön (bra) färg i dagbokens kommentar, ur källdokumentet. Null = okänt.';
comment on column diary_entries.notes_bad_chars is
  'Tecken i rosa (mindre bra) färg i dagbokens kommentar, ur källdokumentet. Null = okänt.';
