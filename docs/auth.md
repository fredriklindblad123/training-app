# Autentisering

Supabase Auth (e-post/lösenord) via `@supabase/ssr`. Se
`web/src/lib/supabase/` för klienterna och `web/src/app/login/`,
`web/src/app/private/`, `web/src/app/auth/confirm/` för sidorna.

## Känd begränsning: bekräftelsemejlets länk

Supabase's standardmall för "Confirm signup" länkar till Supabases egen
`/auth/v1/verify`-endpoint (`{{ .ConfirmationURL }}`), inte till vår
`/auth/confirm`-route. Det betyder att kontot blir bekräftat, men ingen
inloggningssession skapas i appen — användaren måste logga in manuellt
efter att ha klickat länken.

Rätt fix är att ändra mallens länk till:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard
```

**Detta går inte att göra på Supabase Free-planen** med inbyggd
mejlutskick — anpassade mejl-mallar kräver antingen en betald plan
eller en egen SMTP-leverantör (t.ex. Resend, som har en gratisnivå).

## Beslut 2026-07-25: vitlista istället för mejlbekräftelse

Appen är privat (familj), och mejlbekräftelse löser ändå inte "vem får
komma in" — den bevisar bara att någon äger mejladressen de skrev in, inte
att de är en betrodd person. Riktig åtkomstkontroll löses istället med en
"Before User Created" Auth Hook (`allowed_signup_emails`-tabellen +
`hook_restrict_signup_by_email`-funktionen, se migration
`20260725180000_signup_allowlist.sql`) som blockerar registrering för alla
mejladresser som inte finns i tabellen. Ägaren lägger till en adress i
förväg för att släppa in någon — inget mejl, ingen extern tjänst behövs.

I Supabase-dashboarden krävs utöver migrationen:
- **Authentication → Hooks**: aktivera "Before User Created", typ SQL,
  välj funktionen `hook_restrict_signup_by_email`.
- **Authentication → Sign In / Providers**: låt "Allow new users to sign
  up" vara påslagen (vitlistan sköter gate:ningen istället), men stäng av
  "Confirm email" — annars kan en whitelistad person ändå fastna i samma
  "email not confirmed"-problem som orsakade det här beslutet, eftersom
  Supabase gratis-SMTP inte pålitligt levererar till adresser utanför
  projektteamet.

## Att göra

- [x] Lösa "vem får skapa konto" — vitlista, se ovan (2026-07-25)
- [ ] Koppla en SMTP-leverantör (t.ex. Resend) om riktiga bekräftelsemejl
      ändå blir aktuellt senare, eller uppgradera Supabase-planen
- [ ] Uppdatera "Confirm signup"-mallen enligt ovan om det blir aktuellt
