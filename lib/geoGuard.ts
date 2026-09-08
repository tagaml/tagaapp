import * as Location from 'expo-location';

/**
 * INTERRUPTEUR UNIQUE : restreindre Taga au Mali (Bamako).
 *   - false (par défaut) : la géolocalisation marche PARTOUT (on peut tester depuis l'étranger).
 *   - true               : on bloque les commandes hors du Mali et la carte reste sur Bamako.
 *
 * ➜ Le jour du build de production iOS, passe simplement cette valeur à `true`.
 */
export const RESTRICT_TO_MALI = false;

// Boîte englobante approximative du Mali.
export function inMaliBox(lat: number, lng: number): boolean {
  return lat >= 10 && lat <= 25.5 && lng >= -12.5 && lng <= 4.5;
}

/**
 * L'utilisateur peut-il commander ?
 * - Restriction désactivée (RESTRICT_TO_MALI = false) : toujours true.
 * - Sans permission GPS ou en cas d'erreur : true (bénéfice du doute).
 * - On bloque UNIQUEMENT quand la restriction est active ET la position est hors du Mali.
 */
export async function ensureInMali(): Promise<boolean> {
  if (!RESTRICT_TO_MALI) return true;
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return true;
    const last = await Location.getLastKnownPositionAsync();
    const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
    if (!pos) return true;
    return inMaliBox(pos.coords.latitude, pos.coords.longitude);
  } catch {
    return true;
  }
}

export const HORS_MALI_MSG = 'Taga est disponible uniquement au Mali pour le moment. Reviens quand tu es sur place !';
