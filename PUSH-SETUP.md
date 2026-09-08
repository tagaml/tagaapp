# Taga — Activer les vraies notifications push (FCM Android + APNs iOS)

Tout le code est prêt : `send-push` (v4) envoie via Expo, les triggers (commande, chat, géofence, dispatch) l'appellent, et l'app enregistre le `push_token` dans `profiles.push_token`. **Il reste UNIQUEMENT à brancher les canaux réels FCM et APNs** dans EAS. Sans ça, Expo répond « ok » mais personne ne reçoit rien.

> ⚠️ **Deux apps distinctes** : `ml.taga.app` (client) et `ml.taga.chauffeur` (chauffeur).
> → **2 apps Firebase Android** (une par package) et **1 seule clé APNs** (elle couvre tous tes bundle IDs iOS).

---

## Section A — Firebase / FCM (Android)

À répéter **pour chaque app** : d'abord `ml.taga.app`, puis `ml.taga.chauffeur`.

1. Va sur https://console.firebase.google.com → **Créer un projet** nommé **Taga** (un seul projet Firebase suffit, tu y ajouteras les 2 apps).
2. Dans le projet → **Ajouter une app → Android** :
   - App **client** : nom du package **`ml.taga.app`**.
   - Refais l'ajout pour l'app **chauffeur** : package **`ml.taga.chauffeur`**.
3. Télécharge les deux fichiers `google-services.json` et place-les à la **racine du repo mobile** en les renommant :
   - client → **`google-services.client.json`**
   - chauffeur → **`google-services.chauffeur.json`**
   *(app.config.js pointe déjà dessus ; ils sont ignorés par git — ne les commite pas.)*
4. Uploade la clé serveur FCM dans EAS (une fois par variante) :
   ```bash
   eas credentials --platform android            # profil client
   #   → « Google Service Account Key for Push Notifications (FCM V1) » → uploade le JSON du compte de service
   APP_VARIANT=chauffeur eas credentials --platform android   # profil chauffeur
   ```
   Le « Service account JSON » se récupère dans Firebase → **Paramètres du projet → Comptes de service → Générer une nouvelle clé privée**.
5. Rebuild :
   ```bash
   eas build --platform android --profile client-production
   eas build --platform android --profile chauffeur-production
   ```
6. Installe l'AAB/APK sur un device, ouvre l'app, connecte-toi → vérifie dans Supabase :
   ```sql
   select id, push_token, push_variant from profiles where push_token is not null order by updated_at desc;
   ```
7. Envoie une push test depuis https://expo.dev/notifications (colle le `push_token`, titre + corps) → elle doit arriver.

---

## Section B — APNs (iOS)

**Une seule clé `.p8` couvre client + chauffeur.**

1. Va sur https://developer.apple.com/account (accepte le **PLA** à jour si demandé).
2. **Certificates, Identifiers & Profiles → Keys → +** :
   - Coche **Apple Push Notifications service (APNs)**.
   - Crée, **télécharge le `.p8`** (téléchargeable **une seule fois**).
   - Note le **Key ID** (10 caractères) et ton **Team ID** (10 caractères, en haut à droite du compte).
3. Vérifie que les **App IDs** `ml.taga.app` et `ml.taga.chauffeur` ont la capability **Push Notifications** activée (EAS le fait en général automatiquement).
4. Uploade la clé dans EAS :
   ```bash
   eas credentials --platform ios
   #   → « Push Notifications: Manage your Apple Push Notifications Key »
   #   → uploade le .p8 + Key ID + Team ID (réutilise la même clé pour la variante chauffeur)
   ```
5. Rebuild :
   ```bash
   eas build --platform ios --profile client-production
   eas build --platform ios --profile chauffeur-production
   ```
6. Installe sur un **vrai iPhone** (jamais le simulateur pour APNs), accepte la permission notifications → vérifie `profiles.push_token` (même requête SQL que Section A, étape 6).
7. Push test via https://expo.dev/notifications.

---

## Section C — Sanity checks après setup

1. **Flow commande complet** : crée une commande → le resto accepte (`preparation`) → `prete` → le coursier récupère (`livraison`) → il approche à < 100 m du client (géofence) → `livree`. Tu dois recevoir **5 push** dans l'ordre.
2. **Chat** : envoie un message au coursier → push `💬 [prénom]` ; **tape la notif** → elle ouvre la bonne conversation (deep link).
3. **Demande urgente chauffeur** : passe un chauffeur en ligne, crée une course proche → il reçoit « Nouvelle course » sur le canal `urgent` (son fort).
4. **Token bien enregistré** : à chaque connexion, `profiles.push_token` se remplit (Section A étape 6).

---

## Section D — Debug si ça ne marche pas

- **Logs edge** : `supabase functions logs send-push` (voir chaque appel + réponse Expo).
- **Appels des triggers** : `select id, status_code, left(content,160) from net._http_response order by id desc limit 10;` (doit montrer HTTP 200).
- **Tokens Expo** : la réponse Expo est dans `content` (`{"data":{"status":"ok"}}` = bon).
- **Erreurs Expo courantes** :
  - `InvalidCredentials` → clé FCM/APNs mal uploadée ou expirée (refais `eas credentials`).
  - `DeviceNotRegistered` → l'app a été désinstallée ou la permission refusée ; `send-push` **purge automatiquement** le token (`profiles.push_token = null`).
  - `MessageRateExceeded` → trop d'envois ; le throttle chat (15 s) limite déjà ce risque.
- **Rien ne part alors que HTTP 200 + pushed:false** → le user n'a **pas** de `push_token` (permission refusée, ou build sans credentials, ou Expo Go).

---

## Rappels techniques (déjà en place, ne rien changer)

- `send-push` v4 : `priority:'high'`, `channelId` déduit du type (`orders` / `default` / `urgent`), purge `DeviceNotRegistered`, flag `record` anti-doublon.
- Canaux Android créés dans `lib/notify.ts` : `default`, `orders`, `urgent` (+ `taga` historique).
- `aps-environment: production` dans `app.json` (entitlements iOS).
- `expo-notifications` dans les plugins ; `googleServicesFile` par variante dans `app.config.js`.
- Un `push_token` par user dans `profiles` (pas de table multi-device).
