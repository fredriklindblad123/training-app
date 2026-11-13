# IFK-urtavlan

Garmin-urtavla med IFK:s emblem stort i mitten, tiden ovanför och datumet
under. Byggd med Connect IQ (Monkey C) för fenix 5, fenix 6 och Forerunner
255 med varianter (se `manifest.xml`).

```
┌─────────────────┐
│      14:32      │   tiden
│      [IFK]      │   emblemet, halva skärmhöjden
│      [IFK]      │
│    lör 1/11     │   datum
└─────────────────┘
```

Urtavlan hämtar ingenting: ingen nätverkstrafik och ingen nyckel. Samma fil
fungerar därför för alla med samma klockmodell. (2026-11-01 visade den även
dagens pass från Träningsnavet; borttaget 2026-11-02 på begäran.)

Emblemet finns i en storlek per skärm (`resources-round-218x218` …
`280x280`), skalat ur `web/public/ifk-logga.png`.

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

## Bygga

```
./build.sh                  # alla modeller
./build.sh fenix6pro        # bara en
```

Filerna hamnar i `bin/ifk-<modell>.prg`. Modeller som inte är nedladdade i
SdkManager hoppas över.

## Kopiera över till klockan

1. Koppla klockan till datorn med USB-kabeln.
2. Kopiera `.prg`-filen till mappen **GARMIN/APPS** på klockan.
   - fenix 5 syns som en vanlig disk i Finder.
   - fenix 6 och Forerunner 255 använder MTP och syns **inte** i Finder på
     Mac — använd det kostnadsfria programmet *OpenMTP*.
3. Koppla ur. På klockan: håll in *Upp*/*Light* → *Urtavla* → välj
   *IFK Träningsnavet*.
4. Syns inte klockan i OpenMTP: på klockan, håll in *Up/Menu* →
   *Inställningar* → *System* → *USB-läge* → **MTP**.
5. Byt ut en äldre version: ta bort den gamla `.prg`-filen i GARMIN/APPS
   först, rör inget annat där.

## Fallgropar

- **Provad på riktig klocka**: fēnix 6 Pro (2026-11-02). Alla 15 modeller
  bygger utan fel.
- **Garmin-identiteter för modeller** i `manifest.xml` måste matcha de
  enheter som är nedladdade i SDK Manager. Saknas en modell där, ta bort den
  ur manifestet eller ladda ner den.
- **fenix 5 (utan Plus)** har äldst mjukvara. Kräver Connect IQ 3.0, vilket
  klockan har med senaste uppdateringen. Uppdatera klockan via Garmin Express
  om bygget vägrar.
