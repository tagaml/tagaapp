// Données fictives Taga (Bamako, Mali) — F CFA
export const user = {
  prenom: 'Awa',
  nom: 'Touré',
  initiales: 'AT',
  note: 4.9,
  telephone: '+223 76 •• •• 12',
  email: 'awa.toure@email.com',
  ville: 'Bamako · Mali',
  quartier: 'ACI 2000, Hamdallaye',
  code: 'AWA2000',
  version: '2.4.0',
};

export const vehiculesVoiture = [
  { id: 'standard', nom: 'Eco', places: '4 places', eta: '4 min', extra: '', prix: 3200 },
  { id: 'confort', nom: 'Fresh', places: '4 places', eta: '6 min', extra: '', badge: 'Clim', prix: 5500 },
  { id: 'xl', nom: 'SUV', places: '6 places', eta: '8 min', extra: '', prix: 6800 },
];

export const vehiculesMoto = [
  { id: 'moto', nom: 'Taga Moto', places: '1 place', eta: '2 min', extra: 'Casque fourni', prix: 1500 },
];

export const taillesColis = [
  { id: 'petit', nom: 'Petit', desc: 'Documents, clés · < 2 kg', prix: 1000, heavy: false },
  { id: 'moyen', nom: 'Moyen', desc: 'Sac, carton · 2 – 8 kg', prix: 2000, heavy: false },
  { id: 'grand', nom: 'Grand', desc: 'Électroménager · 8 – 20 kg', prix: 3500, heavy: false },
  { id: 'tricycle', nom: 'Tricycle', desc: 'Meubles, sacs, ciment · 20 – 150 kg', prix: 6000, heavy: true },
];

export const categoriesFood = ['Malien', 'Burgers', 'Pizza', 'Healthy', 'Poulet', 'Sucré'];

// Photos Unsplash (CDN). Repli automatique sur l'emoji si une image ne charge pas (voir FoodImage).
const ph = (id: string) => `https://images.unsplash.com/photo-${id}?w=600&q=70&auto=format&fit=crop`;
export const FOOD_IMG = {
  malien: ph('1504674900247-0877df9cc836'),
  table: ph('1414235077428-338989a2e8c0'),
  bowl: ph('1546069901-ba9599a7e63c'),
  burger: ph('1568901346375-23c9450c58cd'),
  pizza: ph('1513104890138-7c749659a591'),
  chicken: ph('1598103442097-8b74394b95c6'),
  fish: ph('1535140728325-a4d3707eee61'),
  skewers: ph('1529692236671-f1f6cf9683ba'),
  juice: ph('1600271886742-f049cd451bba'),
  rice: ph('1516684732162-798a0062be99'),
};

export const restaurants = [
  { id: 'fatou', nom: 'Chez Fatou', note: 4.8, avis: 420, type: 'Malien · Grillades', eta: '25 min', livraison: 'Offerte', promo: '-30%', emoji: '🍗', img: FOOD_IMG.chicken },
  { id: 'burger', nom: 'Burger House', note: 4.6, avis: 210, type: 'Fast-food · Burgers', eta: '20 min', livraison: '500 F', badge: 'Nouveau', emoji: '🍔', img: FOOD_IMG.burger },
  { id: 'pizza', nom: 'Mama Pizza', note: 4.7, avis: 305, type: 'Italien · Pizza', eta: '30 min', livraison: 'Offerte', emoji: '🍕', img: FOOD_IMG.pizza },
  { id: 'djoliba', nom: 'Le Djoliba', note: 4.9, avis: 512, type: 'Malien · Riz', eta: '30 min', livraison: '500 F', emoji: '🍚', img: FOOD_IMG.rice },
];

export const restoMenu = {
  nom: 'Chez Fatou',
  note: 4.8,
  avis: 420,
  type: 'Malien · Grillades',
  eta: '25 min',
  livraison: 'Offerte',
  distance: '1,2 km',
  horaire: 'Ouvert · ferme à 23h00 · Min. commande 2 000 F',
  emoji: '🍗',
  cover: FOOD_IMG.chicken,
  sections: [
    {
      titre: 'Populaires',
      plats: [
        { id: 'yassa', nom: 'Poulet Yassa', desc: 'Poulet mariné, oignons confits, riz parfumé', prix: 3500, populaire: true, emoji: '🍗', img: FOOD_IMG.chicken },
        { id: 'tiep', nom: 'Tieboudienne', desc: 'Riz au poisson, légumes, sauce tomate maison', prix: 4000, populaire: true, emoji: '🐟', img: FOOD_IMG.fish },
        { id: 'brochettes', nom: 'Brochettes de bœuf', desc: 'Bœuf grillé, sauce arachide, attiéké', prix: 2800, populaire: true, emoji: '🍢', img: FOOD_IMG.skewers },
      ],
    },
    {
      titre: 'Grillades',
      plats: [
        { id: 'braise', nom: 'Poulet braisé', desc: 'Demi-poulet braisé, sauce piquante, alloco', prix: 3000, emoji: '🍗', img: FOOD_IMG.chicken },
        { id: 'capitaine', nom: 'Capitaine grillé', desc: 'Poisson entier grillé, attiéké, sauce verte', prix: 5000, emoji: '🐟', img: FOOD_IMG.fish },
      ],
    },
    {
      titre: 'Riz & Plats',
      plats: [
        { id: 'rizgras', nom: 'Riz au gras', desc: 'Riz mijoté, viande, légumes', prix: 2500, emoji: '🍚', img: FOOD_IMG.bowl },
        { id: 'mafe', nom: 'Mafé', desc: 'Sauce arachide, viande, riz blanc', prix: 3200, emoji: '🍲', img: FOOD_IMG.malien },
      ],
    },
    {
      titre: 'Boissons',
      plats: [
        { id: 'gingembre', nom: 'Jus de gingembre', desc: 'Frais, maison, légèrement épicé · 33cl', prix: 1000, emoji: '🥤', img: FOOD_IMG.juice },
        { id: 'bissap', nom: 'Bissap', desc: 'Hibiscus glacé, menthe · 33cl', prix: 1000, emoji: '🧉', img: FOOD_IMG.juice },
      ],
    },
  ],
};

export const panier = {
  resto: 'Chez Fatou',
  eta: '25 min',
  items: [
    { id: 'yassa', nom: 'Poulet Yassa', prix: 3500, qte: 1, emoji: '🍗', img: FOOD_IMG.chicken },
    { id: 'brochettes', nom: 'Brochettes de bœuf', prix: 2800, qte: 1, emoji: '🍢', img: FOOD_IMG.skewers },
  ],
  fraisService: 200,
};

export const historique = [
  { id: '1', jour: "Aujourd'hui", titre: 'Aéroport Bamako-Sénou', heure: '09:12', sous: 'Taxi · 18 min', prix: 3200, statut: 'Terminée', action: 'Refaire le trajet', cat: 'Courses' },
  { id: '2', jour: "Aujourd'hui", titre: 'Chez Fatou', heure: '13:40', sous: '2 articles · Poulet Yassa…', prix: 6500, statut: 'Livrée', action: 'Commander à nouveau', cat: 'Restaurant' },
  { id: '3', jour: 'Hier', titre: 'Marché de Médine', heure: '18:05', sous: 'Moto · 9 min', prix: 1500, statut: 'Terminée', action: 'Refaire le trajet', cat: 'Courses' },
  { id: '4', jour: 'Hier', titre: 'Colis → Badalabougou', heure: '11:20', sous: 'Moyen · Aïssata T.', prix: 2000, statut: 'Livré', action: 'Renvoyer un colis', cat: 'Colis' },
  { id: '5', jour: '5 juin', titre: 'Burger House', heure: '20:15', sous: '3 articles', prix: 8900, statut: 'Livrée', action: 'Commander à nouveau', cat: 'Restaurant' },
  { id: '6', jour: '5 juin', titre: 'Hippodrome → ACI 2000', heure: '08:30', sous: 'Taxi', prix: 2500, statut: 'Annulée', action: 'Réessayer', cat: 'Courses' },
];

export const conversations = [
  { id: 'moussa', nom: 'Moussa K.', heure: '13:52', dernier: "D'accord, j'arrive 👍", nonLus: 2 },
  { id: 'ibrahim', nom: 'Ibrahim D.', heure: 'Hier', dernier: 'Bon appétit ! Merci pour le pourboire 🛵', nonLus: 0 },
  { id: 'fatou', nom: 'Fatoumata S.', heure: 'Lun.', dernier: 'Tu : Merci, bonne route !', nonLus: 0 },
  { id: 'support', nom: 'Support Taga', heure: '2 juin', dernier: 'Ton remboursement a été traité ✅', nonLus: 0 },
];

export const appels = [
  { id: 'a1', nom: 'Moussa K.', heure: '13:50', type: 'Sortant · 2 min 14' },
  { id: 'a2', nom: 'Ibrahim D.', heure: 'Hier', type: 'Entrant · 0 min 48' },
  { id: 'a3', nom: 'Fatoumata S.', heure: 'Lun.', type: 'Appel manqué' },
];

export const chatMessages = [
  { id: 'm1', from: 'eux', text: "Je sors, j'arrive 🙂" },
  { id: 'm2', from: 'eux', text: 'Je suis devant le portail' },
  { id: 'm3', from: 'moi', text: "2 minutes s'il te plaît" },
  { id: 'm4', from: 'eux', text: 'Tu es où ?' },
  { id: 'm5', from: 'moi', text: 'Merci !' },
];

export const adresses = [
  { id: 'maison', label: 'Maison', detail: 'ACI 2000, Hamdallaye · Porte 142' },
  { id: 'travail', label: 'Travail', detail: 'Immeuble Sotuba, ACI 2000' },
  { id: 'maman', label: 'Maman', detail: 'Badalabougou Est, rue 27' },
];

export const paiements = [
  { id: 'om', label: 'Orange Money', detail: '+223 76 •• •• 12', defaut: true, icon: 'OM' },
  { id: 'moov', label: 'Moov Money', detail: '+223 70 •• •• 45', icon: 'MM' },
  { id: 'carte', label: 'Carte bancaire', detail: '•••• 4582 · Visa', icon: '💳' },
];

export const driver = {
  nom: 'Moussa K.',
  note: 4.9,
  vehicule: 'Toyota Corolla · Gris',
  plaque: 'BKO 4582',
  eta: '4 min',
};

export const pourboires = [0, 300, 500, 1000];

// Centre de notifications (inbox)
export const notifications = [
  { id: 'n1', type: 'course', titre: 'Moussa arrive dans 4 min', corps: 'Ton chauffeur est en route vers ACI 2000.', temps: 'Il y a 1 min', nonLu: true, icon: 'car-sport' },
  { id: 'n2', type: 'parrainage', titre: '2 000 F offerts', corps: 'Parraine un ami et gagnez 2 000 F chacun.', temps: 'Il y a 2 h', nonLu: true, icon: 'gift' },
  { id: 'n3', type: 'commande', titre: 'Commande livrée', corps: 'Ta commande Chez Fatou a bien été livrée. Bon appétit !', temps: 'Hier · 13:55', nonLu: false, icon: 'fast-food' },
  { id: 'n4', type: 'promo', titre: '-30% ce week-end', corps: 'Profite de -30% sur toutes tes courses ce week-end.', temps: 'Lun.', nonLu: false, icon: 'pricetag' },
  { id: 'n5', type: 'commande', titre: 'Reçu disponible', corps: 'Le reçu de ta course vers l’aéroport est prêt.', temps: '5 juin', nonLu: false, icon: 'receipt' },
];

// Langues disponibles
export const langues = [
  { id: 'fr', label: 'Français', sub: 'Français', flag: '🇫🇷' },
  { id: 'bm', label: 'Bambara', sub: 'Bamanankan', flag: '🇲🇱' },
  { id: 'en', label: 'English', sub: 'Anglais', flag: '🇬🇧' },
];

// Préférences de notifications (réglages)
export const prefsNotifs = [
  { id: 'courses', label: 'Courses & livraisons', desc: 'Chauffeur trouvé, arrivée, livraison', defaut: true },
  { id: 'promos', label: 'Promotions & offres', desc: 'Codes promo et réductions', defaut: true },
  { id: 'parrainage', label: 'Parrainage', desc: 'Récompenses et invitations', defaut: false },
  { id: 'compte', label: 'Compte & sécurité', desc: 'Connexions et changements importants', defaut: true },
];

// Options de personnalisation d'un plat (accompagnements / suppléments)
export const platOptions = {
  accompagnements: {
    titre: 'Accompagnement', requis: true, multi: false,
    choix: [
      { id: 'riz', nom: 'Riz parfumé', prix: 0, inclus: true },
      { id: 'attieke', nom: 'Attiéké', prix: 0, inclus: true },
      { id: 'frites', nom: 'Frites maison', prix: 500 },
      { id: 'alloco', nom: 'Alloco (banane plantain)', prix: 500 },
    ],
  },
  supplements: {
    titre: 'Suppléments', requis: false, multi: true,
    choix: [
      { id: 'piment', nom: 'Piment maison', prix: 300 },
      { id: 'oeuf', nom: 'Œuf supplémentaire', prix: 700 },
    ],
  },
};

/**
 * Montant en F CFA — formatage DÉTERMINISTE, identique sur iOS et Android.
 *
 * On n'utilise PAS `toLocaleString('fr-FR')` : sur Android, Hermes s'appuie sur l'ICU du système.
 * Selon la version d'Android, le séparateur de milliers change (espace fine insécable, espace
 * normale…) — et sur certains appareils il DISPARAÎT purement et simplement : « 6659250 F » au
 * lieu de « 6 659 250 F ». Sur une app qui affiche de l'argent au chauffeur, c'est inacceptable.
 * Ici, on groupe nous-mêmes par 3 avec une espace insécable : même rendu partout, toujours.
 */
export function fcfa(n: number): string {
  const v = Math.round(Number(n) || 0);
  const signe = v < 0 ? '-' : '';
  const chiffres = Math.abs(v).toString();
  const groupes = chiffres.replace(/\B(?=(\d{3})+(?!\d))/g, ' '); // espace insécable
  return `${signe}${groupes} F`;
}

/** Même groupage, sans l'unité (pour les compteurs : nombre de courses, etc.). */
export function nombre(n: number): string {
  const v = Math.round(Number(n) || 0);
  const signe = v < 0 ? '-' : '';
  return signe + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
