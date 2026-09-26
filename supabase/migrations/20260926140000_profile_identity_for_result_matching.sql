-- Identifierande uppgifter för att kunna matcha en adept mot externa
-- resultatlistor (begäran 2026-09-26).
--
-- Förnamn ensamt räcker inte, och det är inte en teoretisk risk: en sökning
-- på "Alice" + "2000m hinder" + "Ungdomsfinnkampen 2026" ger Alice
-- Samuelsson från Kongahälla, som sprang samma gren på samma tävling. Utan
-- efternamn, klubb och födelseår hade en automatisk matchning skrivit in
-- hennes tid i fel persons utveckling.
alter table profiles
  add column if not exists last_name text,
  add column if not exists birth_year integer,
  add column if not exists club text;

comment on column profiles.last_name is
  'Efternamn. Krävs tillsammans med birth_year och club för att matcha mot externa resultatlistor.';
comment on column profiles.birth_year is
  'Födelseår, för att skilja namnar åt i en nationell resultatdatabas.';
comment on column profiles.club is
  'Klubbnamn som det skrivs i resultatlistor, t.ex. "IFK Göteborg".';
