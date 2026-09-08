# Taga — Ce qui a changé depuis le dernier build

**Dernier build installé :** 11/07 à 13h21
**Dernier commit :** 12/07 à 15h22
**Volume :** 14 commits · 45 fichiers · ~2 100 lignes

> Rien de ce qui suit n'a encore tourné sur un téléphone. Tout est vérifié à la compilation, rien à l'usage.

---

## 1. Bugs critiques — des choses qui cassaient vraiment

### Le livreur recevait les courses taxi (et inversement)
Le dispatch ne connaissait **que le type de véhicule**. La donnée « quel métier fait ce chauffeur » n'existait nulle part. Les deux fonctions de dispatch puisaient donc dans le même vivier : un livreur à moto recevait forcément les courses taxi, un chauffeur VTC recevait les livraisons de repas.

Le chauffeur déclare maintenant les **services** qu'il accepte (Courses, Colis, Livraison repas, Déménagement), limités par son véhicule. Le dispatch filtre strictement. Les chauffeurs déjà inscrits ont été backfillés avec tous les services compatibles — personne n'est bloqué.

### En admin, on pouvait assigner un camion à un colis
Les sélecteurs filtraient sur `d.vehicule`, qui n'est pas le type de véhicule mais le **libellé d'affichage** (« Toyota · Blanc »). Le filtre ne matchait donc jamais rien et **tout le monde passait, camion compris**. Le sélecteur Location n'avait, lui, **aucun filtre du tout**.

Règle d'éligibilité unique, alignée sur le dispatch, branchée sur les quatre sélecteurs. Et un **verrou en base** : j'ai testé en forçant un camion sur un colis en SQL direct, la base refuse.

### Le chauffeur était piégé une fois le client à bord
La RPC d'annulation n'autorisait que les statuts « en route » et « arrivé ». Si le client changeait de destination en pleine course, le chauffeur **ne pouvait pas annuler du tout**.

Le motif « le client a changé de destination » est maintenant recevable à toutes les phases, et il n'accuse plus le chauffeur (l'admin lit « chauffeur non fautif »).

### Le chauffeur se déconnectait en quittant l'app
La tâche de présence en arrière-plan tourne dans un **contexte JS séparé** et créait un 2e client Supabase, qui faisait tourner le refresh token dans le dos de l'app. Au relancement, Supabase détectait une réutilisation et invalidait la session.

Un seul rafraîchisseur désormais, piloté par AppState. Bonus trouvé au passage : l'app appelait `setDriverOffline()` **à chaque ouverture** avant d'avoir relu le flag persisté — le chauffeur sortait du dispatch à chaque démarrage.

### Une offre morte réveillait le chauffeur pour rien
`getMyPendingOffer` ne filtrait pas `expires_at`, et le code **fabriquait un faux compte à rebours de 5 secondes** sur une offre déjà expirée. Le chauffeur était réveillé par la sonnerie, acceptait, et le serveur rejetait.

Filtre sur l'expiration, faux compte à rebours supprimé, et en dessous de 6 secondes restantes l'offre est ignorée silencieusement.

---

## 2. Argent — deux ponctions et un gain fantôme

### Double ponction sur les commandes resto
Taga encaissait **8 % de commission au restaurant ET 200 F de frais de service au client**. Les 200 F étaient codés en dur à trois endroits.

Le mode de rémunération est maintenant **exclusif par restaurant** : soit commission, soit frais de service, jamais les deux. Verrouillé par une contrainte en base (testée : la double ponction est refusée). Frais de service à **0 par défaut**.

### Le livreur ne savait pas ce qu'il gagnait
Un gain **entièrement inventé** (`total × 0.12`) s'affichait sur les livraisons. En le supprimant, le livreur s'est retrouvé sans aucune information.

En vérifiant, `orders.frais_livraison` **existait déjà** (938 F en moyenne, facturés au client) — il n'était simplement jamais remonté au chauffeur. Le `select` ne le demandait pas. Il voit maintenant « Tu gagnes X », avec une part **réglable** (100 % par défaut).

### La promo était appliquée côté client seulement
Le client voyait le montant réduit et payait ce montant par Wave/OM, mais la commande enregistrait le **plein tarif**. L'admin voyait donc un paiement systématiquement « court ». Le code promo est maintenant appliqué et plafonné côté serveur.

---

## 3. Carte et véhicules

Les véhicules étaient rognés, et un point bleu se dessinait par-dessus. Le premier correctif avait des trous, la vérification les a trouvés : sur l'écran livraison, le point bleu **natif** de Google se posait pile sur la moto (il passe toujours au-dessus des marqueurs custom) ; l'`edgePadding` était plus grand que la hauteur des cartes en encart (115 px sur 118 px), ce qui collait les marqueurs au bord où ils étaient rognés.

Corrigé avec une échelle de zIndex explicite (le véhicule est au sommet, rien ne peut être dessiné dessus), boîtes de marqueur à taille fixe, padding calculé sur la vraie hauteur.

**Nouveaux assets** : voiture et scooter **vus du dessus**, dessinés en vectoriel. Et surtout, la donnée qui manquait : `driver_presence` n'avait **aucune colonne de cap** — sans elle, tous les véhicules auraient pointé plein nord. Le cap remonte maintenant du GPS, avec un repli honnête (relèvement entre deux positions réelles ; si le véhicule est à l'arrêt, on conserve le dernier cap au lieu de le remettre à zéro).

---

## 4. Notes — une seule note client, tous services

Les chauffeurs notaient déjà les passagers (**14 notes, moyenne 4,79**), mais personne ne lisait cette donnée.

Le client voit maintenant sa moyenne, et le chauffeur la voit **avant d'accepter** — c'est ce qui lui donne du poids. La note couvre désormais **tous les services** : courses, livraison de repas, déménagement.

**Anonymat verrouillé en base** : les fonctions ne peuvent renvoyer que `(moyenne, nb)`. Jamais une note individuelle, jamais qui a noté. Sans ça, le client identifierait le chauffeur qui lui a mis 3 étoiles (une course = un chauffeur), pourrait se venger, et les chauffeurs cesseraient de noter honnêtement. Seuil de 3 notes avant affichage.

---

## 5. Notifications d'offre

Trois trous corrigés : **aucun TTL** (une offre de 22 s pouvait arriver 10 min plus tard), **rien pour iOS** (le canal Android a `bypassDnd`, iOS n'a aucun équivalent — un chauffeur en mode Concentration ne voyait jamais l'offre), et **aucun payload** (le tap ne pointait nulle part).

La fenêtre d'offre passe de **22 s à 30 s** : quand l'app est tuée, il faut compter le push + le temps de remarquer + le démarrage à froid (jusqu'à 14 s) avant même de voir la carte.

---

## 6. Clavier et cohérence

Le clavier cachait les champs sur 8 écrans. Le vrai bug Android était sur l'écran véhicule chauffeur : le `KeyboardAvoidingView` était **neutralisé sur Android**.

La passe de cohérence a sorti des choses que personne n'avait signalées : un gain de démo de 3 200 F en repli sur le récap de course, « 100 % pour toi » affiché sur **toutes** les offres y compris camion (qui est à commission), des identités mock (« Awa Touré », « Mamadou Diallo ») affichées à de vrais utilisateurs, une fausse distance « 5,8 km », et des pannes réseau déguisées en « aucun résultat ».

**Sur demande :** compteur d'attente simplifié (« Attente 03:12 »), mentions de commission retirées côté chauffeur, la recherche d'adresse trouve « maison » / « domicile » / « boulot » dans les adresses enregistrées.

---

## Ce qui reste à faire

1. **Rebuild** client + chauffeur (rien de tout ça n'est dans le build actuel)
2. **Déployer l'admin** — `wrangler pages deploy` (les fichiers sont modifiés, pas en ligne)
3. **Tester sur un vrai téléphone** — le backend, lui, est déjà actif

**À tester en priorité :** le clavier (inscription, connexion, véhicule chauffeur), la session chauffeur (tuer l'app, rouvrir → rester connecté), enregistrer une adresse « Maison » puis la choisir au checkout, et les véhicules sur la carte (aucun coupé, rien par-dessus, bien orientés).

---

## Réserve honnête

Sur certains Android chinois (Xiaomi, Oppo, Huawei), le constructeur tue les services en arrière-plan malgré tout. Les chauffeurs devront autoriser Taga en « démarrage auto » et retirer l'optimisation de batterie. Aucun code ne contourne ça.
