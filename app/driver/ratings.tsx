import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../../theme';
import { Header, Avatar } from '../../components/ui';
import { getDriverStats, getDriverOfferStats, type DriverStats, type DriverOfferStats } from '../../lib/db';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function dateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MOIS[d.getMonth()]}`;
}
function initiales(nom: string | null): string {
  if (!nom) return '?';
  return nom.split(' ').filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function Stars({ note, size = 13 }: { note: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons
          key={i}
          name={i <= Math.round(note) ? 'star' : 'star-outline'}
          size={size}
          color={colors.gold}
        />
      ))}
    </View>
  );
}

export default function Ratings() {
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [offers, setOffers] = useState<DriverOfferStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [s, o] = await Promise.all([getDriverStats(), getDriverOfferStats()]);
        if (mounted) { setStats(s); setOffers(o); }
      } catch {
        /* garde l'écran vide */
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const avis = stats?.avis ?? [];
  const satisfaction = stats && stats.nbNotes > 0 ? Math.round((stats.note / 5) * 100) : null;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Évaluations" />
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
          <View style={st.hero}>
            <Text style={st.big}>{(stats?.note ?? 0).toFixed(1).replace('.', ',')}</Text>
            <Stars note={stats?.note ?? 0} size={18} />
            <Text style={st.count}>
              {stats?.nbNotes ?? 0} avis
            </Text>
          </View>

          {/* Ma performance — couleurs dans l'ordre du drapeau du Mali (vert · jaune · rouge) :
              Acceptation (vert) · Satisfaction (jaune/or) · Refus (rouge). */}
          <View style={st.perfCard}>
            <View style={st.perfCol}>
              <Text style={[st.perfValue, { color: colors.green }]}>{offers ? `${offers.acceptRate}%` : '—'}</Text>
              <Text style={st.perfLabel}>Acceptation</Text>
            </View>
            <View style={st.perfSep} />
            <View style={st.perfCol}>
              <Text style={[st.perfValue, { color: colors.gold }]}>{satisfaction != null ? `${satisfaction}%` : '—'}</Text>
              <Text style={st.perfLabel}>Satisfaction</Text>
            </View>
            <View style={st.perfSep} />
            <View style={st.perfCol}>
              <Text style={[st.perfValue, { color: colors.brand }]}>{offers ? `${offers.refuseRate}%` : '—'}</Text>
              <Text style={st.perfLabel}>Refus</Text>
            </View>
          </View>

          <Text style={st.section}>Avis récents</Text>

          {avis.length === 0 ? (
            <View style={st.empty}>
              <Ionicons name="star-outline" size={40} color={colors.inkMute} />
              <Text style={st.emptyTitle}>Aucun avis pour l'instant</Text>
              <Text style={st.emptySub}>Tes prochaines courses notées apparaîtront ici.</Text>
            </View>
          ) : (
            avis.map((a, i) => (
              <View key={i} style={st.avis}>
                <View style={st.avisHead}>
                  <Avatar text={initiales(a.passager)} size={42} tone="ink" />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={st.avisNom}>{a.passager ?? 'Passager'}</Text>
                    <Text style={st.avisQuand}>{dateLabel(a.date)}</Text>
                  </View>
                  <Stars note={a.note} />
                </View>
                {a.commentaire ? <Text style={st.avisTexte}>{a.commentaire}</Text> : null}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: 12 },
  big: { fontSize: 52, fontWeight: '800', color: colors.ink },
  count: { fontSize: 14, fontWeight: '700', color: colors.inkSoft, marginTop: 8 },
  perfCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingVertical: 16, paddingHorizontal: 8, marginTop: 22 },
  perfCol: { flex: 1, alignItems: 'center' },
  perfValue: { fontSize: 22, fontWeight: '800' },
  perfLabel: { fontSize: 12, fontWeight: '700', color: colors.inkSoft, marginTop: 3, textAlign: 'center' },
  perfSep: { width: 1, height: 34, backgroundColor: colors.line },
  section: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 26, marginBottom: 4 },
  empty: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 28, marginTop: 14, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.ink, marginTop: 4 },
  emptySub: { fontSize: 13.5, fontWeight: '600', color: colors.inkSoft, textAlign: 'center', lineHeight: 19 },
  avis: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line, marginTop: 14 },
  avisHead: { flexDirection: 'row', alignItems: 'center' },
  avisNom: { fontSize: 15, fontWeight: '800', color: colors.ink },
  avisQuand: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  avisTexte: { fontSize: 14, fontWeight: '600', color: colors.ink2, lineHeight: 20, marginTop: 12 },
});
