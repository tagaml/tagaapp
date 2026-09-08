import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Modal } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { colors, radius, shadow, space } from '../../theme';
import { Btn, Avatar, useToast } from '../../components/ui';
import { TripMap, BAMAKO, distanceKm } from '../../components/TripMap';
import { updateOrderPosition, setOrderStatut, deliverOrderWithCode, getOrderRoute, getGeoRadii, subscribeOrderMessages, subscribeOrder, getOrderUnreadCount, markOrderRead, setOrderClientRating, getDeliveryOrderById, getDeliveryDriverPct, gainLivraison } from '../../lib/db';
import { fcfa } from '../../data/mock';
import { playDriver } from '../../lib/sound';
import { notify } from '../../lib/notify';
import { openNavigation } from '../../lib/navigation';
import { moveHeading } from '../../lib/geo';
import { CodeConfirm } from '../../components/CodeConfirm';

const RESTO = BAMAKO.medine;
const CLIENT = BAMAKO.aci2000;

// Cap GPS exploitable ? expo-location renvoie -1 (ou null) quand le cap est indisponible.
function capGps(h?: number | null): number | null {
  return typeof h === 'number' && Number.isFinite(h) && h >= 0 && h <= 360 ? h : null;
}

export default function DriverDelivery() {
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { orderId, resto, adresse, client, clientPhoto, total } = useLocalSearchParams<{
    orderId?: string; resto?: string; adresse?: string; client?: string; clientPhoto?: string; total?: string;
  }>();
  const clientIni = (client || 'Client').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const [pos, setPos] = useState(RESTO);
  const [cap, setCap] = useState<number | undefined>(undefined); // cap réel de la moto (0 = nord)
  const [restoPt, setRestoPt] = useState(RESTO);
  const [clientPt, setClientPt] = useState(CLIENT);
  const [locFixed, setLocFixed] = useState(false); // vraie position GPS
  const [restoLoaded, setRestoLoaded] = useState(false); // vraies coords resto connues
  const [clientLoaded, setClientLoaded] = useState(false); // vraies coords client connues
  const [radii, setRadii] = useState({ arriveeM: 150, depotM: 180 }); // rayons réglés côté admin
  useEffect(() => { getGeoRadii().then(setRadii).catch(() => {}); }, []);
  useEffect(() => {
    if (!orderId) return;
    getOrderRoute(orderId).then((r) => {
      if (r.resto) { setRestoPt(r.resto); setRestoLoaded(true); }
      if (r.client) { setClientPt(r.client); setClientLoaded(true); }
    }).catch(() => {});
  }, [orderId]);
  const [phase, setPhase] = useState<'collecte' | 'route'>('collecte'); // collecte = va au resto, route = vers client
  const [done, setDone] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false); // étape « note ton client », après la livraison confirmée
  const [note, setNote] = useState(0);
  const [saving, setSaving] = useState(false);
  const [unread, setUnread] = useState(0); // messages client non lus (persistant via order_reads)

  // Ce que le livreur va TOUCHER sur cette livraison : part des frais de livraison (réglée côté
  // admin) + pourboire du client. null tant que ce n'est pas connu -> on n'affiche aucun montant,
  // jamais un chiffre inventé. Chargé à part : n'empêche jamais la livraison d'avancer.
  const [gain, setGain] = useState<number | null>(null);
  useEffect(() => {
    if (!orderId) return;
    let mounted = true;
    Promise.all([getDeliveryOrderById(orderId), getDeliveryDriverPct()])
      .then(([o, pct]) => {
        if (!mounted || !o || o.frais_livraison == null) return;
        setGain(gainLivraison(Number(o.frais_livraison), Number(o.pourboire ?? 0), pct));
      })
      .catch(() => { /* livraison affichée sans montant */ });
    return () => { mounted = false; };
  }, [orderId]);

  // Compte les messages client non lus au montage (persistant entre sessions).
  useEffect(() => {
    if (!orderId) return;
    getOrderUnreadCount(orderId).then(setUnread).catch(() => {});
  }, [orderId]);

  // Diffuse la position GPS réelle sur la commande (le client suit en direct).
  useEffect(() => {
    if (!orderId) return;
    let sub: Location.LocationSubscription | null = null;
    let active = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || !active) return;
        const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const p = { latitude: first.coords.latitude, longitude: first.coords.longitude };
        setPos(p); setLocFixed(true);
        const cap0 = capGps(first.coords.heading);
        if (cap0 != null) setCap(cap0);
        updateOrderPosition(orderId, p.latitude, p.longitude).catch(() => {});
        let prev = p; // point précédent → repli de cap quand le GPS n'en fournit pas
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 8000, distanceInterval: 40 },
          (loc) => {
            const np = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
            // Cap réel : GPS si dispo, sinon relèvement du déplacement. À l'arrêt (< 5 m), on garde
            // le dernier cap connu — la moto ne bascule jamais plein nord sur la carte.
            // Direction de TRAJET : relèvement point-à-point d'abord (fiable), GPS heading en repli
            // (coords.heading peut renvoyer l'orientation du téléphone, pas la trajectoire).
            const cap = moveHeading(prev, np) ?? capGps(loc.coords.heading);
            if (cap != null) setCap(cap);
            prev = np;
            setPos(np); setLocFixed(true);
            updateOrderPosition(orderId, np.latitude, np.longitude).catch(() => {});
          },
        );
      } catch { /* ignore */ }
    })();
    return () => { active = false; sub?.remove(); };
  }, [orderId]);

  // Notifie le livreur quand le client envoie un message pendant la livraison.
  useEffect(() => {
    if (!orderId) return;
    const off = subscribeOrderMessages(orderId, (m) => {
      if (m.sender_role === 'client') { playDriver('accept'); notify('Message du client', m.texte); setUnread((n) => n + 1); }
    });
    return () => off();
  }, [orderId]);

  // Annulation par le client : le livreur est prévenu immédiatement et renvoyé à l'accueil.
  const annulRef = useRef(false);
  useEffect(() => {
    if (!orderId) return;
    const off = subscribeOrder(orderId, (statut) => {
      if (statut === 'annulee' && !annulRef.current) {
        annulRef.current = true;
        playDriver('request');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        notify('Commande annulée', `${client || 'Le client'} a annulé la commande.`);
        Alert.alert('Commande annulée', `${client || 'Le client'} a annulé la commande.`, [
          { text: 'OK', onPress: () => router.replace('/driver') },
        ]);
      }
    });
    return () => off();
  }, [orderId, client]);

  const livrer = () => setCodeOpen(true);

  // Verrou de proximité : « récupéré » seulement au resto, « livré » seulement chez le client.
  // On ne bloque que si on a une vraie position GPS ET les vraies coordonnées de la cible.
  const PICKUP_M = radii.arriveeM, DROP_M = radii.depotM;
  const distRestoM = Math.round(distanceKm(pos, restoPt) * 1000);
  const distClientM = Math.round(distanceKm(pos, clientPt) * 1000);
  const atResto = !(locFixed && restoLoaded) || distRestoM <= PICKUP_M;
  const atClient = !(locFixed && clientLoaded) || distClientM <= DROP_M;

  // Confirmation par code de remise (le client donne son code à 4 chiffres).
  const confirmerCode = async (code: string): Promise<boolean> => {
    if (!orderId) return false;
    const ok = await deliverOrderWithCode(orderId, code);
    if (ok) {
      setCodeOpen(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      playDriver('accept');
      setDone(true);
      // La livraison est confirmée côté serveur : on demande sa note au livreur (exactement comme
      // en fin de course). Sans commande réelle (cas impossible en prod), on rentre directement.
      if (orderId) setNoteOpen(true);
      else setTimeout(() => router.replace('/driver'), 900);
    }
    return ok;
  };

  // Note du client (facultative). Même vocabulaire que la fin de course (trip-summary) :
  // 5 étoiles, une seule fois, jamais de note par défaut — 0 étoile = pas de note envoyée.
  const rentrer = () => router.replace('/driver');
  const envoyerNote = async () => {
    if (!orderId || note < 1 || saving) return;
    setSaving(true);
    try {
      await setOrderClientRating(orderId, note);
    } catch {
      // Échec d'enregistrement : on le dit, mais on ne bloque pas le livreur (il enchaîne).
      toast('Note non enregistrée — connexion instable.', { tone: 'error' });
    } finally {
      setSaving(false);
      rentrer();
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface2 }}>
      <TripMap fill rounded={false} origin={restoPt} destination={clientPt} driver={pos} driverHeading={cap} vehicle="moto" showsUser followDriver />

      <SafeAreaView edges={['top']} style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
        <Pressable onPress={() => router.replace('/driver')} style={st.close}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
      </SafeAreaView>

      <View style={[st.sheet, { paddingBottom: Math.max(insets.bottom + 14, 20) }]}>
        <View style={st.handle} />
        <Text style={st.title}>{done ? 'Livraison terminée' : phase === 'collecte' ? 'Va chercher la commande' : 'En route vers le client'}</Text>
        <Text style={st.sub}>{resto || 'Restaurant'}</Text>

        <View style={st.row}>
          <View style={[st.dot, { backgroundColor: colors.green }]} />
          <Text style={st.rowText} numberOfLines={1}><Text style={st.rowLabel}>Récupération · </Text>{resto || 'Restaurant'}</Text>
        </View>
        <View style={st.row}>
          <View style={[st.dot, { backgroundColor: colors.brand }]} />
          <Text style={st.rowText} numberOfLines={2}><Text style={st.rowLabel}>Livraison · </Text>{adresse || 'Adresse client'}</Text>
        </View>

        {/* Ce que le livreur touche sur cette livraison : visible pendant toute la course.
            Rien n'est affiché tant que le montant n'est pas connu — jamais de gain inventé. */}
        {gain != null ? (
          <View style={st.gainRow}>
            <Text style={st.gainLabel}>Tu gagnes</Text>
            <Text style={st.gainValue}>{fcfa(gain)}</Text>
          </View>
        ) : null}

        <View style={st.clientRow}>
          <Avatar text={clientIni} size={32} tone="ink" uri={clientPhoto || undefined} />
          <Text style={st.clientName}>{client || 'Client'}</Text>
          <Pressable
            style={st.actBtn}
            onPress={() => { if (orderId) markOrderRead(orderId).catch(() => {}); setUnread(0); router.push({ pathname: '/chat', params: { orderId: orderId ?? '', name: client ?? 'Client', role: 'driver' } }); }}
          >
            <Ionicons name="chatbubble" size={18} color={colors.brand} />
            {unread > 0 ? <View style={st.badge}><Text style={st.badgeTxt}>{unread > 9 ? '9+' : unread}</Text></View> : null}
          </Pressable>
        </View>

        <Btn
          label={phase === 'collecte' ? 'Naviguer vers le restaurant' : 'Naviguer vers le client'}
          variant="dark"
          onPress={() => openNavigation(phase === 'collecte'
            ? { address: resto, lat: restoPt?.latitude, lng: restoPt?.longitude, preferAddress: true, label: resto || 'Restaurant' }
            : { address: adresse, lat: clientPt?.latitude, lng: clientPt?.longitude, preferAddress: true, label: client || 'Client' })}
          style={{ marginTop: 14 }}
        />
        {phase === 'collecte' ? (
          <>
            <Btn label="J'ai récupéré la commande" disabled={!atResto} onPress={async () => {
              // N'avance vers le client QUE si le serveur a bien enregistré la prise en charge
              // (sinon le suivi client ne bougerait jamais alors que le coursier croit être parti).
              if (orderId) { try { await setOrderStatut(orderId, 'livraison'); } catch { toast('Connexion instable — réessaie.', { tone: 'error' }); return; } }
              setPhase('route');
            }} style={{ marginTop: 10 }} />
            {!atResto ? <Text style={st.geoHint}>Rapproche-toi du restaurant · {distRestoM} m</Text> : null}
          </>
        ) : (
          <>
            <Btn label="Marquer comme livré" disabled={!atClient} onPress={livrer} loading={done} style={{ marginTop: 10 }} />
            {!atClient ? <Text style={st.geoHint}>Rapproche-toi du client · {distClientM} m</Text> : null}
          </>
        )}
      </View>

      <CodeConfirm
        open={codeOpen}
        title="Code de remise"
        subtitle={`Demande à ${client || 'ton client'} son code à 4 chiffres pour confirmer la livraison.`}
        onConfirm={confirmerCode}
        onClose={() => setCodeOpen(false)}
      />

      {/* Note du client — même écran que la fin de course : le comportement du client compte
          AUSSI en livraison. Facultatif : « Passer » (ou le retour Android) ramène à l'accueil. */}
      <Modal visible={noteOpen} animationType="slide" transparent onRequestClose={rentrer}>
        <View style={st.noteBackdrop}>
          <View style={[st.noteSheet, { paddingBottom: Math.max(insets.bottom + 14, 20) }]}>
            <Text style={st.noteDone}>Livraison terminée</Text>

            <View style={st.rateCard}>
              <Avatar text={clientIni} size={56} tone="ink" uri={clientPhoto || undefined} />
              <Text style={st.rateName} numberOfLines={1}>Note {client || 'ton client'}</Text>

              <View style={st.stars}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <Pressable key={i} onPress={() => setNote(i)} hitSlop={6}>
                    <Ionicons name={i <= note ? 'star' : 'star-outline'} size={38} color={i <= note ? colors.gold : colors.line2} />
                  </Pressable>
                ))}
              </View>
            </View>

            <Btn label="Terminer" onPress={envoyerNote} loading={saving} disabled={note < 1} style={{ marginTop: 20 }} />
            <Pressable onPress={rentrer} hitSlop={8} style={st.skip}>
              <Text style={st.skipTxt}>Passer</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  close: { margin: space.lg, width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: 34, ...shadow.pop },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line2, alignSelf: 'center', marginBottom: 14 },
  title: { fontSize: 20, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 13.5, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowText: { flex: 1, fontSize: 13.5, fontWeight: '700', color: colors.ink2 },
  rowLabel: { color: colors.inkSoft },
  // Gain du livreur : lisible d'un coup d'oeil, comme le prix affiché pendant une course.
  // Ligne « libellé + montant » : le libellé CÈDE (flex 1, il se replie), le montant JAMAIS
  // (flexShrink 0). Sans ça, les deux textes prenaient leur largeur naturelle et le montant
  // sortait de la carte quand le libellé était long (ex. « Encaissé en espèces (déjà en main) »).
  gainRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, backgroundColor: colors.brandTint, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 11, gap: 10 },
  gainLabel: { flex: 1, flexShrink: 1, fontSize: 13, fontWeight: '800', color: colors.brandDeep, textTransform: 'uppercase', letterSpacing: 0.4 },
  gainValue: { flexShrink: 0, textAlign: 'right', fontSize: 22, fontWeight: '800', color: colors.brand },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.line },
  clientName: { flex: 1, fontSize: 15.5, fontWeight: '800', color: colors.ink },
  actBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#D8261C', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: colors.surface },
  badgeTxt: { color: '#fff', fontSize: 10, fontWeight: '800' },
  // Même traitement que le verrou de proximité des courses (active-trip) : bien visible.
  geoHint: { fontSize: 12.5, fontWeight: '700', color: colors.brandDeep, textAlign: 'center', marginTop: 8 },
  // Note du client (fin de livraison) — repris tel quel de l'écran de fin de course.
  noteBackdrop: { flex: 1, backgroundColor: 'rgba(21,17,14,0.45)', justifyContent: 'flex-end' },
  noteSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: 22 },
  noteDone: { fontSize: 20, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  rateCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 22, borderWidth: 1, borderColor: colors.line, alignItems: 'center', marginTop: 18 },
  rateName: { fontSize: 16, fontWeight: '800', color: colors.ink, marginTop: 12 },
  stars: { flexDirection: 'row', gap: 8, marginTop: 16 },
  skip: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 20, marginTop: 4 },
  skipTxt: { fontSize: 15, fontWeight: '800', color: colors.inkSoft },
});
