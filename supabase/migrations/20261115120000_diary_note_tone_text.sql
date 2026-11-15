-- Den gröna och den rosa texten i dagbokens kommentar, var för sig
-- (2026-11-15). Antalet tecken (20261115100000) räcker för känslan per
-- anteckning, men inte för att säga i vilken färg ett visst tema togs upp —
-- en mest grön anteckning kan nämna höften i en rosa bisats. Fylls ur
-- källdokumentet av scripts/import_diary_tone.py.
alter table diary_entries
  add column if not exists notes_good_text text,
  add column if not exists notes_bad_text text;
