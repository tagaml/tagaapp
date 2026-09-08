import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, Alert, Linking, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { colors, radius, shadow, space } from '../theme';
import { Header, Btn, CtaBar, useToast } from '../components/ui';
import { pourboires, fcfa } from '../data/mock';
import { createOrder, getDefaultAddress, getDeliveryFee, getServiceFee, validatePromo, promoRemise, getTagaPayNumber, getFoodOffer, type Address, type FoodOffer } from '../lib/db';
import { reverseGeocode } from '../lib/geo';
import { CopyNumber } from '../components/CopyNumber';
import { ensureInMali, HORS_MALI_MSG } from '../lib/geoGuard';
import { play } from '../lib/sound';
import { useCart } from '../components/cart';

const PAY_METHODS = [
  { id: 'Orange Money', label: 'Orange Money', abbr: 'OM', color: '#FF6600' },
  { id: 'Wave', label: 'Wave', abbr: 'Wave', color: '#1DC4FF' },
] as const;

const PAY_BG: Record<string, string> = { om: '#FF6600', mm: '#1565C0', card: '#137A4B', cash: '#6E665E' };

export default function Checkout() {
  const router = useRouter();
  const { restaurant, items, sousTotal, clear } = useCart();
  const [quand, setQuand] = useState<'asap' | 'plan'>('asap');
  const [tip, setTip] = useState(0);
  const [promo, setPromo] = useState('');
  const [remise, setRemise] = useState(0);
  const [promoOk, setPromoOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [adresse, setAdresse] = useState<Address | null>(null);
  const [fraisLiv, setFraisLiv] = useState(0);
  // Frais de service : 0 par défaut (Taga se paie sur la commission resto). Valeur résolue
  // côté serveur — on lit la même règle pour ne jamais afficher un total que la RPC n'enregistre pas.
  const [fraisService, setFraisService] = useState(0);
  const [method, setMethod] = useState<string>(''); // 'Orange Money' | 'Wave'
  const [tagaNum, setTagaNum] = useState('');
  const [geoBusy, setGeoBusy] = useState(false);
  const [offer, setOffer] = useState<FoodOffer | null>(null); // offre auto active (plage horaire / seuil)
  const toast = useToast();
  // Offre automatique : livraison offerte et/ou réduction %. La MEILLEURE remise (code OU auto)
  // s'applique — jamais les deux cumulées (aligné sur le serveur).
  const autoRemise = Math.round((sousTotal * (offer?.pct || 0)) / 100);
  const remiseEff = Math.min(sousTotal, Math.max(remise, autoRemise));
  const fraisLivEff = offer?.free_deliv ? 0 : fraisLiv;
  const total = Math.max(0, sousTotal + fraisService + fraisLivEff + tip - remiseEff);
  const net = total;

  React.useEffect(() => { getTagaPayNumber().then(setTagaNum).catch(() => {}); }, []);
  React.useEffect(() => { getFoodOffer(sousTotal).then(setOffer).catch(() => {}); }, [sousTotal]);

  React.useEffect(() => {
    let on = true;
    getServiceFee(restaurant?.id ?? null).then((f) => { if (on) setFraisService(f); }).catch(() => {});
    return () => { on = false; };
  }, [restaurant?.id]);

  // Géolocalisation directe : propose la position actuelle comme adresse de livraison.
  const useMaPosition = React.useCallback(async () => {
    setGeoBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { toast('Autorise la localisation pour te situer.', { tone: 'info' }); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      const detail = (await reverseGeocode({ latitude: lat, longitude: lng })) || `Position (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
      const a: any = { id: 'ma-position', label: 'Ma position actuelle', detail, lat, lng };
      setAdresse(a);
      getDeliveryFee(restaurant?.id ?? null, lat, lng).then(setFraisLiv).catch(() => {});
    } catch { toast('Localisation indisponible.', { tone: 'error' }); }
    finally { setGeoBusy(false); }
  }, [restaurant?.id]);

  const appliquerPromo = async () => {
    if (!promo.trim()) {
      toast('Saisis d\'abord un code promo.', { tone: 'info' });
      return;
    }
    const res = await validatePromo(promo, sousTotal);
    if (!res.ok) {
      setRemise(0);
      setPromoOk(null);
      toast(res.reason, { tone: 'error' });
      return;
    }
    const r = promoRemise(res.promo, sousTotal);
    setRemise(r);
    setPromoOk(res.promo.code);
    toast(`Code ${res.promo.code} appliqué · -${fcfa(r)}`, { tone: 'success' });
  };

  // Recharge l'adresse par défaut à chaque focus (après sélection).
  useFocusEffect(
    React.useCallback(() => {
      let on = true;
      getDefaultAddress().then((a) => {
        if (!on) return;
        if (a) {
          setAdresse(a);
          getDeliveryFee(restaurant?.id ?? null, (a as any)?.lat, (a as any)?.lng).then((f) => { if (on) setFraisLiv(f); }).catch(() => {});
        } else {
          // Pas d'adresse enregistrée → on géolocalise directement le client.
          useMaPosition();
        }
      }).catch(() => {});
      return () => { on = false; };
    }, [useMaPosition]),
  );

  const payer = async () => {
    if (!(await ensureInMali())) { Alert.alert('Taga au Mali', HORS_MALI_MSG); return; }
    if (!items.length) {
      toast('Ton panier est vide.', { tone: 'info' });
      router.replace('/food');
      return;
    }
    if (!adresse) { toast('Ajoute une adresse de livraison', { tone: 'info' }); return; }
    if (!method) { toast('Choisis Orange Money ou Wave.', { tone: 'info' }); return; }
    play('order');
    setLoading(true);
    try {
      const id = await createOrder({
        restaurantId: restaurant?.id || null,
        restaurantNom: restaurant?.nom ?? 'Restaurant',
        items: items.map((i) => ({ id: i.menuItemId ?? i.id, nom: i.nom, prix: i.prix, qte: i.qte, options: i.options })),
        sousTotal,
        fraisLivraison: fraisLiv,
        fraisService,
        pourboire: tip,
        total,
        paiement: method,
        creditApplied: 0,
        adresse: adresse ? `${adresse.label} · ${adresse.detail}` : undefined,
        destLat: (adresse as any)?.lat ?? null,
        destLng: (adresse as any)?.lng ?? null,
        promo: promoOk,
      });
      clear();
      router.replace({
        pathname: '/food-track',
        params: {
          orderId: id ?? '',
          restoNom: restaurant?.nom ?? 'Restaurant',
          eta: restaurant?.eta ?? '',
        },
      });
    } catch {
      Alert.alert('Oups', "La commande n'a pas pu être enregistrée. Réessaie.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Finaliser" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 20, paddingHorizontal: space.lg }}>

        <Text style={st.label}>Adresse de livraison</Text>
        <Pressable style={st.box} onPress={() => router.push({ pathname: '/addresses', params: { select: '1' } })}>
          <View style={st.boxIcon}><Ionicons name="location" size={20} color={colors.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.boxTitle} numberOfLines={1}>{adresse?.label ?? 'Choisir une adresse'}</Text>
            <Text style={st.boxSub} numberOfLines={2}>{adresse?.detail ?? 'Ajoute ton adresse de livraison'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMute} />
        </Pressable>
        <Pressable style={st.geoBtn} onPress={useMaPosition} disabled={geoBusy}>
          <Ionicons name="locate" size={16} color={colors.brand} />
          <Text style={st.geoBtnText}>{geoBusy ? 'Localisation…' : 'Utiliser ma position actuelle'}</Text>
        </Pressable>

        <Text style={st.label}>Quand ?</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable style={[st.toggle, quand === 'asap' && st.toggleOn]} onPress={() => setQuand('asap')}>
            <Text style={[st.toggleTitle, quand === 'asap' && st.toggleTitleOn]}>Au plus vite</Text>
            {/* Même délai que le panier et le suivi : celui du restaurant (pas une fourchette inventée). */}
            <Text style={[st.toggleSub, quand === 'asap' && { color: 'rgba(255,255,255,0.8)' }]}>{restaurant?.eta || 'Environ 30 min'}</Text>
          </Pressable>
          <Pressable
            style={[st.toggle, { opacity: 0.55 }]}
            onPress={() =>
              Alert.alert('Bientôt disponible', 'La planification horaire arrive bientôt sur Taga. Ta commande sera livrée au plus vite.')
            }
          >
            <View style={st.soonBadge}><Text style={st.soonText}>Bientôt</Text></View>
            <Text style={st.toggleTitle}>Planifier</Text>
            <Text style={st.toggleSub}>Choisir l'heure</Text>
          </Pressable>
        </View>

        <Text style={st.label}>Paiement</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {PAY_METHODS.map((m) => {
            const on = method === m.id;
            return (
              <Pressable key={m.id} style={[st.payOpt, on && st.payOptOn]} onPress={() => setMethod(m.id)}>
                <View style={[st.payBadge, { backgroundColor: m.color }]}><Text style={st.payBadgeText}>{m.abbr}</Text></View>
                <Text style={[st.payOptLabel, on && { color: colors.brand }]}>{m.label}</Text>
                {on ? <Ionicons name="checkmark-circle" size={20} color={colors.brand} /> : null}
              </Pressable>
            );
          })}
        </View>

        {method ? (
          <View style={st.payCard}>
            <Text style={st.payCardTitle}>Paie {fcfa(net)} via {method}</Text>
            {tagaNum ? (
              <CopyNumber number={tagaNum} />
            ) : (
              <Text style={st.payCardSub}>Le numéro Taga te sera communiqué. Contacte le support si besoin.</Text>
            )}
            <Text style={st.payCardSub}>Envoie le montant au numéro Taga ci-dessus, puis appuie sur « J'ai payé ». Taga vérifie la réception et transmet ta commande au restaurant — tu reçois une notification.</Text>
          </View>
        ) : null}

        <Text style={st.label}>Code promo</Text>
        <View style={st.promo}>
          <TextInput
            placeholder="TAGA30"
            placeholderTextColor={colors.inkMute}
            style={st.promoInput}
            autoCapitalize="characters"
            value={promo}
            onChangeText={setPromo}
          />
          <Pressable style={st.promoBtn} onPress={appliquerPromo}>
            <Text style={st.promoBtnText}>Appliquer</Text>
          </Pressable>
        </View>

        <Text style={st.label}>Pourboire livreur</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {pourboires.map((p) => (
            <Pressable key={p} style={[st.tip, tip === p && st.tipOn]} onPress={() => setTip(p)}>
              <Text style={[st.tipText, tip === p && st.tipTextOn]}>{p === 0 ? 'Aucun' : fcfa(p)}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={st.tipNote}>100% du pourboire revient à ton livreur.</Text>

        {/* Offre en cours (plage horaire / seuil) — bien visible */}
        {offer && (offer.free_deliv || offer.pct > 0) && (
          <View style={st.offerNote}>
            <Ionicons name="pricetag" size={16} color={colors.green} />
            <Text style={st.offerNoteText}>{offer.libelle || (offer.free_deliv ? 'Livraison offerte en ce moment' : `-${offer.pct}% en ce moment`)}</Text>
          </View>
        )}

        <Text style={st.label}>Récapitulatif</Text>
        <View style={st.recap}>
          <Recap label="Sous-total" value={fcfa(sousTotal)} />
          <Recap label="Livraison" value={!adresse ? 'Calculée après adresse' : fraisLivEff > 0 ? fcfa(fraisLivEff) : 'Offerte'} green={!!adresse && fraisLivEff === 0} />
          {/* Frais de service masqué quand il vaut 0 : afficher « 0 F » n'apporte rien. */}
          {fraisService > 0 && <Recap label="Frais de service" value={fcfa(fraisService)} />}
          {tip > 0 && <Recap label="Pourboire" value={fcfa(tip)} />}
          {remiseEff > 0 && <Recap label={autoRemise > remise ? (offer?.libelle || 'Offre du moment') : (promoOk ? `Réduction (${promoOk})` : 'Réduction')} value={`-${fcfa(remiseEff)}`} green />}
          <View style={st.sep} />
          <Recap label="Total" value={fcfa(net)} bold />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      <CtaBar>
        <Btn label={method ? `J'ai payé · ${fcfa(net)}` : 'Choisis Orange Money ou Wave'} disabled={!method} loading={loading} onPress={payer} />
      </CtaBar>
    </View>
  );
}

function Recap({ label, value, green, bold }: { label: string; value: string; green?: boolean; bold?: boolean }) {
  return (
    <View style={st.recapLine}>
      <Text style={[st.recapLabel, bold && { color: colors.ink, fontWeight: '800', fontSize: 16 }]}>{label}</Text>
      <Text style={[st.recapValue, green && { color: colors.green }, bold && { fontSize: 18 }]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 22, marginBottom: 10 },
  box: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  boxIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  boxTitle: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  boxSub: { fontSize: 13, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  geoBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', marginTop: 10, paddingVertical: 6 },
  geoBtnText: { fontSize: 13.5, fontWeight: '800', color: colors.brand },
  payOpt: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 2, borderColor: colors.line, paddingHorizontal: 12, height: 58 },
  payOptOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  payBadge: { width: 40, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  payBadgeText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  payOptLabel: { flex: 1, fontSize: 14.5, fontWeight: '800', color: colors.ink },
  payCard: { backgroundColor: colors.brandTint, borderRadius: radius.lg, padding: 16, marginTop: 12, borderWidth: 1, borderColor: colors.brandSoft },
  payCardTitle: { fontSize: 15.5, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  payNumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 10, marginTop: 10, borderWidth: 1, borderColor: colors.brandSoft },
  payNum: { fontSize: 18, fontWeight: '800', color: colors.ink, letterSpacing: 0.5 },
  payCardSub: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, textAlign: 'center', marginTop: 8, lineHeight: 18 },
  om: { color: '#fff', fontSize: 12, fontWeight: '800' },
  toggle: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, borderWidth: 2, borderColor: colors.line },
  toggleOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  toggleTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  toggleTitleOn: { color: colors.white },
  toggleSub: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  soonBadge: { alignSelf: 'flex-start', backgroundColor: colors.surface2, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginBottom: 6 },
  soonText: { fontSize: 10.5, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.3 },
  promo: { flexDirection: 'row', gap: 10 },
  promoInput: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, height: 50, fontSize: 15, fontWeight: '700', color: colors.ink, borderWidth: 1, borderColor: colors.line },
  promoBtn: { paddingHorizontal: 20, height: 50, borderRadius: radius.md, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  promoBtnText: { color: colors.white, fontWeight: '800', fontSize: 14 },
  tip: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.line },
  tipOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  tipText: { fontSize: 13, fontWeight: '800', color: colors.ink2 },
  tipTextOn: { color: colors.brand },
  tipNote: { fontSize: 12, color: colors.inkSoft, fontWeight: '600', marginTop: 8 },
  offerNote: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.greenSoft, borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: 14, marginBottom: 4 },
  offerNoteText: { flex: 1, fontSize: 13.5, fontWeight: '800', color: colors.green },
  recap: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  recapLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  recapLabel: { fontSize: 14.5, color: colors.inkSoft, fontWeight: '600', flexShrink: 1, marginRight: 10 },
  recapValue: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  sep: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
});
