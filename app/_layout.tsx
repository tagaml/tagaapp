import { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text as RNText, TextInput as RNTextInput } from 'react-native';

// Texte à taille FIXE : l'UI est calibrée en points précis. Sur Android surtout, la « taille de
// police » / « taille d'affichage » du système agrandissait tout le texte (écritures trop grandes).
// On neutralise le facteur d'échelle système pour garder un rendu cohérent sur tous les appareils.
{
  const T = RNText as any;
  T.defaultProps = T.defaultProps || {};
  T.defaultProps.allowFontScaling = false;
  const TI = RNTextInput as any;
  TI.defaultProps = TI.defaultProps || {};
  TI.defaultProps.allowFontScaling = false;
}
import * as Notifications from 'expo-notifications';
import { Stack, useRouter, useSegments } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARDED_KEY } from './onboarding';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '../components/ui';
import { CartProvider } from '../components/cart';
import { AuthProvider, useAuth } from '../components/auth';
import { initNotifications, registerPushToken } from '../lib/notify';
import { IS_DRIVER_APP } from '../lib/appVariant';
import { subscribeNotifications } from '../lib/db';
import { playNotif } from '../lib/sound';
import { colors } from '../theme';

function RootNavigator() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  // Intro affichée une seule fois (app client uniquement).
  const [onboarded, setOnboarded] = useState<boolean | null>(IS_DRIVER_APP ? true : null);

  useEffect(() => {
    if (IS_DRIVER_APP) return;
    AsyncStorage.getItem(ONBOARDED_KEY)
      .then((v) => setOnboarded(v === '1'))
      .catch(() => setOnboarded(true));
  }, []);

  // Prépare les notifications + demande l'autorisation une fois connecté.
  useEffect(() => {
    if (user) { initNotifications(); registerPushToken(); }
  }, [user]);

  // Son à chaque nouvelle notification reçue en direct (app ouverte) — app client.
  useEffect(() => {
    if (IS_DRIVER_APP || !user) return;
    const off = subscribeNotifications(user.id, () => { playNotif(); });
    return off;
  }, [user]);

  // Tap sur une notification push (appli en arrière-plan OU fermée) → deep link selon le payload `data`.
  // Chat → ouvre la conversation ; commande (statut/arrivée/annulation) → ouvre le suivi ; sinon accueil.
  useEffect(() => {
    if (!user) return;
    const home = IS_DRIVER_APP ? '/driver' : '/(tabs)';
    const routeFromData = (resp: Notifications.NotificationResponse | null) => {
      const data = (resp?.notification?.request?.content?.data ?? {}) as Record<string, any>;
      const type = String(data.type ?? '');
      const refType = String(data.ref_type ?? '');
      const refId = data.ref_id ? String(data.ref_id) : '';
      if (type === 'chat' && refId) {
        if (refType === 'order') { router.replace(home); router.push({ pathname: '/chat', params: { orderId: refId, role: IS_DRIVER_APP ? 'driver' : 'client' } }); return; }
        router.replace(home); router.push({ pathname: '/chat', params: { rideId: refId, role: IS_DRIVER_APP ? 'driver' : 'client' } }); return;
      }
      if ((type === 'order_status' || type === 'order_arrival' || type === 'order_cancelled') && refId && !IS_DRIVER_APP) {
        router.replace(home); router.push({ pathname: '/food-track', params: { orderId: refId } }); return;
      }
      // Offre de course/livraison (chauffeur) : on ramène au tableau de bord, qui relit
      // l'offre en attente au focus (getMyPendingOffer / getMyDeliveryOffer) et l'affiche.
      // Couvre le démarrage à froid : l'appli était tuée, le chauffeur tape la notif, l'offre s'ouvre.
      if ((type === 'ride_offer' || type === 'delivery_offer') && IS_DRIVER_APP) {
        router.replace('/driver'); return;
      }
      router.replace(home);
    };
    const sub = Notifications.addNotificationResponseReceivedListener(routeFromData);
    // Démarrage à froid : l'appli a été ouverte EN TAPANT la notif (elle était tuée).
    Notifications.getLastNotificationResponseAsync()
      .then((resp) => { if (resp) routeFromData(resp); })
      .catch(() => {});
    return () => sub.remove();
  }, [user]);

  useEffect(() => {
    if (loading || onboarded === null) return;
    const inAuth = segments[0] === 'login' || segments[0] === 'signup' || segments[0] === 'verify-otp' || segments[0] === 'forgot-password';
    const inOnboarding = segments[0] === 'onboarding';
    const home = IS_DRIVER_APP ? '/driver' : '/(tabs)';
    if (!user) {
      if (!onboarded && !inOnboarding && !inAuth) router.replace('/onboarding');
      else if (onboarded && !inAuth && !inOnboarding) router.replace('/login');
    } else if (inAuth || inOnboarding) {
      router.replace(home);
    } else if (IS_DRIVER_APP && segments[0] === '(tabs)') {
      // App chauffeur : on ne reste jamais sur les onglets client.
      router.replace('/driver');
    }
  }, [user, loading, onboarded, segments]);

  // L'app chauffeur ne doit jamais afficher les onglets client : on garde le spinner
  // pendant la redirection vers /driver (évite le flash de l'app client à l'ouverture).
  const driverMisrouted = IS_DRIVER_APP && segments[0] === '(tabs)';
  if (loading || onboarded === null || driverMisrouted) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
      <Stack.Screen name="login" options={{ animation: 'fade' }} />
      <Stack.Screen name="signup" />
      <Stack.Screen name="verify-otp" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
      <Stack.Screen name="driver" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="searching" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
      <Stack.Screen name="trip-active" options={{ animation: 'fade' }} />
      <Stack.Screen name="chat" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="rating" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <ToastProvider>
            <CartProvider>
              <StatusBar style="dark" />
              <RootNavigator />
            </CartProvider>
          </ToastProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
