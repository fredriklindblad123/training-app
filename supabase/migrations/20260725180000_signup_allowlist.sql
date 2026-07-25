-- Vitlista för vem som får skapa konto. Publik registrering ("Allow new
-- users to sign up") lämnas påslagen i Supabase-inställningarna, men en
-- "Before User Created" Auth Hook (Authentication → Hooks i dashboarden)
-- blockerar alla mejladresser som inte finns i den här tabellen — projekt-
-- ägaren lägger till en adress i förväg för att släppa in någon, ingen
-- extern mejltjänst behövs.

create table allowed_signup_emails (
  email text primary key,
  note text,
  added_at timestamptz not null default now()
);

-- Bara admin (via Supabase-dashboardens Table Editor / service_role) hanterar
-- listan — ingen policy alls, så anon/authenticated varken läser eller
-- skriver den.
alter table allowed_signup_emails enable row level security;

create or replace function public.hook_restrict_signup_by_email(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_email text := lower(event -> 'user' ->> 'email');
  v_allowed int;
begin
  select count(*) into v_allowed
  from public.allowed_signup_emails
  where lower(email) = v_email;

  if v_allowed > 0 then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'Den här mejladressen är inte godkänd för registrering. Kontakta appens ägare.',
      'http_code', 403
    )
  );
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_restrict_signup_by_email to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_by_email from authenticated, anon, public;

-- Fyll på med de mejladresser som ska kunna skapa konto. Lägg till fler
-- rader här (eller direkt i Table Editor) för varje ny person du vill
-- släppa in.
insert into allowed_signup_emails (email, note) values
  ('fredrik_lindblad@hotmail.com', 'ägare')
on conflict (email) do nothing;
