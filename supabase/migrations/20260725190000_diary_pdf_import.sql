-- Stöd för att importera en PDF-träningsdagbok (t.ex. FIG:s
-- pappersdagbok) via /api/diary/import (Anthropic-tolkad, se
-- web/api/index.py). Passbeskrivning och tränarkommentar hålls separata
-- från idrottarens egna ord (notes), så de aldrig blandas ihop.

alter table diary_entries
  add column session_log text,   -- rå träningsloggtext (distans, tempo, intervaller)
  add column coach_notes text;   -- tränarens kommentarer, separat från idrottarens egna

-- Städa ev. dubbletter per (user_id, entry_date) innan unik-constrainten
-- läggs på — behåll senast skapade raden, radera äldre dubbletter.
delete from diary_entries a
using diary_entries b
where a.user_id = b.user_id
  and a.entry_date = b.entry_date
  and a.created_at < b.created_at;

alter table diary_entries
  add constraint diary_entries_user_id_entry_date_key unique (user_id, entry_date);
