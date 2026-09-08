import { supabase } from './supabase';
import { bamakoZones, distanceKm, type Zone, type DemandLevel } from '../components/TripMap';

// Identifiant unique de canal Realtime : évite la collision « cannot add postgres_changes
// callbacks after subscribe() » quand deux écrans s'abonnent au même sujet en même temps.
let _chSeq = 0;
const chId = () => `${Date.now().toString(36)}_${(_chSeq++).toString(36)}`;

export type Restaurant = {
  id: string;
  slug: string;
  nom: string;
  note: number;
  avis: number;
  type: string;
  eta: string;
  livraison: string;            // texte d'affichage (ex. « À partir de 1000 F ») — édité par le marchand
  livraison_offerte?: boolean;  // gratuité réelle — pilotée par l'admin uniquement
  frais_service?: number | null; // frais de service client ; null = défaut global (app_numbers.frais_service)
  promo?: string | null;
  badge?: string | null;
  emoji?: string | null;
  img?: string | null;
  cover?: string | null;
  horaire?: string | null;
  distance?: string | null;
  ouvert?: boolean;
};

export type VarOption = { n: string; d: number };           // nom de l'option, supplément (delta)
export type VarGroup = { g: string; req?: boolean; opts: VarOption[] }; // groupe (ex. « Taille »)

export type MenuItem = {
  id: string;
  slug?: string | null;
  nom: string;
  desc?: string | null;
  prix: number;
  populaire?: boolean;
  emoji?: string | null;
  img?: string | null;
  variantes?: VarGroup[];
};

export type MenuSection = { id: string; titre: string; plats: MenuItem[] };
export type RestaurantDetail = Restaurant & { sections: MenuSection[] };

export async function getRestaurants(): Promise<Restaurant[]> {
  const { data, error } = await supabase.from('restaurants').select('*').order('sort');
  if (error) throw error;
  return (data ?? []) as Restaurant[];
}

/* ===================== Bannières pub (accueil) ===================== */
export type PromoBanner = { id: string; image: string; titre: string | null; sous_titre: string | null; lien: string | null };

/** Bannières publicitaires actives de l'accueil, gérées depuis l'admin. Jamais bloquant. */
export async function getPromoBanners(): Promise<PromoBanner[]> {
  const { data } = await supabase.from('promo_banners').select('id, image, titre, sous_titre, lien').eq('actif', true).order('sort');
  return (data as PromoBanner[]) ?? [];
}

export async function getRestaurant(slug: string): Promise<RestaurantDetail | null> {
  const { data: r, error } = await supabase.from('restaurants').select('*').eq('slug', slug).single();
  if (error || !r) return null;

  const [{ data: secs }, { data: items }] = await Promise.all([
    supabase.from('menu_sections').select('id, titre, sort').eq('restaurant_id', r.id).order('sort'),
    supabase.from('menu_items').select('*').eq('restaurant_id', r.id).order('sort'),
  ]);

  const sections: MenuSection[] = (secs ?? []).map((s: any) => ({
    id: s.id,
    titre: s.titre,
    plats: (items ?? [])
      .filter((i: any) => i.section_id === s.id)
      .filter((i: any) => i.disponible !== false && (i.stock == null || i.stock > 0)) // masque indispo / épuisé
      .map((i: any) => ({
        id: i.id, slug: i.slug, nom: i.nom, desc: i.descr, prix: i.prix,
        populaire: i.populaire, emoji: i.emoji, img: i.img,
        variantes: Array.isArray(i.variantes) ? i.variantes : [],
      })),
  }));

  return { ...(r as Restaurant), sections };
}

/* ===================== Commandes & courses ===================== */

export type OrderInput = {
  restaurantId?: string | null;
  restaurantNom: string;
  items: { id?: string; nom: string; prix: number; qte: number; options?: { g: string; n: string }[] }[];
  sousTotal: number;
  fraisLivraison: number;
  fraisService: number;
  pourboire: number;
  total: number;
  paiement?: string;
  creditApplied?: number;
  adresse?: string;
  destLat?: number | null;
  destLng?: number | null;
  promo?: string | null;
};

/** Frais de livraison estimés = base + tarif/km × distance(resto → client). Repli sur la base. */
export async function getDeliveryFee(restaurantId: string | null, lat?: number | null, lng?: number | null): Promise<number> {
  const [rR, numsR] = await Promise.all([
    restaurantId ? supabase.from('restaurants').select('lat,lng,livraison_offerte').eq('id', restaurantId).maybeSingle() : Promise.resolve({ data: null as any }),
    supabase.from('app_numbers').select('key,value').in('key', ['deliv_base', 'deliv_per_km', 'deliv_free_all']),
  ]);
  const cfg: Record<string, number> = {}; (numsR.data ?? []).forEach((n: any) => { cfg[n.key] = Number(n.value); });
  // Livraison offerte → 0 F. Piloté par l'admin : par restaurant (livraison_offerte)
  // ou globalement (deliv_free_all). Aligné sur la RPC create_order.
  if ((rR.data as any)?.livraison_offerte === true || (cfg.deliv_free_all ?? 0) !== 0) return 0;
  const base = cfg.deliv_base ?? 1000; const perKm = cfg.deliv_per_km ?? 150;
  const rlat = (rR.data as any)?.lat, rlng = (rR.data as any)?.lng;
  if (rlat == null || rlng == null || lat == null || lng == null) return base;
  const R = 6371, dLat = (lat - rlat) * Math.PI / 180, dLng = (lng - rlng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rlat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  // Distance plafonnée (évite des frais absurdes avec des coordonnées de test très éloignées).
  const dist = Math.min(25, R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  return base + Math.round((perKm * Math.max(0, dist)) / 50) * 50;
}

/**
 * Frais de service facturés au client.
 *
 * Chaque restaurant a un mode de rémunération EXCLUSIF (restaurants.remuneration) :
 *   'commission'    -> Taga prend un % au restaurant, le client ne paie AUCUN frais de service.
 *   'frais_service' -> le restaurant ne paie aucune commission, le client paie un frais fixe.
 * Facturer les deux serait une double ponction (la base l'interdit d'ailleurs).
 *
 * Même règle que la RPC create_order, qui reste autoritaire sur le montant enregistré :
 * en mode commission -> 0, quoi qu'il arrive (même si un défaut global est configuré) ;
 * en mode frais_service -> restaurants.frais_service, sinon app_numbers.frais_service, sinon 0.
 * En cas d'erreur réseau on retombe sur 0 : mieux vaut afficher 0 que facturer à tort.
 */
export async function getServiceFee(restaurantId: string | null): Promise<number> {
  try {
    const [rR, numsR] = await Promise.all([
      restaurantId
        ? supabase.from('restaurants').select('frais_service, remuneration').eq('id', restaurantId).maybeSingle()
        : Promise.resolve({ data: null as any }),
      supabase.from('app_numbers').select('key,value').eq('key', 'frais_service').maybeSingle(),
    ]);
    // Mode commission (le défaut) : aucun frais de service, on ne regarde même pas le défaut global.
    const mode = (rR.data as any)?.remuneration;
    if (mode !== 'frais_service') return 0;

    const resto = (rR.data as any)?.frais_service;
    const global = (numsR.data as any)?.value;
    const raw = resto ?? global ?? 0;
    const n = Math.round(Number(raw));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export async function createOrder(input: OrderInput): Promise<string | null> {
  // Création autoritative côté serveur : la RPC recalcule sous-total/total depuis
  // menu_items (les montants envoyés par le client ne sont JAMAIS pris pour argent
  // comptant) et insère commande + articles atomiquement. Les inserts directs sont bloqués.
  const { data, error } = await supabase.rpc('create_order', {
    p_restaurant_id: input.restaurantId ?? null,
    p_items: input.items.filter((it) => it.id).map((it) => ({ id: it.id, qte: it.qte, options: it.options ?? [] })),
    p_pourboire: input.pourboire ?? 0,
    p_paiement: input.paiement ?? 'Espèces',
    p_credit: input.creditApplied ?? 0,
    p_adresse: input.adresse ?? null,
    p_dest_lat: input.destLat ?? null,
    p_dest_lng: input.destLng ?? null,
    p_promo: input.promo ?? null,
  });
  if (error) throw error;
  return (data as string) ?? null;
}

export type RideInput = {
  type: 'voiture' | 'moto' | 'colis';
  tier?: string;
  creditApplied?: number;
  locationHours?: number;
  scheduledAt?: string | null; // réservation planifiée (ISO) ; null = immédiat
  shared?: boolean; // course partagée (Taga Partage, -30%)
  depart?: string;
  destination?: string;
  distanceKm?: number;
  prix: number;
  fraisService?: number; // frais de service Taga inclus dans prix (le chauffeur garde prix - frais)
  paiement?: string;
  vehicule?: string;
  chauffeurNom?: string;
  chauffeurNote?: number;
  plaque?: string;
  departLat?: number;
  departLng?: number;
  destLat?: number;
  destLng?: number;
  stops?: { label?: string | null; lat?: number; lng?: number }[]; // arrêts intermédiaires (max 2)
  colisNote?: string; // contenu / précisions du colis (visible chauffeur + admin)
  manut?: boolean;    // colis tricycle : chargement/déchargement (le serveur ajoute le supplément)
};

/* ---- Zones préférées du chauffeur ---- */
export type DriverZone = { id: string; nom: string };

export async function getDriverZones(): Promise<DriverZone[]> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return [];
  const { data } = await supabase.from('driver_zones').select('id, nom').eq('driver_id', uid).order('created_at');
  return (data ?? []) as DriverZone[];
}

export async function addDriverZone(nom: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  await supabase.from('driver_zones').insert({ driver_id: uid, nom });
}

export async function removeDriverZone(id: string): Promise<void> {
  await supabase.from('driver_zones').delete().eq('id', id);
}

/** Préférences de notifications du client (carte clé → activé). */
export async function getNotifPrefs(): Promise<Record<string, boolean> | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data } = await supabase.from('notif_prefs').select('prefs').eq('user_id', uid).maybeSingle();
  return ((data as any)?.prefs as Record<string, boolean>) ?? null;
}

/** Enregistre l'ensemble des préférences de notifications. */
export async function saveNotifPrefs(prefs: Record<string, boolean>): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  await supabase.from('notif_prefs').upsert(
    { user_id: uid, prefs, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
}

/** Le client laisse un avis sur le restaurant après une commande livrée. */
export async function submitFoodReview(orderId: string, note: number, commentaire?: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Non connecté');
  const { data: o } = await supabase.from('orders').select('restaurant_id').eq('id', orderId).maybeSingle();
  const { error } = await supabase.from('restaurant_reviews').insert({
    order_id: orderId, user_id: uid, restaurant_id: (o as any)?.restaurant_id ?? null,
    note, commentaire: commentaire?.trim() || null,
  });
  if (error) throw error;
}

/** Solde de crédit Taga du client connecté (offert par l'admin). */
export async function getWalletCredit(): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return 0;
  const { data } = await supabase.from('wallet_credits').select('balance').eq('user_id', uid).maybeSingle();
  return (data as any)?.balance ?? 0;
}

/** Supprime définitivement le compte de l'utilisateur connecté (données + compte auth). */
export async function deleteAccount(): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await supabase.functions.invoke('delete-account', { body: {} });
  if (error) return { ok: false, reason: 'network' };
  return (data as any) ?? { ok: false };
}

export type PricingTier = { tier: string; service: string; base: number; per_km: number; min_price: number };

/** Grille tarifaire (source de vérité serveur) — pour afficher l'estimation côté client. */
export async function getPricing(): Promise<Record<string, PricingTier>> {
  const { data } = await supabase.from('pricing').select('*');
  const map: Record<string, PricingTier> = {};
  (data ?? []).forEach((r: any) => { map[r.tier] = r as PricingTier; });
  return map;
}

export type ColisSize = { id: string; nom: string; desc: string; prix: number; heavy: boolean };

/** Tailles de colis configurées en admin (nom, poids/description, prix). Repli sur le mock si vide. */
export async function getColisSizes(): Promise<ColisSize[]> {
  const { data } = await supabase
    .from('pricing')
    .select('tier, label, descr, base, actif, sort')
    .eq('service', 'colis')
    .eq('actif', true)
    .order('sort', { ascending: true });
  const rows = (data ?? []) as any[];
  if (!rows.length) return [];
  return rows.map((r) => ({
    id: r.tier,
    nom: r.label || r.tier,
    desc: r.descr || '',
    prix: Number(r.base) || 0,
    heavy: r.tier === 'tricycle',
  }));
}

/** Prix estimé d'une course selon la grille (même formule que le serveur). */
export function estimatePrice(tier: PricingTier | undefined, km: number): number | null {
  if (!tier) return null;
  const v = tier.base + Math.round((km * tier.per_km) / 50) * 50;
  return Math.max(v, tier.min_price);
}

/** Infos parrainage du client connecté : son code, le bonus (réglé admin), et s'il a déjà été parrainé. */
export async function getReferralInfo(): Promise<{ code: string; bonus: number; alreadyReferred: boolean }> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  const [pR, nR] = await Promise.all([
    uid ? supabase.from('profiles').select('referral_code, referred_by').eq('id', uid).maybeSingle() : Promise.resolve({ data: null as any }),
    supabase.from('app_numbers').select('value').eq('key', 'referral_bonus').maybeSingle(),
  ]);
  const bonus = Number((nR.data as any)?.value);
  return {
    code: (pR.data as any)?.referral_code ?? 'TAGA',
    bonus: (!isNaN(bonus) && bonus > 0) ? bonus : 2000,
    alreadyReferred: !!(pR.data as any)?.referred_by,
  };
}

/** Saisir un code parrain (tolérant aux fautes : casse/espaces normalisés côté serveur). */
export async function applyReferral(code: string): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc('apply_referral', { p_code: code });
  if (error) return { ok: false, reason: 'network' };
  return (data as any) ?? { ok: false };
}

/** Montant des frais d'annulation (réglé côté admin) — affiché avant confirmation. */
export async function getCancelFee(): Promise<number> {
  const { data } = await supabase.from('app_numbers').select('value').eq('key', 'cancel_fee').maybeSingle();
  const n = Number((data as any)?.value);
  return (!isNaN(n) && n >= 0) ? n : 500;
}

/** Rayons de proximité GPS (réglés côté admin) : « arrivé » au point de prise en charge / resto,
 *  et « remise » à destination / chez le client. En mètres. Valeurs de repli sûres si non réglées. */
export async function getGeoRadii(): Promise<{ arriveeM: number; depotM: number }> {
  try {
    const { data } = await supabase.from('app_settings').select('key,num_value').in('key', ['arrivee_radius_m', 'depot_radius_m']);
    const m: Record<string, number> = {};
    (data ?? []).forEach((r: any) => { const n = Number(r.num_value); if (!isNaN(n) && n > 0) m[r.key] = n; });
    return { arriveeM: m['arrivee_radius_m'] ?? 150, depotM: m['depot_radius_m'] ?? 180 };
  } catch {
    return { arriveeM: 150, depotM: 180 };
  }
}

/** Rayon (km) d'affichage des chauffeurs proches sur la carte client (réglé côté admin, façon Uber). */
export async function getNearbyRadiusKm(): Promise<number> {
  try {
    const { data } = await supabase.from('app_settings').select('num_value').eq('key', 'nearby_radius_km').maybeSingle();
    const n = Number((data as any)?.num_value);
    return (!isNaN(n) && n > 0) ? n : 6;
  } catch {
    return 6;
  }
}

/** Numéro Orange Money (réglé côté admin) où le chauffeur paie son abonnement manuellement. */
export async function getOmPaymentNumber(): Promise<string> {
  const { data } = await supabase.from('app_texts').select('value').eq('key', 'om_paiement_numero').maybeSingle();
  const v = (data as any)?.value;
  return (typeof v === 'string' && v.trim()) ? v.trim() : '+223 76 00 00 00';
}

/** Le client modifie une adresse d'une course en cours (destination / départ). Renvoie le nouveau prix. */
export async function updateRideAddress(rideId: string, kind: 'dest' | 'pickup', label: string, lat: number, lng: number): Promise<number> {
  const { data, error } = await supabase.rpc('update_ride_address', { p_ride: rideId, p_kind: kind, p_label: label, p_lat: lat, p_lng: lng });
  if (error) throw error;
  return Number(data) || 0;
}

/** Annule une course (client). Renvoie les frais d'annulation appliqués (0 si aucun). */
export async function cancelRide(rideId: string, reason?: string): Promise<number> {
  const { data, error } = await supabase.rpc('cancel_ride', { p_ride: rideId, p_reason: reason ?? null });
  if (error) throw error;
  return Number(data) || 0;
}

/**
 * Annulation par le CHAUFFEUR. Le motif est transmis tel quel à la RPC `driver_cancel_ride`.
 * Motifs SANS FAUTE (recevables même une fois la course démarrée, le chauffeur n'est pas accusé) :
 *  - 'client_destination' : le client a changé de destination
 *  - 'client_absent'      : le client ne s'est pas présenté
 * Motifs classiques (ex : 'imprevu_chauffeur') : limités aux statuts en_route / arrive.
 */
export async function driverCancelRide(rideId: string, reason?: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('driver_cancel_ride', { p_ride: rideId, p_reason: reason ?? null });
  if (error) throw error;
  return !!data;
}

/** Supplément chargement/déchargement colis (tricycle) — montant serveur. Défaut 2000 F. */
export async function getColisManutFee(): Promise<number> {
  try {
    const { data } = await supabase.from('app_numbers').select('value').eq('key', 'colis_manut_fee').maybeSingle();
    const n = Number((data as any)?.value);
    return (!isNaN(n) && n >= 0) ? n : 2000;
  } catch { return 2000; }
}

/** Numéro Taga (mobile money) où le client paie ; Taga reverse ensuite au prestataire. '' si non réglé. */
export async function getTagaPayNumber(): Promise<string> {
  try {
    const { data } = await supabase.from('app_texts').select('value').eq('key', 'taga_pay_number').maybeSingle();
    return String((data as any)?.value ?? '').trim();
  } catch { return ''; }
}

/** Commission camion/déménagement (% par course) — modèle sans abonnement. Défaut 15 %. */
export async function getCamionCommission(): Promise<number> {
  try {
    const { data } = await supabase.from('app_numbers').select('value').eq('key', 'camion_commission_pct').maybeSingle();
    const n = Number((data as any)?.value);
    return (!isNaN(n) && n > 0 && n < 100) ? n : 15;
  } catch { return 15; }
}

/** Réglages « attente » (éditables admin) : minutes offertes + prix par minute d'attente. */
/**
 * Attente au point de prise en charge.
 *
 * Règle Taga : les `graceMin` premières minutes sont OFFERTES (7 par défaut). Au-delà, un
 * FORFAIT UNIQUE (`fee`, 200 F par défaut) s'ajoute au trajet — ex : 2 000 F devient 2 200 F.
 *
 * Ce n'est PLUS un tarif à la minute : avant, un client en retard de 20 minutes se voyait
 * facturer 1 300 F de surcharge, ce qui était disproportionné et invérifiable pour lui.
 * Le forfait est réglable en admin (200 ou 300).
 */
export async function getWaitingConfig(): Promise<{ graceMin: number; fee: number }> {
  try {
    const { data } = await supabase.from('app_numbers').select('key,value').in('key', ['wait_grace_min', 'wait_fee']);
    const m: Record<string, number> = {};
    (data || []).forEach((r: any) => { m[r.key] = Number(r.value); });
    const graceMin = m.wait_grace_min > 0 ? m.wait_grace_min : 7;
    const fee = m.wait_fee >= 0 && Number.isFinite(m.wait_fee) ? m.wait_fee : 200;
    return { graceMin, fee };
  } catch { return { graceMin: 7, fee: 200 }; }
}

/** Réglages d'attente au POINT INTERMÉDIAIRE (arrêt) : franchise + paliers (réglés admin). */
export async function getStopWaitConfig(): Promise<{ graceMin: number; palierMin: number; palierFee: number }> {
  try {
    const { data } = await supabase.from('app_numbers').select('key,value').in('key', ['stop_wait_grace_min', 'stop_wait_palier_min', 'stop_wait_palier_fee']);
    const m: Record<string, number> = {};
    (data || []).forEach((r: any) => { m[r.key] = Number(r.value); });
    return {
      graceMin: m.stop_wait_grace_min > 0 ? m.stop_wait_grace_min : 4,
      palierMin: m.stop_wait_palier_min > 0 ? m.stop_wait_palier_min : 4,
      palierFee: m.stop_wait_palier_fee >= 0 && Number.isFinite(m.stop_wait_palier_fee) ? m.stop_wait_palier_fee : 200,
    };
  } catch { return { graceMin: 4, palierMin: 4, palierFee: 200 }; }
}

/** Enregistre (côté serveur) l'heure d'arrivée du chauffeur à l'arrêt. Renvoie l'horodatage ISO. */
export async function setStopArrive(rideId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('set_stop_arrive', { p_ride: rideId });
  if (error) return null;
  return (data as string) ?? null;
}

/**
 * Part des FRAIS DE LIVRAISON qui revient au livreur (en %), réglée côté admin
 * (app_numbers.delivery_driver_pct). Défaut 100 : le chauffeur garde sa course,
 * Taga se paie sur l'abonnement et la commission restaurant.
 * Réglable sans rebuild — ne JAMAIS coder ce pourcentage en dur dans les écrans.
 * Borné 0..100 ; toute valeur absente ou invalide retombe sur 100.
 */
export async function getDeliveryDriverPct(): Promise<number> {
  try {
    const { data } = await supabase.from('app_numbers').select('value').eq('key', 'delivery_driver_pct').maybeSingle();
    const n = Number((data as any)?.value);
    if (!Number.isFinite(n)) return 100;
    return Math.min(100, Math.max(0, Math.round(n)));
  } catch { return 100; }
}

/**
 * Gain RÉEL du livreur sur une livraison.
 *
 *   gain = arrondi(frais_livraison × pct / 100) + pourboire
 *
 * `frais_livraison` est ce que le CLIENT paie pour la livraison (déjà en base, calculé par la RPC
 * create_order : base + tarif/km). `pct` vient de app_numbers.delivery_driver_pct. Le pourboire
 * revient intégralement au livreur, en plus.
 *
 * IMPORTANT : `orders.total` (plats + service + livraison + pourboire) n'est PAS un gain — ne
 * jamais s'en servir ici. Et si `frais_livraison` est absent, l'appelant n'affiche AUCUN montant
 * plutôt qu'un chiffre inventé.
 */
export function gainLivraison(fraisLivraison: number, pourboire: number, pct: number): number {
  return Math.round(fraisLivraison * pct / 100) + pourboire;
}

/** % de réduction « Taga Partage » (réglé côté admin) — pour aligner l'affichage client sur le serveur. */
export async function getSharedDiscountPct(): Promise<number> {
  const { data } = await supabase.from('app_numbers').select('value').eq('key', 'shared_discount_pct').maybeSingle();
  const n = Number((data as any)?.value);
  return (!isNaN(n) && n > 0 && n < 100) ? n : 30;
}

/** Covoiturage Taga Partage activé ? (drapeau admin — pilote l'écran d'attente + le repli client). */
export async function getPoolEnabled(): Promise<boolean> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'pool_enabled').maybeSingle();
  return (data as any)?.value === true;
}

/** Devis Eco plein tarif pour une course Partage en attente (repli si pas de binôme). */
export async function poolEcoQuote(rideId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('pool_fallback_eco', { p_ride: rideId, p_apply: false });
  if (error) return null;
  return (data as number) ?? null;
}

/** Convertit une course Partage en attente en Eco plein tarif (le client renonce au covoiturage). */
export async function convertPoolToEco(rideId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('pool_fallback_eco', { p_ride: rideId, p_apply: true });
  if (error) throw error;
  return (data as number) ?? null;
}

export async function createRide(input: RideInput): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Non connecté');

  // Course à la demande (taxi/moto/colis, sans heures de location) :
  // prix + distance + crédit recalculés CÔTÉ SERVEUR via la RPC (anti-triche).
  const onDemand = !input.locationHours && (input.type === 'voiture' || input.type === 'moto' || input.type === 'colis');
  if (onDemand) {
    const { data: rid, error: rpcErr } = await supabase.rpc('create_ride', {
      p_type: input.type,
      p_tier: input.tier ?? null,
      p_depart: input.depart ?? null,
      p_destination: input.destination ?? null,
      p_distance_km: input.distanceKm ?? null,
      p_paiement: input.paiement ?? 'Espèces',
      p_credit: input.creditApplied ?? 0,
      p_shared: input.shared ?? false,
      p_vehicule: input.vehicule ?? null,
      p_scheduled_at: input.scheduledAt ?? null,
      p_depart_lat: input.departLat ?? null,
      p_depart_lng: input.departLng ?? null,
      p_dest_lat: input.destLat ?? null,
      p_dest_lng: input.destLng ?? null,
      p_stops: (input.stops ?? []).map((s) => ({ label: s.label, lat: s.lat, lng: s.lng })),
      p_colis_note: input.colisNote ?? null,
      p_manut: input.manut ?? false,
    });
    if (rpcErr) throw rpcErr;
    const rideId = (rid as string) ?? null;
    const futur = !!input.scheduledAt && new Date(input.scheduledAt).getTime() > Date.now() + 60000;
    if (rideId && !futur) { supabase.functions.invoke('dispatch', { body: { action: 'start', rideId } }).catch(() => {}); }
    return rideId;
  }

  // Location horaire « louer un chauffeur » : tarif horaire propre (insert direct).
  const { data: prof } = await supabase.from('profiles').select('prenom, nom, photo_url').eq('id', uid).maybeSingle();
  const passagerNom = prof ? `${prof.prenom ?? ''} ${prof.nom ?? ''}`.trim() || null : null;

  const { data, error } = await supabase
    .from('rides')
    .insert({
      user_id: uid,
      passager_nom: passagerNom,
      passager_photo: (prof as any)?.photo_url ?? null,
      type: input.type,
      tier: input.tier ?? null,
      location_hours: input.locationHours ?? null,
      scheduled_at: input.scheduledAt ?? null,
      shared: input.shared ?? false,
      statut: 'recherche',
      depart: input.depart ?? null,
      destination: input.destination ?? null,
      distance_km: input.distanceKm ?? null,
      prix: input.prix,
      frais_service: input.fraisService ?? 0,
      paiement: input.paiement ?? 'Espèces',
      credit_applied: input.creditApplied ?? 0,
      vehicule: input.vehicule ?? null,
      chauffeur_nom: input.chauffeurNom ?? null,
      chauffeur_note: input.chauffeurNote ?? null,
      plaque: input.plaque ?? null,
      depart_lat: input.departLat ?? null,
      depart_lng: input.departLng ?? null,
      dest_lat: input.destLat ?? null,
      dest_lng: input.destLng ?? null,
      stop1_label: input.stops?.[0]?.label ?? null,
      stop1_lat: input.stops?.[0]?.lat ?? null,
      stop1_lng: input.stops?.[0]?.lng ?? null,
      stop2_label: input.stops?.[1]?.label ?? null,
      stop2_lat: input.stops?.[1]?.lat ?? null,
      stop2_lng: input.stops?.[1]?.lng ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  const rideId = data?.id ?? null;
  // Consomme le crédit Taga utilisé (le cas échéant). On ATTEND le résultat et on trace un échec
  // (avant : fire-and-forget → si l'appel échouait, le client gardait son crédit tout en ayant payé moins).
  if (rideId && (input.creditApplied ?? 0) > 0) {
    const { error: credErr } = await supabase.rpc('consume_credit', { p_amount: input.creditApplied });
    if (credErr) console.error('[taga] consume_credit (location) a échoué', credErr);
  }
  // Réservation future : pas de dispatch immédiat (le cron s'en charge à l'heure prévue).
  const futur = !!input.scheduledAt && new Date(input.scheduledAt).getTime() > Date.now() + 60000;
  // La LOCATION est désormais auto-dispatchée comme une course : elle SONNE chez les chauffeurs
  // qui ont activé le service « location » (retour testeur Retouche 3). L'admin peut toujours
  // assigner manuellement en secours (admin-assign-location).
  if (rideId && !futur) { supabase.functions.invoke('dispatch', { body: { action: 'start', rideId } }).catch(() => {}); }
  return rideId;
}

/** Destinations récentes du client (façon Uber) — dédupliquées, les plus récentes d'abord. */
export async function getRecentDestinations(limit = 6): Promise<{ id: string; label: string; sub: string; point: { latitude: number; longitude: number }; icon: string }[]> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return [];
  const { data } = await supabase.from('rides')
    .select('destination, dest_lat, dest_lng, created_at')
    .eq('user_id', uid)
    .not('destination', 'is', null)
    .not('dest_lat', 'is', null)
    .not('dest_lng', 'is', null)
    .order('created_at', { ascending: false })
    .limit(30);
  const seen = new Set<string>();
  const out: { id: string; label: string; sub: string; point: { latitude: number; longitude: number }; icon: string }[] = [];
  for (const r of (data ?? []) as any[]) {
    const label = String(r.destination).split(' · ')[0].trim(); // retire les suffixes (ex. colis « · Pour X »)
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: 'recent-' + out.length, label, sub: '', point: { latitude: r.dest_lat, longitude: r.dest_lng }, icon: 'time' });
    if (out.length >= limit) break;
  }
  return out;
}

export type ActivityItem = {
  id: string;
  jour: string;
  titre: string;
  heure: string;
  sous: string;
  prix: number;
  statut: string;
  cat: 'Restaurant' | 'Courses' | 'Colis' | 'Déménagement';
  action: string;
  createdAt: string;
};

const STATUT_MOVING: Record<string, string> = {
  nouveau: 'Demande envoyée', devis: 'Devis reçu', confirme: 'Confirmé', planifie: 'Planifié', termine: 'Terminé', annule: 'Annulée',
};

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function jourLabel(d: Date): string {
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const hier = new Date(now); hier.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return "Aujourd'hui";
  if (sameDay(d, hier)) return 'Hier';
  return `${d.getDate()} ${MOIS[d.getMonth()]}`;
}
function heureLabel(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const STATUT_ORDER: Record<string, string> = {
  confirmee: 'Confirmée', preparation: 'En préparation', prete: 'Prête', livraison: 'En livraison', livree: 'Livrée', annulee: 'Annulée',
};
const STATUT_RIDE: Record<string, string> = {
  recherche: 'Recherche', programme: 'Programmée', en_route: 'En route', arrive: 'Arrivé', en_cours: 'En cours', termine: 'Terminée', annule: 'Annulée',
};

export async function getActivity(): Promise<ActivityItem[]> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return [];
  // NB: la policy RLS de `rides` autorise aussi la lecture des courses en
  // `recherche` (le pool chauffeur). On filtre donc explicitement sur user_id
  // pour ne montrer que l'historique de l'utilisateur, pas le pool global.
  const [{ data: orders }, { data: rides }, { data: movings }] = await Promise.all([
    supabase.from('orders').select('*, order_items(qte)').eq('user_id', uid).order('created_at', { ascending: false }),
    supabase.from('rides').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
    supabase.from('moving_requests').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
  ]);

  const items: ActivityItem[] = [];

  for (const o of orders ?? []) {
    const d = new Date(o.created_at);
    const nb = (o.order_items ?? []).reduce((s: number, x: any) => s + (x.qte ?? 1), 0);
    items.push({
      id: 'o_' + o.id, createdAt: o.created_at, jour: jourLabel(d), heure: heureLabel(d),
      titre: o.restaurant_nom ?? 'Commande', sous: `${nb} article${nb > 1 ? 's' : ''}`,
      prix: o.total, statut: STATUT_ORDER[o.statut] ?? o.statut, cat: 'Restaurant', action: 'Commander à nouveau',
    });
  }

  for (const r of rides ?? []) {
    const d = new Date(r.created_at);
    const colis = r.type === 'colis';
    const km = r.distance_km ? ` · ${Number(r.distance_km).toFixed(1).replace('.', ',')} km` : '';
    // Colis reçu (le format destination est « Chez moi · De X (tel) ») vs envoyé (« … · Pour X »).
    const recu = colis && / · De /.test(String(r.destination ?? ''));
    const base = String(r.destination ?? '').split(' · ')[0].trim();
    items.push({
      id: 'r_' + r.id, createdAt: r.created_at, jour: jourLabel(d), heure: heureLabel(d),
      titre: colis
        ? (recu ? `Colis reçu · ${r.depart ?? ''}` : `Colis → ${base}`)
        : (r.destination ?? 'Course'),
      sous: colis ? `${recu ? 'Colis reçu' : 'Colis envoyé'}${km}` : `${r.type === 'moto' ? 'Moto' : 'Taxi'}${km}`,
      prix: r.prix, statut: STATUT_RIDE[r.statut] ?? r.statut,
      cat: colis ? 'Colis' : 'Courses', action: colis ? (recu ? 'Refaire une réception' : 'Renvoyer un colis') : 'Refaire le trajet',
    });
  }

  for (const m of movings ?? []) {
    const d = new Date(m.created_at);
    items.push({
      id: 'm_' + m.id, createdAt: m.created_at, jour: jourLabel(d), heure: heureLabel(d),
      titre: `${m.depart ?? 'Départ'} → ${m.arrivee ?? 'Arrivée'}`,
      sous: `Déménagement${m.volume ? ' · ' + m.volume : ''}`,
      prix: m.prix ?? 0, statut: STATUT_MOVING[m.statut] ?? m.statut,
      cat: 'Déménagement', action: 'Nouvelle demande',
    });
  }

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items;
}

/* ===================== Temps réel (statut live) ===================== */

export type OrderStatut = 'confirmee' | 'preparation' | 'prete' | 'livraison' | 'livree' | 'annulee';
export type RideStatut = 'recherche' | 'programme' | 'en_route' | 'arrive' | 'en_cours' | 'termine' | 'annule';

export async function getOrderStatut(id: string): Promise<OrderStatut | null> {
  const { data } = await supabase.from('orders').select('statut').eq('id', id).maybeSingle();
  return (data?.statut as OrderStatut) ?? null;
}

export async function setOrderStatut(id: string, statut: OrderStatut): Promise<void> {
  await supabase.from('orders').update({ statut }).eq('id', id);
}

/** Confirme la livraison d'un repas avec le code de remise. Renvoie true si code OK. */
export async function deliverOrderWithCode(orderId: string, code: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('driver_deliver_order', { p_order: orderId, p_code: code });
  if (error) throw error;
  return data === true;
}

/** Confirme la remise d'un colis avec le code de remise. Renvoie true si code OK. */
export async function deliverColisWithCode(rideId: string, code: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('driver_deliver_colis', { p_ride: rideId, p_code: code });
  if (error) throw error;
  return data === true;
}

export async function setRideStatut(id: string, statut: RideStatut): Promise<void> {
  await supabase.from('rides').update({ statut }).eq('id', id);
  // Notifie le client (push distant) aux étapes clés.
  const msg: Partial<Record<RideStatut, [string, string]>> = {
    arrive: ['Ton chauffeur est arrivé', 'Rejoins-le au point de rendez-vous.'],
    en_cours: ['Course démarrée', 'Bon trajet avec Taga !'],
    termine: ['Course terminée', 'Merci d\'avoir voyagé avec Taga.'],
  };
  const m = msg[statut];
  if (m) {
    const { data } = await supabase.from('rides').select('user_id').eq('id', id).maybeSingle();
    if (data?.user_id) sendPushToUser(data.user_id, m[0], m[1]);
  }
}

/** Le chauffeur diffuse sa position GPS réelle pendant la course.
 *  Note cap : `rides` ne stocke que la position (pas de colonne heading — seule `driver_presence`
 *  en a une). Le client oriente donc le véhicule à partir du relèvement entre deux positions
 *  successives reçues ici (voir `moveHeading` dans lib/geo.ts) : une donnée réelle, dérivée du
 *  déplacement du chauffeur, jamais un cap inventé. */
export async function updateDriverPosition(id: string, lat: number, lng: number): Promise<void> {
  await supabase.from('rides').update({ driver_lat: lat, driver_lng: lng }).eq('id', id);
}

/** Marque une course comme encaissée (espèces reçues). */
export async function markRidePaid(id: string): Promise<void> {
  await supabase.from('rides').update({ paye: true }).eq('id', id);
}

/** Clôture serveur d'une course (voiture/moto) : ajoute le supplément d'attente/arrêt (borné côté
 *  serveur), passe la course en « termine » et marque encaissé — le tout de façon atomique.
 *  Renvoie le prix final réellement enregistré. Remplace setRideStatut('termine')+markRidePaid pour
 *  que les suppléments soient PERSISTÉS (comptés dans les gains/l'historique). */
export async function closeRide(id: string, extra = 0): Promise<number | null> {
  const { data, error } = await supabase.rpc('close_ride', { p_ride_id: id, p_extra: Math.max(0, Math.round(extra)) });
  if (error) throw error;
  return typeof data === 'number' ? data : null;
}

/** Le client enregistre sa note + pourboire + commentaire sur la course. */
export async function setRideRating(
  id: string,
  note: number,
  pourboire = 0,
  commentaire?: string,
): Promise<void> {
  await supabase
    .from('rides')
    .update({ note, pourboire, commentaire: commentaire?.trim() || null })
    .eq('id', id);
}

/** Note donnée par le chauffeur au passager (colonne dédiée, n'écrase pas la note client). */
export async function setPassengerRating(id: string, note: number): Promise<void> {
  await supabase.from('rides').update({ passager_note: note }).eq('id', id);
}

/* ---- Note du PASSAGER (façon Uber) ----
 *
 * Règle absolue : on n'expose JAMAIS le détail course par course, ni QUI a noté.
 * Uniquement une MOYENNE agrégée — sinon le client identifie le chauffeur qui lui a mis
 * 3 étoiles (une course = un chauffeur) et peut se venger ; les chauffeurs cesseraient
 * alors de noter honnêtement.
 *
 * Deux RPC SECURITY DEFINER côté serveur ne renvoient QUE (moyenne, nb) :
 *   - my_passenger_rating()            → le client lit SA propre note.
 *   - ride_passenger_rating(p_ride)    → le chauffeur lit la note du passager d'une course
 *                                        (autorisé seulement s'il a une offre dessus ou en est
 *                                        le chauffeur assigné).
 * SEUIL : en dessous de 3 notes, `moyenne` vaut NULL (mais `nb` donne le compte réel).
 * Donc `moyenne === null` = « pas encore de note à afficher ». On n'invente JAMAIS de note :
 * la moindre erreur retombe sur { moyenne: null, nb: 0 }.
 */
export type PassengerRating = { moyenne: number | null; nb: number };

/** Lit une ligne (moyenne, nb) renvoyée par une RPC TABLE. Repli sûr : aucune note fabriquée. */
function toPassengerRating(data: any): PassengerRating {
  const row: any = Array.isArray(data) ? data[0] : data;
  if (!row) return { moyenne: null, nb: 0 };
  const m = row.moyenne == null ? null : Number(row.moyenne);
  const n = Number(row.nb);
  return {
    moyenne: m != null && Number.isFinite(m) ? m : null,
    nb: Number.isFinite(n) && n > 0 ? n : 0,
  };
}

/** Le client lit SA propre note de passager (moyenne agrégée uniquement). */
export async function getMyPassengerRating(): Promise<PassengerRating> {
  try {
    const { data, error } = await supabase.rpc('my_passenger_rating');
    if (error) return { moyenne: null, nb: 0 };
    return toPassengerRating(data);
  } catch {
    return { moyenne: null, nb: 0 };
  }
}

/** Le chauffeur lit la note du passager d'une course (avant d'accepter). Moyenne agrégée uniquement. */
export async function getRidePassengerRating(rideId: string): Promise<PassengerRating> {
  try {
    const { data, error } = await supabase.rpc('ride_passenger_rating', { p_ride: rideId });
    if (error) return { moyenne: null, nb: 0 };
    return toPassengerRating(data);
  } catch {
    return { moyenne: null, nb: 0 };
  }
}

/* La note du client est la MÊME sur tous les services (courses, repas, déménagements) : côté serveur
 * `note_client_agregee` agrège les trois. Un client odieux en livraison de repas voit donc sa note
 * baisser exactement comme en course — et le chauffeur d'à côté le sait avant d'accepter. */

/** Le livreur lit la note du client d'une commande (avant d'accepter). Moyenne agrégée uniquement. */
export async function getOrderClientRating(orderId: string): Promise<PassengerRating> {
  try {
    const { data, error } = await supabase.rpc('order_client_rating', { p_order: orderId });
    if (error) return { moyenne: null, nb: 0 };
    return toPassengerRating(data);
  } catch {
    return { moyenne: null, nb: 0 };
  }
}

/** Le livreur ASSIGNÉ note le client une fois la commande livrée. Le serveur borne 1..5 et vérifie tout.
 *  L'erreur remonte : un échec d'enregistrement ne doit jamais passer inaperçu. */
export async function setOrderClientRating(orderId: string, note: number): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_order_client_rating', { p_order: orderId, p_note: note });
  if (error) throw error;
  return data === true;
}

/** Le chauffeur camion ASSIGNÉ note le client une fois le déménagement terminé. Idem : l'erreur remonte. */
export async function setMovingClientRating(movingId: string, note: number): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_moving_client_rating', { p_moving: movingId, p_note: note });
  if (error) throw error;
  return data === true;
}

/** S'abonne aux changements de statut d'une commande. Renvoie une fonction de désabonnement. */
export function subscribeOrder(id: string, onStatut: (statut: OrderStatut) => void): () => void {
  const ch = supabase
    .channel(`order:${id}:${chId()}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
      (payload: any) => { if (payload.new?.statut) onStatut(payload.new.statut as OrderStatut); })
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/* ---- Suivi live du livreur (repas) ---- */

export type OrderLive = {
  statut: OrderStatut;
  livreurNom: string | null;
  livreurTel: string | null;
  livreurPhoto: string | null;
  driverLat: number | null;
  driverLng: number | null;
  annulRaison: string | null;
};

function toOrderLive(row: any): OrderLive {
  return {
    statut: row.statut as OrderStatut,
    livreurNom: row.livreur_nom ?? null,
    livreurTel: row.livreur_tel ?? null,
    livreurPhoto: row.livreur_photo ?? null,
    driverLat: row.driver_lat ?? null,
    driverLng: row.driver_lng ?? null,
    annulRaison: row.annul_raison ?? null,
  };
}

export type OrderDetail = {
  id: string;
  restaurant_nom: string | null;
  restaurant_id?: string | null;
  total: number;
  sous_total: number | null;
  frais_livraison: number | null;
  frais_service: number | null;
  pourboire: number | null;
  paiement: string | null;
  adresse: string | null;
  statut: string;
  created_at: string;
  delivery_code: string | null;
  items: { nom: string; prix: number; qte: number }[];
};

/** Détail complet d'une commande (avec ses articles) — pour le reçu. */
export async function getOrder(id: string): Promise<OrderDetail | null> {
  const { data } = await supabase
    .from('orders')
    .select('*, order_items(nom, prix, qte)')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const d = data as any;
  return { ...d, items: d.order_items ?? [] } as OrderDetail;
}

/** Coordonnées réelles d'une commande : restaurant (récupération) + client (livraison). */
export async function getOrderRoute(id: string): Promise<{ resto: { latitude: number; longitude: number } | null; client: { latitude: number; longitude: number } | null }> {
  const { data: o } = await supabase.from('orders').select('dest_lat, dest_lng, restaurant_id').eq('id', id).maybeSingle();
  const od = o as any;
  let client: { latitude: number; longitude: number } | null = null;
  let resto: { latitude: number; longitude: number } | null = null;
  if (od?.dest_lat != null && od?.dest_lng != null) client = { latitude: Number(od.dest_lat), longitude: Number(od.dest_lng) };
  if (od?.restaurant_id) {
    const { data: r } = await supabase.from('restaurants').select('lat, lng').eq('id', od.restaurant_id).maybeSingle();
    const rd = r as any;
    if (rd?.lat != null && rd?.lng != null) resto = { latitude: Number(rd.lat), longitude: Number(rd.lng) };
  }
  return { resto, client };
}

/** État live d'une commande (statut + livreur + position GPS). */
export async function getOrderLive(id: string): Promise<OrderLive | null> {
  const { data } = await supabase
    .from('orders')
    .select('statut, livreur_nom, livreur_tel, livreur_photo, driver_lat, driver_lng, annul_raison')
    .eq('id', id)
    .maybeSingle();
  return data ? toOrderLive(data) : null;
}

/** S'abonne à l'état live complet d'une commande (statut + position du livreur). */
export function subscribeOrderLive(id: string, onLive: (live: OrderLive) => void): () => void {
  const ch = supabase
    .channel(`order_live:${id}:${chId()}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
      (payload: any) => { if (payload.new) onLive(toOrderLive(payload.new)); })
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/** Assigne un livreur à une commande (côté coursier / dispatch). */
export async function assignOrderCourier(orderId: string, nom: string, tel?: string, driverId?: string): Promise<void> {
  await supabase.from('orders').update({
    livreur_nom: nom,
    livreur_tel: tel ?? null,
    driver_id: driverId ?? null,
    statut: 'livraison',
  }).eq('id', orderId);
}

/** Le livreur diffuse sa position GPS réelle pendant la livraison. */
export async function updateOrderPosition(orderId: string, lat: number, lng: number): Promise<void> {
  await supabase.from('orders').update({ driver_lat: lat, driver_lng: lng }).eq('id', orderId);
}

/* ---- Côté livreur (app chauffeur) : livraisons à prendre ---- */

export type DeliveryOrder = {
  id: string;
  restaurant_nom: string | null;
  adresse: string | null;
  total: number; // ce que paie le CLIENT en tout — jamais le gain du livreur
  frais_livraison: number | null; // base du gain du livreur (voir gainLivraison)
  pourboire: number | null; // revient au livreur, en plus
  client_nom: string | null;
  client_photo: string | null;
  statut: OrderStatut;
  driver_id: string | null;
  livreur_nom: string | null;
  created_at: string;
};

const DELIV_COLS = 'id, restaurant_nom, adresse, total, frais_livraison, pourboire, client_nom, client_photo, statut, driver_id, livreur_nom, created_at';

/** Livraisons disponibles (prêtes, pas encore prises par un livreur). */
export async function getPendingDeliveries(): Promise<DeliveryOrder[]> {
  const { data } = await supabase
    .from('orders')
    .select(DELIV_COLS)
    .in('statut', ['prete', 'livraison'])
    .is('driver_id', null)
    .order('created_at', { ascending: false })
    .limit(20);
  return (data ?? []) as DeliveryOrder[];
}

/** Course ou commande active du CLIENT connecté (pour le bandeau « en cours » sur l'accueil). */
export type ActiveTrip = { kind: 'ride' | 'order'; id: string; statut: string; label: string };
export async function getMyClientTrip(): Promise<ActiveTrip | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data: r } = await supabase
    .from('rides')
    .select('id, statut, destination')
    .eq('user_id', uid)
    .in('statut', ['recherche', 'en_route', 'arrive', 'en_cours'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (r) return { kind: 'ride', id: (r as any).id, statut: (r as any).statut, label: (r as any).destination || 'Course en cours' };
  const { data: o } = await supabase
    .from('orders')
    .select('id, statut, restaurant_nom')
    .eq('user_id', uid)
    .not('statut', 'in', '("livree","annulee")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (o) return { kind: 'order', id: (o as any).id, statut: (o as any).statut, label: (o as any).restaurant_nom || 'Commande en cours' };
  return null;
}

/** La course en cours du chauffeur connecté (reprise au redémarrage / changement de téléphone). */
export async function getMyActiveRide(): Promise<DriverRide | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data } = await supabase
    .from('rides')
    .select('*')
    .eq('driver_id', uid)
    .in('statut', ['en_route', 'arrive', 'en_cours'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? (data as DriverRide) : null;
}

/** Détail d'une commande de livraison par id (pour afficher une offre). */
export async function getDeliveryOrderById(orderId: string): Promise<DeliveryOrder | null> {
  const { data } = await supabase.from('orders').select(DELIV_COLS).eq('id', orderId).maybeSingle();
  return (data as DeliveryOrder) ?? null;
}

/** La livraison active du livreur connecté (s'il en a accepté une). */
export async function getMyActiveDelivery(): Promise<DeliveryOrder | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data } = await supabase
    .from('orders')
    .select(DELIV_COLS)
    .eq('driver_id', uid)
    .in('statut', ['prete', 'livraison'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as DeliveryOrder) ?? null;
}

/** Le livreur prend une livraison (claim atomique : seulement si libre). */
export async function acceptDelivery(orderId: string, nom: string, tel?: string): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return false;
  const { data, error } = await supabase
    .from('orders')
    .update({ driver_id: uid, livreur_nom: nom, livreur_tel: tel ?? null, statut: 'livraison' })
    .eq('id', orderId)
    .is('driver_id', null)
    .in('statut', ['prete', 'livraison']) // jamais réattribuer une commande livrée/annulée
    .select('id');
  if (error) return false;
  return !!(data && data.length);
}

/** S'abonne aux changements du pool de livraisons (prêtes). */
export function subscribePendingDeliveries(onChange: () => void): () => void {
  const ch = supabase
    .channel(`pending_deliveries:${chId()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: 'statut=eq.livraison' }, () => onChange())
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/* ---- Dispatch livraisons (offres séquentielles, comme les courses) ---- */

export type DeliveryOffer = {
  id: string;
  order_id: string;
  driver_id: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  expires_at: string;
  created_at: string;
};

/** Offre de livraison en attente pour le chauffeur connecté. */
/** Offre de livraison en attente. Même garde que getMyPendingOffer : jamais une offre expirée. */
export async function getMyDeliveryOffer(driverId: string): Promise<DeliveryOffer | null> {
  const { data } = await supabase
    .from('delivery_offers')
    .select('*')
    .eq('driver_id', driverId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as DeliveryOffer) ?? null;
}

/** S'abonne aux livraisons assignées directement à ce chauffeur (par l'admin). */
export function subscribeMyDeliveries(driverId: string, onChange: () => void): () => void {
  const ch = supabase
    .channel(`my_deliveries:${driverId}:${chId()}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `driver_id=eq.${driverId}` }, () => onChange())
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/** S'abonne aux nouvelles offres de livraison adressées à ce chauffeur. */
export function subscribeMyDeliveryOffers(driverId: string, onOffer: (o: DeliveryOffer) => void): () => void {
  const ch = supabase
    .channel(`delivery_offers:${driverId}:${chId()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'delivery_offers', filter: `driver_id=eq.${driverId}` },
      (payload: any) => { if (payload.new?.status === 'pending') onOffer(payload.new as DeliveryOffer); })
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/** Le chauffeur accepte une offre de livraison (assignation autoritaire côté serveur). */
export async function acceptDeliveryOffer(offerId: string): Promise<{ ok: boolean; orderId?: string; reason?: string }> {
  const { data, error } = await supabase.functions.invoke('dispatch', { body: { action: 'accept-delivery', offerId } });
  if (error) return { ok: false, reason: 'network' };
  return (data as any) ?? { ok: false };
}

/** Le chauffeur refuse / laisse expirer une offre de livraison → réassignation au suivant. */
export async function respondDeliveryOffer(offerId: string, action: 'decline' | 'expire'): Promise<void> {
  try { await supabase.functions.invoke('dispatch', { body: { action: action === 'expire' ? 'expire-delivery' : 'decline-delivery', offerId } }); } catch { /* ignore */ }
}

/** Lance le dispatch d'une livraison (appelé quand le marchand passe la commande en livraison). */
export async function startDeliveryDispatch(orderId: string): Promise<void> {
  try { await supabase.functions.invoke('dispatch', { body: { action: 'start-delivery', orderId } }); } catch { /* ignore */ }
}

/** S'abonne aux changements de statut d'une course. Renvoie une fonction de désabonnement. */
export function subscribeRide(
  id: string,
  onStatut: (statut: RideStatut) => void,
  onRow?: (row: DriverRide) => void,
): () => void {
  const ch = supabase
    .channel(`ride:${id}:${chId()}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${id}` },
      (payload: any) => {
        if (payload.new?.statut) onStatut(payload.new.statut as RideStatut);
        if (onRow && payload.new) onRow(payload.new as DriverRide); // ligne complète (position GPS en direct, etc.)
      })
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/* ===================== Côté chauffeur ===================== */

export type DriverRide = {
  id: string;
  type: 'voiture' | 'moto' | 'colis';
  tier?: string | null;
  shared?: boolean | null;
  share_token?: string | null;
  pool_id?: string | null;
  pool_role?: 'a' | 'b' | null;
  pool_state?: string | null;
  paiement?: string | null;
  credit_applied?: number | null;
  colis_note?: string | null;
  location_hours?: number | null;
  service_started_at?: string | null;
  scheduled_at?: string | null;
  annul_raison?: string | null;
  cancel_fee?: number | null;
  delivery_code?: string | null;
  depart: string | null;
  destination: string | null;
  distance_km: number | null;
  prix: number;
  frais_service?: number | null;
  statut: RideStatut;
  created_at: string;
  chauffeur_nom: string | null;
  chauffeur_note: number | null;
  plaque: string | null;
  vehicule: string | null;
  chauffeur_photo?: string | null;
  passager_nom: string | null;
  passager_photo?: string | null;
  user_id: string;
  driver_id?: string | null;
  depart_lat?: number | null;
  depart_lng?: number | null;
  dest_lat?: number | null;
  dest_lng?: number | null;
  driver_lat?: number | null;
  driver_lng?: number | null;
  note?: number | null;
  pourboire?: number | null;
  commentaire?: string | null;
};

/** Lit une course complète (pour l'affichage côté client : vrai chauffeur + statut). */
export async function getRide(id: string): Promise<DriverRide | null> {
  const { data } = await supabase.from('rides').select('*').eq('id', id).maybeSingle();
  return (data as DriverRide) ?? null;
}

/** Les deux courses (legs) d'un covoiturage jumelé, triées par rôle (a puis b). */
export async function getPoolLegs(poolId: string): Promise<DriverRide[]> {
  const { data } = await supabase.from('rides').select('*').eq('pool_id', poolId).order('pool_role', { ascending: true });
  return (data ?? []) as DriverRide[];
}

/** Offre d'empilement Partage « +1 » en attente pour ce chauffeur (2e course partagée à ajouter). */
export type PartageAddon = { offerId: string; poolId: string; gain: number; depart: string; destination: string };
export async function getPendingPartageAddon(driverId: string): Promise<PartageAddon | null> {
  const { data: off } = await supabase.from('ride_offers')
    .select('id, ride_id, pool_id, expires_at, status')
    .eq('driver_id', driverId).eq('status', 'pending').not('pool_id', 'is', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!off || !(off as any).pool_id) return null;
  const exp = (off as any).expires_at;
  if (exp && new Date(exp).getTime() < Date.now()) return null;
  const { data: r } = await supabase.from('rides').select('prix, depart, destination').eq('id', (off as any).ride_id).maybeSingle();
  return { offerId: (off as any).id, poolId: (off as any).pool_id, gain: Number((r as any)?.prix) || 0, depart: (r as any)?.depart ?? '', destination: (r as any)?.destination ?? '' };
}
/** Le chauffeur accepte l'empilement → renvoie le poolId (bascule ensuite sur l'écran course partagée). */
export async function acceptPartageAddon(offerId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('accept_partage_addon', { p_offer: offerId });
  if (error) throw error;
  return (data as string) ?? null;
}
/** Le chauffeur refuse l'empilement → la course en cours continue seule, la 2e repart en attente. */
export async function declinePartageAddon(offerId: string): Promise<void> {
  await supabase.rpc('decline_partage_addon', { p_offer: offerId });
}
/** Informe les 2 passagers de l'ordre de prise en charge (1er récupéré / 2e récupéré ensuite). */
export async function notifyPoolPickupOrder(firstRideId: string, secondRideId: string): Promise<void> {
  await supabase.rpc('notify_pool_pickup_order', { p_first: firstRideId, p_second: secondRideId });
}

/** Téléphone de l'autre partie d'une course (chauffeur↔client), uniquement si on y participe. */
export async function getRideContactPhone(rideId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('ride_contact_phone', { p_ride: rideId });
  if (error) return null;
  return (data as string | null) ?? null;
}

/** Compteur location : démarre le service (course 'arrive' -> 'en_cours' + horodatage). */
export async function locationStart(rideId: string): Promise<void> {
  const { error } = await supabase.rpc('location_start', { p_ride: rideId });
  if (error) throw error;
}

/** Compteur location : arrête le service, recalcule le total selon la durée réelle (½ h sup., min 0,5 h). */
export async function locationStop(rideId: string): Promise<{ billedHours: number; montant: number }> {
  const { data, error } = await supabase.rpc('location_stop', { p_ride: rideId });
  if (error) throw error;
  const row: any = Array.isArray(data) ? data[0] : data;
  return { billedHours: Number(row?.billed_hours ?? 0), montant: Number(row?.montant ?? 0) };
}

// Une course planifiée pour plus tard ne fait pas partie du pool « live » :
// elle ne sera dispatchée qu'à l'heure prévue (par le cron). On exclut donc
// les courses dont `scheduled_at` est dans le futur des requêtes du pool.
const livePoolFilter = () => `scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()}`;

/**
 * Une course est-elle visible pour ce type de véhicule ?
 * - tricycle : UNIQUEMENT les colis lourds (type=colis, tier=tricycle).
 * - voiture / moto : tout SAUF les colis tricycle.
 * (Aligné sur le dispatch : un tricycle ne fait que du colis lourd, et un colis
 *  tricycle n'est jamais proposé/compté pour les autres chauffeurs.)
 */
export function rideVehOk(type: any, tier: any, vehicle?: string | null): boolean {
  if (!vehicle) return true;
  const isTriRide = type === 'colis' && tier === 'tricycle';
  return String(vehicle) === 'tricycle' ? isTriRide : !isTriRide;
}

/** Courses en attente d'un chauffeur (le pool). */
export async function getPendingRides(): Promise<DriverRide[]> {
  const { data } = await supabase
    .from('rides')
    .select('*')
    .eq('statut', 'recherche')
    .or(livePoolFilter())
    .order('created_at', { ascending: false })
    .limit(10);
  return (data ?? []) as DriverRide[];
}

/** Les courses prises par le chauffeur connecté. */
export async function getDriverRides(): Promise<DriverRide[]> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return [];
  const { data } = await supabase
    .from('rides')
    .select('*')
    .eq('driver_id', uid)
    .order('created_at', { ascending: false });
  return (data ?? []) as DriverRide[];
}

/** Locations PROGRAMMÉES pré-assignées au chauffeur (pas encore actives). */
export async function getMyScheduledRides(): Promise<DriverRide[]> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return [];
  const { data } = await supabase
    .from('rides')
    .select('*')
    .eq('driver_id', uid)
    .eq('statut', 'programme')
    .order('scheduled_at', { ascending: true });
  return (data ?? []) as DriverRide[];
}

/* ===================== Présence & matching ===================== */

type Pt = { latitude: number; longitude: number };
const PRESENCE_FRESH_MS = 120000; // un chauffeur est "en ligne" si vu il y a < 2 min

/** Cap valide ? expo-location renvoie -1 (ou null/NaN) quand le cap est indisponible : véhicule à
 *  l'arrêt, appareil sans magnétomètre, premier point GPS… On ne garde QUE 0–360. */
function capValide(h?: number | null): number | null {
  return typeof h === 'number' && Number.isFinite(h) && h >= 0 && h <= 360 ? h : null;
}

/** Le chauffeur diffuse sa présence + position (appelé régulièrement quand il est en ligne).
 *  `heading` : cap réel en degrés (0 = nord). Voir la règle d'écriture ci-dessous. */
export async function setDriverPresence(lat: number, lng: number, vehicule: string | null, online = true, gamme?: string | null, services?: string[] | null, heading?: number | null): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  const row: any = { driver_id: uid, lat, lng, vehicule, online, updated_at: new Date().toISOString() };
  if (gamme !== undefined) row.gamme = gamme; // gamme voiture (Standard/VIP/SUV) pour le matching
  // Services acceptés (courses / colis / livraison / demenagement) : le dispatch filtre STRICTEMENT dessus.
  if (services !== undefined) row.services = services;
  // Cap : on n'écrit la colonne QUE si la valeur est un vrai cap (0–360). Jamais de valeur bidon :
  // un cap indisponible (-1 / null, typiquement à l'arrêt) n'écrase pas le dernier cap connu en base
  // — le véhicule reste orienté comme il l'était réellement, au lieu de sauter plein nord (0°).
  const cap = capValide(heading);
  if (cap != null) row.heading = cap;
  await supabase.from('driver_presence').upsert(row, { onConflict: 'driver_id' });
}

/** Le chauffeur repasse hors ligne. */
export async function setDriverOffline(): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  await supabase.from('driver_presence').update({ online: false, updated_at: new Date().toISOString() }).eq('driver_id', uid);
}

/** Chauffeurs en ligne proches d'un point (pour la carte client/chauffeur).
 *  `vehicle` filtre par type : 'car' → voitures (taxi), 'moto' → motos (moto/livraison).
 *  `heading` (cap réel) n'est remonté QUE s'il existe en base : jamais fabriqué. Sans cap,
 *  la carte laisse le véhicule dans son orientation par défaut plutôt que d'inventer un angle. */
export async function getNearbyDrivers(point: Pt, radiusKm = 6, vehicle?: 'car' | 'moto' | 'tricycle'): Promise<(Pt & { heading?: number })[]> {
  const since = new Date(Date.now() - PRESENCE_FRESH_MS).toISOString();
  const { data } = await supabase
    .from('driver_presence')
    .select('lat, lng, vehicule, heading')
    .eq('online', true)
    .gt('updated_at', since);
  const matchVeh = (v: any) => {
    if (!vehicle) return true;
    const veh = String(v ?? '').toLowerCase();
    if (vehicle === 'car') return veh === 'voiture' || veh === 'car';
    if (vehicle === 'tricycle') return veh === 'tricycle';
    return veh === 'moto';
  };
  return (data ?? [])
    .filter((r: any) => r.lat != null && r.lng != null && matchVeh(r.vehicule))
    .map((r: any) => {
      const p: Pt & { heading?: number } = { latitude: r.lat as number, longitude: r.lng as number };
      const cap = capValide(r.heading);
      if (cap != null) p.heading = cap; // pas de cap en base → on n'invente rien
      return p;
    })
    .filter((p) => distanceKm(point, p) <= radiusKm);
}

/** Compteurs réels : chauffeurs en ligne + demandes en attente (filtrées selon le véhicule). */
export async function getMatchingCounts(vehicle?: string | null): Promise<{ chauffeurs: number; demandes: number }> {
  const since = new Date(Date.now() - PRESENCE_FRESH_MS).toISOString();
  const [d, r] = await Promise.all([
    supabase.from('driver_presence').select('driver_id', { count: 'exact', head: true }).eq('online', true).gt('updated_at', since),
    supabase.from('rides').select('type, tier').eq('statut', 'recherche').or(livePoolFilter()),
  ]);
  const demandes = ((r.data ?? []) as any[]).filter((x) => rideVehOk(x.type, x.tier, vehicle)).length;
  return { chauffeurs: d.count ?? 0, demandes };
}

/** Distance (km) entre un point et le départ d'une course (helper matching). */
export function ridePickupDistance(point: Pt, ride: DriverRide): number | null {
  if (ride.depart_lat == null || ride.depart_lng == null) return null;
  return distanceKm(point, { latitude: ride.depart_lat, longitude: ride.depart_lng });
}

/** Zones de demande calculées en direct depuis les courses en attente (par quartier). */
export async function getDemandZones(vehicle?: string | null): Promise<Zone[]> {
  const { data } = await supabase
    .from('rides')
    .select('depart_lat, depart_lng, type, tier')
    .eq('statut', 'recherche')
    .or(livePoolFilter());
  const pts = (data ?? [])
    .filter((r: any) => r.depart_lat != null && r.depart_lng != null && rideVehOk(r.type, r.tier, vehicle))
    .map((r: any) => ({ latitude: r.depart_lat as number, longitude: r.depart_lng as number }));

  return bamakoZones.map((z) => {
    const count = pts.filter((p) => distanceKm(p, z.point) <= 2).length;
    const level: DemandLevel = count >= 3 ? 'forte' : count >= 1 ? 'moyenne' : 'faible';
    return { point: z.point, nom: z.nom, level, count: count > 0 ? count : undefined };
  });
}

/** S'abonne aux courses qui me sont assignées (dispatch admin) : statut passe à « en_route ». */
export function subscribeAssignedRides(driverId: string, onAssigned: (rideId: string) => void): () => void {
  const ch = supabase
    .channel(`assigned:${driverId}:${chId()}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `driver_id=eq.${driverId}` },
      (payload: any) => { if (payload.new?.statut === 'en_route' && payload.new?.id) onAssigned(payload.new.id as string); })
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/** S'abonne aux déménagements ASSIGNÉS à ce chauffeur camion (temps réel) : quand l'admin lui
 *  attribue une demande, `driver_id` devient le sien → l'app SONNE et l'affiche (retour testeur R4).
 *  L'appelant dé-doublonne par id. */
export function subscribeAssignedMovings(driverId: string, onAssigned: (movingId: string) => void): () => void {
  const ch = supabase
    .channel(`assigned-moving:${driverId}:${chId()}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'moving_requests', filter: `driver_id=eq.${driverId}` },
      (payload: any) => {
        const n = payload.new;
        // On sonne à l'assignation (l'admin passe la demande en « planifie » en attribuant le chauffeur)
        // et à la mise en route — jamais sur un simple « terminé ».
        if (n?.id && (n.statut === 'planifie' || n.statut === 'confirme' || n.statut === 'en_route' || n.statut === 'assigne')) onAssigned(n.id as string);
      })
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/** S'abonne aux nouvelles courses en attente (temps réel). */
export function subscribePendingRides(onNew: (ride: DriverRide) => void): () => void {
  const ch = supabase
    .channel(`pending-rides:${chId()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides' },
      (payload: any) => {
        const n = payload.new;
        // Ignore les réservations planifiées dans le futur (dispatchées plus tard par le cron).
        const futur = n?.scheduled_at && new Date(n.scheduled_at).getTime() > Date.now();
        if (n?.statut === 'recherche' && !futur) onNew(n as DriverRide);
      })
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/* ===================== Dispatch serveur (offres séquentielles) ===================== */

export type RideOffer = {
  id: string;
  ride_id: string;
  driver_id: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  distance_km: number | null;
  expires_at: string;
  created_at: string;
  pool_id?: string | null;   // offre de covoiturage : sert 2 courses jumelées
};

/** Offre en attente pour le chauffeur connecté (s'il y en a une). */
/**
 * Offre de course en attente pour ce chauffeur.
 *
 * ⚠️ Le filtre `expires_at > maintenant` est INDISPENSABLE : le statut reste 'pending' en base
 * tant que le chauffeur (ou le reaper) n'a pas répondu. Sans ce filtre, une offre déjà MORTE
 * remontait comme vivante — le chauffeur ouvrait l'app depuis la notif, voyait une demande,
 * l'acceptait, et le serveur la rejetait.
 */
export async function getMyPendingOffer(driverId: string): Promise<RideOffer | null> {
  const { data } = await supabase
    .from('ride_offers')
    .select('*')
    .eq('driver_id', driverId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as RideOffer) ?? null;
}

/** S'abonne aux nouvelles offres de course adressées à ce chauffeur. */
export function subscribeMyOffers(driverId: string, onOffer: (o: RideOffer) => void): () => void {
  const ch = supabase
    .channel(`ride_offers:${driverId}:${chId()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ride_offers', filter: `driver_id=eq.${driverId}` },
      (payload: any) => { if (payload.new?.status === 'pending') onOffer(payload.new as RideOffer); })
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/** Le chauffeur accepte une offre (assignation autoritaire côté serveur). */
export async function acceptOffer(offerId: string): Promise<{ ok: boolean; rideId?: string; pool?: string; reason?: string }> {
  const { data, error } = await supabase.functions.invoke('dispatch', { body: { action: 'accept', offerId } });
  if (error) return { ok: false, reason: 'network' };
  return (data as any) ?? { ok: false };
}

/** Le chauffeur refuse (ou laisse expirer) une offre → réassignation au suivant. */
export async function respondOffer(offerId: string, action: 'decline' | 'expire'): Promise<void> {
  try { await supabase.functions.invoke('dispatch', { body: { action, offerId } }); } catch { /* ignore */ }
}

/** Le chauffeur refuse une LOCATION qui lui a été assignée (avant de la démarrer) → retour file admin. */
export async function refuseLocation(rideId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('driver_refuse_location', { p_ride: rideId });
  if (error) throw error;
  return data === true;
}

/** Relance le dispatch d'une course encore en recherche (filet de sécurité). */
export async function redispatchRide(rideId: string): Promise<void> {
  try { await supabase.functions.invoke('dispatch', { body: { action: 'start', rideId } }); } catch { /* ignore */ }
}

/* ===================== Messagerie (client ↔ chauffeur) ===================== */

export type Message = {
  id: string;
  ride_id: string | null;
  order_id?: string | null;
  sender_id: string;
  sender_role: 'client' | 'driver';
  texte: string;
  created_at: string;
};

export async function getMessages(rideId: string): Promise<Message[]> {
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('ride_id', rideId)
    .order('created_at', { ascending: true });
  return (data ?? []) as Message[];
}

export async function sendMessage(rideId: string, role: 'client' | 'driver', texte: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Non connecté');
  const { error } = await supabase
    .from('messages')
    .insert({ ride_id: rideId, sender_id: uid, sender_role: role, texte });
  if (error) throw error;
}

/* ---- Messagerie commande (client ↔ livreur) ---- */

export async function getOrderMessages(orderId: string): Promise<Message[]> {
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  return (data ?? []) as Message[];
}

export async function sendOrderMessage(orderId: string, role: 'client' | 'driver', texte: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Non connecté');
  const { error } = await supabase
    .from('messages')
    .insert({ order_id: orderId, sender_id: uid, sender_role: role, texte });
  if (error) throw error;
}

/** S'abonne aux nouveaux messages d'une commande. */
export function subscribeOrderMessages(orderId: string, onNew: (m: Message) => void): () => void {
  const ch = supabase
    .channel(`order_messages:${orderId}:${chId()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `order_id=eq.${orderId}` },
      (payload: any) => onNew(payload.new as Message))
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/** S'abonne aux nouveaux messages d'une course. Renvoie une fonction de désabonnement. */
export function subscribeMessages(rideId: string, onNew: (m: Message) => void): () => void {
  const ch = supabase
    .channel(`messages:${rideId}:${chId()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `ride_id=eq.${rideId}` },
      (payload: any) => onNew(payload.new as Message))
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/* ===================== Déménagement (devis / réservation) ===================== */

export type MovingInput = {
  depart?: string; departLat?: number | null; departLng?: number | null; departEtage?: string;
  arrivee?: string; arriveeLat?: number | null; arriveeLng?: number | null; arriveeEtage?: string;
  volume?: string; dateSouhaitee?: string | null; creneau?: string;
  manutentionnaires?: number; options?: string; note?: string;
};

export type MovingRequest = {
  id: string; depart: string | null; depart_etage: string | null; arrivee: string | null; arrivee_etage: string | null;
  volume: string | null; date_souhaitee: string | null; creneau: string | null; manutentionnaires: number;
  // `note` = les CONSIGNES écrites par le client (texte libre). À ne jamais confondre avec
  // `client_note` = la note (1..5) que le chauffeur camion met au client.
  options: string | null; note: string | null; statut: string; prix: number | null; created_at: string; paye?: boolean;
  client_note?: number | null;
  driver_nom?: string | null; driver_id?: string | null;
};

/** Détail d'une demande de déménagement du client connecté. */
export async function getMovingRequest(id: string): Promise<MovingRequest | null> {
  const { data } = await supabase.from('moving_requests').select('*').eq('id', id).maybeSingle();
  return (data as MovingRequest) ?? null;
}

/** Le client accepte le devis de son déménagement (devis → confirmé). */
export async function confirmMoving(id: string): Promise<void> {
  const { error } = await supabase.rpc('confirm_moving', { p_id: id });
  if (error) throw error;
}

/** Déménagements assignés au chauffeur connecté (RLS : driver_id = moi). */
export async function getMyMovings(): Promise<MovingRequest[]> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return [];
  const { data } = await supabase.from('moving_requests').select('*').eq('driver_id', uid).order('date_souhaitee', { ascending: true });
  return (data ?? []) as MovingRequest[];
}

/** Historique des livraisons de repas effectuées par le livreur connecté (toutes, récentes d'abord). */
export async function getDriverDeliveries(): Promise<DeliveryOrder[]> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return [];
  const { data } = await supabase.from('orders').select(DELIV_COLS).eq('driver_id', uid).order('created_at', { ascending: false });
  return (data ?? []) as DeliveryOrder[];
}

/** Téléphone de l'autre partie d'un déménagement (client↔chauffeur), si on y participe. */
export async function getMovingContactPhone(movingId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('moving_contact_phone', { p_moving: movingId });
  if (error) return null;
  return (data as string | null) ?? null;
}

/** Le chauffeur marque un déménagement comme terminé. */
export async function markMovingDone(id: string): Promise<void> {
  const { error } = await supabase.from('moving_requests').update({ statut: 'termine' }).eq('id', id);
  if (error) throw error;
}

/** Le chauffeur camion fait avancer le statut d'exécution : en_route → arrive → termine. */
export async function setMovingStatut(id: string, statut: 'en_route' | 'arrive' | 'termine'): Promise<void> {
  const { error } = await supabase.from('moving_requests').update({ statut }).eq('id', id);
  if (error) throw error;
}

/** Envoie une demande de déménagement (traitée en devis par l'admin). Renvoie l'id. */
export async function createMovingRequest(input: MovingInput): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Non connecté');
  const { data, error } = await supabase.from('moving_requests').insert({
    user_id: uid,
    depart: input.depart ?? null, depart_lat: input.departLat ?? null, depart_lng: input.departLng ?? null, depart_etage: input.departEtage ?? null,
    arrivee: input.arrivee ?? null, arrivee_lat: input.arriveeLat ?? null, arrivee_lng: input.arriveeLng ?? null, arrivee_etage: input.arriveeEtage ?? null,
    volume: input.volume ?? null, date_souhaitee: input.dateSouhaitee ?? null, creneau: input.creneau ?? null,
    manutentionnaires: input.manutentionnaires ?? 0, options: input.options ?? null, note: input.note ?? null,
  }).select('id').single();
  if (error) throw error;
  return (data as any)?.id ?? null;
}

/* ===================== Messagerie support (utilisateur ↔ admin Taga) ===================== */

export type SupportMsg = { id: string; user_id: string; sender: 'user' | 'admin'; texte: string; created_at: string };

/** Fil de discussion support de l'utilisateur connecté. */
export async function getSupportMessages(): Promise<SupportMsg[]> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return [];
  const { data } = await supabase
    .from('support_messages')
    .select('id,user_id,sender,texte,created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: true });
  return (data ?? []) as SupportMsg[];
}

/** Envoie un message au support (côté utilisateur). */
export async function sendSupportMessage(texte: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Non connecté');
  const { error } = await supabase
    .from('support_messages')
    .insert({ user_id: uid, sender: 'user', texte });
  if (error) throw error;
}

/** Marque comme lus les messages du support reçus par l'utilisateur. */
export async function markSupportRead(): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  await supabase.from('support_messages').update({ read_user: true }).eq('user_id', uid).eq('sender', 'admin').eq('read_user', false);
}

/** S'abonne au fil support de l'utilisateur connecté. */
export function subscribeSupportMessages(userId: string, onNew: (m: SupportMsg) => void): () => void {
  const ch = supabase
    .channel(`support:${userId}:${chId()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `user_id=eq.${userId}` },
      (payload: any) => onNew(payload.new as SupportMsg))
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/** Nombre de messages support non lus (pour le badge). */
export async function getSupportUnread(): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return 0;
  const { count } = await supabase
    .from('support_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid).eq('sender', 'admin').eq('read_user', false);
  return count ?? 0;
}

/* ===================== Profil utilisateur ===================== */

export type Profile = { id: string; prenom: string | null; nom: string | null; phone: string | null };

export async function getProfile(): Promise<Profile | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data } = await supabase.from('profiles').select('id, prenom, nom, phone').eq('id', uid).maybeSingle();
  return (data as Profile) ?? null;
}

export async function updateProfile(input: { prenom?: string; nom?: string; phone?: string }): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Non connecté');
  const { error } = await supabase.from('profiles').update({
    prenom: input.prenom, nom: input.nom, phone: input.phone, updated_at: new Date().toISOString(),
  }).eq('id', uid);
  if (error) throw error;
}

/* ===================== Adresses ===================== */

export type Address = { id: string; label: string; detail: string; lat: number | null; lng: number | null; is_default: boolean };

// ⚠️ Toutes les fonctions d'adresse VÉRIFIENT l'erreur Supabase et la propagent.
// Avant, l'erreur était ignorée (`const { data } = ...`) : un enregistrement refusé
// affichait quand même « Adresse enregistrée » et l'adresse n'existait nulle part.

/** Adresses de l'utilisateur : la « par défaut » d'abord, puis la PLUS RÉCENTE. */
export async function getAddresses(): Promise<Address[]> {
  const { data, error } = await supabase
    .from('addresses')
    .select('*')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false }); // la plus récente en tête (avant : la plus ancienne)
  if (error) throw error;
  return (data ?? []) as Address[];
}

export async function getDefaultAddress(): Promise<Address | null> {
  const list = await getAddresses();
  return list.find((a) => a.is_default) ?? list[0] ?? null;
}

/** Identifiant de l'utilisateur connecté, lu EN LOCAL (pas d'appel réseau, pas de faux « Non connecté »). */
async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) throw new Error('Non connecté');
  return uid;
}

export async function saveAddress(input: { id?: string; label: string; detail: string; lat?: number | null; lng?: number | null; is_default?: boolean }): Promise<string | null> {
  const uid = await currentUserId();

  // Première adresse enregistrée → elle devient AUTOMATIQUEMENT l'adresse par défaut.
  // Sans ça, aucune adresse n'était jamais « par défaut » et le checkout retombait
  // sur une adresse arbitraire : la « Maison » que le client venait d'ajouter ne sortait jamais.
  let parDefaut = input.is_default ?? false;
  if (!parDefaut && !input.id) {
    const { count, error: cErr } = await supabase
      .from('addresses')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid);
    if (cErr) throw cErr;
    if ((count ?? 0) === 0) parDefaut = true;
  }

  if (parDefaut) {
    const { error } = await supabase.from('addresses').update({ is_default: false }).eq('user_id', uid);
    if (error) throw error;
  }

  const champs = {
    label: input.label,
    detail: input.detail,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    is_default: parDefaut,
  };

  if (input.id) {
    const { error } = await supabase.from('addresses').update(champs).eq('id', input.id).eq('user_id', uid);
    if (error) throw error;
    return input.id;
  }

  const { data, error } = await supabase
    .from('addresses')
    .insert({ user_id: uid, ...champs })
    .select('id')
    .single();
  if (error) throw error;
  if (!data?.id) throw new Error("L'adresse n'a pas pu être enregistrée.");
  return data.id;
}

/**
 * Rattrapage : certaines adresses ont été enregistrées AVANT que le formulaire ne géocode
 * systématiquement (lat/lng à null). Sans coordonnées, on ne peut ni les proposer comme
 * destination ni sauter le géocodage. On les géocode une fois à partir de leur texte
 * et on complète la ligne en base.
 *
 * Silencieux et best-effort : une adresse introuvable reste simplement sans coordonnées.
 * Retourne le nombre d'adresses réparées.
 */
export async function repairAddressCoords(list?: Address[]): Promise<number> {
  const { searchPlaces } = await import('./geo'); // import paresseux : évite tout cycle db <-> geo
  const adresses = list ?? (await getAddresses());
  const aReparer = adresses.filter((a) => a.lat == null || a.lng == null);
  if (aReparer.length === 0) return 0;

  const uid = await currentUserId();
  let repares = 0;

  for (const a of aReparer) {
    const texte = (a.detail ?? '').trim();
    if (texte.length < 3) continue; // le géocodeur ne répond pas en dessous
    try {
      const trouves = await searchPlaces(texte);
      const p = trouves[0];
      if (!p) continue;
      const { error } = await supabase
        .from('addresses')
        .update({ lat: p.point.latitude, lng: p.point.longitude })
        .eq('id', a.id)
        .eq('user_id', uid);
      if (!error) repares += 1;
    } catch {
      /* réseau/géocodeur indisponible : on retentera au prochain passage */
    }
  }
  return repares;
}

export async function deleteAddress(id: string): Promise<void> {
  const uid = await currentUserId();
  const { error } = await supabase.from('addresses').delete().eq('id', id).eq('user_id', uid);
  if (error) throw error;
}

export async function setDefaultAddress(id: string): Promise<void> {
  const uid = await currentUserId();
  const { error: e1 } = await supabase.from('addresses').update({ is_default: false }).eq('user_id', uid);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('addresses').update({ is_default: true }).eq('id', id).eq('user_id', uid);
  if (e2) throw e2;
}

/* ===================== Moyens de paiement ===================== */

export type PaymentMethod = { id: string; type: string; label: string; detail: string | null; is_default: boolean };

export async function getPaymentMethods(): Promise<PaymentMethod[]> {
  const { data } = await supabase.from('payment_methods').select('*').order('is_default', { ascending: false }).order('created_at');
  return (data ?? []) as PaymentMethod[];
}

export async function getDefaultPayment(): Promise<PaymentMethod | null> {
  const list = await getPaymentMethods();
  return list.find((p) => p.is_default) ?? list[0] ?? null;
}

export async function savePaymentMethod(input: { id?: string; type: string; label: string; detail?: string; is_default?: boolean }): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Non connecté');
  if (input.is_default) await supabase.from('payment_methods').update({ is_default: false }).eq('user_id', uid);
  if (input.id) {
    await supabase.from('payment_methods').update({ type: input.type, label: input.label, detail: input.detail ?? null, is_default: input.is_default ?? false }).eq('id', input.id);
    return input.id;
  }
  const { data } = await supabase.from('payment_methods').insert({ user_id: uid, type: input.type, label: input.label, detail: input.detail ?? null, is_default: input.is_default ?? false }).select('id').single();
  return data?.id ?? null;
}

export async function deletePaymentMethod(id: string): Promise<void> {
  await supabase.from('payment_methods').delete().eq('id', id);
}

export async function setDefaultPayment(id: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  await supabase.from('payment_methods').update({ is_default: false }).eq('user_id', uid);
  await supabase.from('payment_methods').update({ is_default: true }).eq('id', id);
}

/* ===================== Profil véhicule chauffeur ===================== */

/** Services que le chauffeur peut accepter, selon son type de véhicule.
 *  Source de vérité côté app — DOIT rester alignée avec l'edge function `dispatch`
 *  et la fonction SQL `services_compatibles`.
 *  'courses' = courses VTC / moto-taxi · 'colis' = livraison de colis
 *  'livraison' = livraison de repas · 'demenagement' = camion (assigné par l'admin).
 *
 *  Règle métier : une VOITURE ne transporte QUE des passagers (ni colis, ni repas).
 *  Les colis vont à la MOTO (colis léger) et au TRICYCLE (colis lourd), la livraison
 *  de repas se fait à MOTO uniquement. La moto peut tout faire. */
/**
 * Ce que chaque véhicule a le DROIT de faire. Le chauffeur coche ensuite ce qu'il VEUT faire
 * là-dedans (la location, notamment, ne doit jamais lui être imposée : il prête son véhicule).
 *
 * Règle Taga :
 *   voiture   → passagers + location. JAMAIS de colis ni de livraison de repas.
 *   moto      → passagers + colis + livraison + location.
 *   tricycle  → colis lourd uniquement.
 *   camion    → déménagement uniquement.
 */
export const SERVICES_PAR_VEHICULE: Record<string, string[]> = {
  voiture: ['courses', 'location'],
  moto: ['courses', 'colis', 'livraison', 'location'],
  tricycle: ['colis'],
  camion: ['demenagement'],
};

/** Services compatibles avec un type de véhicule (liste vide si type inconnu). */
export function servicesCompatibles(vehicule: string): string[] {
  return SERVICES_PAR_VEHICULE[vehicule] ?? [];
}

/**
 * Services cochés PAR DÉFAUT : tout ce que le véhicule sait faire, SAUF la location.
 * Prêter son véhicule est un engagement particulier — on ne l'active jamais à la place du
 * chauffeur. Il coche la case s'il le veut ; sinon Taga ne lui proposera aucune location.
 * (Même règle côté serveur : fonction services_defaut().)
 */
export function servicesParDefaut(vehicule: string): string[] {
  return servicesCompatibles(vehicule).filter((s) => s !== 'location');
}

/** Services acceptés par le chauffeur connecté (vide si non renseignés). */
export async function getDriverServices(): Promise<string[]> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return [];
  const { data } = await supabase.from('driver_profiles').select('services').eq('driver_id', uid).maybeSingle();
  const s = (data as any)?.services;
  return Array.isArray(s) ? (s as string[]) : [];
}

/** Enregistre les services acceptés par le chauffeur (erreurs propagées : sans ça il ne recevrait rien). */
export async function saveDriverServices(services: string[]): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Non connecté');
  const { error } = await supabase.from('driver_profiles').upsert({
    driver_id: uid,
    services,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'driver_id' });
  if (error) throw error;
}

/**
 * Icône à afficher sur la carte pour une course donnée.
 *
 * Le type d'une course vaut « voiture », « moto » ou « colis ». Les écrans faisaient
 * `type === 'moto' ? 'moto' : 'car'` — donc un COLIS, qui n'est jamais « moto » au sens strict,
 * s'affichait avec une VOITURE. Or un colis est toujours transporté à moto (ou en tricycle pour
 * le colis lourd). Une seule règle ici, utilisée partout : seule la course « voiture » montre
 * une voiture.
 */
export function iconeCarte(rideType?: string | null): 'car' | 'moto' {
  return (rideType || '').toLowerCase() === 'voiture' ? 'car' : 'moto';
}

/* --- Changement de véhicule : verrouillé après validation, l'admin confirme --- */

export type VehicleLock = {
  locked: boolean;                 // dossier validé ⇒ le chauffeur ne change plus seul de véhicule
  pending: { to_type: string } | null; // demande déjà déposée, en attente de l'admin
};

/** Le chauffeur peut-il encore changer de véhicule lui-même ? (documents attachés au véhicule validé) */
export async function getVehicleLock(): Promise<VehicleLock> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return { locked: false, pending: null };
  const [{ data: k }, { data: r }] = await Promise.all([
    supabase.from('driver_kyc').select('statut').eq('driver_id', uid).maybeSingle(),
    supabase.from('driver_vehicle_requests').select('to_type').eq('driver_id', uid).eq('statut', 'en_attente').maybeSingle(),
  ]);
  return {
    locked: (k as any)?.statut === 'valide',
    pending: r ? { to_type: (r as any).to_type as string } : null,
  };
}

/** Demande de changement de véhicule : un admin doit la confirmer (les pièces seront revérifiées). */
export async function requestVehicleChange(toType: string, fromType?: string | null, motif?: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Non connecté');
  const { error } = await supabase.from('driver_vehicle_requests').insert({
    driver_id: uid, to_type: toType, from_type: fromType ?? null, motif: motif ?? null, statut: 'en_attente',
  });
  if (error) throw error;
}

export type VehicleDetails = { vehicule?: string | null; couleur?: string | null; plaque?: string | null; gamme?: string | null };
export type DriverProfile = { vehicule: string | null; plaque: string | null; type: string | null; couleur: string | null; gamme?: string | null; vehicle_types?: string[] | null; vehicles?: Record<string, VehicleDetails> | null };

export async function getDriverProfile(): Promise<DriverProfile | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase.from('driver_profiles').select('vehicule, plaque, type, couleur, gamme, vehicle_types, vehicles').eq('driver_id', uid).maybeSingle();
  if (error) throw error; // erreur transitoire : on garde le profil déjà connu (pas de faux « complète ton véhicule »)
  return (data as DriverProfile) ?? null;
}

export async function saveDriverProfile(input: DriverProfile): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Non connecté');
  // Véhicules déclarés : au moins le type principal.
  const types = (input.vehicle_types && input.vehicle_types.length ? input.vehicle_types : [input.type || 'voiture']).filter(Boolean);
  const vehicles = input.vehicles ?? {};
  // Colonnes plates = véhicule principal (1er type) pour rétro-compat / affichage passager par défaut.
  const main = vehicles[types[0]] ?? { vehicule: input.vehicule, couleur: input.couleur, plaque: input.plaque, gamme: input.gamme };
  // Gamme (Standard/VIP/SUV) : seulement pour une voiture ; sinon null.
  const gamme = types[0] === 'voiture' ? (main.gamme ?? input.gamme ?? 'standard') : null;
  await supabase.from('driver_profiles').upsert({
    driver_id: uid,
    vehicule: main.vehicule ?? null, plaque: main.plaque ?? null, couleur: main.couleur ?? null,
    type: types[0],
    gamme,
    vehicle_types: types,
    vehicles,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'driver_id' });
}

/** Reflète le véhicule actif (choisi au passage en ligne) dans les colonnes plates,
 *  pour que le passager voie les bonnes infos (marque/couleur/plaque) du véhicule réellement utilisé. */
export async function applyActiveVehicle(type: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  const { data } = await supabase.from('driver_profiles').select('vehicles').eq('driver_id', uid).maybeSingle();
  const v = ((data as any)?.vehicles ?? {})[type] as VehicleDetails | undefined;
  if (!v) return;
  await supabase.from('driver_profiles').update({
    vehicule: v.vehicule ?? null, couleur: v.couleur ?? null, plaque: v.plaque ?? null, type,
    gamme: type === 'voiture' ? (v.gamme ?? 'standard') : null,
    updated_at: new Date().toISOString(),
  }).eq('driver_id', uid);
}

/* ===================== Stats chauffeur (gains & notes) ===================== */

export type DriverStats = {
  coursesTotal: number;
  gainsTotal: number;
  especes: number;          // encaissé en espèces (déjà en main, non retirable)
  verse: number;            // total déjà versé ou en attente de versement
  soldeDisponible: number;  // gains ÉLECTRONIQUES + déménagements - versements - frais Taga encaissés en espèces
  fraisDus: number;         // frais de service Taga encaissés en espèces par le chauffeur → à reverser à Taga
  note: number;
  nbNotes: number;
  today: { courses: number; gains: number };
  semaine: { courses: number; gains: number };
  avis: { note: number; commentaire: string | null; passager: string | null; date: string }[];
};

/** Taux d'acceptation / refus du chauffeur (à partir de l'historique des offres reçues). */
export type DriverOfferStats = { accepted: number; declined: number; expired: number; total: number; acceptRate: number; refuseRate: number };
export async function getDriverOfferStats(): Promise<DriverOfferStats> {
  const empty: DriverOfferStats = { accepted: 0, declined: 0, expired: 0, total: 0, acceptRate: 0, refuseRate: 0 };
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return empty;
  const [ro, dlo] = await Promise.all([
    supabase.from('ride_offers').select('status').eq('driver_id', uid),
    supabase.from('delivery_offers').select('status').eq('driver_id', uid),
  ]);
  const all = [...(ro.data ?? []), ...(dlo.data ?? [])];
  let accepted = 0, declined = 0, expired = 0;
  all.forEach((o: any) => {
    if (o.status === 'accepted') accepted++;
    else if (o.status === 'declined') declined++;
    else if (o.status === 'expired') expired++;
  });
  const total = accepted + declined + expired; // offres résolues (on ignore les 'pending')
  return {
    accepted, declined, expired, total,
    acceptRate: total ? Math.round((accepted / total) * 100) : 0,
    // Refus = décliné + expiré (offre ignorée) — c'est ce que voit un chauffeur façon Uber/Yango.
    refuseRate: total ? Math.round(((declined + expired) / total) * 100) : 0,
  };
}

export async function getDriverStats(): Promise<DriverStats> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  const vide: DriverStats = { coursesTotal: 0, gainsTotal: 0, especes: 0, verse: 0, soldeDisponible: 0, fraisDus: 0, note: 0, nbNotes: 0, today: { courses: 0, gains: 0 }, semaine: { courses: 0, gains: 0 }, avis: [] };
  if (!uid) return vide;
  const [ridesR, payoutsR, movingsR, ordersR, camPct, delivPct] = await Promise.all([
    supabase.from('rides').select('prix, frais_service, pourboire, statut, paiement, note, commentaire, passager_nom, created_at').eq('driver_id', uid).order('created_at', { ascending: false }),
    supabase.from('payouts').select('montant, statut').eq('driver_id', uid),
    supabase.from('moving_requests').select('prix, statut, created_at, paye').eq('driver_id', uid).eq('statut', 'termine').eq('paye', true),
    supabase.from('orders').select('frais_livraison, pourboire, paiement, statut, created_at').eq('driver_id', uid).eq('statut', 'livree'),
    getCamionCommission(),
    getDeliveryDriverPct(),
  ]);
  // Déménagement : le chauffeur garde (100 − commission Taga) % → montant NET affiché.
  const movNet = (prix: any) => Math.round((Number(prix) || 0) * (100 - camPct) / 100);
  // Course/location : le chauffeur GARDE prix − frais de service (Taga encaisse le frais). Compter
  // le prix entier gonflait le solde retirable → Taga reversait sa propre commission. Corrigé.
  const keep = (r: any) => Math.max(0, (Number(r.prix) || 0) - (Number(r.frais_service) || 0));
  // Pourboire course : ajouté par le client (souvent après la course, via l'app) → le chauffeur le
  // garde à 100 %, et il est RETIRABLE (encaissé par l'app, pas en espèces en main). Comptabilisé à part.
  const tip = (r: any) => Math.max(0, Number(r.pourboire) || 0);
  const rows = (ridesR.data ?? []) as any[];
  const term = rows.filter((r) => r.statut === 'termine');
  const now = new Date();
  const sameDay = (d: Date) => d.toDateString() === now.toDateString();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const notes = term.map((r) => r.note).filter((n) => n != null) as number[];
  // Déménagements terminés (camion) : comptent dans les gains du chauffeur.
  const movs = (movingsR.data ?? []) as any[];
  const movToday = movs.filter((m) => sameDay(new Date(m.created_at)));
  const movSem = movs.filter((m) => new Date(m.created_at) >= weekAgo);
  const movTotal = movs.reduce((s, m) => s + movNet(m.prix), 0);
  // Livraisons de repas terminées : gain = frais_livraison × pct + pourboire (jamais le total commande).
  const ords = (ordersR.data ?? []) as any[];
  const estCash = (p: any) => /esp[eè]ces|cash/i.test(String(p ?? ''));
  const delivGain = (o: any) => gainLivraison(Number(o.frais_livraison) || 0, Number(o.pourboire) || 0, delivPct);
  const ordToday = ords.filter((o) => sameDay(new Date(o.created_at)));
  const ordSem = ords.filter((o) => new Date(o.created_at) >= weekAgo);
  const delivTotal = ords.reduce((s, o) => s + delivGain(o), 0);
  const delivElec = ords.filter((o) => !estCash(o.paiement)).reduce((s, o) => s + delivGain(o), 0);
  const today = term.filter((r) => sameDay(new Date(r.created_at)));
  const sem = term.filter((r) => new Date(r.created_at) >= weekAgo);
  const tipTotal = term.reduce((s, r) => s + tip(r), 0);
  const gainsTotal = term.reduce((s, r) => s + keep(r), 0) + tipTotal + movTotal + delivTotal;
  // Espèces = déjà encaissé en main par le chauffeur → NON retirable.
  const estEspeces = (p: any) => /esp[eè]ces|cash/i.test(String(p ?? ''));
  const especes = term.filter((r) => estEspeces(r.paiement)).reduce((s, r) => s + keep(r), 0);
  // Retirable = gains électroniques (OM/carte) + déménagements (gérés par Taga).
  const electronique = term.filter((r) => !estEspeces(r.paiement)).reduce((s, r) => s + keep(r), 0) + tipTotal + movTotal + delivElec;
  // Frais de service encaissés EN ESPÈCES par le chauffeur : c'est de l'argent Taga qu'il a en main
  // → on le déduit de son solde retirable (Taga se rembourse sur ce qu'elle lui doit).
  const fraisDus = term.filter((r) => estEspeces(r.paiement)).reduce((s, r) => s + (Number(r.frais_service) || 0), 0);
  // Versements déjà payés OU en attente (on ne compte pas les refusés).
  // Robuste aux deux libellés rencontrés en base : 'refuse' et 'refused'.
  const estRefuse = (s: any) => /refus/i.test(String(s ?? ''));
  const verse = ((payoutsR.data ?? []) as any[])
    .filter((p) => !estRefuse(p.statut))
    .reduce((s, p) => s + (Number(p.montant) || 0), 0);
  return {
    coursesTotal: term.length + movs.length + ords.length,
    gainsTotal,
    especes,
    verse,
    soldeDisponible: Math.max(0, electronique - verse - fraisDus),
    fraisDus,
    note: notes.length ? Math.round((notes.reduce((s, n) => s + n, 0) / notes.length) * 10) / 10 : 0,
    nbNotes: notes.length,
    today: { courses: today.length + movToday.length + ordToday.length, gains: today.reduce((s, r) => s + keep(r) + tip(r), 0) + movToday.reduce((s, m) => s + movNet(m.prix), 0) + ordToday.reduce((s, o) => s + delivGain(o), 0) },
    semaine: { courses: sem.length + movSem.length + ordSem.length, gains: sem.reduce((s, r) => s + keep(r) + tip(r), 0) + movSem.reduce((s, m) => s + movNet(m.prix), 0) + ordSem.reduce((s, o) => s + delivGain(o), 0) },
    avis: term.filter((r) => r.note != null).slice(0, 20).map((r) => ({ note: r.note, commentaire: r.commentaire ?? null, passager: r.passager_nom ?? null, date: r.created_at })),
  };
}

/* ===================== Favoris ===================== */

export async function getFavorites(): Promise<string[]> {
  const { data } = await supabase.from('favorites').select('restaurant_id');
  return (data ?? []).map((r: any) => r.restaurant_id as string);
}

export async function toggleFavorite(restaurantId: string): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Non connecté');
  const { data: existing } = await supabase.from('favorites').select('restaurant_id').eq('user_id', uid).eq('restaurant_id', restaurantId).maybeSingle();
  if (existing) {
    await supabase.from('favorites').delete().eq('user_id', uid).eq('restaurant_id', restaurantId);
    return false;
  }
  await supabase.from('favorites').insert({ user_id: uid, restaurant_id: restaurantId });
  return true;
}

/* ===================== Messagerie : boîte de réception ===================== */

export type Conversation = {
  rideId?: string;   // conversation liée à une course
  orderId?: string;  // conversation liée à une commande food
  nom: string;
  dernier: string;
  heure: string;
  ts: number;        // horodatage du dernier message (pour le tri)
  nonLus: number;
  role: 'client' | 'driver';
};

const hhmm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** Liste les conversations (courses ET commandes food) de l'utilisateur connecté. */
export async function getConversations(): Promise<Conversation[]> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return [];

  const [ridesR, ordersR] = await Promise.all([
    supabase.from('rides').select('id, user_id, driver_id, passager_nom, chauffeur_nom, created_at')
      .or(`user_id.eq.${uid},driver_id.eq.${uid}`).order('created_at', { ascending: false }).limit(50),
    supabase.from('orders').select('id, user_id, driver_id, client_nom, livreur_nom, restaurant_nom, created_at')
      .or(`user_id.eq.${uid},driver_id.eq.${uid}`).order('created_at', { ascending: false }).limit(50),
  ]);
  const rides = (ridesR.data ?? []) as any[];
  const orders = (ordersR.data ?? []) as any[];
  const rideIds = rides.map((r) => r.id);
  const orderIds = orders.map((o) => o.id);

  const [rReads, rMsgs, oReads, oMsgs] = await Promise.all([
    rideIds.length ? supabase.from('message_reads').select('ride_id, last_read_at').eq('user_id', uid) : Promise.resolve({ data: [] as any[] }),
    rideIds.length ? supabase.from('messages').select('ride_id, texte, created_at, sender_id').in('ride_id', rideIds).order('created_at', { ascending: false }).limit(500) : Promise.resolve({ data: [] as any[] }),
    orderIds.length ? supabase.from('order_reads').select('order_id, last_read_at').eq('user_id', uid) : Promise.resolve({ data: [] as any[] }),
    orderIds.length ? supabase.from('messages').select('order_id, texte, created_at, sender_id').in('order_id', orderIds).order('created_at', { ascending: false }).limit(500) : Promise.resolve({ data: [] as any[] }),
  ]);

  const out: Conversation[] = [];

  // --- Courses ---
  const lastRideRead: Record<string, string> = {};
  (rReads.data ?? []).forEach((r: any) => { lastRideRead[r.ride_id] = r.last_read_at; });
  const lastRideMsg: Record<string, any> = {}; const unreadRide: Record<string, number> = {};
  for (const m of (rMsgs.data ?? []) as any[]) {
    if (!lastRideMsg[m.ride_id]) lastRideMsg[m.ride_id] = m;
    const lr = lastRideRead[m.ride_id];
    if (m.sender_id !== uid && (!lr || m.created_at > lr)) unreadRide[m.ride_id] = (unreadRide[m.ride_id] ?? 0) + 1;
  }
  for (const r of rides) {
    const m = lastRideMsg[r.id]; if (!m) continue;
    const iAmClient = r.user_id === uid;
    out.push({ rideId: r.id, nom: iAmClient ? (r.chauffeur_nom || 'Chauffeur') : (r.passager_nom || 'Passager'), dernier: m.texte, heure: hhmm(m.created_at), ts: new Date(m.created_at).getTime(), nonLus: unreadRide[r.id] ?? 0, role: iAmClient ? 'client' : 'driver' });
  }

  // --- Commandes food ---
  const lastOrderRead: Record<string, string> = {};
  (oReads.data ?? []).forEach((r: any) => { lastOrderRead[r.order_id] = r.last_read_at; });
  const lastOrderMsg: Record<string, any> = {}; const unreadOrder: Record<string, number> = {};
  for (const m of (oMsgs.data ?? []) as any[]) {
    if (!lastOrderMsg[m.order_id]) lastOrderMsg[m.order_id] = m;
    const lr = lastOrderRead[m.order_id];
    if (m.sender_id !== uid && (!lr || m.created_at > lr)) unreadOrder[m.order_id] = (unreadOrder[m.order_id] ?? 0) + 1;
  }
  for (const o of orders) {
    const m = lastOrderMsg[o.id]; if (!m) continue;
    const iAmClient = o.user_id === uid;
    out.push({ orderId: o.id, nom: iAmClient ? (o.livreur_nom || o.restaurant_nom || 'Livraison') : (o.client_nom || 'Client'), dernier: m.texte, heure: hhmm(m.created_at), ts: new Date(m.created_at).getTime(), nonLus: unreadOrder[o.id] ?? 0, role: iAmClient ? 'client' : 'driver' });
  }

  return out.sort((a, b) => b.ts - a.ts);
}

/** Marque une conversation comme lue (met à jour l'horodatage de lecture). */
export async function markRideRead(rideId: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  await supabase.from('message_reads').upsert(
    { user_id: uid, ride_id: rideId, last_read_at: new Date().toISOString() },
    { onConflict: 'user_id,ride_id' },
  );
}

/** Marque les messages d'une commande comme lus (côté coursier ou client). */
export async function markOrderRead(orderId: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  await supabase.from('order_reads').upsert(
    { user_id: uid, order_id: orderId, last_read_at: new Date().toISOString() },
    { onConflict: 'user_id,order_id' },
  );
}

/** Messages non lus d'une commande envoyés par l'autre partie (persistant via order_reads).
 *  fromRole = 'client' → badge côté coursier ; 'driver' → badge côté client. */
export async function getOrderUnreadCount(orderId: string, fromRole: 'client' | 'driver' = 'client'): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return 0;
  const { data: rd } = await supabase.from('order_reads').select('last_read_at').eq('user_id', uid).eq('order_id', orderId).maybeSingle();
  const since = (rd as any)?.last_read_at ?? '1970-01-01T00:00:00Z';
  const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true })
    .eq('order_id', orderId).eq('sender_role', fromRole).gt('created_at', since);
  return count ?? 0;
}

/** Nombre total de messages non lus (badge cloche/messages). */
export async function getUnreadMessages(): Promise<number> {
  const convos = await getConversations();
  return convos.reduce((s, c) => s + c.nonLus, 0);
}

/* ===================== Centre de notifications ===================== */

export type Notif = { id: string; titre: string; corps: string | null; type: string; lu: boolean; created_at: string; ref_type?: string | null; ref_id?: string | null };

export async function getNotifications(): Promise<Notif[]> {
  const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
  return (data ?? []) as Notif[];
}

export async function getUnreadNotifCount(): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return 0;
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('lu', false);
  return count ?? 0;
}

export async function markNotificationsRead(): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  await supabase.from('notifications').update({ lu: true }).eq('user_id', uid).eq('lu', false);
}

/** Ajoute une notification au centre (insère pour l'utilisateur connecté). */
export async function addNotification(titre: string, corps?: string, type = 'info'): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  await supabase.from('notifications').insert({ user_id: uid, titre, corps: corps ?? null, type });
}

/** S'abonne aux nouvelles notifications de l'utilisateur (temps réel). */
export function subscribeNotifications(userId: string, onNew: (n: Notif) => void): () => void {
  const ch = supabase
    .channel(`notif:${userId}:${chId()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload: any) => onNew(payload.new as Notif))
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/* ===================== Tarifs location chauffeur ===================== */

/** Tarif horaire par véhicule (réglé côté admin). Repli si la table est indisponible. */
export async function getLocationTarifs(): Promise<Record<string, number>> {
  const fallback: Record<string, number> = { voiture: 5000, moto: 3000 };
  try {
    const { data } = await supabase.from('location_tarifs').select('vehicule, tarif_heure').eq('actif', true);
    if (!data || !data.length) return fallback;
    const map: Record<string, number> = {};
    data.forEach((r: any) => { map[r.vehicule] = r.tarif_heure; });
    return { ...fallback, ...map };
  } catch {
    return fallback;
  }
}

/** Multiplicateurs de gamme pour la location (Standard/Confort/XL). */
/** Prix horaire ABSOLU par gamme de location (Eco/Fresh/SUV) — réglé directement côté admin. */
export async function getLocationGammes(): Promise<Record<string, number>> {
  const fallback: Record<string, number> = { standard: 5000, confort: 7500, xl: 9500 };
  try {
    const { data } = await supabase.from('location_gammes').select('tier, tarif_heure, mult');
    if (!data || !data.length) return fallback;
    const map: Record<string, number> = {};
    data.forEach((r: any) => {
      // tarif_heure absolu prioritaire ; repli sur base voiture × mult si non renseigné.
      const th = Number(r.tarif_heure);
      map[r.tier] = (!isNaN(th) && th > 0) ? th : Math.round((5000 * Number(r.mult || 1)) / 500) * 500;
    });
    return { ...fallback, ...map };
  } catch {
    return fallback;
  }
}

/** Frais de service Taga (réglés côté admin, app_numbers).
 *  - locHour : F par heure ajouté aux locations (défaut 200).
 *  - ridePct : % du prix ajouté aux courses VTC/moto/colis (défaut 0 = désactivé). */
export async function getServiceFees(): Promise<{ locHour: number; ridePct: number }> {
  const fallback = { locHour: 200, ridePct: 0 };
  try {
    const { data } = await supabase.from('app_numbers').select('key, value').in('key', ['service_fee_loc_hour', 'service_fee_ride_pct']);
    if (!data || !data.length) return fallback;
    const map: Record<string, number> = {};
    data.forEach((r: any) => { const n = Number(r.value); if (!isNaN(n)) map[r.key] = n; });
    return {
      locHour: map.service_fee_loc_hour ?? fallback.locHour,
      ridePct: map.service_fee_ride_pct ?? fallback.ridePct,
    };
  } catch {
    return fallback;
  }
}

/* ===================== Promotions ===================== */

export type Promo = { code: string; description: string; reduction: number; reduction_type: 'pct' | 'fixe' };

export type PromoResult = { ok: true; promo: Promo } | { ok: false; reason: string };

/** Valide un code promo : actif + période de validité + seuil minimum de commande. */
export async function validatePromo(code: string, sousTotal = 0): Promise<PromoResult> {
  const c = code.trim().toUpperCase();
  if (!c) return { ok: false, reason: 'Saisis un code.' };
  const { data } = await supabase.from('promo_codes')
    .select('code, description, reduction, reduction_type, actif, starts_at, ends_at, min_order').eq('code', c).maybeSingle();
  if (!data || !data.actif) return { ok: false, reason: 'Code invalide ou inactif.' };
  const now = Date.now();
  if ((data as any).starts_at && new Date((data as any).starts_at).getTime() > now) return { ok: false, reason: "Ce code n'est pas encore actif." };
  if ((data as any).ends_at && new Date((data as any).ends_at).getTime() < now) return { ok: false, reason: 'Ce code a expiré.' };
  const minOrder = Number((data as any).min_order) || 0;
  if (minOrder > 0 && sousTotal < minOrder) return { ok: false, reason: `Ce code s'applique à partir de ${minOrder} F de commande.` };
  const reductionType: 'pct' | 'fixe' = data.reduction_type === 'pct' ? 'pct' : 'fixe';
  return { ok: true, promo: { code: data.code, description: data.description, reduction: Number(data.reduction) || 0, reduction_type: reductionType } };
}

/** Calcule la remise (F) pour un sous-total donné. */
export function promoRemise(promo: Promo, sousTotal: number): number {
  return promo.reduction_type === 'pct' ? Math.round((sousTotal * promo.reduction) / 100) : promo.reduction;
}

/** Offre food active MAINTENANT (livraison gratuite / réduction auto) pour un sous-total donné. */
export type FoodOffer = { free_deliv: boolean; pct: number; libelle: string | null };
export async function getFoodOffer(sousTotal: number): Promise<FoodOffer> {
  try {
    const { data } = await supabase.rpc('food_offer', { p_sous: Math.max(0, Math.round(sousTotal)) });
    const row: any = Array.isArray(data) ? data[0] : data;
    return { free_deliv: !!row?.free_deliv, pct: Number(row?.pct) || 0, libelle: row?.libelle ?? null };
  } catch { return { free_deliv: false, pct: 0, libelle: null }; }
}

/* ===================== Support (tickets) ===================== */

export async function createTicket(sujet: string, categorie = 'Général'): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Non connecté');
  await supabase.from('support_tickets').insert({ user_id: uid, sujet, categorie });
}

/* ===================== Retraits chauffeur ===================== */

export async function createPayout(montant: number, methode = 'Orange Money', dest?: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Non connecté');
  await supabase.from('payouts').insert({ driver_id: uid, montant, methode, dest: dest ?? null });
}

export async function getMyPayouts(): Promise<{ montant: number; statut: string; created_at: string }[]> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return [];
  const { data } = await supabase.from('payouts').select('montant, statut, created_at').eq('driver_id', uid).order('created_at', { ascending: false });
  return (data ?? []) as any[];
}

/* ===================== Push distant ===================== */

/** Envoie une notification push à un utilisateur (via l'Edge Function). Sans effet si pas de jeton/build. */
export async function sendPushToUser(userId: string, title: string, body: string): Promise<void> {
  try {
    await supabase.functions.invoke('send-push', { body: { userId, title, body } });
  } catch {
    /* edge function indisponible : on ignore */
  }
}

/* ===================== Abonnement chauffeur ===================== */

export type DriverPlan = {
  code: string;
  label: string;
  prix: number;
  duree_jours: number;
  sort: number;
  actif: boolean;
  vehicle?: string | null;
};

export type DriverSubscription = {
  id: string;
  driver_id: string;
  plan_code: string;
  montant: number;
  started_at: string;
  expires_at: string;
  statut: string;
  paiement: string;
  created_at: string;
};

/* ===================== Vérification chauffeur (KYC) ===================== */

export type KycStatut = 'en_attente' | 'en_validation' | 'valide' | 'refuse';
export type KycField = 'permis' | 'identite' | 'carte_grise' | 'assurance' | 'vehicule';

export type DriverKyc = {
  driver_id: string;
  statut: KycStatut;
  permis_path: string | null;
  identite_path: string | null;
  carte_grise_path: string | null;
  assurance_path: string | null;
  vehicule_path: string | null;
  submitted_at: string | null;
  updated_at: string;
};

const KYC_COL: Record<KycField, string> = {
  permis: 'permis_path',
  identite: 'identite_path',
  carte_grise: 'carte_grise_path',
  assurance: 'assurance_path',
  vehicule: 'vehicule_path',
};

/** Dossier KYC du chauffeur connecté (null s'il n'a rien commencé). */
export async function getKyc(): Promise<DriverKyc | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase.from('driver_kyc').select('*').eq('driver_id', uid).maybeSingle();
  // Erreur transitoire (réseau / token en cours de rafraîchissement) : on LÈVE au lieu de renvoyer null.
  // Sinon l'appelant croyait le dossier « non validé » et dégradait un chauffeur pourtant validé
  // (« par moment déconnecté + redemande les documents »).
  if (error) throw error;
  return (data as DriverKyc) ?? null;
}

// Décode une chaîne base64 en octets (atob est dispo dans Hermes).
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64ToBytes(b64: string): Uint8Array {
  // Voie rapide si atob est dispo (web / Hermes récent).
  const atob = (globalThis as any).atob;
  if (typeof atob === 'function') {
    const bin = atob(b64) as string;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  // Repli pur JS (certains moteurs RN n'ont pas atob → évite l'erreur d'upload).
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const lookup = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) lookup[B64_CHARS.charCodeAt(i)] = i;
  let len = clean.length;
  while (len > 0 && clean[len - 1] === '=') len--;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let p = 0, buf = 0, bits = 0;
  for (let i = 0; i < len; i++) {
    const v = lookup[clean.charCodeAt(i)];
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[p++] = (buf >> bits) & 0xff; }
  }
  return out;
}

/**
 * Téléverse une image (base64) d'un document dans le bucket privé `kyc`,
 * enregistre son chemin dans le dossier KYC et remet le statut « en attente ».
 */
/**
 * Renvoie l'uid après s'être assuré que le JETON d'accès est FRAIS.
 * Sans ça, un upload Storage peu après un réveil d'app peut partir avec un jeton
 * expiré → la requête est vue comme anonyme → « new row violates row-level security policy ».
 */
async function uidWithFreshSession(): Promise<string> {
  let { data: { session } } = await supabase.auth.getSession();
  const expMs = session?.expires_at ? session.expires_at * 1000 : 0;
  if (!session || expMs - Date.now() < 60000) {
    try { const r = await supabase.auth.refreshSession(); if (r.data.session) session = r.data.session; } catch { /* garde la session courante */ }
  }
  const uid = session?.user?.id;
  if (!uid) throw new Error('Session expirée — reconnecte-toi');
  return uid;
}

/** Téléverse une image via l'edge function (service role) — évite les soucis de RLS Storage en RN. */
async function uploadViaEdge(bucket: 'avatars' | 'kyc', name: string, base64: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('upload-file', { body: { bucket, name, base64 } });
  if (error) throw new Error((error as any).message || 'Envoi impossible');
  if (!data || !(data as any).ok) throw new Error((data as any)?.error || (data as any)?.reason || 'Envoi impossible');
}

/** Téléverse la photo de profil du chauffeur (bucket public) et renvoie son URL. */
export async function uploadDriverPhoto(base64: string): Promise<string> {
  const uid = await uidWithFreshSession();
  const path = `${uid}/photo.jpg`;
  await uploadViaEdge('avatars', 'photo.jpg', base64);
  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  const url = `${pub.publicUrl}?v=${Date.now()}`; // anti-cache : force le rafraîchissement
  const { error } = await supabase.from('profiles').update({ photo_url: url }).eq('id', uid);
  if (error) throw error;
  return url;
}

/** Photo de profil de l'utilisateur connecté (ou null). */
export async function getMyPhoto(): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data } = await supabase.from('profiles').select('photo_url').eq('id', uid).maybeSingle();
  return (data as any)?.photo_url ?? null;
}

export async function uploadKycImage(field: KycField, base64: string): Promise<string> {
  const uid = await uidWithFreshSession();
  const path = `${uid}/${field}.jpg`;
  await uploadViaEdge('kyc', `${field}.jpg`, base64);

  // Upsert du dossier avec le nouveau chemin (repasse en attente de soumission).
  const { error } = await supabase
    .from('driver_kyc')
    .upsert(
      { driver_id: uid, [KYC_COL[field]]: path, statut: 'en_attente', updated_at: new Date().toISOString() },
      { onConflict: 'driver_id' },
    );
  if (error) throw error;
  return path;
}

/** URL signée temporaire pour afficher un document (bucket privé). */
export async function getKycSignedUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('kyc').createSignedUrl(path, 60 * 30);
  return data?.signedUrl ?? null;
}

/** Soumet le dossier à validation (tous les documents doivent être présents). */
export async function submitKyc(): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Non connecté');
  await supabase
    .from('driver_kyc')
    .update({ statut: 'en_validation', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('driver_id', uid);
}


/** Forfaits disponibles pour un type de véhicule (voiture / moto / tricycle).
 *  Sans `vehicle`, renvoie tous les forfaits. Tarifs réglés côté admin. */
export async function getDriverPlans(vehicle?: string | null): Promise<DriverPlan[]> {
  let q = supabase.from('driver_plans').select('*').eq('actif', true).order('sort');
  if (vehicle) q = q.or(`vehicle.eq.${vehicle},vehicle.is.null`);
  const { data } = await q;
  return (data ?? []) as DriverPlan[];
}

/** L'abonnement actif du chauffeur connecté (expire dans le futur), sinon null. */
export async function getActiveSubscription(): Promise<DriverSubscription | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from('driver_subscriptions')
    .select('*')
    .eq('driver_id', uid)
    .eq('statut', 'actif')                       // seul un abonnement ACTIVÉ par l'admin compte
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error; // erreur transitoire : on ne fait PAS passer le chauffeur hors ligne
  return (data as DriverSubscription) ?? null;
}

/** Dernière demande d'abonnement en attente d'activation (paiement) par l'admin. */
export async function getPendingSubscription(): Promise<DriverSubscription | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data } = await supabase
    .from('driver_subscriptions')
    .select('*')
    .eq('driver_id', uid)
    .eq('statut', 'en_attente')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as DriverSubscription) ?? null;
}

/**
 * Souscrit (ou prolonge) un abonnement. L'échéance s'ajoute à l'abonnement
 * actif s'il en existe un, sinon elle part de maintenant.
 * Le paiement réel (Orange Money) reste à brancher : marqué « en_attente ».
 */
export async function createSubscription(planCode: string): Promise<DriverSubscription | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Non connecté');

  const { data: plan } = await supabase.from('driver_plans').select('*').eq('code', planCode).maybeSingle();
  if (!plan) throw new Error('Forfait introuvable');

  // Demande d'abonnement : le statut/paiement sont forcés en "en_attente" côté serveur
  // (trigger anti-fraude). L'admin active après réception du paiement (espèces / OM)
  // et recalcule la date d'expiration. expires_at ici n'est qu'un repère, ignoré à l'activation.
  const expires = new Date(Date.now() + plan.duree_jours * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from('driver_subscriptions')
    .insert({
      driver_id: uid,
      plan_code: plan.code,
      montant: plan.prix,
      expires_at: expires.toISOString(),
      statut: 'en_attente',
      paiement: 'en_attente',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as DriverSubscription;
}
