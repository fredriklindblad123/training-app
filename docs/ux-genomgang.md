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
| 2 | Hela appen | "Intervall" i Träningens tre växlar och träningsfaktorerna, "Intervaller" i passkategorier och planering | En passtyp ska heta en sak | Medel |
| 3 | Bottenmenyn | "Uppföljn" och "Inställn" är avhuggna mitt i ordet; alla andra flikar är hela ord | Hela ord, eller ett annat kortare ord | Medel |
| 4 | Hela appen | Fem formuleringar för tomt tillstånd: "Inget planerat", "inget planerat", "Inget planerat pass den här dagen.", "Inget planerat den här perioden.", "Ingen data i perioden." | En formulering per sorts tomhet | Låg |
| 5 | Dashboard | H1 är "Dashboard" | Alla andra vyer har svenskt substantiv: Form, Uppföljning, Resultat, Inställningar, Tävlingar | Låg |
| 6 | Dashboard | Belastning +57,6 % mot årets snitt visas i grönt som en förbättring | Ett stort belastningshopp är en risksignal, inte en prestation. Vilopuls +4,9 % flaggas gult, så systemet kan skilja | Att ta ställning till |

## Prövat och avfärdat

**"Distans" plus "Zon 4 — Tröskelarbete" på samma kort är ingen
motsägelse.** Det fanns med som en avvikelse i första utkastet. Ägaren
avfärdade den 2026-09-23, med rätta: kategorin säger vilken TYP av pass det
var, zonen säger hur hårt det BLEV. Två olika påståenden om samma pass, inte
två svar på samma fråga. Samma uppbyggnad som "Så gick passet"-kortet
medvetet använder.

Kvar står en smalare observation, om kalibrering snarare än konsekvens:
Garmins zon 4 heter "Tröskelarbete", men de 95 pass sedan juni 2026 där zon
4 dominerar har en snittpuls på 170 (spann 140–179), medan Alices egen
tröskelpuls är 183. Klockans zon 4 ligger alltså under hennes tröskel, och
etiketten säger något annat än hennes eget värde. Det är samma skäl som fick
formvyn att kringgå zonerna. Ingen åtgärd vidtagen — noterat.

---

## Nästa körning

Användbarhet: informationsordning, navigationslogik, ton mot adepten, och
vad som saknas respektive är överflödigt. Kör `/ux-genomgang anvandbarhet`.
