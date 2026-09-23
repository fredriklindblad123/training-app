# UX-genomgång

Genomgång av Träningsnavets gränssnitt, renderat i webbläsare. Första
körningen: konsekvens. Gjord 2026-09-23 mot dev-servern, inloggad som
coach, alla vyer i 1280 px och 390 px, ljust och mörkt läge.

Målgrupp: den som implementerar. Inventering — inget är rättat här utom
det som visade sig vara en regression.

---

## Vad som höll

- **Ingen sidoscroll i någon vy**, varken i 390 px eller 1280 px. Fixen
  från 2026-09-14 håller i hela appen.
- **Inga konsolfel** utom en avbruten begäran vid navigering.
- Färgsystemen (`--cat-*`, `--day-*`, `--status-*`) används genomgående
  rätt efter genomgången 2026-09-21. Sjuk är gult och skadad rött överallt.
- Uppföljningens nya kolumner (Frånvaro, Distanspass) renderar rätt med
  riktig data, och tomma löpare faller inte ur tabellen.

## Regression, rättad i samband med genomgången

**Uppföljning öppnade på fel period.** Vyn visade "Tävlingsperiod 2026 Aug"
som förvald, en period som tog slut 30 augusti, trots att villkoret skulle
vara att idag ligger i ett block. Orsak: ändringen som införde
`todayInBlock` applicerades aldrig — ett `cd` misslyckades, skriptet kördes
aldrig, och typkontrollen efteråt gick igenom eftersom den gamla koden var
giltig. Grönt bygge bekräftar inte att en ändring landat.

Rättad och verifierad i körande app: vyn öppnar nu på V.39.

## Avvikelser att ta ställning till

| # | Vy | Avvikelse | Norm | Allvar |
|---|---|---|---|---|
| 1 | Dashboard | Dagens pass visar "Distans" och direkt under "Pulszon: Zon 4 — Tröskelarbete · 71 % av tiden" | Formvyn kringgår Garmins zoner helt, för de är opålitliga i det här materialet (68,4 % "tröskel" mot 67,2 % gråzon mätt på %max) | Hög |
| 2 | Hela appen | "Intervall" i Träningens tre växlar och träningsfaktorerna, "Intervaller" i passkategorier och planering | En passtyp ska heta en sak | Medel |
| 3 | Bottenmenyn | "Uppföljn" och "Inställn" är avhuggna mitt i ordet; alla andra flikar är hela ord | Hela ord, eller ett annat kortare ord | Medel |
| 4 | Hela appen | Fem formuleringar för tomt tillstånd: "Inget planerat", "inget planerat", "Inget planerat pass den här dagen.", "Inget planerat den här perioden.", "Ingen data i perioden." | En formulering per sorts tomhet | Låg |
| 5 | Dashboard | H1 är "Dashboard" | Alla andra vyer har svenskt substantiv: Form, Uppföljning, Resultat, Inställningar, Tävlingar | Låg |
| 6 | Dashboard | Belastning +57,6 % mot årets snitt visas i grönt som en förbättring | Ett stort belastningshopp är en risksignal, inte en prestation. Vilopuls +4,9 % flaggas gult, så systemet kan skilja | Att ta ställning till |

### Om nummer 1

Det är samma motsägelse som rapporterades 2026-09-13 ("reggats som lugn
distans, men tittar man i passet står det tröskel"), i en annan skepnad.
Kategorin kommer från appens egen klassificering, pulszonen från klockan,
och de säger olika saker om samma pass på samma kort. Antingen ska zonen
bort, eller så ska den förklaras som klockans uppfattning och inte appens.

---

## Nästa körning

Användbarhet: informationsordning, navigationslogik, ton mot adepten, och
vad som saknas respektive är överflödigt. Kör `/ux-genomgang anvandbarhet`.
