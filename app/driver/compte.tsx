import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useLiveRefresh, srcVehicule, srcKyc, srcAbonnement } from '../../lib/live';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors, radius, space } from '../../theme';
import { Btn, Card, Avatar, useToast } from '../../components/ui';
import { useAuth } from '../../components/auth';
import { getDriverProfile, getDriverStats, getMyPhoto, uploadDriverPhoto, getMyMovings, type DriverProfile, type DriverStats } from '../../lib/db';
import { IS_DRIVER_APP } from '../../lib/appVariant';

type Lien = { icon: keyof typeof Ionicons.glyphMap; label: string; href: string };

const LIENS: Lien[] = [
  { icon: 'notifications-outline', label: 'Notifications & messages', href: '/driver/notifications' },
  { icon: 'card-outline', label: 'Mon abonnement', href: '/driver/abonnement' },
  { icon: 'car-outline', label: 'Mon véhicule', href: '/driver/vehicule' },
  { icon: 'document-text-outline', label: 'Documents & permis', href: '/driver/documents' },
  { icon: 'time-outline', label: 'Mes courses', href: '/driver/trajets' },
  { icon: 'star-outline', label: 'Évaluations & avis', href: '/driver/ratings' },
  { icon: 'location-outline', label: 'Zones préférées', href: '/driver/zones' },
  { icon: 'help-circle-outline', label: 'Aide & support', href: '/driver/help' },
];

export default function Compte() {
  const router = useRouter();
  const toast = useToast();
  const { user, signOut } = useAuth();
  // Nom réel du chauffeur — pas de nom de démo. Si le profil est vide, on retombe
  // sur le numéro de téléphone, puis sur un libellé neutre.
  const fullName = [user?.prenom, user?.nom].filter(Boolean).join(' ').trim();
  const nom = fullName || user?.phone || 'Chauffeur';
  const initiales = (fullName ? fullName.split(' ').map((p) => p[0]).join('') : 'C').slice(0, 2).toUpperCase();

  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busyPhoto, setBusyPhoto] = useState(false);
  const [erreur, setErreur] = useState(false); // profil non chargé ≠ profil vide
  // « Mes déménagements » n'apparaît que si le chauffeur a réellement des déménagements (camion) :
  // c'est là qu'il les termine / note le client. Sinon on n'encombre pas son menu.
  const [hasMovings, setHasMovings] = useState(false);

  const charger = useCallback(async () => {
    try {
      const [p, s, ph] = await Promise.all([getDriverProfile(), getDriverStats(), getMyPhoto()]);
      setProfile(p); setStats(s); setPhoto(ph); setErreur(false);
      getMyMovings().then((m) => setHasMovings(m.length > 0)).catch(() => {});
    } catch {
      // Sans ce drapeau, une coupure réseau afficherait « Véhicule non renseigné »
      // à un chauffeur qui a pourtant bien renseigné son véhicule.
      setErreur(true);
    }
  }, []);

  // Temps réel : véhicule, dossier, abonnement, note — l'écran suit ce que fait l'admin,
  // au lieu de rester figé sur l'état du jour où il a été ouvert.
  useLiveRefresh(charger, (uid) => [...srcVehicule(uid), ...srcKyc(uid), ...srcAbonnement(uid)]);

  // Déconnexion = action lourde (le chauffeur sort du dispatch) → confirmation obligatoire.
  const deconnexion = () => {
    Alert.alert('Se déconnecter ?', 'Tu ne recevras plus aucune course tant que tu ne te reconnectes pas.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: () => { Promise.resolve(signOut()).catch(() => toast('Déconnexion impossible — réessaie.')); } },
    ]);
  };

  const changePhoto = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.5, base64: true, mediaTypes: 'images', allowsEditing: true, aspect: [1, 1] });
      if (res.canceled || !res.assets?.[0]?.base64) return;
      setBusyPhoto(true);
      const url = await uploadDriverPhoto(res.assets[0].base64);
      setPhoto(url);
      toast('Photo mise à jour');
    } catch {
      toast('Échec de l\'envoi de la photo');
    } finally {
      setBusyPhoto(false);
    }
  };
  // En cas d'échec de chargement, on n'affirme rien (« — ») plutôt que d'affirmer du faux.
  const ratingLabel = erreur
    ? '—'
    : stats && stats.coursesTotal > 0
      ? `${stats.nbNotes > 0 ? stats.note : '—'} · ${stats.coursesTotal} course${stats.coursesTotal > 1 ? 's' : ''}`
      : 'Nouveau chauffeur';

  const vehiculeLabel = profile?.vehicule
    ? [profile.vehicule, profile.couleur].filter(Boolean).join(' · ')
    : erreur
      ? 'Profil indisponible · vérifie ta connexion'
      : 'Véhicule non renseigné';
  const plaqueLabel = profile?.plaque || (erreur ? '—' : 'Ajoute ta plaque');

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
        <Text style={st.h1}>Compte</Text>

        <Card style={{ marginTop: 14, alignItems: 'center', paddingVertical: 24 }}>
          <Pressable onPress={changePhoto} disabled={busyPhoto}>
            <Avatar text={initiales} size={72} tone="ink" uri={photo ?? undefined} />
            <View style={st.camBadge}>
              {busyPhoto ? <ActivityIndicator color={colors.white} size="small" /> : <Ionicons name="camera" size={14} color={colors.white} />}
            </View>
          </Pressable>
          <View style={st.nameRow}>
            <Text style={st.name}>{nom}</Text>
          </View>
          <View style={st.starRow}>
            <Ionicons name="star" size={15} color={colors.gold} />
            <Text style={st.rating}>{ratingLabel}</Text>
          </View>
          <View style={st.vehicule}>
            <Text style={st.vehiculeText}>{vehiculeLabel}</Text>
            <Text style={st.plaque}>{plaqueLabel}</Text>
          </View>
        </Card>

        <Card style={{ marginTop: 16, padding: 0 }}>
          {(hasMovings
            ? [...LIENS.slice(0, 5), { icon: 'bus-outline' as const, label: 'Mes déménagements', href: '/driver/demenagements' }, ...LIENS.slice(5)]
            : LIENS
          ).map((l, i, arr) => (
            <Pressable
              key={l.href}
              onPress={() => router.push({ pathname: l.href as any, params: { from: 'compte' } })}
              style={({ pressed }) => [st.row, i < arr.length - 1 && st.rowBorder, pressed && { backgroundColor: colors.surface2 }]}
            >
              <View style={st.rowIcon}>
                <Ionicons name={l.icon} size={19} color={colors.ink2} />
              </View>
              <Text style={st.rowLabel}>{l.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.inkMute} />
            </Pressable>
          ))}
        </Card>

        {!IS_DRIVER_APP && (
          <Btn label="Revenir en mode client" variant="dark" onPress={() => router.replace('/(tabs)/compte')} style={{ marginTop: 20 }} />
        )}

        <Pressable onPress={deconnexion} style={st.logout}>
          <Ionicons name="log-out-outline" size={19} color={colors.brandDeep} />
          <Text style={st.logoutText}>Se déconnecter</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  h1: { fontSize: 26, fontWeight: '800', color: colors.ink, marginTop: 12 },
  camBadge: { position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  name: { fontSize: 20, fontWeight: '800', color: colors.ink },
  pro: { backgroundColor: colors.ink, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8 },
  proText: { fontSize: 11, fontWeight: '800', color: colors.white, letterSpacing: 0.5 },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  rating: { fontSize: 14, fontWeight: '700', color: colors.inkSoft },
  vehicule: { alignItems: 'center', marginTop: 14, backgroundColor: colors.surface2, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.md },
  vehiculeText: { fontSize: 14, fontWeight: '800', color: colors.ink2 },
  plaque: { fontSize: 13, fontWeight: '700', color: colors.inkSoft, marginTop: 3 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 16, gap: 13 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  rowIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontSize: 15.5, fontWeight: '700', color: colors.ink },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 22, paddingVertical: 14 },
  logoutText: { fontSize: 15.5, fontWeight: '800', color: colors.brandDeep },
});
