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
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/calendar
```

**Detta går inte att göra på Supabase Free-planen** med inbyggd
mejlutskick — anpassade mejl-mallar kräver antingen en betald plan
eller en egen SMTP-leverantör (t.ex. Resend, som har en gratisnivå).

## Att göra

- [ ] Koppla en SMTP-leverantör (t.ex. Resend) för att kunna anpassa
      mejl-mallen, eller uppgradera Supabase-planen
- [ ] Uppdatera "Confirm signup"-mallen enligt ovan när det är löst
