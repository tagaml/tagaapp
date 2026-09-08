import { Share } from 'react-native';

// Page publique de suivi en direct (hébergée sur le site Taga). Le proche ouvre ce lien
// dans son navigateur : carte live, position du chauffeur qui bouge, véhicule, plaque, ETA.
const TRACK_BASE = 'https://taga.ml/suivi.html';

type TripShare = {
  kind?: 'course' | 'livraison';
  token?: string | null;      // share_token de la course → lien de suivi live
  chauffeur?: string | null;
  vehicule?: string | null;
  plaque?: string | null;
  destination?: string | null;
  etaMin?: number | null;
  lat?: number | null;
  lng?: number | null;
};

/**
 * Partage en direct le trajet / la livraison avec un proche (façon Uber « Partager mon trajet »).
 * Envoie un lien de SUIVI LIVE (position du chauffeur qui bouge + ETA), avec un rappel
 * des infos clés. Repli sur un pin Google Maps si le token de partage n'est pas disponible.
 */
export async function shareTrip(opts: TripShare): Promise<void> {
  const l: string[] = [];
  l.push(opts.kind === 'livraison'
    ? '📦 Je reçois une livraison via Taga, suis-la en direct :'
    : '🚕 Je suis en course sur Taga, suis mon trajet en direct :');

  if (opts.token) {
    // Lien principal : suivi live (WhatsApp affiche l'aperçu Open Graph).
    l.push(`👉 ${TRACK_BASE}?t=${encodeURIComponent(opts.token)}`);
  }
  if (opts.chauffeur) l.push(`Chauffeur : ${opts.chauffeur}`);
  if (opts.vehicule) l.push(`Véhicule : ${opts.vehicule}${opts.plaque && opts.plaque !== '—' ? ` (${opts.plaque})` : ''}`);
  if (opts.destination) l.push(`Destination : ${opts.destination}`);
  if (opts.etaMin) l.push(`Arrivée estimée : ~${opts.etaMin} min`);
  // Repli seulement s'il n'y a pas de lien de suivi (ancienne course sans token).
  if (!opts.token && opts.lat != null && opts.lng != null) {
    l.push(`Position : https://www.google.com/maps?q=${opts.lat},${opts.lng}`);
  }
  l.push('— Envoyé via Taga');
  try { await Share.share({ message: l.join('\n') }); } catch { /* annulé */ }
}

/** Partage simple d'une position GPS (urgence / « où es-tu »). */
export async function sharePosition(lat?: number | null, lng?: number | null, prefix = 'Ma position Taga'): Promise<void> {
  if (lat == null || lng == null) return;
  try { await Share.share({ message: `${prefix} : https://www.google.com/maps?q=${lat},${lng}` }); } catch { /* annulé */ }
}
