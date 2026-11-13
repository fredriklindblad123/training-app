#!/usr/bin/env bash
# Bygger IFK-urtavlan, en fil per klockmodell.
#
#   ./build.sh                  # alla modeller i manifest.xml
#   ./build.sh fenix6pro fr255s # bara dessa
#
# Filerna hamnar i bin/ifk-<modell>.prg. Samma fil fungerar för alla med
# samma modell — urtavlan hämtar ingenting och har ingen nyckel.
#
# Kräver Connect IQ SDK och en utvecklarnyckel i developer_key.der — se
# README.md.
set -euo pipefail
cd "$(dirname "$0")"

# Java och SDK installerade i ~/.ciq-tools (README.md) hittas utan PATH-ändring.
TOOLS="$HOME/.ciq-tools"
if [ -d "$TOOLS/jdk/Contents/Home" ]; then
  export JAVA_HOME="$TOOLS/jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
sdk_bin=$(ls -d "$TOOLS"/sdk/connectiq-sdk-*/bin 2>/dev/null | tail -1 || true)
[ -n "$sdk_bin" ] && export PATH="$sdk_bin:$PATH"

command -v monkeyc >/dev/null || { echo "monkeyc saknas — installera Connect IQ SDK, se README.md"; exit 1; }
[ -f developer_key.der ] || { echo "developer_key.der saknas — se README.md"; exit 1; }
devdir="$HOME/Library/Application Support/Garmin/ConnectIQ/Devices"

if [ $# -gt 0 ]; then
  devices=("$@")
else
  devices=($(grep -o 'product id="[^"]*"' manifest.xml | cut -d'"' -f2))
fi

mkdir -p bin
for d in "${devices[@]}"; do
  if [ ! -f "$devdir/$d/compiler.json" ]; then
    echo "· $d hoppas över — inte nedladdad i SdkManager"
    continue
  fi
  echo "→ ifk-${d}"
  monkeyc -f monkey.jungle -d "$d" -y developer_key.der -o "bin/ifk-${d}.prg" -w
done
rm -f bin/*.debug.xml
echo "Klart: $(ls bin/ifk-*.prg 2>/dev/null | wc -l | tr -d ' ') filer i bin/"
