# IFK-urtavlan

Garmin-urtavla för Träningsnavets adepter: IFK:s emblem, tiden, datum och
**dagens pass** från appen. Byggd med Connect IQ (Monkey C) för fenix 5,
fenix 6 och Forerunner 255 med varianter (se `manifest.xml`).

```
┌─────────────────┐
│      [IFK]      │   emblemet
│      14:32      │   tiden
│    lör 1/11     │   datum
│      IDAG       │
│ Tröskel 6x3min  │   dagens pass, hämtas var 15:e min
└─────────────────┘
```

## Hur det hänger ihop

- Varje adept har en **klocknyckel**, som skapas i appen under
  *Inställningar → Klocka*. Nyckeln visas bara när den skapas.
- `build.sh` bygger in nyckeln i urtavlan. Det behövs eftersom urtavlor som
  kopieras över med USB inte kan få inställningar från telefonen. **Varje adept
  får alltså en egen fil.**
- Urtavlan hämtar `GET /api/watch/today?token=…` (Python-API:t,
  `web/api/index.py`) ungefär var 15:e minut, via Garmin Connect-appen i
  telefonen. Svaret är dagens planerade pass, till exempel
  `{"date": "2026-11-01", "text": "Tröskel 6x3min"}`.
- En ny nyckel i appen ersätter den gamla. En urtavla byggd med den gamla
  slutar då hämta, vilket är rätt om en klocka bytt ägare eller kommit bort.

## Engångsinstallation (på datorn som bygger)

Det mesta är redan gjort på Fredriks dator (2026-11-01):

- **Java** (Temurin 17) och **Connect IQ SDK 9.3.0** ligger i `~/.ciq-tools`.
  `build.sh` hittar dem själv — ingen PATH-ändring behövs.
- **Utvecklarnyckeln** finns i den här mappen (`developer_key.der`, checkas
  aldrig in). Tappas den bort: skapa en ny med
  ```
  openssl genrsa -out developer_key.pem 4096
  openssl pkcs8 -topk8 -inform PEM -outform DER -in developer_key.pem -out developer_key.der -nocrypt
  ```
  och bygg om alla klockors filer.
- **SDK Manager** ligger i `~/Applications/SdkManager.app`.

Kvar är ett steg som kräver ett Garmin-konto och därför inte går att göra
automatiskt: **klockmodellernas definitionsfiler**. Garmin lämnar bara ut dem
efter inloggning.

1. Öppna `~/Applications/SdkManager.app` och logga in med ett Garmin-konto
   (samma som till Garmin Connect duger).
2. Under **Devices**, ladda ner: fenix 5, 5S, 5X, 5 Plus, 5S Plus, 5X Plus,
   fenix 6, 6S, 6 Pro, 6S Pro, 6X Pro, Forerunner 255, 255 Music, 255S, 255S
   Music. Fler modeller går att lägga till i `manifest.xml` senare.
3. Klart. Filerna hamnar i `~/Library/Application Support/Garmin/ConnectIQ/Devices`,
   där `build.sh` hittar dem.

## Bygga för en adept

1. Skapa adeptens nyckel i appen: *Inställningar → Klocka → Skapa nyckel*.
   Kopiera den.
2. Bygg, för hennes klockmodell eller alla:
   ```
   ./build.sh nike <nyckel> fenix6
   ./build.sh alice <nyckel>            # alla modeller
   ```
   Filerna hamnar i `bin/<namn>-<modell>.prg`.
3. Valfritt: prova i simulatorn först med `connectiq` och sedan
   `monkeydo bin/nike-fenix6.prg fenix6`.

## Kopiera över till klockan

1. Koppla klockan till datorn med USB-kabeln.
2. Kopiera `.prg`-filen till mappen **GARMIN/APPS** på klockan.
   - fenix 5 syns som en vanlig disk i Finder.
   - fenix 6 och Forerunner 255 använder MTP och syns **inte** i Finder på
     Mac — använd det kostnadsfria programmet *OpenMTP*.
3. Koppla ur. På klockan: håll in *Upp*/*Light* → *Urtavla* → välj
   *IFK Träningsnavet*.
4. Klockan måste vara parkopplad med Garmin Connect-appen i telefonen för att
   hämta dagens pass. Första hämtningen kan dröja upp till 15 minuter; fram
   till dess står det "Hämtar...".

Att det fungerar syns i appen: under *Inställningar → Klocka* står
"klockan hämtade senast …".

## Fallgropar

- **Byggd och provad i simulatorn** för alla elva fenix 5/6-modeller
  (2026-11-01). Forerunner 255-modellerna var inte nedladdade då — bygg dem
  när de finns i SDK Manager. Ännu inte provad på en riktig klocka.
- **Garmin-identiteter för modeller** i `manifest.xml` måste matcha de
  enheter som är nedladdade i SDK Manager. Saknas en modell där, ta bort den
  ur manifestet eller ladda ner den.
- **fenix 5 (utan Plus)** har äldst mjukvara. Kräver Connect IQ 3.0, vilket
  klockan har med senaste uppdateringen. Uppdatera klockan via Garmin Express
  om bygget vägrar.
- **Text som inte får plats** kortas med "..." i API:t (max 48 tecken) och
  radbryts på klockan.
