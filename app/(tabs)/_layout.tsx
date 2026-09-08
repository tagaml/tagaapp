import { Tabs, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme';
import { IS_DRIVER_APP } from '../../lib/appVariant';

export default function TabsLayout() {
  const insets = useSafeAreaInsets(); // hook appelé AVANT tout retour (règle des hooks)

  // Les onglets CLIENT sont la route racine « / ». Dans l'app CHAUFFEUR, ils se montaient donc
  // au démarrage, se peignaient à l'écran, et la redirection vers /driver n'arrivait qu'APRÈS :
  // d'où l'app client qui s'affichait une fraction de seconde avant l'app chauffeur (Android).
  // Ici, on redirige PENDANT le rendu : le navigateur d'onglets n'est jamais monté, donc
  // il n'y a plus rien à peindre — le flash est impossible par construction.
  if (IS_DRIVER_APP) return <Redirect href="/driver" />;

  const bottom = Math.max(insets.bottom, 10); // marge sûre au-dessus de la barre système Android/iOS
  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.inkMute,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
          height: 60 + bottom,
          paddingTop: 8,
          paddingBottom: bottom,
        },
        tabBarLabelStyle: { fontSize: 11.5, fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Accueil', tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="services"
        options={{ title: 'Services', tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="activite"
        options={{ title: 'Activité', tabBarIcon: ({ color, size }) => <Ionicons name="receipt" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="compte"
        options={{ title: 'Compte', tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} /> }}
      />
    </Tabs>
  );
}
