#!/usr/bin/env bash
# =============================================================================
# Icônes PROVISOIRES de l'application (PWA) : « H » doré sur fond anthracite,
# aux couleurs de la charte. À REMPLACER par le logo officiel fourni par le
# client (même noms de fichiers, mêmes tailles). Prérequis : ImageMagick.
# =============================================================================
set -euo pipefail
DEST="$(cd "$(dirname "$0")/.." && pwd)/public/icones"
mkdir -p "$DEST"
POLICE=${POLICE:-DejaVu-Sans-Bold}

icone() { # taille, marge (fraction du côté laissée libre pour les icônes « maskable »), fichier
  local t=$1 zone=$2 f=$3
  local glyphe=$(( t * zone / 100 ))
  convert -size "${t}x${t}" xc:'#1f1f1f' \
    \( -size "${glyphe}x${glyphe}" -background none -fill '#e6c068' -font "$POLICE" -gravity center label:H \) \
    -gravity center -composite \
    -fill '#b8860b' -draw "rectangle $(( t*30/100 )),$(( t*50/100 + glyphe*45/100 )) $(( t*70/100 )),$(( t*50/100 + glyphe*45/100 + t/40 ))" \
    -strip "PNG32:$DEST/$f"
}

icone 192 62 icone-192.png
icone 512 62 icone-512.png
# « maskable » : le système peut rogner jusqu'à 20 % : glyphe plus petit.
icone 512 46 icone-maskable-512.png
icone 180 62 apple-touch-icon.png
echo "Icônes provisoires écrites dans $DEST"
