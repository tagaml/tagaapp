import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, radius, shadow, space } from '../../theme';
import { Header, Btn, useToast } from '../../components/ui';
import { useAuth } from '../../components/auth';
import { fcfa } from '../../data/mock';
import { playDriver, startRequestRing, stopRequestRing } from '../../lib/sound';
import { notify } from '../../lib/notify';
import {
  getMyActiveDelivery,
  getMyDeliveryOffer,
  subscribeMyDeliveryOffers,
  getDeliveryOrderById,
  acceptDeliveryOffer,
  respondDeliveryOffer,
  getOrderClientRating,
  getDeliveryDriverPct,
  gainLivraison,
  type DeliveryOffer,
  type DeliveryOrder,
} from '../../lib/db';

// Note à la française : une décimale, virgule décimale (4,8 — jamais 4.8).
function fmtNote(n: number): string {
  return n.toFixed(1).replace('.', ',');
}

export default function Livraisons() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const [offer, setOffer] = useState<DeliveryOffer | null>(null);
  const [order, setOrder] = useState<DeliveryOrder | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [accepting, setAccepting] = useState(false);
  // Note du client : MOYENNE agrégée uniquement (jamais le détail, jamais qui a noté).
  //   undefined -> pas encore chargée (on n'affiche rien) ; null -> moins de 3 notes -> « Nouveau ».
  const [noteClient, setNoteClient] = useState<number | null | undefined>(undefined);
  // Part des frais de livraison qui revient au livreur (réglée côté admin). null = pas encore lue :
  // tant qu'on ne la connaît pas, on n'affiche AUCUN montant plutôt qu'un gain approximatif.
  const [pct, setPct] = useState<number | null>(null);
  const offerRef = useRef<DeliveryOffer | null>(null);
  const clear = () => { offerRef.current = null; setOffer(null); setOrder(null); setNoteClient(undefined); };

  // Lue une seule fois à l'ouverture de l'écran : l'offre ne dure que 30 s, on ne la fait jamais attendre.
  useEffect(() => {
    let on = true;
    getDeliveryDriverPct().then((p) => { if (on) setPct(p); }).catch(() => {});
    return () => { on = false; };
  }, []);

  // Gain RÉEL du livreur sur cette livraison : part des frais de livraison + pourboire.
  // Si les frais ne sont pas connus (commande sans frais_livraison), on n'invente rien -> null.
  const gain = order && order.frais_livraison != null && pct != null
    ? gainLivraison(Number(order.frais_livraison), Number(order.pourboire ?? 0), pct)
    : null;

  const goActive = (o: DeliveryOrder) =>
    router.replace({ pathname: '/driver/delivery', params: { orderId: o.id, resto: o.restaurant_nom ?? 'Restaurant', adresse: o.adresse ?? '', client: o.client_nom ?? 'Client', clientPhoto: o.client_photo ?? '', total: String(o.total ?? 0) } });

  const showOffer = useCallback(async (off: DeliveryOffer) => {
    try {
      const ord = await getDeliveryOrderById(off.order_id);
      if (!ord || ord.driver_id) return;
      offerRef.current = off;
      setOffer(off); setOrder(ord); setNoteClient(undefined);
      setCountdown(Math.max(3, Math.round((new Date(off.expires_at).getTime() - Date.now()) / 1000)));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      startRequestRing(18000);
      notify('Nouvelle livraison', `${ord.restaurant_nom ?? 'Restaurant'} → client`);

      // Note du client : chargée APRÈS coup, sans jamais bloquer ni retarder l'offre (30 s à peine).
      // Si la RPC échoue ou tarde, la carte reste affichée simplement sans note — jamais de note inventée.
      getOrderClientRating(off.order_id)
        .then((r) => { if (offerRef.current?.id === off.id) setNoteClient(r.moyenne); })
        .catch(() => { /* offre affichée sans note */ });
    } catch { /* ignore */ }
  }, []);

  useFocusEffect(useCallback(() => {
    let on = true;
    (async () => {
      try {
        const active = await getMyActiveDelivery();
        if (on && active) { goActive(active); return; }
        if (!user?.id) return;
        const off = await getMyDeliveryOffer(user.id);
        if (on && off) showOffer(off);
      } catch { /* ignore */ }
    })();
    const unsub = user?.id ? subscribeMyDeliveryOffers(user.id, (o) => { if (!offerRef.current) showOffer(o); }) : () => {};
    return () => { on = false; unsub(); stopRequestRing(); };
  }, [user?.id, showOffer]));

  // Compte à rebours ; à l'expiration on relâche l'offre (réassignation au suivant).
  useEffect(() => {
    if (!offer) return;
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(id);
          stopRequestRing();
          respondDeliveryOffer(offer.id, 'expire').catch(() => {});
          clear();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [offer]);

  const refuser = () => {
    if (!offer) return;
    stopRequestRing();
    respondDeliveryOffer(offer.id, 'decline').catch(() => {}); // réassignation au suivant
    clear();
  };

  const accepter = async () => {
    if (!offer || !order) return;
    stopRequestRing();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    playDriver('accept');
    setAccepting(true);
    try {
      const res = await acceptDeliveryOffer(offer.id);
      if (!res.ok) { toast(res.reason === 'expired' ? 'Offre expirée' : 'Livraison déjà prise', { tone: 'error' }); clear(); return; }
      offerRef.current = null;
      goActive(order);
    } catch {
      toast('Connexion instable — réessaie.', { tone: 'error' });
    } finally { setAccepting(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Livraisons" />
      {offer && order ? (
        <View style={{ flex: 1, paddingHorizontal: space.lg, paddingTop: 16 }}>
          <View style={st.card}>
            <View style={st.head}>
              <View style={st.icon}><Ionicons name="restaurant" size={22} color={colors.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.resto} numberOfLines={1}>{order.restaurant_nom || 'Restaurant'}</Text>
                <Text style={st.ref}>Commande #{order.id.slice(0, 4).toUpperCase()}</Text>
              </View>
            </View>

            <View style={st.line}>
              <View style={[st.dot, { backgroundColor: colors.green }]} />
              <Text style={st.lineText} numberOfLines={1}><Text style={st.lineLabel}>Récupération · </Text>{order.restaurant_nom || 'Restaurant'}</Text>
            </View>
            <View style={st.line}>
              <View style={[st.dot, { backgroundColor: colors.brand }]} />
              <Text style={st.lineText} numberOfLines={2}><Text style={st.lineLabel}>Livraison · </Text>{order.adresse || 'Adresse client'}</Text>
            </View>

            {/* Client + sa note (moyenne agrégée, tous services confondus). Le livreur sait à qui
                il a affaire AVANT d'accepter, exactement comme sur une offre de course. */}
            <View style={st.clientRow}>
              <Ionicons name="person-circle-outline" size={20} color={colors.inkSoft} />
              <Text style={st.clientName} numberOfLines={1}>{order.client_nom || 'Client'}</Text>
              {noteClient != null ? (
                <View style={st.noteBadge}>
                  <Ionicons name="star" size={12} color={colors.gold} />
                  <Text style={st.noteTxt}>{fmtNote(noteClient)}</Text>
                </View>
              ) : noteClient === null ? (
                // Moins de 3 notes : badge neutre. Un client sans historique ne doit pas paraître mauvais.
                <View style={st.newBadge}><Text style={st.newTxt}>Nouveau</Text></View>
              ) : null}
            </View>

            {/* GAIN du livreur : l'information PRINCIPALE, c'est là-dessus qu'il décide d'accepter.
                Lisible d'un coup d'oeil, comme le prix sur une offre de course. Si les frais de
                livraison sont inconnus, on affiche « — » : jamais un montant inventé. */}
            <View style={st.gainBox}>
              <Text style={st.gainLabel}>Tu gagnes</Text>
              <Text style={st.gainValue} numberOfLines={1} adjustsFontSizeToFit>{gain != null ? fcfa(gain) : '—'}</Text>
            </View>

            {/* Montant de la COMMANDE (panier du client) : sert à l'encaissement, jamais présenté
                comme un gain. Information secondaire. */}
            <View style={st.totalRow}>
              <Text style={st.totalLabel}>Commande du client</Text>
              <Text style={st.totalValue}>{fcfa(order.total || 0)}</Text>
            </View>

            <View style={st.timer}>
              <Ionicons name="time-outline" size={16} color={colors.brandDeep} />
              <Text style={st.timerText}>Accepte avant {countdown}s</Text>
            </View>

            {/* Accepter DOMINANT en pleine largeur, Refuser en second (même schéma que la carte
                d'offre de course sur l'accueil : une seule action évidente au premier coup d'œil). */}
            <View style={st.btns}>
              <Btn label="Accepter" loading={accepting} onPress={accepter} />
              <Pressable onPress={refuser} hitSlop={8} style={st.refuse}>
                <Text style={st.refuseTxt}>Refuser</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        <View style={st.emptyBox}>
          <Ionicons name="cube-outline" size={42} color={colors.inkMute} />
          <Text style={st.emptyTitle}>En attente de livraisons</Text>
          <Text style={st.empty}>Reste en ligne : dès qu'une commande est prête près de toi, elle te sera proposée ici.</Text>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: 18, borderWidth: 1, borderColor: colors.line, ...shadow.pop },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  resto: { fontSize: 17, fontWeight: '800', color: colors.ink },
  ref: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  lineText: { flex: 1, fontSize: 13.5, fontWeight: '700', color: colors.ink2 },
  lineLabel: { color: colors.inkSoft },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  clientName: { flexShrink: 1, fontSize: 14.5, fontWeight: '800', color: colors.ink },
  noteBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  noteTxt: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  newBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line },
  newTxt: { fontSize: 11, fontWeight: '800', color: colors.inkSoft },
  // Gain : traitement le plus fort de la carte (même poids que le prix d'une offre de course).
  gainBox: { alignItems: 'center', marginTop: 16, backgroundColor: colors.brandTint, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 14 },
  gainLabel: { fontSize: 13, fontWeight: '800', color: colors.brandDeep, textTransform: 'uppercase', letterSpacing: 0.4 },
  gainValue: { fontSize: 30, fontWeight: '800', color: colors.brand, marginTop: 2 },
  // Total client : information secondaire (encaissement), volontairement plus discrète que le gain.
  // Ligne « libellé + montant » : le libellé CÈDE (flex 1, il se replie), le montant JAMAIS
  // (flexShrink 0). Sans ça, les deux textes prenaient leur largeur naturelle et le montant
  // sortait de la carte quand le libellé était long (ex. « Encaissé en espèces (déjà en main) »).
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingHorizontal: 2, gap: 10 },
  totalLabel: { flex: 1, flexShrink: 1, fontSize: 12.5, fontWeight: '700', color: colors.inkSoft },
  totalValue: { flexShrink: 0, textAlign: 'right', fontSize: 13.5, fontWeight: '800', color: colors.ink2 },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: 16, backgroundColor: colors.brandSoft, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  timerText: { fontSize: 13.5, fontWeight: '800', color: colors.brandDeep },
  btns: { gap: 12, marginTop: 16 },
  refuse: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', minHeight: 50, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.line2, backgroundColor: colors.surface },
  refuseTxt: { fontSize: 15, fontWeight: '800', color: colors.ink2 },
  emptyBox: { alignItems: 'center', gap: 8, marginTop: 80, paddingHorizontal: 36 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: colors.ink, marginTop: 6 },
  empty: { textAlign: 'center', color: colors.inkSoft, fontWeight: '600', fontSize: 13.5, lineHeight: 19 },
});
