# Träningsapp – medeldistans friidrott

Webbapp (responsiv + PWA) för medeldistanslöpare. Fungerar på både dator och mobil.

## Kärnfunktioner

- **Garmin-integration**: hämta träningsdata via Garmin Connect API (kräver godkänd
  utvecklaråtkomst från Garmin — verifiera detta tidigt, se `docs/garmin-api.md`)
- **Kalender**: översikt över tränings pass
- **Träningsdagbok**: egna noteringar per pass/dag
- **Långsiktig planering**: periodiseringsplan mot ett mål (t.ex. en tävling om ett år)
- **AI-förslag**: träningsförslag baserat på referensmaterial (t.ex. inladdad PDF från
  Andreas Almgren) via RAG (Retrieval Augmented Generation)

## Tänkt teknikstack

- **Frontend**: Next.js/React, responsiv + PWA
- **Backend**: Next.js API-routes / serverless-funktioner
- **Databas**: Supabase (Postgres + auth + filuppladdning + pgvector för RAG)
- **Hosting**: Vercel (kod på GitHub, deploy därifrån)
- **AI**: Anthropic API (egen API-nyckel, separat från Claude.ai-abonnemang)

## Status

Projektet är i planeringsfas. Se `docs/` för delbeslut och utredningar.

## Öppna frågor

- [ ] Garmin Connect API – ansöka om utvecklaråtkomst, undersöka godkännandekrav
- [ ] Datamodell för träningspass, mål, dagbok
- [ ] Val av vektordatabas/RAG-upplägg för referensmaterial
