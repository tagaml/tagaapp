import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Affiche les notifications même quand l'app est au premier plan.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let configured = false;
let permission: boolean | null = null;

/** Prépare le canal Android + demande l'autorisation (une seule fois). */
export async function initNotifications(): Promise<void> {
  if (configured) return;
  configured = true;
  try {
    if (Platform.OS === 'android') {
      // Canaux Android par criticité (le serveur choisit le canal selon le type de push).
      // 'default'  : chat, infos → importance haute, son doux.
      // 'orders'   : transitions commande, coursier arrivé → haute priorité, son distinct.
      // 'urgent'   : demandes course/livraison chauffeur → priorité MAX, son fort, vibration marquée.
      // 'taga'     : canal historique conservé pour compatibilité (anciens appels).
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Messages & infos', importance: Notifications.AndroidImportance.HIGH,
        sound: 'default', vibrationPattern: [0, 150], lightColor: '#E84B1F',
      });
      await Notifications.setNotificationChannelAsync('orders', {
        name: 'Commandes & livraisons', importance: Notifications.AndroidImportance.HIGH,
        sound: 'default', vibrationPattern: [0, 250, 200, 250], lightColor: '#E84B1F',
      });
      await Notifications.setNotificationChannelAsync('urgent', {
        name: 'Demandes urgentes', importance: Notifications.AndroidImportance.MAX,
        sound: 'default', vibrationPattern: [0, 400, 200, 400, 200, 400], lightColor: '#E84B1F',
        bypassDnd: true,
      });
      // 'urgent2' : canal NEUF. Android fige les réglages d'un canal à sa création — un ancien
      // 'urgent' créé sans son ne sonnera jamais malgré ce code. Un nouvel identifiant force la
      // recréation avec son fort + priorité MAX. Le serveur (send-push) envoie sur ce canal.
      await Notifications.setNotificationChannelAsync('urgent2', {
        name: 'Nouvelles courses', importance: Notifications.AndroidImportance.MAX,
        sound: 'default', vibrationPattern: [0, 400, 200, 400, 200, 400], lightColor: '#E84B1F',
        bypassDnd: true,
      });
      await Notifications.setNotificationChannelAsync('taga', {
        name: 'Taga', importance: Notifications.AndroidImportance.MAX,
        sound: 'default', vibrationPattern: [0, 250, 250, 250], lightColor: '#E84B1F',
      });
    }
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    permission = status === 'granted';
  } catch {
    permission = false;
  }
}

/**
 * Enregistre le jeton push Expo de l'appareil dans le profil (pour les notifications distantes).
 * Sans effet dans Expo Go (le push distant nécessite un build de développement EAS).
 */
export async function registerPushToken(): Promise<void> {
  try {
    // Expo Go ne supporte plus le push distant → on ne tente rien.
    if (Constants.appOwnership === 'expo') return;
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') { status = (await Notifications.requestPermissionsAsync()).status; }
    if (status !== 'granted') return;
    const projectId =
      (Constants.expoConfig as any)?.extra?.eas?.projectId ||
      (Constants as any).easConfig?.projectId;
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    // Variante de l'app (client | chauffeur) → permet de cibler les pushs côté admin.
    const variant = ((Constants.expoConfig as any)?.extra?.variant === 'chauffeur') ? 'chauffeur' : 'client';
    if (uid && token?.data) await supabase.from('profiles').update({ push_token: token.data, push_variant: variant }).eq('id', uid);
  } catch {
    /* push distant indisponible (Expo Go ou build sans projectId) : on ignore */
  }
}

/** Efface le jeton push de l'appareil à la déconnexion (évite que l'ancien compte reçoive les notifs). */
export async function clearPushToken(): Promise<void> {
  try {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (uid) await supabase.from('profiles').update({ push_token: null }).eq('id', uid);
  } catch { /* ignore */ }
}

/** Envoie une notification locale immédiate (alerte même app en arrière-plan tant qu'elle tourne). */
export async function notify(title: string, body: string): Promise<void> {
  try {
    if (permission === null) await initNotifications();
    if (!permission) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: 'default' },
      trigger: null, // immédiat
    });
  } catch {
    /* notifications indisponibles : on ignore silencieusement */
  }
}
