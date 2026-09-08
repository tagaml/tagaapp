import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setDriverPresence } from './db';

// Tâche de localisation en arrière-plan : tant que le chauffeur est « en ligne »,
// on continue d'émettre sa présence (position + véhicule) même appli fermée.
// → le dispatch le garde dans la file et peut lui envoyer une offre (push) sans qu'il ouvre l'appli.
//
// ⚠️ Ne fonctionne qu'avec un build natif (EAS / TestFlight), pas en Expo Go.
export const BG_PRESENCE_TASK = 'taga-bg-presence';
const VEH_KEY = 'taga.bg.vehicule';
const GAMME_KEY = 'taga.bg.gamme';
const SERVICES_KEY = 'taga.bg.services'; // services acceptés (JSON) : le dispatch filtre dessus

/** Relit les services stockés (JSON). Renvoie null si absent/illisible → le serveur retombera sur son défaut. */
async function readServices(): Promise<string[] | null> {
  try {
    const raw = await AsyncStorage.getItem(SERVICES_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length ? (arr as string[]) : null;
  } catch {
    return null;
  }
}

// Définition de la tâche (au niveau module : requis par expo-task-manager).
TaskManager.defineTask(BG_PRESENCE_TASK, async ({ data, error }: any) => {
  if (error) return;
  const locs: Location.LocationObject[] = data?.locations ?? [];
  const loc = locs[locs.length - 1];
  if (!loc) return;
  try {
    // Aucun repli sur « voiture » : publier un véhicule faux ferait sonner les mauvaises demandes
    // (un moto-livreur recevrait des courses taxi). Sans véhicule connu, on n'émet rien.
    const veh = await AsyncStorage.getItem(VEH_KEY);
    if (!veh) return;
    const gamme = veh === 'voiture' ? ((await AsyncStorage.getItem(GAMME_KEY)) || 'standard') : null;
    // Mêmes services qu'au premier plan : sinon le chauffeur recevrait des demandes hors de ses services.
    const services = await readServices();
    // Cap réel du véhicule (0 = nord) : transmis tel quel, `setDriverPresence` ignore les valeurs
    // non exploitables (-1 / null quand le chauffeur est à l'arrêt) et conserve alors le dernier
    // cap connu en base — le véhicule n'est jamais remis à plein nord sur la carte des clients.
    await setDriverPresence(loc.coords.latitude, loc.coords.longitude, veh, true, gamme, services, loc.coords.heading);
  } catch {
    /* session absente / réseau : on réessaiera à la prochaine mise à jour GPS */
  }
});

/** Démarre le suivi de présence en arrière-plan pour le véhicule actif (+ gamme voiture + services). */
export async function startBackgroundPresence(vehicule: string, gamme?: string | null, services?: string[] | null): Promise<void> {
  try {
    await AsyncStorage.setItem(VEH_KEY, vehicule);
    await AsyncStorage.setItem(GAMME_KEY, gamme || 'standard');
    if (services && services.length) await AsyncStorage.setItem(SERVICES_KEY, JSON.stringify(services));
    else await AsyncStorage.removeItem(SERVICES_KEY);
    // La permission « toujours » est nécessaire pour l'arrière-plan (sinon on ignore silencieusement).
    const fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted) return;
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (!bg.granted) return;
    const already = await Location.hasStartedLocationUpdatesAsync(BG_PRESENCE_TASK).catch(() => false);
    if (already) return;
    await Location.startLocationUpdatesAsync(BG_PRESENCE_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 45000,       // réémet la présence ~toutes les 45 s (< fenêtre de 120 s du dispatch)
      distanceInterval: 60,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: false,
      foregroundService: {
        notificationTitle: 'Taga — en ligne',
        notificationBody: 'Tu reçois les demandes de courses même écran verrouillé.',
        notificationColor: '#E84B1F',
      },
    });
  } catch {
    /* build non natif (Expo Go) ou permission refusée : la présence reste au premier plan */
  }
}

/** Arrête le suivi de présence en arrière-plan (passage hors ligne / déconnexion). */
export async function stopBackgroundPresence(): Promise<void> {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(BG_PRESENCE_TASK).catch(() => false);
    if (started) await Location.stopLocationUpdatesAsync(BG_PRESENCE_TASK);
  } catch {
    /* ignore */
  }
}
