import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { colors, radius, space } from '../theme';
import { Header, Btn, useToast } from '../components/ui';
import { getAddresses, saveAddress, deleteAddress } from '../lib/db';
import { searchPlaces, type GeoPlace } from '../lib/geo';
import { AdjustOnMap } from '../components/RideMap';
import { BAMAKO } from '../components/TripMap';

const raccourcis = [
  { label: 'Maison', icon: 'home' as const },
  { label: 'Travail', icon: 'briefcase' as const },
  { label: 'Autre', icon: 'location' as const },
];

export default function AddressForm() {
  const router = useRouter();
  const toast = useToast();
  // `select=1` → l'adresse est ajoutée depuis une commande : on l'utilise directement.
  const { id, select } = useLocalSearchParams<{ id?: string; select?: string }>();
  const pourCommande = select === '1' && !id;

  const [libelle, setLibelle] = useState('');
  const [detail, setDetail] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [parDefaut, setParDefaut] = useState(false);
  const [saving, setSaving] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [sugg, setSugg] = useState<GeoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const pickedRef = useRef(false); // évite de relancer la recherche juste après un choix/géoloc

  useEffect(() => {
    if (!id) return;
    getAddresses().then((list) => {
      const a = list.find((x) => x.id === id);
      if (!a) return;
      setLibelle(a.label);
      setDetail(a.detail);
      setLat(a.lat); setLng(a.lng);
      setParDefaut(a.is_default);
    }).catch(() => {});
  }, [id]);

  // Auto-complétion d'adresse (Photon, biaisé Bamako) avec anti-rebond.
  useEffect(() => {
    if (pickedRef.current) { pickedRef.current = false; return; }
    const q = detail.trim();
    if (q.length < 3) { setSugg([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try { const r = await searchPlaces(q); setSugg(r); } catch { setSugg([]); }
      setSearching(false);
    }, 350);
    return () => clearTimeout(t);
  }, [detail]);

  const choisirSugg = (p: GeoPlace) => {
    pickedRef.current = true;
    setDetail([p.label, p.sub].filter(Boolean).join(', '));
    setLat(p.point.latitude); setLng(p.point.longitude);
    setSugg([]);
  };

  // Géolocalisation directe : position actuelle → adresse (géocodage inverse).
  const geolocaliser = async () => {
    setGeoBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) { toast('Autorise la localisation pour utiliser ta position', { tone: 'error' }); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      pickedRef.current = true;
      setLat(pos.coords.latitude); setLng(pos.coords.longitude);
      try {
        const g = (await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }))[0];
        const label = g ? [g.name || g.street, g.district || g.city].filter(Boolean).join(', ') : '';
        setDetail(label || 'Ma position actuelle');
      } catch { setDetail('Ma position actuelle'); }
      setSugg([]);
      toast('Position détectée');
    } catch { toast('Localisation indisponible', { tone: 'error' }); }
    finally { setGeoBusy(false); }
  };

  const valide = libelle.trim().length > 0 && detail.trim().length > 0;

  const enregistrer = async () => {
    setSaving(true);
    try {
      // saveAddress remonte désormais une vraie erreur si la base refuse :
      // on n'affiche plus « Adresse enregistrée » quand rien n'a été enregistré.
      await saveAddress({
        id,
        label: libelle.trim(),
        detail: detail.trim(),
        lat,
        lng,
        // Ajoutée depuis une commande → devient l'adresse utilisée (sinon on respecte le choix).
        is_default: parDefaut || pourCommande,
      });
      toast('Adresse enregistrée');
      router.back();
    } catch (e: any) {
      toast(e?.message === 'Non connecté' ? 'Reconnecte-toi pour enregistrer ton adresse' : "Échec de l'enregistrement. Réessaie.", { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const supprimer = async () => {
    if (!id) return;
    try {
      await deleteAddress(id);
      toast('Adresse supprimée');
      router.back();
    } catch {
      toast('Échec de la suppression', { tone: 'error' });
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title={id ? "Modifier l'adresse" : 'Nouvelle adresse'} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 32 }}>
        <Text style={st.hint}>Raccourcis</Text>
        <View style={st.chips}>
          {raccourcis.map((r) => {
            const actif = libelle === r.label;
            return (
              <Pressable key={r.label} style={[st.chip, actif && st.chipOn]} onPress={() => setLibelle(r.label)}>
                <Ionicons name={r.icon} size={16} color={actif ? colors.white : colors.brand} />
                <Text style={[st.chipText, actif && st.chipTextOn]}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Field label="Libellé" value={libelle} onChange={setLibelle} placeholder="Maison, Travail…" />

        <View style={{ marginTop: 16 }}>
          <Text style={st.label}>Quartier / adresse</Text>
          <View style={st.addrRow}>
            <TextInput
              value={detail}
              onChangeText={(t) => { setDetail(t); if (lat != null) { setLat(null); setLng(null); } }}
              placeholder="Tape une adresse ou utilise ta position"
              placeholderTextColor={colors.inkMute}
              style={[st.input, { flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRightWidth: 0 }]}
            />
            <Pressable onPress={geolocaliser} disabled={geoBusy} style={st.geoBtn}>
              {geoBusy ? <ActivityIndicator color={colors.white} size="small" /> : <Ionicons name="locate" size={20} color={colors.white} />}
            </Pressable>
          </View>
          {lat != null ? (
            <Text style={st.geoOk}><Ionicons name="checkmark-circle" size={12} color={colors.green} /> Position enregistrée</Text>
          ) : null}

          {/* Placer / ajuster le point exact sur la carte */}
          <Pressable style={st.mapBtn} onPress={() => setMapOpen(true)}>
            <Ionicons name="map" size={18} color={colors.brand} />
            <Text style={st.mapBtnText}>{lat != null ? 'Ajuster le point sur la carte' : 'Placer le point sur la carte'}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.inkMute} />
          </Pressable>

          {/* Suggestions d'adresses */}
          {(searching || sugg.length > 0) && (
            <View style={st.suggBox}>
              {searching && sugg.length === 0 ? (
                <View style={st.suggLoading}><ActivityIndicator size="small" color={colors.inkMute} /></View>
              ) : sugg.map((p) => (
                <Pressable key={p.id} style={st.suggRow} onPress={() => choisirSugg(p)}>
                  <Ionicons name="location-outline" size={18} color={colors.inkSoft} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.suggLabel} numberOfLines={1}>{p.label}</Text>
                    {p.sub ? <Text style={st.suggSub} numberOfLines={1}>{p.sub}</Text> : null}
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <Pressable style={st.toggle} onPress={() => setParDefaut((v) => !v)}>
          <View style={[st.checkbox, parDefaut && st.checkboxOn]}>
            {parDefaut ? <Ionicons name="checkmark" size={16} color={colors.white} /> : null}
          </View>
          <Text style={st.toggleText}>Définir par défaut</Text>
        </Pressable>

        <Btn label="Enregistrer" onPress={enregistrer} disabled={!valide} loading={saving} style={{ marginTop: 24 }} />

        {id ? (
          <Btn label="Supprimer" variant="ghost" onPress={supprimer} style={{ marginTop: 12 }} />
        ) : null}
      </ScrollView>
      </KeyboardAvoidingView>

      <AdjustOnMap
        open={mapOpen}
        initial={lat != null && lng != null ? { latitude: lat, longitude: lng } : BAMAKO.aci2000}
        title="Point de livraison"
        onClose={() => setMapOpen(false)}
        onConfirm={(pt, label) => {
          pickedRef.current = true;
          setLat(pt.latitude); setLng(pt.longitude);
          if (label && (!detail.trim() || lat == null)) setDetail(label);
          setSugg([]);
          setMapOpen(false);
          toast('Point de livraison enregistré');
        }}
      />
    </View>
  );
}

function Field({ label, value, onChange, placeholder, keyboard }: { label: string; value: string; onChange: (s: string) => void; placeholder?: string; keyboard?: any }) {
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={st.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} keyboardType={keyboard} style={st.input} placeholderTextColor={colors.inkMute} />
    </View>
  );
}

const st = StyleSheet.create({
  hint: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, marginTop: 16, marginBottom: 10 },
  chips: { flexDirection: 'row', gap: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 14, height: 42 },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 14, fontWeight: '800', color: colors.ink },
  chipTextOn: { color: colors.white },
  label: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, marginBottom: 8 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 16, height: 52, fontSize: 16, fontWeight: '700', color: colors.ink, borderWidth: 1, borderColor: colors.line },
  addrRow: { flexDirection: 'row', alignItems: 'stretch' },
  geoBtn: { width: 52, height: 52, borderTopRightRadius: radius.md, borderBottomRightRadius: radius.md, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  geoOk: { fontSize: 12, fontWeight: '700', color: colors.green, marginTop: 6 },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, height: 50, borderWidth: 1, borderColor: colors.line },
  mapBtnText: { flex: 1, fontSize: 14.5, fontWeight: '800', color: colors.ink },
  suggBox: { marginTop: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  suggLoading: { padding: 16, alignItems: 'center' },
  suggRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.line },
  suggLabel: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  suggSub: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 1 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
  checkbox: { width: 26, height: 26, borderRadius: 8, borderWidth: 1.5, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  checkboxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  toggleText: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
});
