#!/bin/bash
# ---------------------------------------------------------------------------
# Taga — build local ANDROID (chauffeur + client) en AAB, puis envoi Play Store.
#
#   ./build-android.sh            # build + envoi Play Store (AAB)
#   ./build-android.sh --no-send  # build seulement (les .aab restent ici)
#
# AAB, pas APK : le Play Store n'accepte plus les APK pour une nouvelle version.
# (Pour un test rapide sur un téléphone, utilise plutôt les profils *-preview,
#  qui produisent un APK installable directement — voir la note en bas.)
#
# Tout ce qui demande une saisie est fait AU DÉBUT. Ensuite le script tourne
# seul (~20-40 min) : tu peux partir. Journal complet dans build-android.log
# ---------------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "$0")"

LOG="build-android.log"
: > "$LOG"
ENVOYER=1
[ "${1:-}" = "--no-send" ] && ENVOYER=0

log()  { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
fail() { echo "❌ $*" | tee -a "$LOG"; exit 1; }

echo "════════════════════════════════════════════"
echo "  Taga — build Android AAB (chauffeur + client)"
echo "════════════════════════════════════════════"
echo

# --- 1. Pré-vol : tout ce qui peut bloquer, on le règle MAINTENANT ----------
command -v eas >/dev/null 2>&1 || fail "eas CLI introuvable. Installe-le : npm i -g eas-cli"
eas whoami >/dev/null 2>&1 || fail "Pas connecté à EAS. Lance : eas login"
log "EAS : connecté en tant que $(eas whoami 2>/dev/null)"

# Un JDK est nécessaire pour compiler en local (Android Studio en installe un).
if ! command -v java >/dev/null 2>&1; then
  fail "Java introuvable. Installe un JDK 17 :  brew install --cask zulu@17"
fi
log "Java : $(java -version 2>&1 | head -1)"

# Le SDK Android doit être visible.
if [ -z "${ANDROID_HOME:-}" ] && [ -z "${ANDROID_SDK_ROOT:-}" ]; then
  if [ -d "$HOME/Library/Android/sdk" ]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
    log "ANDROID_HOME déduit : $ANDROID_HOME"
  else
    fail "SDK Android introuvable. Installe Android Studio, puis :
      export ANDROID_HOME=\$HOME/Library/Android/sdk"
  fi
fi

if [ "$ENVOYER" = "1" ]; then
  # La clé de service Google Play sert à envoyer l'AAB automatiquement.
  # (Play Console → Configuration → Accès API → compte de service → clé JSON)
  CLE=$(python3 - <<'PY' 2>/dev/null
import json
try:
    d = json.load(open('eas.json'))
    s = d.get('submit', {}).get('production', {}).get('android', {})
    print(s.get('serviceAccountKeyPath', ''))
except Exception:
    print('')
PY
)
  if [ -z "$CLE" ] || [ ! -f "$CLE" ]; then
    echo
    echo "⚠️  Pas de clé de service Google Play configurée."
    echo "   Le build va se faire, mais PAS l'envoi : tu déposeras les .aab à la main"
    echo "   sur play.google.com/console (Production → Créer une version)."
    echo
    read -r -p "Continuer sans envoi automatique ? [O/n] " REP
    [ "${REP:-O}" = "n" ] && exit 0
    ENVOYER=0
  else
    log "Clé Google Play : $CLE"
  fi
fi

echo
log "Pré-vol OK — tu peux partir, le script continue seul."
echo

# --- 2. Empêche le Mac de dormir pendant toute la durée ---------------------
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -dimsu -w $$ &
  CAFF=$!
  trap 'kill $CAFF 2>/dev/null' EXIT
fi

# --- 3. Build (+ envoi), variante par variante ------------------------------
# Le CHAUFFEUR d'abord : c'est lui qui porte les correctifs de dispatch,
# de présence en arrière-plan et de compteur d'attente.
build_et_envoie() {
  local profil="$1" nom="$2"

  log "──────── $nom : build AAB en cours (20-40 min) ────────"
  if ! eas build --platform android --profile "$profil" --local --non-interactive >>"$LOG" 2>&1; then
    log "❌ $nom : ÉCHEC du build (voir $LOG)"
    return 1
  fi

  local aab
  aab=$(ls -t ./*.aab 2>/dev/null | head -1)
  [ -n "$aab" ] || { log "❌ $nom : aucun .aab trouvé après le build"; return 1; }

  # On renomme, sinon le build suivant écrase le précédent.
  local final="taga-${nom,,}-$(date +%Y%m%d-%H%M).aab"
  mv "$aab" "$final"
  log "✅ $nom : build OK → $final"

  if [ "$ENVOYER" = "1" ]; then
    log "──────── $nom : envoi vers Google Play ────────"
    if ! eas submit --platform android --profile "$profil" --path "$final" --non-interactive >>"$LOG" 2>&1; then
      log "❌ $nom : ÉCHEC de l'envoi (l'AAB existe : $final)"
      return 1
    fi
    log "🚀 $nom : envoyé sur Google Play ($final)"
  fi
  return 0
}

RESULTAT=""
build_et_envoie "chauffeur-production" "CHAUFFEUR" \
  && RESULTAT+="chauffeur ✅  " || RESULTAT+="chauffeur ❌  "
build_et_envoie "client-production" "CLIENT" \
  && RESULTAT+="client ✅" || RESULTAT+="client ❌"

# --- 4. Bilan ---------------------------------------------------------------
echo
log "════════ TERMINÉ — $RESULTAT ════════"
log "Journal complet : $(pwd)/$LOG"
ls -1t ./*.aab 2>/dev/null | head -2 | while read -r f; do log "   → $f"; done
command -v osascript >/dev/null 2>&1 && \
  osascript -e "display notification \"$RESULTAT\" with title \"Taga — build Android terminé\"" 2>/dev/null

echo
echo "Note : pour installer directement sur un téléphone de test (APK, pas AAB) :"
echo "  eas build --platform android --profile chauffeur-preview --local"
