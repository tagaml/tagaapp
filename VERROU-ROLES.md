# Verrou des rôles véhicule — vérification avant build

Date : 14/07/2026. Tout ci-dessous a été **attaqué en base**, pas relu dans le code.
Les tests créent leurs propres lignes et les suppriment ; les réglages ont été sauvegardés avant.

## La règle

| Véhicule | Course voiture | Course moto | Colis léger | Colis lourd | Repas | Location |
|---|---|---|---|---|---|---|
| Voiture  | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | seulement si cochée |
| Moto     | ⛔ | ✅ | ✅ | ⛔ | ✅ | seulement si cochée |
| Tricycle | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| Camion   | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ (déménagement seul) |

La **location** n'est jamais imposée : le chauffeur prête son véhicule, il coche la case.
Défaut = tout ce que le véhicule sait faire **sauf** la location (`services_defaut()`).

## LA FUITE RACINE (trouvée lors de cette vérification)

Il existait **DEUX dispatcheurs**, et le vrai n'était pas celui que je croyais.

Les crons `dispatch_stale_rides` et `dispatch_stale_deliveries` tournent **toutes les 15 secondes**
et ce sont eux qui envoient les offres. Ils ne filtraient **que le tricycle** — ni le type de
véhicule, ni les services :

- une course **voiture** pouvait sonner chez une **moto** ;
- une commande de **repas** pouvait sonner chez une **voiture** ;
- un chauffeur qui n'a pas coché « livraison » recevait quand même du food.

Le téléphone sonnait, le chauffeur acceptait, et le garde d'assignation refusait ensuite.
D'où les « sonneries fantômes » signalées par le testeur. **Mes correctifs précédents (présence,
fonction edge) n'avaient jamais touché ces crons.**

Corrigé : nouvelle fonction `chauffeur_prend(driver, service, véhicules[])`, appliquée dans les
deux crons. La gamme voiture (Eco/Fresh/SUV) est également vérifiée.

## Les 3 verrous, en profondeur (défense en couches)

1. **Présence** (`presence_coherente`) — le véhicule publié est forcé à celui du profil.
   Un vieux build ne peut pas mentir.
2. **Offre** (les 2 crons) — l'offre ne part qu'au bon véhicule ET au bon service. *(c'était le trou)*
3. **Assignation** (`chk_ride_driver_compatible`, `chk_order_driver_compatible`) — dernier rempart :
   même une assignation manuelle admin est refusée si elle est incohérente.

## Résultats des tests

- Matrice véhicule × demande : **25 cas sur 25 conformes**.
- Crons : course voiture → offerte à une voiture ✅ · colis → moto ✅ · repas → moto ✅.
- Location non cochée → refusée pour les 4 véhicules ✅ ; cochée → acceptée ✅.
- Réglages (`app_numbers`) intacts après les tests ✅ ; aucune ligne de test résiduelle ✅.

## À TRANCHER PAR OUSMANE (hors périmètre technique)

Les **5 administrateurs sont tous `super`** — y compris Alassane, le testeur. Un super admin peut
changer les tarifs, valider des retraits et créer d'autres admins. Les rôles `finance` / `support`
existent et fonctionnent, mais personne ne les utilise.
