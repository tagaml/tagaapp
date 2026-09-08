import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, Alert, ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { colors, radius, space } from '../theme';
import { Header, Btn, CtaBar, ServiceIcon, useToast } from '../components/ui';
import { createMovingRequest } from '../lib/db';
import { ensureInMali, HORS_MALI_MSG, RESTRICT_TO_MALI, inMaliBox } from '../lib/geoGuard';
import { searchPlaces, type GeoPlace } from '../lib/geo';
import { AdjustOnMap } from '../components/RideMap';
import { BAMAKO } from '../components/TripMap';
import { play } from '../lib/sound';

type Pt = { lat: number; lng: number };

/** Champ adresse : saisie + autocomplétion + géoloc + choix du point (repère) sur la carte. */
function AddrField({ value, onText, pt, setPt, placeholder, autoLocate }: {
  value: string; onText: (t: string) => void; pt: Pt | null; setPt: (p: Pt | null) => void; placeholder: string; autoLocate?: boolean;
}) {
  const toast = useToast();
  const [sugg, setSugg] = useState<GeoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const pickedRef = useRef(false);

  // Auto-géoloc à l'ouverture (départ) — silencieux.
  useEffect(() => { if (autoLocate) geoloc(true); }, []);

  // Autocomplétion (Photon, biaisé Bamako) avec anti-rebond.
  useEffect(() => {
    if (pickedRef.current) { pickedRef.current = false; return; }
    const q = value.trim();
    if (q.length < 3) { setSugg([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try { setSugg(await searchPlaces(q)); } catch { setSugg([]); }
      setSearching(false);
    }, 350);
    return () => clearTimeout(t);
  }, [value]);

  const choisir = (p: GeoPlace) => {
    pickedRef.current = true;
    onText([p.label, p.sub].filter(Boolean).join(', '));
    setPt({ lat: p.point.latitude, lng: p.point.longitude });
    setSugg([]);
  };

  const geoloc = async (silencieux = false) => {
    setGeoBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) { if (!silencieux) toast('Autorise la localisation', { tone: 'error' }); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      // Hors du Mali (test à l'étranger) : on n'impose pas une adresse étrangère.
      if (RESTRICT_TO_MALI && !inMaliBox(pos.coords.latitude, pos.coords.longitude)) { if (!silencieux) toast('Taga est disponible au Mali — cherche ton adresse à Bamako', { tone: 'error' }); return; }
      const p: Pt = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      pickedRef.current = true;
      let label = 'Ma position actuelle';
      try { const g = (await Location.reverseGeocodeAsync({ latitude: p.lat, longitude: p.lng }))[0]; if (g) { const l = [g.name || g.street, g.district || g.city].filter(Boolean).join(', '); if (l) label = l; } } catch { /* défaut */ }
      onText(label); setPt(p); setSugg([]);
      if (!silencieux) toast('Position détectée');
    } catch { if (!silencieux) toast('Localisation indisponible', { tone: 'error' }); }
    finally { setGeoBusy(false); }
  };

  return (
    <View>
      <View style={st.addrRow}>
        <TextInput style={st.addrInput} value={value} onChangeText={(t) => { onText(t); if (pt) setPt(null); }} placeholder={placeholder} placeholderTextColor={colors.inkMute} />
        <Pressable onPress={() => geoloc()} disabled={geoBusy} style={st.geoBtn}>
          {geoBusy ? <ActivityIndicator color={colors.white} size="small" /> : <Ionicons name="locate" size={20} color={colors.white} />}
        </Pressable>
      </View>

      {(searching || sugg.length > 0) && (
        <View style={st.suggBox}>
          {searching && sugg.length === 0 ? (
            <View style={{ padding: 14, alignItems: 'center' }}><ActivityIndicator size="small" color={colors.inkMute} /></View>
          ) : sugg.map((p) => (
            <Pressable key={p.id} style={st.suggRow} onPress={() => choisir(p)}>
              <Ionicons name="location-outline" size={18} color={colors.inkSoft} />
              <View style={{ flex: 1 }}>
                <Text style={st.suggLabel} numberOfLines={1}>{p.label}</Text>
                {p.sub ? <Text style={st.suggSub} numberOfLines={1}>{p.sub}</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>
      )}

      <View style={st.underRow}>
        {pt ? <Text style={st.geoOk}><Ionicons name="checkmark-circle" size={12} color={colors.green} /> Point enregistré</Text> : <View />}
        <Pressable style={st.mapLink} onPress={() => setMapOpen(true)}>
          <Ionicons name="map" size={15} color={colors.brand} />
          <Text style={st.mapLinkText}>Choisir le point sur la carte</Text>
        </Pressable>
      </View>

      <AdjustOnMap
        open={mapOpen}
        initial={pt ? { latitude: pt.lat, longitude: pt.lng } : BAMAKO.aci2000}
        title="Placer le repère"
        onClose={() => setMapOpen(false)}
        onConfirm={(point, label) => { pickedRef.current = true; setPt({ lat: point.latitude, lng: point.longitude }); if (label) onText(label); setSugg([]); setMapOpen(false); toast('Repère enregistré'); }}
      />
    </View>
  );
}

const VOLUMES = [
  { id: 'studio', nom: 'Studio', desc: '1 pièce · peu de meubles' },
  { id: '2-3', nom: '2 – 3 pièces', desc: 'Appartement familial' },
  { id: 'villa', nom: 'Villa / grande maison', desc: 'Gros volume' },
];
const CRENEAUX = [
  { id: 'matin', nom: 'Matin', sub: '8 h – 12 h' },
  { id: 'apres-midi', nom: 'Après-midi', sub: '12 h – 17 h' },
  { id: 'soir', nom: 'Soir', sub: '17 h – 20 h' },
  { id: 'demi-journee', nom: 'Demi-journée', sub: '8 h – 13 h' },
  { id: 'journee', nom: 'Journée', sub: '8 h – 17 h' },
];
const OPTIONS = ['Démontage / remontage', 'Emballage', 'Cartons fournis'];
const HOUR_MAX = 4;

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
function dayLabel(offset: number): string {
  const d = new Date(); d.setDate(d.getDate() + offset);
  if (offset === 0) return "Aujourd'hui";
  if (offset === 1) return 'Demain';
  return `${JOURS[d.getDay()]} ${d.getDate()}`;
}
function isoDate(offset: number): string {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export default function Demenagement() {
  const router = useRouter();
  const toast = useToast();
  const [depart, setDepart] = useState('');
  const [departEtage, setDepartEtage] = useState('');
  const [departPt, setDepartPt] = useState<{ lat: number; lng: number } | null>(null);
  const [arrivee, setArrivee] = useState('');
  const [arriveeEtage, setArriveeEtage] = useState('');
  const [arriveePt, setArriveePt] = useState<{ lat: number; lng: number } | null>(null);
  const [volume, setVolume] = useState('2-3');
  const [dayOffset, setDayOffset] = useState(1);
  const [creneau, setCreneau] = useState('matin');
  const [manut, setManut] = useState(1);
  const [options, setOptions] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const toggleOpt = (o: string) => setOptions((a) => a.includes(o) ? a.filter((x) => x !== o) : [...a, o]);
  const pret = depart.trim().length >= 3 && arrivee.trim().length >= 3;

  const envoyer = async () => {
    if (!pret) { Alert.alert('Déménagement', 'Indique au moins les adresses de départ et d\'arrivée.'); return; }
    if (!(await ensureInMali())) { Alert.alert('Taga au Mali', HORS_MALI_MSG); return; }
    play('order');
    setLoading(true);
    try {
      const newId = await createMovingRequest({
        depart: depart.trim(), departEtage: departEtage.trim() || undefined, departLat: departPt?.lat ?? null, departLng: departPt?.lng ?? null,
        arrivee: arrivee.trim(), arriveeEtage: arriveeEtage.trim() || undefined, arriveeLat: arriveePt?.lat ?? null, arriveeLng: arriveePt?.lng ?? null,
        volume, dateSouhaitee: isoDate(dayOffset), creneau,
        manutentionnaires: manut,
        options: options.join(', ') || undefined,
        note: note.trim() || undefined,
      });
      // Libellé lisible du créneau (jamais l'identifiant interne « apres-midi », « demi-journee »…).
      const creneauLabel = (CRENEAUX.find((c) => c.id === creneau)?.nom ?? creneau).toLowerCase();
      Alert.alert(
        'Demande envoyée',
        `Taga a bien reçu ta demande de déménagement pour ${dayOffset <= 1 ? dayLabel(dayOffset).toLowerCase() : `le ${dayLabel(dayOffset)}`} (${creneauLabel}). Un conseiller te contacte avec un devis et une équipe.`,
        [{ text: 'OK', onPress: () => newId ? router.replace({ pathname: '/moving-detail', params: { id: newId } }) : router.replace('/(tabs)') }],
      );
    } catch {
      Alert.alert('Oups', "La demande n'a pas pu être envoyée. Réessaie.");
    } finally {
      setLoading(false);
    }
  };

  const inc = () => setManut((m) => Math.min(HOUR_MAX, m + 1));
  const dec = () => setManut((m) => Math.max(0, m - 1));
  const scrollRef = useRef<ScrollView>(null);
  const noteFocused = useRef(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      if (noteFocused.current) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    });
    return () => show.remove();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Déménagement" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <View style={st.hero}>
          <ServiceIcon name="demenagement" size={60} />
          <View style={{ flex: 1 }}>
            <Text style={st.heroTitle}>On déménage tes affaires</Text>
            <Text style={st.heroSub}>Véhicule + équipe. Devis gratuit.</Text>
          </View>
        </View>

        <Text style={st.label}>Adresse de départ</Text>
        <AddrField value={depart} onText={setDepart} pt={departPt} setPt={setDepartPt} placeholder="Tape une adresse ou utilise ta position" autoLocate />
        <TextInput style={[st.input, st.small]} value={departEtage} onChangeText={setDepartEtage} placeholder="Étage / ascenseur (ex : 2e, sans ascenseur)" placeholderTextColor={colors.inkMute} />

        <Text style={st.label}>Adresse d'arrivée</Text>
        <AddrField value={arrivee} onText={setArrivee} pt={arriveePt} setPt={setArriveePt} placeholder="Tape l'adresse d'arrivée" />
        <TextInput style={[st.input, st.small]} value={arriveeEtage} onChangeText={setArriveeEtage} placeholder="Étage / ascenseur (ex : 2e, sans ascenseur)" placeholderTextColor={colors.inkMute} />

        <Text style={st.label}>Volume</Text>
        {VOLUMES.map((v) => {
          const on = v.id === volume;
          return (
            <Pressable key={v.id} onPress={() => setVolume(v.id)} style={[st.opt, on && st.optOn]}>
              <View style={[st.radio, on && st.radioOn]}>{on && <View style={st.radioDot} />}</View>
              <View style={{ flex: 1 }}>
                <Text style={st.optName}>{v.nom}</Text>
                <Text style={st.optDesc}>{v.desc}</Text>
              </View>
            </Pressable>
          );
        })}

        <Text style={st.label}>Date souhaitée</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingVertical: 2 }}>
          {Array.from({ length: 8 }).map((_, i) => {
            const on = dayOffset === i;
            return (
              <Pressable key={i} onPress={() => setDayOffset(i)} style={[st.chip, on && st.chipOn]}>
                <Text style={[st.chipText, on && { color: colors.white }]}>{dayLabel(i)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={st.label}>Créneau</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {CRENEAUX.map((c) => {
            const on = c.id === creneau;
            return (
              <Pressable key={c.id} onPress={() => setCreneau(c.id)} style={[st.creneau, on && st.optOn]}>
                <Text style={[st.creneauNom, on && { color: colors.brandDeep }]}>{c.nom}</Text>
                <Text style={st.creneauSub}>{c.sub}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={st.label}>Personnes pour porter</Text>
        <View style={st.stepper}>
          <Pressable onPress={dec} disabled={manut === 0} style={[st.stepBtn, manut === 0 && { opacity: 0.5 }]}>
            <Ionicons name="remove" size={22} color={colors.ink} />
          </Pressable>
          <Text style={st.stepVal}>{manut === 0 ? 'Aucun' : `${manut} personne${manut > 1 ? 's' : ''}`}</Text>
          <Pressable onPress={inc} disabled={manut >= HOUR_MAX} style={[st.stepBtn, manut >= HOUR_MAX && { opacity: 0.5 }]}>
            <Ionicons name="add" size={22} color={colors.ink} />
          </Pressable>
        </View>

        <Text style={st.label}>Options</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {OPTIONS.map((o) => {
            const on = options.includes(o);
            return (
              <Pressable key={o} onPress={() => toggleOpt(o)} style={[st.tag, on && st.tagOn]}>
                <Text style={[st.tagText, on && { color: colors.white }]}>{o}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={st.label}>Précisions (facultatif)</Text>
        <TextInput style={[st.input, { height: 90, textAlignVertical: 'top', paddingTop: 12 }]} value={note} onChangeText={setNote} placeholder="Ex : frigo + machine à laver, piano, accès difficile…" placeholderTextColor={colors.inkMute} multiline onFocus={() => { noteFocused.current = true; setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200); }} onBlur={() => { noteFocused.current = false; }} />

        <View style={st.note}>
          <Ionicons name="information-circle" size={18} color={colors.brand} />
          <Text style={st.noteText}>Pas de paiement maintenant — devis d'abord.</Text>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      <CtaBar>
        <Btn label={pret ? 'Demander un devis' : 'Indique les adresses'} disabled={!pret} loading={loading} onPress={envoyer} />
      </CtaBar>
    </View>
  );
}

const st = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.brandTint, borderRadius: radius.lg, padding: 14, marginTop: 14, borderWidth: 1, borderColor: colors.brandSoft },
  heroTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  heroSub: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 3, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 22, marginBottom: 10 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, height: 52, paddingHorizontal: 16, fontSize: 15.5, fontWeight: '600', color: colors.ink },
  small: { height: 46, marginTop: 8, fontSize: 14 },
  addrRow: { flexDirection: 'row', alignItems: 'stretch' },
  addrInput: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderWidth: 1, borderRightWidth: 0, borderColor: colors.line, height: 52, paddingHorizontal: 16, fontSize: 15.5, fontWeight: '600', color: colors.ink },
  geoBtn: { width: 52, height: 52, borderTopRightRadius: radius.md, borderBottomRightRadius: radius.md, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  geoOk: { fontSize: 12, fontWeight: '700', color: colors.green },
  suggBox: { marginTop: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  suggRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  suggLabel: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  suggSub: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 1 },
  underRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 7 },
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mapLinkText: { fontSize: 13, fontWeight: '800', color: colors.brand },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 2, borderColor: colors.line, marginBottom: 10 },
  optOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.brand },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.brand },
  optName: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  optDesc: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  chip: { paddingHorizontal: 15, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 14, fontWeight: '800', color: colors.ink2 },
  creneau: { flexGrow: 1, flexBasis: '30%', minWidth: '30%', backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center', borderWidth: 2, borderColor: colors.line },
  creneauNom: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  creneauSub: { fontSize: 11.5, fontWeight: '700', color: colors.inkSoft, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.line, padding: 8 },
  stepBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  stepVal: { fontSize: 16, fontWeight: '800', color: colors.ink },
  tag: { paddingHorizontal: 14, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  tagOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  tagText: { fontSize: 13.5, fontWeight: '800', color: colors.ink2 },
  note: { flexDirection: 'row', gap: 10, marginTop: 20, backgroundColor: colors.brandTint, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.brandSoft },
  noteText: { flex: 1, fontSize: 12.5, color: colors.ink2, fontWeight: '600', lineHeight: 18 },
});
