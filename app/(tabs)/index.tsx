import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ImageBackground } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../../theme';
import { Avatar, Card, Tag, ServiceIcon, FoodImage, Skeleton } from '../../components/ui';
import * as Location from 'expo-location';
import { useAuth } from '../../components/auth';
import { getRestaurants, getDefaultAddress, getUnreadNotifCount, getMyClientTrip, getMyPhoto, getPromoBanners, type Restaurant, type ActiveTrip, type PromoBanner } from '../../lib/db';
import { setSearchBias } from '../../lib/geo';
import { RESTRICT_TO_MALI, inMaliBox } from '../../lib/geoGuard';

const services = [
  { key: 'Taxi', icon: 'car', route: '/ride-voiture' },
  { key: 'Moto', icon: 'moto', route: '/ride-moto' },
  { key: 'Coursier', icon: 'colis', route: '/colis' },
  { key: 'Restaurant', icon: 'food', route: '/food' },
  { key: 'Déménagement', icon: 'demenagement', route: '/demenagement' },
] as const;

export default function Home() {
  const router = useRouter();
  const { user: authUser } = useAuth();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [quartier, setQuartier] = useState<string>('Choisir une adresse');
  const [nonLus, setNonLus] = useState(0);
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [banners, setBanners] = useState<PromoBanner[]>([]);
  const [liveAddr, setLiveAddr] = useState<string | null>(null); // adresse GPS en direct (façon Uber)
  const [liveCity, setLiveCity] = useState<string | null>(null); // ville réelle issue du reverse-geocode

  const openActiveTrip = () => {
    if (!activeTrip) return;
    if (activeTrip.kind === 'ride') {
      router.push({ pathname: activeTrip.statut === 'recherche' ? '/searching' : '/trip-active', params: { rideId: activeTrip.id } });
    } else {
      router.push({ pathname: '/food-track', params: { orderId: activeTrip.id } });
    }
  };

  const chargerRestos = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRestaurants();
      setRestaurants(data);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { chargerRestos(); }, [chargerRestos]);
  // Bannières pub (gérées dans l'admin) — chargées à part, jamais bloquantes.
  useEffect(() => { getPromoBanners().then(setBanners).catch(() => {}); }, []);

  // Géolocalisation directe (façon Uber) : adresse GPS réelle sous « Bamako, Mali ».
  useEffect(() => {
    let actif = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!RESTRICT_TO_MALI || inMaliBox(pos.coords.latitude, pos.coords.longitude)) setSearchBias(pos.coords.latitude, pos.coords.longitude);
        const g = (await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }))[0];
        if (!actif || !g) return;
        const label = [g.name || g.street, g.district || g.city].filter(Boolean).join(', ');
        if (label) setLiveAddr(label);
        const city = g.city || g.subregion || g.region;
        if (city) setLiveCity(city);
      } catch { /* pas de position : on garde l'adresse par défaut */ }
    })();
    return () => { actif = false; };
  }, []);

  // Adresse par défaut + notifications non lues, rafraîchies à chaque focus.
  useFocusEffect(
    useCallback(() => {
      let actif = true;
      (async () => {
        try {
          const [adr, unread, trip, ph] = await Promise.all([getDefaultAddress(), getUnreadNotifCount(), getMyClientTrip(), getMyPhoto()]);
          if (!actif) return;
          if (adr?.detail) setQuartier(adr.detail);
          setNonLus(unread);
          setActiveTrip(trip);
          setPhoto(ph);
        } catch {
          /* silencieux */
        }
      })();
      return () => { actif = false; };
    }, [])
  );

  const initiales = ((authUser?.prenom?.trim()[0] ?? '') + (authUser?.nom?.trim()[0] ?? '')).toUpperCase() || '?';
  // Ville en tête : ville réelle issue du reverse-geocode si disponible, sinon libellé neutre (pas de ville inventée).
  const ville = liveCity ?? 'Ta position';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Barre localisation */}
        <View style={st.topBar}>
          <Pressable style={{ flex: 1 }} onPress={() => router.push('/addresses')}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="location" size={14} color={colors.brand} />
              <Text style={st.city}>{ville}</Text>
              <Ionicons name="chevron-down" size={14} color={colors.inkMute} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="navigate" size={11} color={colors.inkSoft} />
              <Text style={st.quartier} numberOfLines={1}>{liveAddr ?? quartier}</Text>
            </View>
          </Pressable>
          <Pressable style={st.bell} onPress={() => router.push('/notifications')} hitSlop={8}>
            <Ionicons name="notifications-outline" size={22} color={colors.ink} />
            {nonLus > 0 && (
              <View style={st.bellBadge}>
                <Text style={st.bellBadgeText}>{nonLus}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Bandeau « en cours » : revenir à la course/commande active */}
        {activeTrip && (
          <Pressable style={st.live} onPress={openActiveTrip}>
            <View style={st.livePulse}>
              <Ionicons name={activeTrip.kind === 'order' ? 'fast-food' : 'car-sport'} size={20} color={colors.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.liveTitle}>{activeTrip.kind === 'order' ? 'Commande en cours' : activeTrip.statut === 'recherche' ? 'Recherche d\'un chauffeur…' : 'Course en cours'}</Text>
              <Text style={st.liveSub} numberOfLines={1}>{activeTrip.label}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.brand} />
          </Pressable>
        )}

        {/* Hero VTC (bannière photo « Bouge la ville ») */}
        <Pressable onPress={() => router.push('/ride-voiture')} style={st.hero}>
          <ImageBackground
            source={require('../../assets/services/hero.jpg')}
            style={StyleSheet.absoluteFill}
            imageStyle={{ borderRadius: radius.xl }}
            resizeMode="cover"
          />
          <View style={st.heroOverlay} />
          <Text style={st.heroKicker}>Taga VTC</Text>
          <Text style={st.heroTitle}>Bouge la ville,{'\n'}en un geste.</Text>
          <Text style={st.heroSub}>Commande une course en quelques secondes</Text>
          <View style={st.heroBtn}>
            <Text style={st.heroBtnText}>Réserver maintenant</Text>
            <Ionicons name="arrow-forward" size={18} color={colors.white} />
          </View>
        </Pressable>

        {/* Services rapides (défilement horizontal : icônes larges + libellé sur une ligne) */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.quickRow}>
          {services.map((sv) => (
            <Pressable key={sv.key} style={st.quick} onPress={() => router.push(sv.route as any)}>
              <View style={st.quickIcon}>
                <ServiceIcon name={sv.icon} size={sv.icon === 'demenagement' ? 60 : sv.icon === 'moto' ? 56 : sv.icon === 'colis' ? 52 : 48} />
              </View>
              <Text style={st.quickLabel} numberOfLines={1}>{sv.key}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Louer un chauffeur (carte séparée, au-dessus des offres) */}
        <Pressable onPress={() => router.push('/louer')} style={st.louerCard}>
          <View style={st.louerIcon}><ServiceIcon name="car" size={34} /></View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={st.louerTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>Louer un chauffeur</Text>
              <View style={st.louerTag}><Text style={st.louerTagText}>Nouveau</Text></View>
            </View>
            <Text style={st.louerSub} numberOfLines={1}>À l'heure ou à la journée · 5 h, 10 h…</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMute} />
        </Pressable>

        {/* Offres du moment (bannières pub rotatives, réglées dans l'admin) */}
        {banners.length > 0 && (
          <>
            <View style={st.sectionHead}>
              <Text style={st.sectionTitle}>Offres du moment</Text>
            </View>
            <PromoBanners items={banners} onTap={(lien) => { if (lien && lien.startsWith('/')) router.push(lien as any); }} />
          </>
        )}

        {/* Restos populaires */}
        <View style={st.sectionHead}>
          <Text style={st.sectionTitle}>Restos populaires</Text>
          <Pressable onPress={() => router.push('/food')}>
            <Text style={st.seeAll}>Tout voir</Text>
          </Pressable>
        </View>

        {error && restaurants.length === 0 && !loading && (
          <View style={st.restoError}>
            <Ionicons name="cloud-offline-outline" size={18} color={colors.inkSoft} />
            <Text style={st.restoErrorText}>Impossible de charger les restos.</Text>
            <Pressable style={st.restoRetry} onPress={chargerRestos} hitSlop={8}>
              <Ionicons name="refresh" size={14} color={colors.white} />
              <Text style={st.restoRetryText}>Réessayer</Text>
            </Pressable>
          </View>
        )}

        {loading
          ? [0, 1, 2].map((i) => (
              <Card key={i} style={st.restoCard}>
                <Skeleton height={60} width={60} radius={radius.md} />
                <View style={{ flex: 1, gap: 8 }}>
                  <Skeleton height={16} width="60%" radius={8} />
                  <Skeleton height={13} width="40%" radius={8} />
                  <Skeleton height={22} width={120} radius={11} />
                </View>
              </Card>
            ))
          : restaurants.map((r) => (
              <Card
                key={r.id}
                style={st.restoCard}
                onPress={() => router.push({ pathname: '/resto-detail', params: { slug: r.slug } })}
              >
                <FoodImage uri={r.img ?? undefined} emoji={r.emoji ?? undefined} emojiSize={28} radius={radius.md} style={st.restoThumb} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={st.restoName} numberOfLines={1}>{r.nom}</Text>
                    <Ionicons name="star" size={13} color={colors.gold} />
                    <Text style={st.restoNote}>{r.note}</Text>
                  </View>
                  <Text style={st.restoMeta}>{r.type} · {r.eta}</Text>
                  <View style={{ marginTop: 6 }}>
                    {/* Frais de livraison : « offerte » ou libellé du marchand. Sans libellé, on n'invente
                        pas de montant (le vrai frais est calculé à l'adresse, au checkout). */}
                    <Tag
                      text={r.livraison_offerte ? 'Livraison offerte' : r.livraison ? `Livraison · ${r.livraison}` : 'Livraison selon distance'}
                      tone={r.livraison_offerte ? 'green' : 'mute'}
                    />
                  </View>
                </View>
              </Card>
            ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// Bannières pub rotatives : change toutes les 4,5 s, tap → route interne. Alimentées par l'admin.
function PromoBanners({ items, onTap }: { items: PromoBanner[]; onTap: (lien: string | null) => void }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (items.length <= 1) { setIdx(0); return; }
    const iv = setInterval(() => setIdx((i) => (i + 1) % items.length), 4500);
    return () => clearInterval(iv);
  }, [items.length]);
  if (!items.length) return null;
  const b = items[Math.min(idx, items.length - 1)];
  return (
    <View style={st.promoWrap}>
      <Pressable onPress={() => onTap(b.lien)} style={st.promoCard}>
        <FoodImage uri={b.image} style={StyleSheet.absoluteFill} />
        {(b.titre || b.sous_titre) ? (
          <View style={st.promoOverlay}>
            {b.titre ? <Text style={st.promoTitle} numberOfLines={1}>{b.titre}</Text> : null}
            {b.sous_titre ? <Text style={st.promoSub} numberOfLines={1}>{b.sous_titre}</Text> : null}
          </View>
        ) : null}
      </Pressable>
      {items.length > 1 ? (
        <View style={st.promoDots}>
          {items.map((_, i) => <View key={i} style={[st.promoDot, i === idx && st.promoDotOn]} />)}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  promoWrap: { marginHorizontal: space.lg, marginTop: 4, marginBottom: 20 },
  promoCard: { height: 132, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface2, ...shadow.card },
  promoOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: 'rgba(0,0,0,0.38)' },
  promoTitle: { color: colors.white, fontSize: 17, fontWeight: '800' },
  promoSub: { color: 'rgba(255,255,255,0.92)', fontSize: 12.5, fontWeight: '600', marginTop: 2 },
  promoDots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 9 },
  promoDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.line2 },
  promoDotOn: { width: 18, backgroundColor: colors.brand },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: 8, paddingBottom: 14, gap: 12 },
  bell: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  bellBadge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 2, borderColor: colors.bg },
  bellBadgeText: { color: colors.white, fontSize: 10.5, fontWeight: '800' },
  city: { fontSize: 13, fontWeight: '800', color: colors.ink },
  quartier: { fontSize: 12.5, color: colors.inkSoft, fontWeight: '600', marginTop: 1 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: space.lg, marginBottom: 12, backgroundColor: colors.brandTint, borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: colors.brandSoft },
  livePulse: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  liveTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  liveSub: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 1 },
  hero: { marginHorizontal: space.lg, backgroundColor: colors.ink, borderRadius: radius.xl, padding: 24, overflow: 'hidden', ...shadow.pop },
  heroOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: radius.xl, backgroundColor: 'rgba(12,10,8,0.52)' },
  heroKicker: { color: colors.brand, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  heroTitle: { color: colors.white, fontSize: 28, fontWeight: '800', marginTop: 8, lineHeight: 32 },
  heroSub: { color: 'rgba(255,255,255,0.7)', fontSize: 14, marginTop: 8, fontWeight: '500' },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.brand, alignSelf: 'flex-start', paddingHorizontal: 18, height: 46, borderRadius: radius.md, marginTop: 18 },
  heroBtnText: { color: colors.white, fontWeight: '800', fontSize: 15 },
  quickRow: { flexDirection: 'row', gap: 16, paddingHorizontal: space.lg, marginTop: 22, alignItems: 'flex-start' },
  quick: { alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  quickIcon: { width: 68, height: 68, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, ...shadow.card },
  quickLabel: { fontSize: 12.5, fontWeight: '700', color: colors.ink2, textAlign: 'center' },
  louerCard: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: space.lg, marginTop: 20, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  louerIcon: { width: 52, height: 52, borderRadius: 15, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  louerTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  louerSub: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 3 },
  louerTag: { backgroundColor: colors.green, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  louerTagText: { color: colors.white, fontSize: 10, fontWeight: '800' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, marginTop: 28, marginBottom: 12 },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: colors.ink },
  seeAll: { fontSize: 14, fontWeight: '700', color: colors.brand },
  restoCard: { marginHorizontal: space.lg, marginBottom: 12, flexDirection: 'row', gap: 14, alignItems: 'center' },
  restoThumb: { width: 60, height: 60, borderRadius: radius.md, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  restoName: { fontSize: 16, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  restoNote: { fontSize: 13, fontWeight: '700', color: colors.ink2 },
  restoMeta: { fontSize: 13, color: colors.inkSoft, fontWeight: '600', marginTop: 3 },
  restoError: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: space.lg, marginBottom: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line },
  restoErrorText: { flex: 1, fontSize: 13.5, color: colors.inkSoft, fontWeight: '600' },
  restoRetry: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.ink, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  restoRetryText: { color: colors.white, fontSize: 13, fontWeight: '800' },
});
