import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useLiveRefresh, srcKyc, srcVehicule } from '../../lib/live';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors, radius, shadow, space } from '../../theme';
import { Btn, useToast } from '../../components/ui';
import {
  getKyc,
  uploadKycImage,
  getKycSignedUrl,
  submitKyc,
  getDriverProfile,
  type DriverKyc,
  type KycField,
  type KycStatut,
} from '../../lib/db';

// Pièces obligatoires par type de véhicule. Moto : pas de carte grise ni assurance.
const DOCS_MOTO: KycField[] = ['permis', 'identite', 'vehicule'];

type DocDef = { field: KycField; titre: string; sous: string; icon: keyof typeof Ionicons.glyphMap };

const DOCS: DocDef[] = [
  { field: 'permis', titre: 'Permis de conduire', sous: 'Recto, bien lisible', icon: 'card-outline' },
  { field: 'identite', titre: "Pièce d'identité", sous: 'CNI, carte NINA, acte de naissance ou passeport', icon: 'person-outline' },
  { field: 'carte_grise', titre: 'Carte grise', sous: 'Du véhicule utilisé', icon: 'document-text-outline' },
  { field: 'assurance', titre: 'Assurance', sous: 'En cours de validité', icon: 'shield-checkmark-outline' },
  { field: 'vehicule', titre: 'Photo du véhicule', sous: 'Plaque bien visible', icon: 'car-outline' },
];

const STATUT_UI: Record<KycStatut, { label: string; sub: string; color: string; soft: string; icon: keyof typeof Ionicons.glyphMap }> = {
  en_attente: { label: 'Documents requis', sub: 'Ajoute tes pièces puis envoie ton dossier.', color: colors.brandDeep, soft: colors.brandTint, icon: 'alert-circle' },
  en_validation: { label: 'En cours de validation', sub: 'Ton dossier est en cours de vérification.', color: colors.gold, soft: colors.goldSoft, icon: 'time' },
  valide: { label: 'Compte vérifié', sub: 'Tu peux passer en ligne et recevoir des courses.', color: colors.green, soft: colors.greenSoft, icon: 'checkmark-circle' },
  refuse: { label: 'Dossier refusé', sub: 'Un document pose problème. Renvoie tes pièces.', color: colors.brandDeep, soft: colors.brandTint, icon: 'close-circle' },
};

export default function Documents() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  // Le retour ramène TOUJOURS à l'écran d'où l'on vient (inscription, compte) — jamais à l'accueil par surprise.
  const goBack = () => router.replace(
    from === 'compte' ? '/driver/compte' : from === 'onboarding' ? '/driver/onboarding' : '/driver',
  );
  const toast = useToast();
  const insets = useSafeAreaInsets();

  const [kyc, setKyc] = useState<DriverKyc | null>(null);
  const [vehType, setVehType] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<KycField | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Liste des pièces réellement exigées pour ce chauffeur (selon son véhicule).
  // `vehType` est relu à CHAQUE affichage de l'écran : si le chauffeur revient en arrière et change de
  // véhicule (voiture → moto), il voyait sinon les documents de l'ancien véhicule (carte grise, assurance).
  const docs = vehType === 'moto' ? DOCS.filter((d) => DOCS_MOTO.includes(d.field)) : DOCS;
  const vehLabel = vehType === 'moto' ? 'Moto' : vehType === 'tricycle' ? 'Tricycle' : vehType === 'camion' ? 'Camion' : 'Voiture';

  const charger = async () => {
    try {
      const [k, prof] = await Promise.all([getKyc(), getDriverProfile()]);
      setKyc(k);
      setVehType(prof?.type ?? null);
      if (k) {
        const urls: Record<string, string> = {};
        await Promise.all(
          DOCS.map(async (d) => {
            const path = (k as any)[`${d.field}_path`] as string | null;
            if (path) {
              const u = await getKycSignedUrl(path);
              if (u) urls[d.field] = u;
            }
          }),
        );
        // On garde les aperçus locaux déjà affichés en priorité.
        setPreviews((prev) => ({ ...urls, ...prev }));
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  // Temps réel : quand l'admin VALIDE ou REFUSE le dossier, le chauffeur le voit à l'instant —
  // sans fermer/rouvrir l'application. Recharge aussi au retour sur l'écran et au réveil de l'app
  // (c'est ce qui manquait : le statut restait figé sur « en attente »).
  useLiveRefresh(charger, (uid) => [...srcKyc(uid), ...srcVehicule(uid)]);

  const choisirSource = (field: KycField) =>
    Alert.alert('Ajouter le document', 'Comment veux-tu ajouter cette pièce ?', [
      { text: 'Prendre une photo', onPress: () => lancer(field, 'camera') },
      { text: 'Choisir dans la galerie', onPress: () => lancer(field, 'galerie') },
      { text: 'Annuler', style: 'cancel' },
    ]);

  const lancer = async (field: KycField, source: 'camera' | 'galerie') => {
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { toast('Autorise l\'appareil photo pour continuer'); return; }
      }
      const opts: ImagePicker.ImagePickerOptions = { quality: 0.5, base64: true, mediaTypes: 'images' };
      const res = source === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]?.base64) return;

      const asset = res.assets[0];
      setBusy(field);
      setPreviews((p) => ({ ...p, [field]: asset.uri })); // aperçu immédiat (optimiste)
      await uploadKycImage(field, asset.base64!);
      await charger();
      toast('Document ajouté');
    } catch {
      // Échec de l'envoi : on retire l'aperçu optimiste pour que la case redevienne vide.
      setPreviews((p) => {
        const next = { ...p };
        delete next[field];
        return next;
      });
      toast('Échec de l\'envoi. Réessaie.');
    } finally {
      setBusy(null);
    }
  };

  const has = (field: KycField) => !!kyc && !!(kyc as any)[`${field}_path`];
  const nbFournis = docs.filter((d) => has(d.field)).length;
  const tousFournis = nbFournis === docs.length;
  const statut: KycStatut = kyc?.statut ?? 'en_attente';
  const ui = STATUT_UI[statut];

  const envoyer = async () => {
    setSubmitting(true);
    try {
      await submitKyc();
      setKyc((k) => (k ? { ...k, statut: 'en_validation' } : k));
      toast('Dossier envoyé · en cours de validation');
    } catch {
      toast('Échec de l\'envoi du dossier');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={st.head}>
        <Pressable onPress={goBack} hitSlop={10} style={st.back}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Text style={st.headTitle}>{loading ? 'Mes documents' : `Mes documents · ${vehLabel}`}</Text>
        <View style={{ width: 42 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + 120 }} showsVerticalScrollIndicator={false}>
          <View style={[st.statut, { backgroundColor: ui.soft, borderColor: ui.color }]}>
            <View style={[st.statutIcon, { backgroundColor: ui.color }]}>
              <Ionicons name={ui.icon} size={22} color={colors.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[st.statutTitle, { color: ui.color }]}>{ui.label}</Text>
              <Text style={st.statutSub}>{ui.sub}</Text>
            </View>
          </View>

          <View style={st.progress}>
            <Text style={st.progressText}>{nbFournis}/{docs.length} documents ajoutés</Text>
          </View>

          {docs.map((d) => {
            const ok = has(d.field);
            const prev = previews[d.field];
            const loadingDoc = busy === d.field;
            return (
              <Pressable key={d.field} style={st.doc} onPress={() => statut !== 'valide' && choisirSource(d.field)} disabled={statut === 'valide'}>
                <View style={st.thumb}>
                  {prev ? (
                    <Image source={{ uri: prev }} style={st.thumbImg} />
                  ) : (
                    <Ionicons name={d.icon} size={22} color={colors.inkSoft} />
                  )}
                  {loadingDoc && <View style={st.thumbLoad}><ActivityIndicator color={colors.white} /></View>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.docTitre}>{d.titre}</Text>
                  <Text style={st.docSous}>{d.sous}</Text>
                </View>
                {ok ? (
                  <View style={st.okBadge}><Ionicons name="checkmark" size={14} color={colors.white} /></View>
                ) : (
                  <View style={st.addBadge}><Ionicons name="add" size={18} color={colors.brand} /></View>
                )}
              </Pressable>
            );
          })}

          <View style={st.info}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.inkSoft} />
            <Text style={st.infoText}>Documents privés et sécurisés. Seul Taga peut les consulter.</Text>
          </View>
        </ScrollView>
      )}

      {!loading && statut !== 'valide' && (
        <View style={[st.bottom, { paddingBottom: insets.bottom + 14 }]}>
          <Btn
            label={statut === 'en_validation' ? 'En cours de validation…' : tousFournis ? 'Envoyer mon dossier' : `Ajoute ${docs.length - nbFournis} document${docs.length - nbFournis > 1 ? 's' : ''}`}
            onPress={envoyer}
            loading={submitting}
            disabled={!tousFournis || statut === 'en_validation'}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: 8 },
  back: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  headTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  statut: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, borderRadius: radius.lg, borderWidth: 1, marginTop: 10 },
  statutIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  statutTitle: { fontSize: 16, fontWeight: '800' },
  statutSub: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 3, lineHeight: 18 },
  progress: { marginTop: 20, marginBottom: 6 },
  progressText: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5 },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line, marginTop: 10 },
  thumb: { width: 52, height: 52, borderRadius: 12, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImg: { width: '100%', height: '100%' },
  thumbLoad: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(21,17,14,0.45)', alignItems: 'center', justifyContent: 'center' },
  docTitre: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  docSous: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 3 },
  okBadge: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  addBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  info: { flexDirection: 'row', gap: 9, marginTop: 18, paddingHorizontal: 2 },
  infoText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, lineHeight: 18 },
  demoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 14 },
  demo: { flex: 1, fontSize: 12.5, fontWeight: '700', color: colors.gold, lineHeight: 18 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingTop: 12, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.line },
});
