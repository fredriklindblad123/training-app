#!/usr/bin/env bash
# Bygger IFK-urtavlan för en adept, en fil per klockmodell.
#
#   ./build.sh <namn> <klocknyckel> [modell ...]
#
#   ./build.sh alice Xy3...   # alla modeller i manifest.xml
#   ./build.sh nike Ab9... fenix6 fr255s
#
# Klocknyckeln skapas i appen under Inställningar → Klocka. Den byggs in i
# filen, eftersom urtavlor som kopieras över med USB inte kan få inställningar
# från telefonen. Filerna hamnar i bin/<namn>-<modell>.prg.
#
# Kräver Connect IQ SDK (monkeyc på PATH) och en utvecklarnyckel i
# developer_key.der — se README.md.
set -euo pipefail
cd "$(dirname "$0")"

if [ $# -lt 2 ]; then
  sed -n '2,15p' "$0"
  exit 1
fi
name="$1"; token="$2"; shift 2

# Java och SDK installerade i ~/.ciq-tools (README.md) hittas utan PATH-ändring.
TOOLS="$HOME/.ciq-tools"
if [ -d "$TOOLS/jdk/Contents/Home" ]; then
  export JAVA_HOME="$TOOLS/jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
sdk_bin=$(ls -d "$TOOLS"/sdk/connectiq-sdk-*/bin 2>/dev/null | tail -1 || true)
[ -n "$sdk_bin" ] && export PATH="$sdk_bin:$PATH"

command -v monkeyc >/dev/null || { echo "monkeyc saknas — installera Connect IQ SDK, se README.md"; exit 1; }
devdir="$HOME/Library/Application Support/Garmin/ConnectIQ/Devices"
[ -d "$devdir" ] || { echo "Klockmodellerna saknas — öppna SdkManager, logga in och ladda ner dem (README.md)"; exit 1; }
[ -f developer_key.der ] || { echo "developer_key.der saknas — se README.md"; exit 1; }

if [ $# -gt 0 ]; then
  devices=("$@")
else
  devices=($(grep -o 'product id="[^"]*"' manifest.xml | cut -d'"' -f2))
fi

mkdir -p source-token bin
cat > source-token/Token.mc <<MC
// Genererad av build.sh för ${name}. Checkas aldrig in.
(:background)
module Token {
    const VALUE = "${token}";
}
MC

for d in "${devices[@]}"; do
  echo "→ ${name}-${d}"
  monkeyc -f monkey.jungle -d "$d" -y developer_key.der -o "bin/${name}-${d}.prg" -w
done
echo "Klart: $(ls bin/${name}-*.prg | wc -l | tr -d ' ') filer i bin/"
