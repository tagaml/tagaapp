import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../../theme';
import { Tag, ServiceIcon, serviceImages } from '../../components/ui';

// Icône de service : la voiture utilise le visuel 3D, le reste les illustrations.
function ServiceVisual({ icon, size }: { icon: string; size: number }) {
  if (icon === 'car') {
    return <Image source={serviceImages.classic} style={{ width: size * 1.3, height: size * 0.92 }} resizeMode="contain" />;
  }
  // Le coursier (colis) et la moto sont un peu plus grands (marge interne plus forte).
  if (icon === 'colis') {
    return <ServiceIcon name="colis" size={size * 1.3} />;
  }
  if (icon === 'moto') {
    return <ServiceIcon name="moto" size={size * 1.35} />;
  }
  if (icon === 'demenagement') {
    return <ServiceIcon name="demenagement" size={size * 1.35} />;
  }
  return <ServiceIcon name={icon as any} size={size} />;
}

const groups = [
  {
    titre: 'Se déplacer',
    items: [
      { nom: 'Taxi VTC', desc: 'Voiture avec chauffeur', icon: 'car', route: '/ride-voiture' },
      { nom: 'Moto-Taxi', desc: 'Esquive les bouchons · casque fourni', icon: 'moto', route: '/ride-moto' },
      { nom: 'Louer un chauffeur', desc: "À l'heure ou à la journée · 5 h, 10 h…", icon: 'car', route: '/louer', badge: 'Nouveau' },
    ],
  },
  {
    titre: 'Se faire livrer',
    items: [
      // Pas de promesse de gratuité ici : la livraison est calculée à l'adresse (checkout).
      { nom: 'Restaurant', desc: 'Tes plats préférés livrés en ~30 min', icon: 'food', route: '/food' },
      { nom: 'Déménagement', desc: 'Véhicule + main-d\'œuvre · devis sur mesure', icon: 'demenagement', route: '/demenagement', badge: 'Nouveau' },
      { nom: 'Coursier', desc: 'Envoie un colis partout dans Bamako', icon: 'colis', route: '/colis', badge: 'Nouveau' },
    ],
  },
];

const bientot = [
  { nom: 'Épicerie', desc: 'Tes courses du quotidien livrées à domicile', icon: 'basket' },
  { nom: 'Pharmacie', desc: 'Médicaments et parapharmacie en express', icon: 'medkit' },
];

export default function Services() {
  const router = useRouter();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={st.head}>
          <Pressable onPress={() => router.navigate('/(tabs)')} hitSlop={8} style={st.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
          <Text style={st.title}>Services</Text>
        </View>

        {groups.map((g) => (
          <View key={g.titre}>
            <Text style={st.groupTitle}>{g.titre}</Text>
            {g.items.map((it) => (
              <Pressable key={it.nom} style={st.card} onPress={() => router.push(it.route as any)}>
                <View style={st.cardIcon}><ServiceVisual icon={it.icon} size={40} /></View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={st.cardName} numberOfLines={1}>{it.nom}</Text>
                    {(it as any).badge && <Tag text={(it as any).badge} tone="green" />}
                  </View>
                  <Text style={st.cardDesc}>{it.desc}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.inkMute} />
              </Pressable>
            ))}
          </View>
        ))}

        <Text style={st.groupTitle}>Bientôt disponible</Text>
        {bientot.map((it) => (
          <Pressable
            key={it.nom}
            style={[st.card, { opacity: 0.6 }]}
            onPress={() => Alert.alert(it.nom, 'Ce service arrive très bientôt sur Taga. Reste connecté !')}
          >
            <View style={[st.cardIcon, { backgroundColor: colors.surface2 }]}><Ionicons name={it.icon as any} size={24} color={colors.inkMute} /></View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={st.cardName}>{it.nom}</Text>
                <Tag text="Bientôt" tone="mute" />
              </View>
              <Text style={st.cardDesc}>{it.desc}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  head: { paddingHorizontal: space.lg, paddingTop: 10, paddingBottom: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8, marginBottom: 2 },
  title: { fontSize: 28, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 14, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  feature: { marginHorizontal: space.lg, marginTop: 10, marginBottom: 8, backgroundColor: colors.ink, borderRadius: radius.xl, padding: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', ...shadow.pop },
  featureTitle: { color: colors.white, fontSize: 21, fontWeight: '800', marginTop: 12, lineHeight: 26 },
  featureIcon: { width: 64, height: 64, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  groupTitle: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: space.lg, marginTop: 22, marginBottom: 10 },
  card: { marginHorizontal: space.lg, marginBottom: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  cardIcon: { width: 54, height: 54, borderRadius: 16, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 16, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  cardDesc: { fontSize: 13, color: colors.inkSoft, fontWeight: '600', marginTop: 3, lineHeight: 18 },
});
