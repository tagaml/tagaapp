#!/bin/bash
# ---------------------------------------------------------------------------
# Taga — build local iOS (chauffeur + client) puis envoi automatique TestFlight.
#
#   ./build-testflight.sh
#
# Tout ce qui demande une saisie est fait AU DÉBUT. Ensuite le script tourne
# seul (~40-80 min) : tu peux fermer l'écran et partir. Le Mac est maintenu
# éveillé (caffeinate) et tout est journalisé dans build-testflight.log
# ---------------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "$0")"

LOG="build-testflight.log"
: > "$LOG"

log()  { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
fail() { echo "❌ $*" | tee -a "$LOG"; exit 1; }

echo "════════════════════════════════════════════"
echo "  Taga — build + TestFlight (chauffeur + client)"
echo "════════════════════════════════════════════"
echo

# --- 1. Pré-vol : tout ce qui peut bloquer, on le règle MAINTENANT ----------
command -v eas >/dev/null 2>&1 || fail "eas CLI introuvable. Installe-le : npm i -g eas-cli"
command -v xcodebuild >/dev/null 2>&1 || fail "Xcode introuvable (requis pour --local)."

eas whoami >/dev/null 2>&1 || fail "Pas connecté à EAS. Lance : eas login"
log "EAS : connecté en tant que $(eas whoami 2>/dev/null)"

# Apple ID (pour l'envoi TestFlight)
if [ -z "${EXPO_APPLE_ID:-}" ]; then
  read -r -p "Apple ID (email du compte développeur) : " EXPO_APPLE_ID
  [ -n "$EXPO_APPLE_ID" ] || fail "Apple ID vide."
fi
export EXPO_APPLE_ID

# Mot de passe application-spécifique (PAS ton mot de passe Apple normal).
# À créer sur https://appleid.apple.com → Connexion et sécurité → Mots de passe
# pour application. Format : xxxx-xxxx-xxxx-xxxx
if [ -z "${EXPO_APPLE_APP_SPECIFIC_PASSWORD:-}" ]; then
  echo
  echo "Mot de passe application-spécifique Apple (xxxx-xxxx-xxxx-xxxx)"
  echo "→ à créer sur https://appleid.apple.com (Connexion et sécurité)"
  read -r -s -p "Mot de passe : " EXPO_APPLE_APP_SPECIFIC_PASSWORD
  echo
  [ -n "$EXPO_APPLE_APP_SPECIFIC_PASSWORD" ] || fail "Mot de passe vide."
fi
export EXPO_APPLE_APP_SPECIFIC_PASSWORD

log "Apple ID : $EXPO_APPLE_ID (mot de passe app-spécifique fourni)"
echo
log "Pré-vol OK — tu peux partir, le script continue seul."
echo

# --- 2. Empêche le Mac de dormir pendant toute la durée ---------------------
caffeinate -dimsu -w $$ &
CAFF=$!
trap 'kill $CAFF 2>/dev/null' EXIT

# --- 3. Build + envoi, variante par variante -------------------------------
# On construit le CHAUFFEUR en premier : c'est lui qui porte les correctifs
# de session / présence en arrière-plan.
build_et_envoie() {
  local profil="$1" nom="$2"

  log "──────── $nom : build en cours (peut prendre 20-40 min) ────────"
  if ! eas build --platform ios --profile "$profil" --local --non-interactive >>"$LOG" 2>&1; then
    log "❌ $nom : ÉCHEC du build (voir $LOG)"
    return 1
  fi

  # Récupère l'.ipa le plus récent produit par ce build.
  local ipa
  ipa=$(ls -t ./*.ipa 2>/dev/null | head -1)
  [ -n "$ipa" ] || { log "❌ $nom : aucun .ipa trouvé après le build"; return 1; }
  log "✅ $nom : build OK → $ipa"

  log "──────── $nom : envoi vers TestFlight ────────"
  if ! eas submit --platform ios --profile "$profil" --path "$ipa" --non-interactive >>"$LOG" 2>&1; then
    log "❌ $nom : ÉCHEC de l'envoi TestFlight (l'.ipa existe : $ipa)"
    return 1
  fi
  log "🚀 $nom : envoyé sur TestFlight ($ipa)"
  return 0
}

RESULTAT=""
build_et_envoie "chauffeur-production" "CHAUFFEUR" \
  && RESULTAT+="chauffeur ✅  " || RESULTAT+="chauffeur ❌  "
build_et_envoie "client-production" "CLIENT" \
  && RESULTAT+="client ✅" || RESULTAT+="client ❌"

# --- 4. Bilan + notification macOS -----------------------------------------
echo
log "════════ TERMINÉ — $RESULTAT ════════"
log "Journal complet : $(pwd)/$LOG"
osascript -e "display notification \"$RESULTAT\" with title \"Taga — build TestFlight terminé\"" 2>/dev/null

echo
echo "Apple met ensuite quelques minutes à « traiter » chaque build"
echo "avant qu'il apparaisse dans TestFlight."
