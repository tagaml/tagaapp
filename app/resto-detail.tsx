import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../theme';
import { Btn, CtaBar, useToast, FoodImage, Skeleton } from '../components/ui';
import { fcfa } from '../data/mock';
import { getRestaurant, type RestaurantDetail } from '../lib/db';
import { useCart } from '../components/cart';

export default function RestoDetail() {
  const router = useRouter();
  const toast = useToast();
  const { add, count } = useCart();
  const insets = useSafeAreaInsets();
  const { slug = 'fatou' } = useLocalSearchParams<{ slug?: string }>();

  const [resto, setResto] = useState<RestaurantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [essai, setEssai] = useState(0); // relance manuelle (Réessayer)

  useEffect(() => {
    let actif = true;
    setLoading(true);
    (async () => {
      try {
        const data = await getRestaurant(slug);
        if (actif) setResto(data);
      } catch {
        if (actif) setResto(null);
      } finally {
        if (actif) setLoading(false);
      }
    })();
    return () => {
      actif = false;
    };
  }, [slug, essai]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={st.cover}>
          <Skeleton height={200} width="100%" radius={0} style={StyleSheet.absoluteFill} />
          <Pressable onPress={() => router.back()} style={[st.coverBack, { top: insets.top + 6 }]}>
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
        </View>
        <View style={[st.sheet, { paddingTop: 22, gap: 12 }]}>
          <Skeleton height={26} width="55%" radius={8} />
          <Skeleton height={14} width="35%" radius={8} />
          <Skeleton height={60} width="100%" radius={radius.lg} />
          <Skeleton height={42} width="100%" radius={radius.md} />
          <Skeleton height={90} width="100%" radius={radius.md} />
          <Skeleton height={90} width="100%" radius={radius.md} />
        </View>
      </View>
    );
  }

  if (!resto) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={st.cover}>
          <Pressable onPress={() => router.back()} style={[st.coverBack, { top: insets.top + 6 }]}>
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
        </View>
        {/* Échec de chargement : on ne fait pas croire à une page vide, on propose de réessayer. */}
        <View style={st.unavailable}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.inkMute} />
          <Text style={st.unavailableTitle}>Impossible d'afficher ce restaurant</Text>
          <Text style={st.unavailableSub}>Vérifie ta connexion puis réessaie.</Text>
          <Btn label="Réessayer" onPress={() => { setLoading(true); setEssai((n) => n + 1); }} style={{ marginTop: 16, paddingHorizontal: 26 }} />
        </View>
      </View>
    );
  }

  const ferme = resto.ouvert === false;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Bandeau image */}
      <View style={st.cover}>
        <FoodImage uri={resto.cover ?? undefined} emoji={resto.emoji ?? '🍽️'} emojiSize={88} style={StyleSheet.absoluteFill} />
        <Pressable onPress={() => router.back()} style={[st.coverBack, { top: insets.top + 6 }]}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }} style={st.sheet}>
        <Text style={st.name}>{resto.nom}</Text>
        <Text style={st.meta}>{resto.type}</Text>

        {ferme && (
          <View style={st.closed}>
            <Ionicons name="lock-closed" size={15} color={colors.ink} />
            <Text style={st.closedText}>Restaurant fermé · les commandes ne sont pas disponibles pour le moment.</Text>
          </View>
        )}

        {/* Stats — libellés clairs, pas de « Distance » vide. Un resto sans avis affiche « Nouveau ». */}
        <View style={st.stats}>
          {(() => {
            const nouveau = (resto.avis ?? 0) === 0;
            // Frais de livraison compacts : « À partir de 1000 F » débordait → « dès 1000 F ».
            const livr = resto.livraison_offerte ? 'Offerte' : ((resto.livraison || '—').replace(/^À partir de\s*/i, 'dès '));
            const stats: [string, string][] = [
              [nouveau ? 'Nouveau' : `★ ${resto.note}`, nouveau ? 'restaurant' : `${resto.avis} avis`],
              [resto.eta || '—', 'Préparation'],
              [livr, 'Livraison'],
            ];
            return stats.map(([n, l], i) => (
              <View key={i} style={[st.stat, i < stats.length - 1 && st.statBorder]}>
                <Text style={st.statN} numberOfLines={1} adjustsFontSizeToFit>{n}</Text>
                <Text style={st.statL} numberOfLines={1}>{l}</Text>
              </View>
            ));
          })()}
        </View>

        {resto.horaire && (
          <View style={st.horaire}>
            <Ionicons name="time" size={15} color={colors.green} />
            <Text style={st.horaireText}>{resto.horaire}</Text>
          </View>
        )}

        {/* Menu par section */}
        {(resto.sections ?? []).map((sec) => (
          <View key={sec.id}>
            <View style={st.secHead}>
              <Text style={st.secTitle}>{sec.titre}</Text>
              <Text style={st.secCount}>{(sec.plats ?? []).length}</Text>
            </View>
            {(sec.plats ?? []).map((p) => (
              <Pressable
                key={p.id}
                style={st.plat}
                onPress={() =>
                  ferme
                    ? Alert.alert('Restaurant fermé', `${resto.nom} n'accepte pas de commandes pour le moment.`)
                    : router.push({
                    pathname: '/plat',
                    params: {
                      id: p.id,
                      nom: p.nom,
                      desc: p.desc ?? '',
                      prix: String(p.prix),
                      img: p.img ?? '',
                      emoji: p.emoji ?? '',
                      restoId: resto.id ?? '',
                      restoNom: resto.nom,
                      eta: resto.eta ?? '',
                      variantes: JSON.stringify(p.variantes ?? []),
                    },
                  })
                }
              >
                <View style={{ flex: 1 }}>
                  {p.populaire && (
                    <View style={st.pop}><Ionicons name="flame" size={11} color={colors.brandDeep} /><Text style={st.popText}>Populaire</Text></View>
                  )}
                  <Text style={st.platName}>{p.nom}</Text>
                  <Text style={st.platDesc}>{p.desc}</Text>
                  <Text style={st.platPrix}>{fcfa(p.prix)}</Text>
                </View>
                <View style={st.platThumb}>
                  <FoodImage uri={p.img ?? undefined} emoji={p.emoji ?? undefined} emojiSize={30} style={StyleSheet.absoluteFill} />
                  <Pressable
                    style={[st.add, ferme && { opacity: 0.5 }]}
                    onPress={() => {
                      if (ferme) {
                        Alert.alert('Restaurant fermé', `${resto.nom} n'accepte pas de commandes pour le moment.`);
                        return;
                      }
                      // Plat avec options → on ouvre la personnalisation. Sinon ajout direct.
                      if (p.variantes && p.variantes.length) {
                        router.push({ pathname: '/plat', params: { id: p.id, nom: p.nom, desc: p.desc ?? '', prix: String(p.prix), img: p.img ?? '', emoji: p.emoji ?? '', restoId: resto.id ?? '', restoNom: resto.nom, eta: resto.eta ?? '', variantes: JSON.stringify(p.variantes) } });
                        return;
                      }
                      add(
                        { id: resto.id || null, nom: resto.nom, eta: resto.eta || null },
                        { id: p.id, menuItemId: p.id, nom: p.nom, prix: p.prix, qte: 1 },
                      );
                      toast(`${p.nom} ajouté au panier`, { tone: 'success' });
                    }}
                  >
                    <Ionicons name="add" size={20} color={colors.white} />
                  </Pressable>
                </View>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>

      <CtaBar>
        {ferme && count === 0 ? (
          <Btn label="Restaurant fermé" disabled />
        ) : (
          <Btn label={count > 0 ? `Voir le panier · ${count}` : 'Voir le panier'} onPress={() => router.push('/cart')} />
        )}
      </CtaBar>
    </View>
  );
}

const st = StyleSheet.create({
  cover: { height: 250, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center', paddingTop: 30 },
  coverBack: { position: 'absolute', top: 50, left: space.lg, width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  sheet: { flex: 1, backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, marginTop: -24, paddingTop: 22, paddingHorizontal: space.lg },
  name: { fontSize: 26, fontWeight: '800', color: colors.ink },
  meta: { fontSize: 14, color: colors.inkSoft, fontWeight: '600', marginTop: 3 },
  stats: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: 16, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 6 },
  statBorder: { borderRightWidth: 1, borderRightColor: colors.line },
  statN: { fontSize: 15, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  statL: { fontSize: 11, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  horaire: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, backgroundColor: colors.greenSoft, borderRadius: radius.md, padding: 12 },
  horaireText: { fontSize: 13, fontWeight: '700', color: colors.green, flex: 1 },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 26, marginBottom: 10 },
  secTitle: { fontSize: 19, fontWeight: '800', color: colors.ink },
  secCount: { fontSize: 13, fontWeight: '700', color: colors.inkMute, backgroundColor: colors.surface2, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  plat: { flexDirection: 'row', gap: 14, alignItems: 'center', padding: 12, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, marginBottom: 12, ...shadow.card },
  pop: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', backgroundColor: colors.brandSoft, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, marginBottom: 5 },
  popText: { fontSize: 10.5, fontWeight: '800', color: colors.brandDeep },
  platName: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  platDesc: { fontSize: 13, color: colors.inkSoft, fontWeight: '600', marginTop: 3, lineHeight: 18 },
  platPrix: { fontSize: 14.5, fontWeight: '800', color: colors.ink, marginTop: 8 },
  platThumb: { width: 94, height: 94, borderRadius: radius.lg, backgroundColor: colors.surface2, overflow: 'hidden', justifyContent: 'flex-end', alignItems: 'flex-end', padding: 6 },
  add: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface, ...shadow.pop },
  unavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 10 },
  unavailableTitle: { fontSize: 18, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  unavailableSub: { fontSize: 14, fontWeight: '600', color: colors.inkSoft, textAlign: 'center' },
  closed: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, backgroundColor: colors.surface2, borderRadius: radius.md, padding: 12 },
  closedText: { fontSize: 13, fontWeight: '700', color: colors.ink, flex: 1, lineHeight: 18 },
});
