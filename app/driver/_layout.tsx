import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme';

export default function DriverLayout() {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 10);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.inkMute,
        tabBarStyle: {
          backgroundColor: colors.ink,
          borderTopColor: 'rgba(255,255,255,0.08)',
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
        name="gains"
        options={{ title: 'Gains', tabBarIcon: ({ color, size }) => <Ionicons name="wallet" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="compte"
        options={{ title: 'Compte', tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} /> }}
      />

      {/* Écrans immersifs (plein écran) : masquent la barre d'onglets quand ils sont affichés */}
      <Tabs.Screen name="active-trip" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="pool-trip" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="delivery" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="trip-summary" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="chat" options={{ href: null, tabBarStyle: { display: 'none' } }} />

      {/* Autres écrans non affichés dans la barre */}
      <Tabs.Screen name="onboarding" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="trajets" options={{ href: null }} />
      <Tabs.Screen name="documents" options={{ href: null }} />
      <Tabs.Screen name="abonnement" options={{ href: null }} />
      <Tabs.Screen name="vehicule" options={{ href: null }} />
      <Tabs.Screen name="ratings" options={{ href: null }} />
      <Tabs.Screen name="zones" options={{ href: null }} />
      <Tabs.Screen name="help" options={{ href: null }} />
      <Tabs.Screen name="livraisons" options={{ href: null }} />
      <Tabs.Screen name="demenagements" options={{ href: null }} />
      <Tabs.Screen name="upcoming" options={{ href: null }} />
    </Tabs>
  );
}
