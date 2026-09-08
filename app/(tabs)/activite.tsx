import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../../theme';
import { fcfa } from '../../data/mock';
import { getActivity, type ActivityItem } from '../../lib/db';

const filtres = ['Tout', 'Courses', 'Restaurant', 'Colis', 'Déménagement'];

const statutTone: Record<string, string> = {
  Terminée: colors.green, Terminé: colors.green, Livrée: colors.green, Livré: colors.green,
  Confirmé: colors.green, Planifié: colors.green, Annulée: colors.brandDeep,
};

export default function Activite() {
  const router = useRouter();
  const [filtre, setFiltre] = useState('Tout');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [allItems, setAllItems] = useState<ActivityItem[]>([]);

  const charger = useCallback(async () => {
    try {
      const data = await getActivity();
      setAllItems(data);
      setError(false);
    } catch {
      // Distingue « erreur réseau » de « vraiment vide » (sinon on affiche « Aucune activité » à tort).
      setError((prev) => prev || true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);
  useFocusEffect(useCallback(() => { charger(); }, [charger]));

  const refresh = () => {
    setRefreshing(true);
    charger().finally(() => setRefreshing(false));
  };

  const items = allItems.filter((h) => filtre === 'Tout' || h.cat === filtre);
  const jours = [...new Set(items.map((i) => i.jour))];

  const now = new Date();
  const trajets = allItems.filter((i) => i.cat === 'Courses').length;
  const repas = allItems.filter((i) => i.cat === 'Restaurant').length;
  const ceMois = allItems
    .filter((i) => {
      const d = new Date(i.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, i) => s + i.prix, 0);
  const ceMoisLabel = fcfa(ceMois);
  const vide = !loading && !error && allItems.length === 0;
  const enErreur = !loading && error && allItems.length === 0;

  // Course/commande en cours réelle (statut non terminal).
  const enCoursStatuts = ['Recherche', 'Programmée', 'En route', 'Arrivé', 'En cours', 'Confirmée', 'En préparation', 'Prête', 'En livraison'];
  const enCours = allItems.find((i) => enCoursStatuts.includes(i.statut));

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brand} />}
      >
        <View style={st.head}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => router.navigate('/(tabs)')} hitSlop={8} style={st.backBtn}>
              <Ionicons name="chevron-back" size={24} color={colors.ink} />
            </Pressable>
            <Pressable onPress={() => router.push('/notifications')} hitSlop={8} style={st.backBtn}>
              <Ionicons name="notifications-outline" size={22} color={colors.ink} />
            </Pressable>
          </View>
          <Text style={st.title}>Activité</Text>
        </View>

        {/* En cours (course ou commande) — affiché seulement s'il y en a une réelle */}
        {enCours && (
          <Pressable
            onPress={() => router.push(
              enCours.cat === 'Restaurant'
                ? { pathname: '/food-track', params: { orderId: enCours.id.slice(2) } }
                : enCours.statut === 'Recherche'
                  ? { pathname: '/searching', params: { rideId: enCours.id.slice(2) } }
                  : { pathname: '/trip-active', params: { rideId: enCours.id.slice(2) } }
            )}
            style={st.live}
          >
            <View style={st.livePulse}>
              <Ionicons name={enCours.cat === 'Restaurant' ? 'fast-food' : 'car-sport'} size={22} color={colors.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.liveTitle}>{enCours.cat === 'Restaurant' ? 'Commande en cours' : 'Course en cours'}</Text>
              <Text style={st.liveSub} numberOfLines={1}>{enCours.titre}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={st.liveEta}>{enCours.statut}</Text>
              <Text style={st.liveEtaLabel}>STATUT</Text>
            </View>
          </Pressable>
        )}

        {/* Stats */}
        <View style={st.stats}>
          {[[String(trajets), 'Trajets'], [String(repas), 'Repas'], [ceMoisLabel, 'Ce mois']].map(([n, l]) => (
            <View key={l} style={st.stat}>
              <Text style={st.statN}>{n}</Text>
              <Text style={st.statL}>{l}</Text>
            </View>
          ))}
        </View>

        {/* Filtres */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips}>
          {filtres.map((f) => (
            <Pressable key={f} onPress={() => setFiltre(f)} style={[st.chip, filtre === f && st.chipOn]}>
              <Text style={[st.chipText, filtre === f && st.chipTextOn]}>{f}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Erreur réseau (distincte de « vide ») */}
        {enErreur && (
          <View style={st.empty}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.inkMute} />
            <Text style={st.emptyText}>Connexion indisponible. Vérifie ton réseau puis réessaie.</Text>
            <Pressable style={st.retryBtn} onPress={charger}>
              <Ionicons name="refresh" size={16} color={colors.white} />
              <Text style={st.retryText}>Réessayer</Text>
            </Pressable>
          </View>
        )}

        {/* État vide */}
        {vide && (
          <View style={st.empty}>
            <Ionicons name="receipt-outline" size={40} color={colors.inkMute} />
            <Text style={st.emptyText}>Aucune activité — tes courses et commandes apparaîtront ici.</Text>
          </View>
        )}

        {/* Liste */}
        {jours.map((jour) => (
          <View key={jour}>
            <Text style={st.dayLabel}>{jour}</Text>
            {items.filter((i) => i.jour === jour).map((it) => (
              <Pressable
                key={it.id}
                style={st.item}
                onPress={() => router.push(
                  it.cat === 'Restaurant'
                    ? { pathname: '/receipt', params: { id: it.id.slice(2) } }
                    : it.cat === 'Déménagement'
                      ? { pathname: '/moving-detail', params: { id: it.id.slice(2) } }
                      : { pathname: '/trip-detail', params: { id: it.id.slice(2) } }
                )}
              >
                <View style={st.itemIcon}>
                  <Ionicons
                    name={it.cat === 'Restaurant' ? 'restaurant' : it.cat === 'Colis' ? 'cube' : it.cat === 'Déménagement' ? 'car' : 'car-sport'}
                    size={20} color={colors.ink2}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.itemTitle}>{it.titre}</Text>
                  <Text style={st.itemSub}>{it.heure} · {it.sous}</Text>
                  <Text style={st.itemAction}>{it.cat === 'Déménagement' ? it.action : `${it.action} · Reçu`}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={st.itemPrice}>{fcfa(it.prix)}</Text>
                  <Text style={[st.itemStatut, { color: statutTone[it.statut] || colors.inkSoft }]}>{it.statut}</Text>
                </View>
              </Pressable>
            ))}
          </View>
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
  live: { marginHorizontal: space.lg, marginTop: 6, backgroundColor: colors.ink, borderRadius: radius.lg, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 13, ...shadow.pop },
  livePulse: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  liveTitle: { color: colors.white, fontSize: 15.5, fontWeight: '800' },
  liveSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600', marginTop: 2 },
  liveEta: { color: colors.brand, fontSize: 17, fontWeight: '800' },
  liveEtaLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  stats: { flexDirection: 'row', gap: 10, paddingHorizontal: space.lg, marginTop: 14 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.line },
  statN: { fontSize: 17, fontWeight: '800', color: colors.ink },
  statL: { fontSize: 12, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  chips: { paddingHorizontal: space.lg, gap: 8, paddingVertical: 16 },
  chip: { paddingHorizontal: 16, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line2 },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 13.5, fontWeight: '700', color: colors.ink2 },
  chipTextOn: { color: colors.white },
  dayLabel: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, paddingHorizontal: space.lg, marginTop: 10, marginBottom: 8 },
  item: { marginHorizontal: space.lg, marginBottom: 10, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 15, flexDirection: 'row', gap: 13, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  itemIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  itemSub: { fontSize: 13, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  itemAction: { fontSize: 12.5, color: colors.brand, fontWeight: '700', marginTop: 6 },
  itemPrice: { fontSize: 15, fontWeight: '800', color: colors.ink },
  itemStatut: { fontSize: 12.5, fontWeight: '700', marginTop: 4 },
  empty: { alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: 48, gap: 12 },
  emptyText: { fontSize: 14, color: colors.inkSoft, fontWeight: '600', textAlign: 'center', lineHeight: 20 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.ink, borderRadius: radius.md, paddingHorizontal: 18, paddingVertical: 11, marginTop: 4 },
  retryText: { color: colors.white, fontSize: 14, fontWeight: '800' },
});
