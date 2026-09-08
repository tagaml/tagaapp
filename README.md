# Taga 🛺🍗📦

Super-app mobile pour **Bamako (Mali)** : courses VTC (voiture & moto), livraison de restaurants et envoi de colis.
Application **native iOS + Android**, un seul code, construite avec **React Native (Expo)**.

---

## ✅ Ce qui est déjà fait

Les **23 écrans** du prototype sont codés et la navigation fonctionne :

**Onglets principaux**
- Accueil · Services · Activité · Compte

**Courses**
- Réserver une voiture · Réserver une moto · Course en direct · Détail d'un trajet · Notation

**Restaurant**
- Liste des restos (avec recherche) · Détail d'un resto & menu · Panier · Finaliser la commande · Suivi de commande · Reçu

**Colis**
- Envoyer un colis

**Compte & divers**
- Profil · Parrainage · Mes adresses · Moyens de paiement · Messages & appels · Chat · Aide & sécurité

> Pour l'instant, les données sont **fictives** (pas encore de vrai serveur, ni de vraie carte, ni de paiement réel). C'est la base visuelle et le parcours complet — exactement ce qu'il faut pour tester l'app et décider de la suite.

---

## 📱 Tester l'app sur ton téléphone (le plus simple, 3 minutes)

1. Sur ton téléphone, installe l'application **Expo Go** :
   - iPhone → App Store
   - Android → Google Play

2. Sur ton ordinateur, installe **Node.js** si ce n'est pas déjà fait : https://nodejs.org (choisis la version « LTS »).

3. Ouvre le **Terminal** (Mac) et tape ces commandes une par une (appuie sur Entrée après chacune) :

   ```bash
   cd ~/Documents/taga
   rm -rf node_modules package-lock.json
   npm install
   npx expo start
   ```

   > La 1ʳᵉ fois, `npm install` prend 1 à 2 minutes (il télécharge les briques de l'app). Les fois suivantes, tu pourras lancer directement `npx expo start`.

4. Un **QR code** apparaît dans le terminal.
   - iPhone → ouvre l'appareil photo et vise le QR code.
   - Android → ouvre l'app **Expo Go** et scanne le QR code.

5. L'app **Taga** s'ouvre sur ton téléphone ! 🎉
   Chaque fois que le code change, l'app se met à jour toute seule.

> 💡 Ton téléphone et ton ordinateur doivent être sur le **même réseau Wi-Fi**.

---

## 💻 Tester sur l'ordinateur (optionnel)

Dans le terminal après `npx expo start`, appuie sur :
- `i` → ouvre le simulateur iPhone (nécessite Xcode sur Mac)
- `a` → ouvre l'émulateur Android (nécessite Android Studio)
- `w` → ouvre dans le navigateur web

---

## 📂 Comment c'est organisé

```
taga/
├── app/                  ← Tous les écrans (un fichier = un écran)
│   ├── (tabs)/           ← Les 4 onglets du bas
│   │   ├── index.tsx        Accueil
│   │   ├── services.tsx     Services
│   │   ├── activite.tsx     Activité
│   │   └── compte.tsx       Compte
│   ├── ride-voiture.tsx     Réserver une voiture
│   ├── food.tsx             Liste des restaurants
│   ├── cart.tsx             Panier
│   └── ... (tous les autres écrans)
├── components/ui.tsx     ← Boutons, cartes, en-têtes réutilisables
├── data/mock.ts          ← Toutes les données fictives (restos, prix, etc.)
├── theme/index.ts        ← Couleurs et styles de la marque
└── README.md             ← Ce fichier
```

👉 Pour **changer un texte ou un prix**, c'est presque toujours dans `data/mock.ts`.
👉 Pour **changer les couleurs**, c'est dans `theme/index.ts`.

---

## 🚀 La suite (quand tu veux)

Étapes possibles pour aller vers une vraie app en production :
1. **Carte & géolocalisation réelles** (Google Maps ou Mapbox)
2. **Comptes utilisateurs** (inscription, connexion par SMS)
3. **Backend & base de données** (commandes, restos, chauffeurs en temps réel)
4. **Paiements réels** (Orange Money, Moov Money, carte)
5. **Publication** sur l'App Store et le Google Play Store

---

## 🎨 Identité

- Couleur de marque : orange `#E84B1F`
- Fond crème : `#FBFAF8`
- Police : Hanken Grotesk (police système par défaut pour l'instant)
- Devise : Franc CFA (F)
