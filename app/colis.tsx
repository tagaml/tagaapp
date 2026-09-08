import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Modal, TextInput, Alert, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../theme';
import { Header, Btn, CtaBar, ServiceIcon, useToast } from '../components/ui';
import { BAMAKO, distanceKm } from '../components/TripMap';
import { RideMap, Place } from '../components/RideMap';
import { type GeoRoute } from '../lib/geo';
import { taillesColis, fcfa } from '../data/mock';
import { createRide, getPricing, estimatePrice, getColisSizes, getColisManutFee, getServiceFees, type PricingTier, type ColisSize } from '../lib/db';
import { realisticEta, arrivalLabel, fallbackEstimate, serverPathKm } from '../lib/estimate';
import { PaymentSelector, type PaymentChoice } from '../components/PaymentSelector';
import { ConfirmOrder } from '../components/ConfirmOrder';
import { ensureInMali, HORS_MALI_MSG } from '../lib/geoGuard';
import { play } from '../lib/sound';
import { useKeyboardHeight } from '../lib/keyboard';
import { st } from './ride-voiture';

const PRIX_PAR_KM = 250; // F CFA / km (repli si la grille n'a pas chargé)

type Dest = { nom: string; tel: string };

export default function Colis() {
  const router = useRouter();
  const toast = useToast();
  const rp = useLocalSearchParams<{ destLabel?: string; destLat?: string; destLng?: string }>();
  const initialDest: Place | null = rp.destLabel && rp.destLat && rp.destLng
    ? { id: 'redo', label: String(rp.destLabel), sub: String(rp.destLabel), point: { latitude: Number(rp.destLat), longitude: Number(rp.destLng) }, icon: 'location' }
    : null;
  const [mode, setMode] = useState<'envoyer' | 'recevoir'>('envoyer');
  const isRecevoir = mode === 'recevoir';
  const [sizes, setSizes] = useState<ColisSize[]>(taillesColis as ColisSize[]);
  const [sel, setSel] = useState(taillesColis[0].id);
  const [dest, setDest] = useState<Place | null>(null);
  const [origin, setOrigin] = useState<{ latitude: number; longitude: number }>(BAMAKO.aci2000);
  const [destinataire, setDestinataire] = useState<Dest | null>(null);
  const [note, setNote] = useState(''); // contenu / précisions du colis
  const [manut, setManut] = useState(false); // chargement / déchargement (colis lourd)
  const [manutFeeCfg, setManutFeeCfg] = useState(2000); // supplément (réglé admin)
  const [ridePct, setRidePct] = useState(0); // frais de service courses (%) — réglé admin
  const [confirmOpen, setConfirmOpen] = useState(false); // récap avant recherche
  const [editOpen, setEditOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [route, setRoute] = useState<GeoRoute | null>(null);
  const [pricing, setPricing] = useState<Record<string, PricingTier>>({});
  const [pay, setPay] = useState<PaymentChoice>({ method: 'Espèces', creditApplied: 0 });
  const choisi = sizes.find((t) => t.id === sel) ?? sizes[0];
  const scrollRef = useRef<ScrollView>(null);
  const noteFocused = useRef(false);
  // Quand le clavier s'affiche et que le champ commentaire a le focus, on l'amène juste au-dessus.
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      if (noteFocused.current) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    });
    return () => show.remove();
  }, []);

  useEffect(() => {
    getPricing().then(setPricing).catch(() => {});
    getColisManutFee().then(setManutFeeCfg).catch(() => {});
    getServiceFees().then((f) => setRidePct(f.ridePct)).catch(() => {});
    // Tailles de colis configurées en admin (nom, poids, prix). Repli sur le mock.
    getColisSizes().then((s) => { if (s.length) { setSizes(s); const moto = s.find((x) => !x.heavy) ?? s[0]; setSel((cur) => (s.some((x) => x.id === cur) ? cur : moto.id)); } }).catch(() => {});
  }, []);

  // Deux options de livraison (façon Yassir) : Moto (colis normal) et Tricycle (colis lourd).
  const motoSize = sizes.find((x) => !x.heavy) ?? sizes[0];
  const tricycleSize = sizes.find((x) => x.heavy);
  const priceFor = (id: string, base: number) => dest
    ? (estimatePrice(pricing[id], km) ?? base + Math.round((km * PRIX_PAR_KM) / 50) * 50)
    : base;
  const livOptions = [
    motoSize ? { size: motoSize, icon: 'scooterColis' as const, label: 'Livraison Moto', sub: motoSize.desc || 'Petit / moyen colis', heavy: false } : null,
    tricycleSize ? { size: tricycleSize, icon: 'tricycle' as const, label: 'Livraison Tricycle', sub: tricycleSize.desc || 'Colis lourd / encombrant', heavy: true } : null,
  ].filter(Boolean) as { size: ColisSize; icon: 'scooterColis' | 'tricycle'; label: string; sub: string; heavy: boolean }[];

  // PRIX : distance identique au serveur (taga_path_km) → prix affiché = offre reçue par le coursier.
  const km = dest ? serverPathKm([origin, dest.point]) : 0;
  const fb = dest ? fallbackEstimate(origin, dest.point) : null;
  // Durée réaliste de la livraison (trafic Bamako) + heure d'arrivée estimée.
  const eta = realisticEta(route?.durationMin ?? fb?.durationMin ?? null);
  const arrive = arrivalLabel(eta);
  // Base « prise en charge » : celle de la grille serveur si dispo, sinon le prix mock.
  // (On garde la même source que le total pour que le récap s'additionne correctement.)
  const baseColis = pricing[sel]?.base ?? choisi.prix;
  // Estimation distance depuis la grille serveur (repli sur le calcul local).
  const distTotal = dest
    ? (estimatePrice(pricing[sel], km) ?? choisi.prix + Math.round((km * PRIX_PAR_KM) / 50) * 50)
    : choisi.prix;
  // Option chargement/déchargement (colis lourd / tricycle) : le client en est averti.
  const isHeavy = !!choisi.heavy;
  const MANUT_FEE = manutFeeCfg; // supplément chargement + déchargement (réglé côté admin)
  const manutFee = isHeavy && manut ? MANUT_FEE : 0;
  const baseTotal = distTotal + manutFee;
  // Frais de service Taga (courses) : % du prix, ajouté au total.
  const svcFee = Math.round((baseTotal * ridePct) / 100);
  const total = baseTotal + svcFee;
  const fraisDistance = Math.max(0, distTotal - baseColis);

  const pret = !!dest && !!destinataire;

  const trouverCoursier = async () => {
    if (!(await ensureInMali())) { Alert.alert('Taga au Mali', HORS_MALI_MSG); return; }
    play('order');
    setLoading(true);
    try {
      // Recevoir : le coursier récupère chez l'expéditeur (dest) et livre chez moi (origin) → on inverse.
      const collecteLabel = isRecevoir ? (dest?.label ?? 'Récupération') : 'Ma position';
      const livraisonLabel = isRecevoir ? 'Chez moi' : (dest?.label ?? '');
      const role = isRecevoir ? 'De' : 'Pour';
      const departPt = isRecevoir ? dest?.point : origin;
      const destPt = isRecevoir ? origin : dest?.point;
      const id = await createRide({
        type: 'colis',
        tier: sel,
        depart: collecteLabel,
        // Contact (expéditeur ou destinataire) gardé dans la destination (pas de colonne dédiée).
        destination: destinataire
          ? `${livraisonLabel} · ${role} ${destinataire.nom} (${destinataire.tel})`
          : livraisonLabel,
        distanceKm: km,
        prix: total,
        fraisService: svcFee,
        paiement: pay.method,
        creditApplied: pay.creditApplied,
        vehicule: choisi.heavy ? 'Taga Tricycle' : 'Taga Coursier',
        manut: manutFee > 0, // le serveur ajoute le supplément configuré (anti-triche)
        colisNote: [note.trim(), manutFee > 0 ? 'Chargement + déchargement demandé' : ''].filter(Boolean).join(' · ') || undefined,
        departLat: departPt?.latitude,
        departLng: departPt?.longitude,
        destLat: destPt?.latitude,
        destLng: destPt?.longitude,
      });
      if (!id) { Alert.alert('Oups', "La demande n'a pas pu être enregistrée. Réessaie."); return; }
      router.push({ pathname: '/searching', params: { rideId: id } });
    } catch {
      // Même message que ci-dessus : on parle de « demande », jamais de « course », pour un colis.
      Alert.alert('Oups', "La demande n'a pas pu être enregistrée. Réessaie.");
    } finally {
      setLoading(false);
    }
  };
  const initiales = destinataire ? destinataire.nom.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : '';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title={isRecevoir ? 'Recevoir un colis' : 'Envoyer un colis'} />

      {/* Bascule Envoyer / Recevoir */}
      <View style={cs.seg}>
        {([['envoyer', 'Envoyer', 'arrow-up'], ['recevoir', 'Recevoir', 'arrow-down']] as const).map(([m, lab, ic]) => {
          const on = mode === m;
          return (
            <Pressable key={m} onPress={() => setMode(m)} style={[cs.segItem, on && cs.segItemOn]}>
              <Ionicons name={ic} size={16} color={on ? colors.white : colors.ink2} />
              <Text style={[cs.segText, on && { color: colors.white }]}>{lab}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Carte fixe en haut. En mode « recevoir », l'adresse saisie = récupération chez l'expéditeur. */}
      <RideMap
        vehicle="moto"
        defaultOrigin={BAMAKO.aci2000}
        height={168}
        pickupEditable
        departCaption={isRecevoir ? 'Livrer chez moi' : 'Point de collecte'}
        destCaption={isRecevoir ? 'Adresse de récupération' : 'Adresse de livraison'}
        destPrompt={isRecevoir ? 'Où récupérer le colis ?' : 'Où livrer le colis ?'}
        initialDest={initialDest}
        onChange={(d, o, r) => { setDest(d); setOrigin(o); setRoute(r ?? null); }}
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView ref={scrollRef} style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <View style={cs.note}>
          <Ionicons name="information-circle" size={18} color={colors.brand} />
          <Text style={cs.noteText}>
            {isRecevoir
              ? <>Collecte chez l'<Text style={cs.noteBold}>expéditeur</Text> → <Text style={cs.noteBold}>ta position</Text>.</>
              : <>Collecte → <Text style={cs.noteBold}>destinataire</Text>.</>}
          </Text>
        </View>

        <Text style={st.section}>Type de livraison</Text>
        <View style={{ paddingHorizontal: space.lg, gap: 10 }}>
          {livOptions.map((o) => {
            const on = o.size.id === sel;
            const p = priceFor(o.size.id, o.size.prix);
            return (
              <Pressable key={o.size.id} onPress={() => setSel(o.size.id)} style={[st.opt, on && st.optOn]}>
                <View style={st.optIcon}>
                  <ServiceIcon name={o.icon} size={o.heavy ? 48 : 46} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={cs.nameRow}>
                    <Text style={st.optName}>{o.label}</Text>
                    {o.heavy ? <View style={cs.heavyBadge}><Text style={cs.heavyBadgeTxt}>Colis lourd</Text></View> : null}
                  </View>
                  <Text style={st.optMeta}>{o.sub}</Text>
                </View>
                {dest ? <Text style={st.optPrix}>{fcfa(p)}</Text> : <Text style={cs.optPrixHint}>Selon{'\n'}distance</Text>}
              </Pressable>
            );
          })}
        </View>

        {/* Chargement / déchargement (colis lourd · tricycle) : option facturée, le client en est averti. */}
        {isHeavy ? (
          <View style={{ paddingHorizontal: space.lg, marginTop: 10 }}>
            <Pressable onPress={() => setManut((v) => !v)} style={[cs.manutRow, manut && cs.manutRowOn]}>
              <View style={[cs.manutCheck, manut && cs.manutCheckOn]}>
                {manut ? <Ionicons name="checkmark" size={15} color={colors.white} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.optName}>Chargement et déchargement</Text>
                <Text style={st.optMeta}>Le coursier aide à porter</Text>
              </View>
              <Text style={st.optPrix}>+{fcfa(MANUT_FEE)}</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={st.section}>{isRecevoir ? 'Expéditeur' : 'Destinataire'}</Text>
        <Pressable style={cs.dest} onPress={() => setEditOpen(true)}>
          {destinataire ? (
            <>
              <View style={cs.destAvatar}><Text style={cs.destInit}>{initiales}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={st.optName}>{destinataire.nom}</Text>
                <Text style={st.optMeta} numberOfLines={1}>{destinataire.tel}{dest ? ` · ${dest.label}` : ''}</Text>
              </View>
              <Ionicons name="pencil" size={18} color={colors.inkMute} />
            </>
          ) : (
            <>
              <View style={[cs.destAvatar, { backgroundColor: colors.brandTint }]}><Ionicons name="person-add" size={20} color={colors.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.optName}>{isRecevoir ? "Ajouter l'expéditeur" : 'Ajouter un destinataire'}</Text>
                <Text style={st.optMeta}>{isRecevoir ? 'Nom et numéro de la personne qui envoie' : 'Nom et numéro de la personne qui reçoit'}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.inkMute} />
            </>
          )}
        </Pressable>

        <Text style={st.section}>Contenu du colis</Text>
        <View style={{ paddingHorizontal: space.lg }}>
          <TextInput
            style={cs.noteInput}
            value={note}
            onChangeText={setNote}
            placeholder="Ex : documents, téléphone, plat chaud, fragile…"
            placeholderTextColor={colors.inkMute}
            multiline
            onFocus={() => { noteFocused.current = true; setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200); }}
            onBlur={() => { noteFocused.current = false; }}
          />
        </View>

        {dest && (
          <View style={cs.recap}>
            {/* Détail du calcul (prise en charge / distance / estimation) retiré : on garde l'essentiel,
                le total. Les seuls suppléments réels (manutention, frais de service) restent visibles. */}
            {manutFee > 0 ? <Recap label="Chargement et déchargement" value={fcfa(manutFee)} /> : null}
            {svcFee > 0 ? <Recap label="Frais de service" value={fcfa(svcFee)} /> : null}
            {(manutFee > 0 || svcFee > 0) ? <View style={cs.sep} /> : null}
            <Recap label="Total estimé" value={fcfa(total)} bold={pay.creditApplied <= 0} />
            {pay.creditApplied > 0 ? (
              <>
                <Recap label="Crédit Taga" value={`-${fcfa(pay.creditApplied)}`} />
                <Recap label="À payer" value={fcfa(Math.max(0, total - pay.creditApplied))} bold />
              </>
            ) : null}
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      <CtaBar>
        {dest ? <PaymentSelector total={total} onChange={setPay} /> : null}
        <View style={st.totalRow}>
          <View>
            <Text style={st.totalLabel}>Total</Text>
            <Text style={st.totalVal}>{dest ? fcfa(Math.max(0, total - pay.creditApplied)) : '—'}</Text>
          </View>
          <Btn
            label={!dest ? (isRecevoir ? 'Choisis la récupération' : 'Choisis la destination') : !destinataire ? (isRecevoir ? "Ajoute l'expéditeur" : 'Ajoute un destinataire') : 'Trouver un coursier'}
            disabled={!pret}
            loading={loading}
            onPress={() => { if (pret) setConfirmOpen(true); }}
            style={{ flex: 1, marginLeft: 14 }}
          />
        </View>
      </CtaBar>

      <ConfirmOrder
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        loading={loading}
        onConfirm={() => { setConfirmOpen(false); trouverCoursier(); }}
        titre="Confirmer l'envoi"
        moyen={choisi.heavy ? 'Livraison Tricycle' : 'Livraison Moto'}
        rows={[
          { icon: 'ellipse', label: isRecevoir ? 'Récupération' : 'Point de collecte', value: isRecevoir ? (dest?.label ?? '') : 'Ma position' },
          { icon: 'location', label: 'Livraison', value: isRecevoir ? 'Chez moi' : (dest?.label ?? '') },
          { icon: 'cube', label: 'Colis', value: `${choisi.nom}${manutFee > 0 ? ' · chargement/déchargement' : ''}` },
          ...(destinataire ? [{ icon: 'person' as const, label: isRecevoir ? 'Expéditeur' : 'Destinataire', value: `${destinataire.nom} · ${destinataire.tel}` }] : []),
          ...(svcFee > 0 ? [{ icon: 'card' as const, label: 'Frais de service', value: fcfa(svcFee) }] : []),
          { icon: 'card', label: 'Paiement', value: pay.method },
        ]}
        total={Math.max(0, total - pay.creditApplied)}
        cta="Confirmer et chercher un coursier"
      />

      <DestinataireModal
        open={editOpen}
        role={isRecevoir ? 'Expéditeur' : 'Destinataire'}
        initial={destinataire}
        onClose={() => setEditOpen(false)}
        onSave={(d) => { setDestinataire(d); setEditOpen(false); toast(`${isRecevoir ? 'Expéditeur' : 'Destinataire'} enregistré`); }}
      />
    </View>
  );
}

function DestinataireModal({ open, role = 'Destinataire', initial, onClose, onSave }: {
  open: boolean; role?: string; initial: Dest | null; onClose: () => void; onSave: (d: Dest) => void;
}) {
  const [nom, setNom] = useState(initial?.nom ?? '');
  const [tel, setTel] = useState(initial?.tel ?? '');
  React.useEffect(() => { if (open) { setNom(initial?.nom ?? ''); setTel(initial?.tel ?? ''); } }, [open]);
  const valide = nom.trim().length >= 2 && tel.trim().length >= 6;
  const kbHeight = useKeyboardHeight(); // remonte la feuille : un Modal Android ne se redimensionne pas

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      {/* PAS de KeyboardAvoidingView : sans effet dans un Modal sur Android (fenêtre séparée, le
          `adjustResize` du manifeste ne s'y applique pas). On remonte la feuille avec la hauteur
          RÉELLE du clavier — sinon il recouvre les champs « Nom » et « Téléphone ». */}
      <View style={cs.backdrop}>
        <SafeAreaView edges={['bottom']} style={[cs.sheet, { paddingBottom: kbHeight }]}>
          <View style={cs.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={cs.sheetHead}>
              <Text style={cs.sheetTitle}>{role}</Text>
              <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color={colors.ink} /></Pressable>
            </View>

            <Text style={cs.fieldLabel}>Nom complet</Text>
            <TextInput
              placeholder="Ex : Aïssata Traoré"
              placeholderTextColor={colors.inkMute}
              value={nom}
              onChangeText={setNom}
              style={cs.input}
            />

            <Text style={cs.fieldLabel}>Téléphone</Text>
            <TextInput
              placeholder="+223 70 00 00 00"
              placeholderTextColor={colors.inkMute}
              value={tel}
              onChangeText={setTel}
              keyboardType="phone-pad"
              style={cs.input}
            />

            <Btn label={`Enregistrer ${role.toLowerCase()}`} disabled={!valide} onPress={() => onSave({ nom: nom.trim(), tel: tel.trim() })} style={{ marginTop: 22 }} />
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function Recap({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={cs.recapLine}>
      <Text style={[cs.recapLabel, bold && { color: colors.ink, fontWeight: '800', fontSize: 16 }]}>{label}</Text>
      <Text style={[cs.recapValue, bold && { fontSize: 18 }]}>{value}</Text>
    </View>
  );
}

const cs = StyleSheet.create({
  seg: { flexDirection: 'row', gap: 8, paddingHorizontal: space.lg, paddingBottom: 10 },
  segItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 42, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line2 },
  segItemOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  segText: { fontSize: 14.5, fontWeight: '800', color: colors.ink2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heavyBadge: { backgroundColor: colors.brand, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2 },
  manutRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: 12, paddingHorizontal: 12, borderWidth: 2, borderColor: colors.line },
  manutRowOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  manutCheck: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  manutCheckOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  heavyBadgeTxt: { color: colors.white, fontSize: 10.5, fontWeight: '800' },
  note: { flexDirection: 'row', gap: 9, marginHorizontal: space.lg, marginTop: 8, backgroundColor: colors.brandTint, borderRadius: radius.md, padding: 9, borderWidth: 1, borderColor: colors.brandSoft },
  noteText: { flex: 1, fontSize: 12.5, color: colors.ink2, fontWeight: '600', lineHeight: 18 },
  noteBold: { fontWeight: '800', color: colors.brandDeep },
  dest: { marginHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line },
  destAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  destInit: { color: colors.white, fontWeight: '800', fontSize: 15 },
  optPrixHint: { fontSize: 12, fontWeight: '800', color: colors.inkMute, textAlign: 'right', lineHeight: 15 },
  noteInput: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, paddingHorizontal: 14, paddingTop: 12, minHeight: 70, fontSize: 15, fontWeight: '600', color: colors.ink, textAlignVertical: 'top' },
  noteHelp: { fontSize: 12, fontWeight: '600', color: colors.inkSoft, marginTop: 7, marginBottom: 2 },
  recap: { marginHorizontal: space.lg, marginTop: 18, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line },
  recapLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  recapLabel: { fontSize: 14.5, color: colors.inkSoft, fontWeight: '600', flexShrink: 1, marginRight: 10 },
  recapValue: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  sep: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(21,17,14,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: 10, paddingBottom: 14 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line2, alignSelf: 'center', marginBottom: 14 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: colors.ink },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, marginTop: 14, marginBottom: 8 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 16, height: 52, fontSize: 16, fontWeight: '700', color: colors.ink, borderWidth: 1, borderColor: colors.line },
});
