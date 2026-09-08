import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../../theme';
import { Header, Btn } from '../../components/ui';

const FAQ = [
  {
    q: 'Comment sont calculés mes gains ?',
    r: 'Tu gardes 100% de tes courses, colis et livraisons de repas (pourboires compris) — Taga se rémunère uniquement sur ton abonnement. Seul le camion (déménagement) fonctionne autrement : pas d\'abonnement, mais une commission Taga sur chaque course. Le détail exact est affiché sur chaque mission.',
  },
  {
    q: 'Quand suis-je payé ?',
    r: 'Ce que tu encaisses en espèces est déjà dans ta poche. Pour le reste, demande un retrait à tout moment depuis l\'onglet Gains : Taga vérifie la demande puis verse le montant sur ton Orange Money.',
  },
  {
    q: 'Problème avec un passager ?',
    r: 'Utilise le bouton SOS sur l\'accueil : tu peux partager ta position à un proche ou appeler directement la police (17). Tu peux aussi joindre le support ci-dessus à tout moment.',
  },
];

export default function Help() {
  const [open, setOpen] = useState<number | null>(null);
  const router = useRouter();

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Aide & support" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
        <Text style={st.intro}>Une question ou un souci pendant une course ? On est là 24h/24.</Text>

        <Pressable style={st.support} onPress={() => router.push('/support-chat')}>
          <View style={st.supportIcon}><Ionicons name="chatbubbles" size={22} color={colors.white} /></View>
          <Text style={st.supportText}>Discuter avec le support</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.white} />
        </Pressable>

        <Pressable style={st.supportSec} onPress={() => Linking.openURL('tel:+22376000012').catch(() => {})}>
          <View style={st.supportSecIcon}><Ionicons name="call" size={19} color={colors.brand} /></View>
          <Text style={st.supportSecText}>Appeler le support</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMute} />
        </Pressable>

        <View style={{ height: 20 }} />

        {FAQ.map((f, i) => {
          const isOpen = open === i;
          return (
            <Pressable key={i} onPress={() => setOpen(isOpen ? null : i)} style={st.faq}>
              <View style={st.faqHead}>
                <Text style={st.faqQ}>{f.q}</Text>
                <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.inkMute} />
              </View>
              {isOpen && <Text style={st.faqR}>{f.r}</Text>}
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  intro: { fontSize: 14.5, fontWeight: '600', color: colors.inkSoft, lineHeight: 21, marginTop: 6, marginBottom: 18 },
  support: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.ink, borderRadius: radius.lg, padding: 16 },
  supportIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  supportText: { flex: 1, fontSize: 15.5, fontWeight: '800', color: colors.white },
  supportSec: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  supportSecIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  supportSecText: { flex: 1, fontSize: 15.5, fontWeight: '800', color: colors.ink },
  faq: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line, marginBottom: 12 },
  faqHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  faqQ: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.ink },
  faqR: { fontSize: 14, fontWeight: '600', color: colors.ink2, lineHeight: 20, marginTop: 12 },
});
