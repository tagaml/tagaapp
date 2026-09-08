import { Alert, Linking, Platform } from 'react-native';

type NavDest = {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  label?: string;
  preferAddress?: boolean;
};

/**
 * Ouvre l'itinéraire vers une destination (Google Maps, Waze, ou Plans sur iOS).
 * - Les courses passent des coordonnées GPS (précis).
 * - Les livraisons passent l'adresse texte (preferAddress) + coords de repli.
 */
export function openNavigation(dest: NavDest) {
  const hasCoords = dest.lat != null && dest.lng != null;
  const addr = dest.address && String(dest.address).trim() ? encodeURIComponent(String(dest.address).trim()) : null;

  let usingCoords: boolean;
  if (dest.preferAddress && addr) usingCoords = false;
  else if (hasCoords) usingCoords = true;
  else if (addr) usingCoords = false;
  else { Alert.alert('Adresse indisponible', 'Aucune destination à ouvrir pour cette étape.'); return; }

  const target = usingCoords ? `${dest.lat},${dest.lng}` : addr!;
  const gmapsWeb = `https://www.google.com/maps/dir/?api=1&destination=${target}&travelmode=driving`;
  const wazeWeb = usingCoords ? `https://waze.com/ul?ll=${dest.lat},${dest.lng}&navigate=yes` : `https://waze.com/ul?q=${addr}&navigate=yes`;
  const apple = `http://maps.apple.com/?daddr=${target}`;
  // Schémas natifs (ouvrent directement l'appli si installée)
  const gmapsApp = Platform.OS === 'ios'
    ? `comgooglemaps://?daddr=${target}&directionsmode=driving`
    : (usingCoords ? `google.navigation:q=${target}` : `geo:0,0?q=${target}`);
  const wazeApp = usingCoords ? `waze://?ll=${dest.lat},${dest.lng}&navigate=yes` : `waze://?q=${addr}&navigate=yes`;

  const open = async (appUrl: string, webUrl: string) => {
    try {
      const ok = await Linking.canOpenURL(appUrl);
      await Linking.openURL(ok ? appUrl : webUrl);
    } catch {
      try { await Linking.openURL(webUrl); } catch { Alert.alert('Oups', "Impossible d'ouvrir la navigation."); }
    }
  };

  const options: any[] = [
    { text: 'Google Maps', onPress: () => open(gmapsApp, gmapsWeb) },
    { text: 'Waze', onPress: () => open(wazeApp, wazeWeb) },
  ];
  if (Platform.OS === 'ios') options.push({ text: 'Plans', onPress: () => Linking.openURL(apple).catch(() => {}) });
  options.push({ text: 'Annuler', style: 'cancel' });

  Alert.alert('Itinéraire', dest.label || 'Ouvrir avec…', options);
}
