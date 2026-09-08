import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Linking, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../theme';
import { Header, Btn, Avatar } from '../components/ui';
import { TripMap, BAMAKO } from '../components/TripMap';
import { routeBetween, moveHeading, type GeoRoute } from '../lib/geo';
import { subscribeOrderLive, setOrderStatut, getOrderLive, getOrder, getOrderRoute, submitFoodReview, subscribeOrderMessages, getOrderUnreadCount, markOrderRead, getTagaPayNumber } from '../lib/db';
import { notify } from '../lib/notify';
import { shareTrip } from '../lib/share';
import { fcfa } from '../data/mock';
import { CopyNumber } from '../components/CopyNumber';

const RESTO = BAMAKO.medine;   // zone restaurant (repli)
const CLIENT = BAMAKO.aci2000; // zone client (repli)

const ORDRE = ['confirmee', 'preparation', 'prete', 'livraison', 'livree'] as const;

const META = (resto: string) => [
  { titre: 'Commande confirmée', desc: 'Le restaurant a reçu ta commande' },
  { titre: 'En préparation', desc: `${resto} prépare tes plats` },
  { titre: 'Prête', desc: 'Prête · un livreur arrive la récupérer' },
  { titre: 'En livraison', desc: 'Ton livreur est en route vers toi' },
  { titre: 'Livré', desc: 'Bon appétit !' },
];

// Libellés canoniques Taga (alignés client / chauffeur / marchand / admin).
const BANNIERE: Record<string, string> = {
  attente_paiement: 'En attente de confirmation du paiement',
  confirmee: 'Confirmée',
  preparation: 'En préparation',
  prete: 'Prête',
  livraison: 'En livraison',
  livree: 'Livrée',
  annulee: 'Annulée',
};

export default function FoodTrack() {
  const router = useRouter();
  const { orderId, restoNom, eta } = useLocalSearchParams<{ orderId?: string; restoNom?: string; eta?: string }>();
  const [statut, setStatut] = useState<string>('');
  const [loaded, setLoaded] = useState(false); // premier chargement effectué (succès ou échec)
  const [loadError, setLoadError] = useState(false); // le premier chargement a échoué
  const [reload, setReload] = useState(0); // relance manuelle (Réessayer)
  // Position live du livreur (GPS réel) + nom/téléphone réels.
  const [coursierPos, setCoursierPos] = useState<{ latitude: number; longitude: number } | null>(null);
  const [livreurNom, setLivreurNom] = useState<string | null>(null);
  const [livreurPhoto, setLivreurPhoto] = useState<string | null>(null);
  const [livreurTel, setLivreurTel] = useState<string | null>(null);
  const [raison, setRaison] = useState<string | null>(null); // raison d'annulation système
  const [code, setCode] = useState<string | null>(null); // code de remise à donner au livreur
  const [restoPt, setRestoPt] = useState(RESTO);   // vraie position du restaurant
  const [clientPt, setClientPt] = useState(CLIENT); // vraie position du client
  const [foodRoute, setFoodRoute] = useState<GeoRoute | null>(null); // vraie route (restaurant → client)
  // Position simulée (repli tant qu'on n'a pas de GPS réel), façon approche progressive.
  const [simPos, setSimPos] = useState(RESTO);
  const [stars, setStars] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [unread, setUnread] = useState(0);
  const [tagaNum, setTagaNum] = useState('');
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState('');

  const noter = async (n: number) => {
    setStars(n);
    try { if (orderId) { await submitFoodReview(orderId, n); setReviewed(true); } } catch { /* ignore */ }
  };

  const partager = () => {
    const m = etaLabel ? etaLabel.match(/\d+/) : null;
    shareTrip({
      kind: 'livraison',
      chauffeur: livreurNom,
      etaMin: m ? Number(m[0]) : null,
      lat: coursierPos?.latitude ?? null,
      lng: coursierPos?.longitude ?? null,
    });
  };

  const restoLabel = restoNom && restoNom.length ? restoNom : 'Ton restaurant';
  // Délai estimé : uniquement celui du restaurant. Si on rouvre le suivi sans ce paramètre,
  // on n'affiche PAS de durée inventée (sinon le suivi contredirait la fiche du resto).
  const etaLabel = eta && eta.length ? eta : null;
  const refLabel = orderId ? `#TG-${orderId.slice(0, 4).toUpperCase()}` : '#TG-4821';
  const terminal = statut === 'livree' || statut === 'annulee';

  useEffect(() => {
    if (!orderId) {
      // Sans orderId : aucune commande réelle à suivre → état neutre (pas de fausse commande).
      setLoaded(true);
      setLoadError(true);
      return;
    }
    const apply = (live: { statut: string; livreurNom: string | null; livreurTel: string | null; livreurPhoto?: string | null; driverLat: number | null; driverLng: number | null; annulRaison?: string | null }) => {
      setLivreurNom(live.livreurNom);   // se vide si le coursier est relâché (reclaim)
      setLivreurPhoto(live.livreurPhoto ?? null);
      setLivreurTel(live.livreurTel);
      setRaison(live.annulRaison ?? null);
      if (live.driverLat != null && live.driverLng != null) {
        setCoursierPos({ latitude: live.driverLat, longitude: live.driverLng });
      } else {
        setCoursierPos(null);
      }
    };
    getOrderLive(orderId)
      .then((l) => { if (l) { setStatut(l.statut); apply(l); setLoaded(true); } else { setLoaded(true); setLoadError(true); } })
      .catch(() => { setLoaded(true); setLoadError(true); });
    getOrder(orderId).then((o) => {
      if (o?.delivery_code) setCode(o.delivery_code);
      if (o) { setPayAmount(Number((o as any).total ?? 0)); setPayMethod(String((o as any).paiement ?? '')); }
    }).catch(() => {});
    getTagaPayNumber().then(setTagaNum).catch(() => {});
    getOrderRoute(orderId).then((r) => { if (r.resto) setRestoPt(r.resto); if (r.client) setClientPt(r.client); }).catch(() => {});
    const off = subscribeOrderLive(orderId, (live) => {
      setStatut((prev) => {
        if (prev !== live.statut) {
          // Notification locale immédiate (app ouverte). La notification PERSISTANTE de chaque
          // transition est écrite côté serveur (trigger trg_order_status_notif) → pas de doublon ici.
          if (live.statut === 'preparation') notify('🍽️ Commande acceptée', 'Le restaurant prépare tes plats.');
          else if (live.statut === 'prete') notify('🎯 Commande prête', 'On cherche un coursier.');
          else if (live.statut === 'livraison') notify('🛵 En livraison', 'Ton coursier a récupéré ta commande.');
          else if (live.statut === 'livree') notify('✅ Livrée', 'Bon appétit avec Taga !');
        }
        return live.statut;
      });
      apply(live);
    });
    return () => { off(); };
  }, [orderId, reload]);

  // Messages entrants du livreur : notif + pastille « non lu ».
  useEffect(() => {
    if (!orderId) return;
    getOrderUnreadCount(orderId, 'driver').then(setUnread).catch(() => {}); // non-lus persistants
    const off = subscribeOrderMessages(orderId, (m) => {
      if (m.sender_role === 'driver') {
        notify('Message de ton livreur', m.texte);
        setUnread((n) => n + 1);
      }
    });
    return () => off();
  }, [orderId]);

  // Tant que le livreur n'a pas de GPS réel et qu'il est « en livraison », on l'anime
  // depuis le restaurant vers le client (pour que la carte soit vivante en démo).
  useEffect(() => {
    if (coursierPos || statut !== 'livraison') return;
    let t = 0;
    const id = setInterval(() => {
      t = Math.min(1, t + 0.04);
      setSimPos({
        latitude: restoPt.latitude + (clientPt.latitude - restoPt.latitude) * t,
        longitude: restoPt.longitude + (clientPt.longitude - restoPt.longitude) * t,
      });
      if (t >= 1) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [statut, coursierPos, restoPt.latitude, clientPt.latitude]);

  // Vraie route routière restaurant → client (identique aux courses : trait plein sur les rues).
  useEffect(() => {
    let on = true;
    routeBetween(restoPt, clientPt).then((r) => { if (on) setFoodRoute(r); }).catch(() => {});
    return () => { on = false; };
  }, [restoPt.latitude, restoPt.longitude, clientPt.latitude, clientPt.longitude]);

  // Position affichée du livreur : GPS réel si dispo, sinon simulation.
  const livreurPos = coursierPos ?? (statut === 'livraison' ? simPos : restoPt);

  // ---- Cap de la moto sur la carte (orientation façon Uber) ----
  // `orders` ne transporte que la position du livreur (driver_lat/driver_lng), pas son cap : on le
  // dérive du mouvement réel (relèvement entre deux positions successives). À l'arrêt (< 5 m, donc
  // aucun déplacement mesurable), on CONSERVE le dernier cap connu au lieu de pointer plein nord.
  const [livreurCap, setLivreurCap] = useState<number | undefined>(undefined);
  const posPrec = useRef<{ latitude: number; longitude: number } | null>(null);
  useEffect(() => {
    const cap = moveHeading(posPrec.current, livreurPos);
    if (cap != null) setLivreurCap(cap);
    posPrec.current = livreurPos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livreurPos.latitude, livreurPos.longitude]);

  const livreurLabel = livreurNom || 'Ton livreur';
  const livreurIni = livreurNom ? livreurNom.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() : 'ID';

  const rang = Math.max(0, ORDRE.indexOf(statut as (typeof ORDRE)[number]));
  const etapes = META(restoLabel).map((e, i) => ({
    ...e,
    done: i < rang,
    active: i === rang,
  }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Suivi de commande" />
      {!loaded ? (
        <View style={st.center}>
          <ActivityIndicator color={colors.brand} size="large" />
          <Text style={st.centerText}>Chargement…</Text>
        </View>
      ) : loadError ? (
        <View style={st.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.inkSoft} />
          <Text style={st.centerText}>Impossible de charger le suivi</Text>
          <Btn label="Réessayer" onPress={() => { setLoadError(false); setLoaded(false); setReload((r) => r + 1); }} style={{ marginTop: 14, paddingHorizontal: 26 }} />
        </View>
      ) : (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}>
      <View style={{ paddingHorizontal: space.lg }}>
        <View style={st.banner}>
          <View style={{ flex: 1 }}>
            <Text style={st.bannerTitle}>{
              statut === 'annulee' ? (raison ? `Annulée · ${raison}` : 'Annulée')
              : statut === 'prete' ? (livreurNom ? 'Prête · coursier en route' : "Prête · recherche d'un coursier")
              : (BANNIERE[statut] ?? 'En préparation')
            }</Text>
            <Text style={st.bannerSub}>{restoLabel} · Commande {refLabel}</Text>
          </View>
          {statut !== 'attente_paiement' && etaLabel ? (
            <View style={st.etaPill}>
              <Text style={st.etaNum}>{etaLabel}</Text>
              <Text style={st.etaLabel}>Estimé</Text>
            </View>
          ) : null}
        </View>

        {statut === 'attente_paiement' ? (
          <View style={st.payCard}>
            <View style={st.payIcon}><Ionicons name="phone-portrait" size={22} color={colors.brand} /></View>
            <Text style={st.payTitle}>Règle ta commande au numéro Taga{payMethod ? ` (${payMethod})` : ''}</Text>
            <Text style={st.payAmount}>{fcfa(payAmount)}</Text>
            {tagaNum ? (
              <CopyNumber number={tagaNum} />
            ) : (
              <Text style={st.paySub}>Le numéro de paiement te sera communiqué par Taga.</Text>
            )}
            <Text style={st.paySub}>Dès que Taga confirme la réception du paiement, ta commande est transmise au restaurant. Tu recevras une notification.</Text>
          </View>
        ) : null}

        {/* Le coursier n'apparaît sur la carte QU'À PARTIR de la prise en charge (livraison).
            Avant (confirmée / préparation / prête), on ne montre que le restaurant et le client. */}
        <TripMap
          origin={restoPt}
          destination={clientPt}
          driver={(statut === 'livraison' || statut === 'livree') ? livreurPos : undefined}
          driverHeading={livreurCap}
          routeCoords={(statut === 'livraison' || statut === 'livree') ? foodRoute?.coords : undefined}
          height={150}
          vehicle="moto"
          fitRoute
        />

        {code && !terminal ? (
          <View style={st.codeCard}>
            <View style={st.codeIcon}><Ionicons name="keypad" size={20} color={colors.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={st.codeLabel}>Code de remise</Text>
              <Text style={st.codeSub}>Donne-le au livreur pour confirmer la réception</Text>
            </View>
            <Text style={st.codeValue}>{code}</Text>
          </View>
        ) : null}
      </View>

      {/* Étapes — masquées tant que le paiement n'est pas confirmé, et pour une commande annulée
          (afficher une étape « active » sur une commande annulée serait trompeur). */}
      {statut !== 'attente_paiement' && statut !== 'annulee' ? (
      <View style={st.steps}>
        {etapes.map((e, i) => (
          <View key={i} style={st.step}>
            <View style={st.stepCol}>
              <View style={[st.dot, e.done && st.dotDone, e.active && st.dotActive]}>
                {e.done && <Ionicons name="checkmark" size={13} color={colors.white} />}
              </View>
              {i < etapes.length - 1 && <View style={[st.lineV, e.done && st.lineDone]} />}
            </View>
            <View style={{ flex: 1, paddingBottom: 22 }}>
              <Text style={[st.stepTitle, !e.done && !e.active && { color: colors.inkMute }]}>{e.titre}</Text>
              <Text style={st.stepDesc}>{e.desc}</Text>
            </View>
          </View>
        ))}
      </View>
      ) : null}

      {/* Livreur */}
      {statut === 'livraison' || statut === 'livree' ? (
        <View style={st.driver}>
          <Avatar text={livreurIni} size={48} tone="ink" uri={livreurPhoto ?? undefined} />
          <View style={{ flex: 1 }}>
            <Text style={st.driverName}>{livreurLabel}</Text>
            <Text style={st.driverRole}>{coursierPos ? 'En route vers toi · Taga' : 'Ton livreur · Taga'}</Text>
          </View>
          {livreurTel ? (
            <Pressable
              style={st.iconBtn}
              onPress={() =>
                Linking.openURL(`tel:${livreurTel}`).catch(() =>
                  Alert.alert('Appel impossible', 'Impossible de lancer l\'appel sur cet appareil.')
                )
              }
            >
              <Ionicons name="call" size={18} color={colors.brand} />
            </Pressable>
          ) : null}
          <Pressable style={st.iconBtn} onPress={() => { if (orderId) markOrderRead(orderId).catch(() => {}); setUnread(0); router.push({ pathname: '/chat', params: { orderId: orderId ?? '', name: livreurLabel, tel: livreurTel ?? '' } }); }}>
            <Ionicons name="chatbubble" size={18} color={colors.brand} />
            {unread > 0 ? (
              <View style={st.chatBadge}><Text style={st.chatBadgeTxt}>{unread > 9 ? '9+' : unread}</Text></View>
            ) : null}
          </Pressable>
        </View>
      ) : null}

      {statut === 'livree' && (
        <View style={st.rateBox}>
          {reviewed ? (
            <Text style={st.rateThanks}>Merci pour ton avis ! 🙏</Text>
          ) : (
            <>
              <Text style={st.rateTitle}>Note ce restaurant</Text>
              <View style={st.stars}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} onPress={() => noter(n)} hitSlop={6}>
                    <Ionicons name={n <= stars ? 'star' : 'star-outline'} size={34} color={colors.gold} />
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </View>
      )}

      {statut === 'livraison' && (
        <View style={{ paddingHorizontal: space.lg, marginTop: 16 }}>
          <Pressable style={st.shareBtn} onPress={partager}>
            <Ionicons name="share-social" size={18} color={colors.brand} />
            <Text style={st.shareTxt}>Partager ma livraison</Text>
          </Pressable>
        </View>
      )}

      <View style={{ paddingHorizontal: space.lg, marginTop: 16 }}>
        {statut === 'annulee' ? (
          <Btn label="Réessayer" onPress={() => router.replace('/food')} />
        ) : terminal ? (
          <Btn label="Terminé" onPress={() => router.replace('/food')} />
        ) : !(statut === 'attente_paiement' || statut === 'confirmee' || statut === 'preparation') ? (
          // Une fois prête / en livraison, l'annulation n'est plus possible (commande déjà chez le coursier).
          <Btn label="Retour" variant="ghost" onPress={() => router.back()} />
        ) : (
          <Btn
            label="Annuler la commande"
            variant="ghost"
            onPress={() =>
              Alert.alert('Annuler la commande', 'Veux-tu vraiment annuler cette commande ?', [
                { text: 'Non', style: 'cancel' },
                {
                  text: 'Oui, annuler',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      if (orderId) await setOrderStatut(orderId, 'annulee');
                      router.back();
                    } catch {
                      // Ne pas mentir : si l'annulation échoue, on prévient au lieu de revenir en arrière.
                      Alert.alert('Annulation impossible', "La commande n'a pas pu être annulée. Réessaie ou contacte le support.");
                    }
                  },
                },
              ])
            }
          />
        )}
      </View>
      </ScrollView>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  centerText: { fontSize: 15, fontWeight: '700', color: colors.inkSoft, textAlign: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.ink, borderRadius: radius.lg, padding: 16, marginBottom: 14, ...shadow.pop },
  bannerTitle: { color: colors.white, fontSize: 18, fontWeight: '800' },
  bannerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600', marginTop: 3 },
  etaPill: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 8 },
  etaNum: { color: colors.white, fontSize: 16, fontWeight: '800' },
  etaLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 10, fontWeight: '700' },
  payCard: { backgroundColor: colors.brandTint, borderRadius: radius.lg, padding: 16, marginTop: 12, borderWidth: 1, borderColor: colors.brandSoft, alignItems: 'center', ...shadow.card },
  payIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  payTitle: { fontSize: 15.5, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  payAmount: { fontSize: 26, fontWeight: '900', color: colors.brand, marginTop: 4 },
  payNumRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 10, marginTop: 10, borderWidth: 1, borderColor: colors.brandSoft },
  payNum: { fontSize: 18, fontWeight: '800', color: colors.ink, letterSpacing: 0.5 },
  paySub: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, textAlign: 'center', marginTop: 8, lineHeight: 18 },
  codeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.brandTint, borderRadius: radius.lg, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.brandSoft, ...shadow.card },
  codeIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  codeLabel: { fontSize: 14.5, fontWeight: '800', color: colors.brandDeep },
  codeSub: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  codeValue: { fontSize: 28, fontWeight: '800', color: colors.brandDeep, letterSpacing: 6 },
  steps: { marginHorizontal: space.lg, marginTop: 20, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16, paddingTop: 18, ...shadow.card },
  step: { flexDirection: 'row', gap: 14 },
  stepCol: { alignItems: 'center', width: 26 },
  dot: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: colors.green, borderColor: colors.green },
  dotActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  lineV: { width: 2, flex: 1, backgroundColor: colors.line2, marginVertical: 2 },
  lineDone: { backgroundColor: colors.green },
  stepTitle: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  stepDesc: { fontSize: 13, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  driver: { flexDirection: 'row', alignItems: 'center', gap: 13, marginHorizontal: space.lg, marginTop: 6, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  rateBox: { marginHorizontal: space.lg, marginTop: 16, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line, alignItems: 'center', ...shadow.card },
  rateTitle: { fontSize: 15, fontWeight: '800', color: colors.ink, marginBottom: 10 },
  stars: { flexDirection: 'row', gap: 10 },
  rateThanks: { fontSize: 15, fontWeight: '800', color: colors.green },
  driverName: { fontSize: 16, fontWeight: '800', color: colors.ink },
  driverRole: { fontSize: 13, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  chatBadge: { position: 'absolute', top: 4, right: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  chatBadgeTxt: { color: colors.white, fontSize: 10.5, fontWeight: '800' },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.brandTint, borderRadius: radius.md, paddingVertical: 13 },
  shareTxt: { color: colors.brand, fontSize: 15, fontWeight: '800' },
});
