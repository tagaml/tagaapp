import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, RefreshControl, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../theme';
import { Header, Tag, Skeleton, FoodImage } from '../components/ui';
import { categoriesFood } from '../data/mock';
import { getRestaurants, type Restaurant } from '../lib/db';

export default function Food() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);

  const charger = async () => {
    setLoading(true);
    try {
      const data = await getRestaurants();
      setRestaurants(data);
      setError(false);
    } catch {
      setRestaurants([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    charger();
  }, []);

  const refresh = () => {
    charger();
  };
  const list = restaurants.filter((r) => {
    const matchQ = r.nom.toLowerCase().includes(q.toLowerCase()) || r.type.toLowerCase().includes(q.toLowerCase());
    const matchCat = !cat || r.type.toLowerCase().includes(cat.toLowerCase()) || r.nom.toLowerCase().includes(cat.toLowerCase());
    return matchQ && matchCat;
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Restaurants" />

      {/* Recherche */}
      <View style={st.search}>
        <Ionicons name="search" size={18} color={colors.inkMute} />
        <TextInput
          placeholder="Un resto, un plat…"
          placeholderTextColor={colors.inkMute}
          value={q}
          onChangeText={setQ}
          style={st.searchInput}
        />
      </View>

      <View style={st.delivNote}>
        <Ionicons name="bicycle" size={15} color={colors.brand} />
        <Text style={st.delivNoteText}>Livraison à partir de 1 000 F</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.brand} />}
      >
        {/* Catégories */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.cats}>
          {categoriesFood.map((c) => {
            const on = cat === c;
            return (
              <Pressable key={c} style={[st.cat, on && st.catOn]} onPress={() => setCat(on ? null : c)}>
                <Text style={[st.catText, on && st.catTextOn]}>{c}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Offre du moment */}
        <View style={st.offer}>
          <View style={st.offerIcon}><Text style={{ fontSize: 22 }}>🎉</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={st.offerTitle}>Offre du moment</Text>
            <Text style={st.offerSub}>-30% sur tes 3 premières commandes · TAGA30</Text>
          </View>
        </View>

        {loading ? (
          <>
            <Text style={st.section}>Autour de toi</Text>
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i} style={st.skelCard}>
                <Skeleton height={130} width="100%" radius={0} />
                <View style={{ padding: 16, gap: 8 }}>
                  <Skeleton height={18} width="60%" radius={8} />
                  <Skeleton height={13} width="40%" radius={8} />
                  <Skeleton height={24} width={120} radius={12} />
                </View>
              </View>
            ))}
          </>
        ) : error ? (
          // Une panne réseau ne doit JAMAIS s'afficher comme « aucun résultat » :
          // l'erreur est testée AVANT le filtre de recherche.
          <>
            <Text style={st.section}>Autour de toi</Text>
            <Pressable style={st.errorRow} onPress={charger}>
              <Ionicons name="cloud-offline-outline" size={20} color={colors.inkSoft} />
              <Text style={st.errorText}>Connexion indisponible</Text>
              <View style={st.retryBtn}><Text style={st.retryText}>Réessayer</Text></View>
            </Pressable>
          </>
        ) : (q.length > 0 || cat) && list.length === 0 ? (
          <View style={st.empty}>
            <Text style={{ fontSize: 40 }}>🔍</Text>
            <Text style={st.emptyTitle}>Aucun résultat</Text>
            <Text style={st.emptySub}>On n'a trouvé aucun resto pour cette recherche. Essaie un autre mot.</Text>
          </View>
        ) : list.length === 0 ? (
          <>
            <Text style={st.section}>Autour de toi</Text>
            <View style={st.empty}>
              <Text style={{ fontSize: 40 }}>🍽️</Text>
              <Text style={st.emptyTitle}>Aucun restaurant pour le moment</Text>
              <Text style={st.emptySub}>Reviens un peu plus tard, de nouveaux restos arrivent bientôt sur Taga.</Text>
            </View>
          </>
        ) : (
          <>
            <Text style={st.section}>Autour de toi</Text>
            {list.map((r) => {
              const ferme = r.ouvert === false;
              return (
              <Pressable
                key={r.id}
                style={[st.card, ferme && { opacity: 0.55 }]}
                onPress={() => ferme
                  ? Alert.alert('Restaurant fermé', `${r.nom} n'accepte pas de commandes pour le moment.`)
                  : router.push({ pathname: '/resto-detail', params: { slug: r.slug } })}
              >
                <View style={st.thumb}>
                  <FoodImage uri={(r.cover ?? r.img) ?? undefined} emoji={r.emoji ?? undefined} emojiSize={40} style={StyleSheet.absoluteFill} />
                  {ferme
                    ? <View style={[st.promoTag, { backgroundColor: colors.ink }]}><Text style={st.promoText}>Fermé</Text></View>
                    : <>
                        {r.promo && <View style={st.promoTag}><Text style={st.promoText}>{r.promo}</Text></View>}
                        {r.badge && <View style={[st.promoTag, st.badgeRight]}><Text style={st.promoText}>{r.badge}</Text></View>}
                      </>}
                </View>
                <View style={st.cardBody}>
                  <View style={st.cardTop}>
                    <Text style={st.name} numberOfLines={1}>{r.nom}</Text>
                    <View style={st.ratingChip}>
                      <Ionicons name="star" size={12} color={colors.gold} />
                      <Text style={st.note}>{r.note}</Text>
                    </View>
                  </View>
                  <Text style={st.type} numberOfLines={1}>{r.type}</Text>
                  <View style={st.metaRow}>
                    <Ionicons name="time-outline" size={14} color={colors.inkSoft} />
                    <Text style={st.eta} numberOfLines={1}>{r.eta}</Text>
                    <View style={st.metaDot} />
                    {/* Même libellé que l'accueil : pas de montant inventé si le marchand n'en donne pas. */}
                    <Tag
                      text={r.livraison_offerte ? 'Livraison offerte' : r.livraison ? `Livraison · ${r.livraison}` : 'Livraison selon distance'}
                      tone={r.livraison_offerte ? 'green' : 'mute'}
                    />
                  </View>
                </View>
              </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: space.lg, marginBottom: 4, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 16, height: 52, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  searchInput: { flex: 1, fontSize: 15, color: colors.ink, fontWeight: '600' },
  cats: { paddingHorizontal: space.lg, gap: 8, paddingVertical: 14 },
  cat: { paddingHorizontal: 16, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line2 },
  catOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  catText: { fontSize: 13.5, fontWeight: '700', color: colors.ink2 },
  catTextOn: { color: colors.white },
  delivNote: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: space.lg, marginTop: 4, marginBottom: 4, paddingVertical: 10, paddingHorizontal: 13, backgroundColor: colors.brandTint, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandSoft },
  delivNoteText: { fontSize: 13, fontWeight: '800', color: colors.brandDeep },
  offer: { flexDirection: 'row', alignItems: 'center', gap: 13, marginHorizontal: space.lg, backgroundColor: colors.goldSoft, borderRadius: radius.lg, padding: 14, marginBottom: 8, ...shadow.card },
  offerIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  offerTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  offerSub: { fontSize: 12.5, fontWeight: '600', color: colors.ink2, marginTop: 2 },
  section: { fontSize: 19, fontWeight: '800', color: colors.ink, paddingHorizontal: space.lg, marginTop: 18, marginBottom: 14 },
  card: { marginHorizontal: space.lg, marginBottom: 16, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', ...shadow.card },
  skelCard: { marginHorizontal: space.lg, marginBottom: 16, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', ...shadow.card },
  thumb: { height: 150, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  promoTag: { position: 'absolute', top: 12, left: 12, backgroundColor: colors.brand, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 9, ...shadow.card },
  badgeRight: { left: undefined, right: 12, backgroundColor: colors.green },
  promoText: { color: colors.white, fontSize: 12, fontWeight: '800' },
  cardBody: { padding: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 17.5, fontWeight: '800', color: colors.ink },
  ratingChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.goldSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  note: { fontSize: 13, fontWeight: '800', color: colors.ink },
  eta: { fontSize: 13, fontWeight: '700', color: colors.inkSoft },
  type: { fontSize: 13.5, color: colors.inkSoft, fontWeight: '600', marginTop: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.line2, marginHorizontal: 2 },
  empty: { alignItems: 'center', paddingHorizontal: 40, paddingTop: 50, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  emptySub: { fontSize: 14, color: colors.inkSoft, fontWeight: '600', textAlign: 'center', lineHeight: 20 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: space.lg, backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.line },
  errorText: { flex: 1, fontSize: 14.5, fontWeight: '700', color: colors.ink },
  retryBtn: { paddingHorizontal: 14, height: 36, borderRadius: radius.md, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: colors.white, fontWeight: '800', fontSize: 13 },
});
