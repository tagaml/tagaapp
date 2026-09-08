// Estimation partagée (client + chauffeur) : trafic Bamako, heure d'arrivée,
// repli quand le routage échoue, fourchette de prix et gain net chauffeur.

export type LatLng = { latitude: number; longitude: number };

/** Facteur de circulation à Bamako selon l'heure locale (heures de pointe = trajets plus longs). */
export function trafficFactor(d: Date = new Date()): number {
  const h = d.getHours();
  const day = d.getDay(); // 0 = dimanche
  if (day === 0) return 1.1;            // dimanche : fluide
  if (h >= 17 && h < 20) return 1.6;    // pointe du soir (la pire)
  if (h >= 7 && h < 9) return 1.5;      // pointe du matin
  if (h >= 16 && h < 17) return 1.4;    // début des sorties
  if (h >= 12 && h < 14) return 1.25;   // pause déjeuner
  if (h >= 9 && h < 16) return 1.2;     // journée
  if (h >= 20 && h < 22) return 1.15;   // début de soirée
  return 1.05;                           // nuit / tôt le matin
}

/** Durée réaliste = durée en circulation libre (OSRM) × facteur trafic. */
export function realisticEta(freeFlowMin: number | null | undefined, d?: Date): number | null {
  if (freeFlowMin == null || !isFinite(freeFlowMin)) return null;
  return Math.max(1, Math.round(freeFlowMin * trafficFactor(d)));
}

/** Heure d'arrivée estimée « HH:MM » à partir de maintenant + etaMin. */
export function arrivalLabel(etaMin: number | null | undefined, from: Date = new Date()): string | null {
  if (etaMin == null) return null;
  const t = new Date(from.getTime() + etaMin * 60000);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

/** Distance à vol d'oiseau (km). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLng = (b.longitude - a.longitude) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// Distance « serveur » : IDENTIQUE à taga_path_km côté base (vol d'oiseau à travers les arrêts × 1.3).
// À utiliser pour le PRIX affiché, afin qu'il corresponde exactement à l'offre reçue par le chauffeur
// (le serveur recalcule le prix avec cette même formule, il ne fait pas confiance à OSRM du client).
export const SERVER_ROAD_FACTOR = 1.3;
export function serverPathKm(points: (LatLng | null | undefined)[]): number {
  const pts = (points || []).filter(
    (p): p is LatLng => !!p && isFinite(p.latitude) && isFinite(p.longitude)
  );
  if (pts.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += haversineKm(pts[i], pts[i + 1]);
  return SERVER_ROAD_FACTOR * total;
}

// Repli quand OSRM ne répond pas : distance route ≈ vol d'oiseau × facteur, durée à vitesse urbaine.
const ROAD_FACTOR = 1.35;
const URBAN_KMH = 26;

/** Estimation de secours (distance route + durée libre) si le routage échoue → jamais d'estimation vide. */
export function fallbackEstimate(from: LatLng, to: LatLng): { distanceKm: number; durationMin: number } {
  const straight = haversineKm(from, to);
  const distanceKm = straight * ROAD_FACTOR;
  const durationMin = Math.max(1, Math.round((distanceKm / URBAN_KMH) * 60));
  return { distanceKm, durationMin };
}

/** Fourchette de prix (arrondie à 50 F) autour de l'estimation ponctuelle. */
export function priceBracket(value: number): { low: number; high: number } {
  const low = Math.max(0, Math.floor((value * 0.92) / 50) * 50);
  const high = Math.ceil((value * 1.12) / 50) * 50;
  return { low, high };
}

// Modèle Taga : pas de commission sur les courses. Le chauffeur/livreur garde 100% du prix
// (+ 100% des pourboires) ; la plateforme se rémunère via l'abonnement chauffeur.
