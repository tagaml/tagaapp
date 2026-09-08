# Guide — OTP WhatsApp pour Taga (inscription + mot de passe oublié)

Ce guide te fait passer de **zéro** à un OTP WhatsApp fonctionnel. Le code (app + serveur) est déjà prêt ; il te reste à configurer **Meta** et à coller **5 secrets** dans Supabase.

Ordre conseillé : 1) numéro + template, 2) token, 3) paiement + publication, 4) secrets Supabase, 5) déploiement, 6) test.

---

## 1. Prérequis (côté Meta)

1. Un compte **Meta Business** (business.facebook.com).
2. Sur **developers.facebook.com** → *Mes applications* → crée une app **type « Entreprise »** (ou ouvre la tienne).
3. Ajoute le produit **WhatsApp** à l'app (bouton « Configurer »). C'est l'écran de ta capture.

---

## 2. Enregistrer le numéro d'envoi

Dans **WhatsApp → Configuration de base** (ta capture) :

- Section **« Enregistrez votre numéro de téléphone WhatsApp »** : ajoute le numéro qui **enverra** les codes (un numéro dédié Taga, PAS ton WhatsApp perso — un numéro ne peut pas être à la fois sur l'app WhatsApp normale et sur l'API).
- Pour **tester tout de suite**, Meta te donne un **numéro de test** gratuit et te laisse ajouter jusqu'à 5 **numéros destinataires de test** (les tiens) sans publier l'app.
- Note le **« ID du numéro de téléphone »** (*Phone Number ID*) affiché → c'est le secret **`WHATSAPP_PHONE_NUMBER_ID`**.

---

## 3. Créer le template d'authentification (OBLIGATOIRE)

WhatsApp interdit d'envoyer un texte libre à un utilisateur : il faut un **modèle approuvé**. Pour un OTP, on utilise la catégorie **Authentication** (approbation quasi instantanée).

1. Va sur **WhatsApp Manager** → **Modèles de messages** → **Créer un modèle**.
2. Catégorie : **Authentification**.
3. Nom : **`taga_otp`** (ce sera le secret `WHATSAPP_TEMPLATE_NAME`).
4. Langue : **Français** (`fr`) — ce sera `WHATSAPP_TEMPLATE_LANG`. (Si tu choisis « Anglais (US) », mets `en_US`.)
5. Contenu : coche **« Copier le code »** (bouton copier). Le corps est standardisé, par ex. :
   > *« <#> est votre code de vérification. Pour votre sécurité, ne le partagez pas. »*
6. Soumets. L'approbation prend de quelques secondes à quelques minutes.

> Important : le nom (`taga_otp`) et la langue (`fr`) doivent correspondre EXACTEMENT aux secrets Supabase.

---

## 4. Obtenir un token d'accès

Deux options :

**A. Token de test (rapide, expire en 24 h)** — pour valider tout de suite.
WhatsApp → Configuration de base → **Token d'accès temporaire**. Copie-le.

**B. Token permanent (pour la production)** — via un **utilisateur système** :
1. business.facebook.com → **Paramètres d'entreprise** → **Utilisateurs → Utilisateurs système** → **Ajouter** (rôle *Admin*).
2. **Générer un nouveau token** → choisis l'app → permissions **`whatsapp_business_messaging`** et **`whatsapp_business_management`**.
3. Assigne l'**actif** WhatsApp (WABA) à cet utilisateur système.
4. Copie le token (il ne réexpire pas). → secret **`WHATSAPP_TOKEN`**.

---

## 5. Moyen de paiement + publication

- Section **« Ajoutez un moyen de paiement »** (ta capture) : ajoute une carte. WhatsApp offre **1 000 conversations/mois gratuites** ; au-delà c'est facturé (les OTP sont peu chers). Sans carte, tu restes en mode test (5 numéros).
- **Publier l'application** : nécessaire pour envoyer à de **vrais** numéros (hors les 5 de test). developers.facebook.com → ton app → bascule **« En direct »** (peut demander une vérification d'entreprise).

---

## 6. Coller les 5 secrets dans Supabase

Supabase → ton projet → **Edge Functions → Secrets** (ou CLI). Ajoute :

| Secret | Valeur |
|---|---|
| `WHATSAPP_TOKEN` | le token de l'étape 4 |
| `WHATSAPP_PHONE_NUMBER_ID` | l'ID du numéro (étape 2) |
| `WHATSAPP_TEMPLATE_NAME` | `taga_otp` |
| `WHATSAPP_TEMPLATE_LANG` | `fr` |
| `OTP_PEPPER` | une longue chaîne aléatoire secrète (ex. sortie de `openssl rand -hex 32`) |

En CLI :
```bash
supabase secrets set WHATSAPP_TOKEN="EAAG..." WHATSAPP_PHONE_NUMBER_ID="123456789" \
  WHATSAPP_TEMPLATE_NAME="taga_otp" WHATSAPP_TEMPLATE_LANG="fr" \
  OTP_PEPPER="$(openssl rand -hex 32)"
```
(`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont déjà fournis automatiquement aux Edge Functions.)

---

## 7. Déployer les Edge Functions

```bash
cd ~/Documents/taga
supabase functions deploy whatsapp-send-otp
supabase functions deploy whatsapp-verify-otp
```
La table `otp_codes` et la fonction `auth_uid_by_email` sont **déjà en base** (migration lot23).

---

## 8. (Optionnel) Webhook — « URL de rappel » + « Vérifier le token »

**Pas nécessaire pour envoyer les OTP.** Utile seulement si tu veux les **accusés de réception**. Si tu le veux plus tard, je te crée une petite Edge Function `whatsapp-webhook` :
- **URL de rappel** = `https://dquzsztxjsvwjefgztrh.supabase.co/functions/v1/whatsapp-webhook`
- **Vérifier le token** = une chaîne secrète que tu choisis (à mettre aussi en secret `WHATSAPP_VERIFY_TOKEN`).

Pour l'instant, **laisse cette section vide** et passe à la suite.

---

## 9. Tester

1. App en mode test : ajoute ton propre numéro dans les **numéros de test** WhatsApp.
2. Dans l'app Taga : **Créer un compte** → tu reçois un code WhatsApp → saisis-le → compte créé et connecté.
3. **Mot de passe oublié** → numéro → code WhatsApp → nouveau mot de passe → connecté.

Si le code n'arrive pas : vérifie (a) le template **approuvé**, (b) le numéro destinataire **dans la liste de test** (tant que l'app n'est pas publiée), (c) les 5 secrets, (d) les **logs** de `whatsapp-send-otp` (Supabase → Edge Functions → Logs) — l'erreur exacte de Meta y apparaît.

---

## Ce qui est déjà fait (côté Taga)

- **Base** : table `otp_codes` (codes hashés, RLS service_role only) + `auth_uid_by_email`.
- **Serveur** : `whatsapp-send-otp` (rate-limit : 1 code/min, 5/h ; anti-doublon) et `whatsapp-verify-otp` (max 5 essais, expiration 10 min, crée le compte ou change le mot de passe).
- **App** : inscription en 2 temps (numéro prouvé avant création), écran de saisie du code, et « Mot de passe oublié » complet.
- Sécurité : le code n'est jamais renvoyé au client ni stocké en clair ; les fonctions n'exposent pas l'existence d'un compte au-delà du strict nécessaire.
