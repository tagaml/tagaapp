import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../../theme';
import { Avatar, Row, Card } from '../../components/ui';
import { useAuth } from '../../components/auth';
import Constants from 'expo-constants';
import { getDefaultAddress, getDefaultPayment, getConversations, deleteAccount, getWalletCredit, getMyPhoto, getMyPassengerRating, type PassengerRating } from '../../lib/db';
import { fcfa } from '../../data/mock';

function initiales(prenom: string, nom: string): string {
  const a = prenom.trim()[0] ?? '';
  const b = nom.trim()[0] ?? '';
  return (a + b).toUpperCase() || '?';
}

/** Note à la française : une décimale, virgule décimale (4,8 — jamais 4.8). */
function fmtNote(n: number): string {
  return n.toFixed(1).replace('.', ',');
}

export default function Compte() {
  const router = useRouter();
  const { user: authUser, signOut } = useAuth();
  const [adresseVal, setAdresseVal] = useState<string | undefined>(undefined);
  const [paiementVal, setPaiementVal] = useState<string | undefined>(undefined);
  const [nonLus, setNonLus] = useState(0);
  const [credit, setCredit] = useState(0);
  const [photo, setPhoto] = useState<string | null>(null);
  // Ma note de passager : UNIQUEMENT la moyenne agrégée (jamais le détail course par course,
  // jamais qui a noté). `moyenne === null` = pas encore de note affichable — on n'invente rien.
  const [maNote, setMaNote] = useState<PassengerRating>({ moyenne: null, nb: 0 });

  useFocusEffect(
    useCallback(() => {
      let actif = true;
      (async () => {
        try {
          const [adr, pay, convos, cred, ph, note] = await Promise.all([
            getDefaultAddress(),
            getDefaultPayment(),
            getConversations(),
            getWalletCredit(),
            getMyPhoto(),
            getMyPassengerRating(),
          ]);
          if (!actif) return;
          setAdresseVal(adr?.label ?? 'Aucune');
          setPaiementVal(pay?.label ?? 'Aucun');
          setNonLus(convos.reduce((s, c) => s + c.nonLus, 0));
          setCredit(cred);
          setPhoto(ph);
          setMaNote(note);
        } catch {
          /* silencieux */
        }
      })();
      return () => { actif = false; };
    }, [])
  );

  const prenom = authUser?.prenom ?? '';
  const nom = authUser?.nom ?? '';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
        <Text style={st.title}>Compte</Text>

        {/* Profil */}
        <Pressable style={st.profile} onPress={() => router.push('/profile')}>
          <Avatar text={initiales(prenom, nom)} size={56} tone="ink" uri={photo ?? undefined} />
          <View style={{ flex: 1 }}>
            <Text style={st.name}>{prenom} {nom}</Text>
            {/* Note du passager : moyenne agrégée uniquement. Sous le seuil (moins de 3 notes),
                on n'affiche NI « 0 » NI une note inventée — juste un état d'attente neutre. */}
            <View style={st.noteRow}>
              {maNote.moyenne != null ? (
                <>
                  <Ionicons name="star" size={13} color={colors.gold} />
                  <Text style={st.noteVal}>{fmtNote(maNote.moyenne)}</Text>
                  <Text style={st.note}>({maNote.nb} avis)</Text>
                </>
              ) : (
                <Text style={st.note}>{maNote.nb > 0 ? 'Note bientôt disponible' : 'Pas encore de note'}</Text>
              )}
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.inkMute} />
        </Pressable>

        {/* Devenir chauffeur (app séparée) */}
        <Pressable
          style={st.driver}
          onPress={() => {
            // Lien vers l'app « Taga Chauffeur » (App Store iOS / Play Store Android).
            const url = Platform.OS === 'ios'
              ? 'https://apps.apple.com/app/id6782490137'
              : 'https://play.google.com/store/apps/details?id=ml.taga.chauffeur';
            Linking.openURL(url).catch(() => Alert.alert(
              'Taga Chauffeur',
              "Recherche « Taga Chauffeur » sur l'App Store / Play Store pour l'installer et recevoir des courses.",
            ));
          }}
        >
          <View style={st.driverIcon}><Ionicons name="car-sport" size={24} color={colors.white} /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.driverTitle}>Tu es chauffeur ?</Text>
            <Text style={st.driverSub}>Télécharge l'app Taga Chauffeur</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.white} />
        </Pressable>

        {/* Parrainage */}
        <Pressable style={st.referral} onPress={() => router.push('/referral')}>
          <View style={st.giftIcon}><Ionicons name="gift" size={24} color={colors.white} /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.refTitle}>Parraine un ami</Text>
            {/* Tutoiement : jamais de « vous » dans l'app. */}
            <Text style={st.refSub}>2 000 F pour toi, 2 000 F pour lui à sa 1ʳᵉ commande</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.brandDeep} />
        </Pressable>

        {credit > 0 && (
          <View style={st.credit}>
            <View style={st.creditIcon}><Ionicons name="wallet" size={22} color={colors.white} /></View>
            <View style={{ flex: 1 }}>
              <Text style={st.creditTitle}>Crédit Taga</Text>
              <Text style={st.creditSub}>Utilisable sur tes prochaines commandes</Text>
            </View>
            <Text style={st.creditVal}>{fcfa(credit)}</Text>
          </View>
        )}

        <Text style={st.group}>Préférences</Text>
        <Card style={st.section}>
          <Row icon="location" label="Mes adresses" value={adresseVal} onPress={() => router.push('/addresses')} />
          <Row icon="card" label="Moyens de paiement" value={paiementVal} onPress={() => router.push('/payments')} />
          {/* Pas de valeur figée « Activées » : l'état réel se règle dans l'écran dédié. */}
          <Row icon="notifications" label="Notifications" onPress={() => router.push('/notification-settings')} />
          <Row icon="language" label="Langue" value="Français" onPress={() => router.push('/langue')} last />
        </Card>

        <Text style={st.group}>Assistance</Text>
        <Card style={st.section}>
          {/* Intitulés alignés sur les écrans réellement ouverts (Messages / Activité). */}
          <Row icon="chatbubbles" label="Messages" badge={nonLus > 0 ? nonLus : undefined} onPress={() => router.push('/messages')} />
          <Row icon="bag-handle" label="Mon activité" onPress={() => router.push('/(tabs)/activite')} />
          <Row icon="shield-checkmark" label="Aide & sécurité" onPress={() => router.push('/help')} last />
        </Card>

        <Text style={st.group}>Légal</Text>
        <Card style={st.section}>
          <Row icon="document-text" label="Conditions & confidentialité" onPress={() => router.push('/conditions')} last />
        </Card>

        <Pressable
          style={st.logout}
          onPress={() =>
            Alert.alert('Déconnexion', 'Tu veux vraiment te déconnecter ?', [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Déconnexion', style: 'destructive', onPress: () => { signOut(); } },
            ])
          }
        >
          <Ionicons name="log-out-outline" size={20} color={colors.brandDeep} />
          <Text style={st.logoutText}>Déconnexion</Text>
        </Pressable>

        <Pressable
          style={st.deleteBtn}
          onPress={() =>
            Alert.alert(
              'Supprimer mon compte',
              'Cette action est définitive : ton compte et toutes tes données (courses, commandes, adresses, paiements) seront supprimés. Continuer ?',
              [
                { text: 'Annuler', style: 'cancel' },
                {
                  text: 'Supprimer',
                  style: 'destructive',
                  onPress: () =>
                    Alert.alert('Dernière confirmation', 'Es-tu sûr ? On ne pourra pas récupérer ton compte.', [
                      { text: 'Annuler', style: 'cancel' },
                      {
                        text: 'Oui, supprimer',
                        style: 'destructive',
                        onPress: async () => {
                          const res = await deleteAccount();
                          if (res.ok) { signOut(); }
                          else { Alert.alert('Échec', 'La suppression a échoué. Réessaie ou contacte le support.'); }
                        },
                      },
                    ]),
                },
              ],
            )
          }
        >
          <Ionicons name="trash-outline" size={18} color={colors.inkSoft} />
          <Text style={st.deleteText}>Supprimer mon compte</Text>
        </Pressable>

        <Text style={st.version}>Taga · version {Constants.expoConfig?.version ?? ''}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.ink, paddingHorizontal: space.lg, paddingTop: 10 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: space.lg, marginTop: 16, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  name: { fontSize: 18, fontWeight: '800', color: colors.ink },
  note: { fontSize: 13.5, fontWeight: '700', color: colors.inkSoft },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  noteVal: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  noteHint: { fontSize: 11.5, fontWeight: '600', color: colors.inkMute, marginTop: 3 },
  driver: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: space.lg, marginTop: 16, backgroundColor: colors.ink, borderRadius: radius.lg, padding: 16, ...shadow.pop },
  driverIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  driverTitle: { fontSize: 16, fontWeight: '800', color: colors.white },
  driverSub: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  referral: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: space.lg, marginTop: 12, backgroundColor: colors.brandSoft, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.brandSoft },
  giftIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  refTitle: { fontSize: 16, fontWeight: '800', color: colors.brandDeep },
  refSub: { fontSize: 13, fontWeight: '600', color: colors.brandDeep, marginTop: 2, opacity: 0.85 },
  credit: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: space.lg, marginTop: 12, backgroundColor: colors.green, borderRadius: radius.lg, padding: 16, ...shadow.card },
  creditIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  creditTitle: { fontSize: 16, fontWeight: '800', color: colors.white },
  creditSub: { fontSize: 12.5, fontWeight: '600', color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  creditVal: { fontSize: 18, fontWeight: '800', color: colors.white },
  group: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: space.lg, marginTop: 24, marginBottom: 10 },
  section: { marginHorizontal: space.lg, padding: 0, overflow: 'hidden' },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: space.lg, marginTop: 24, height: 54, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  logoutText: { fontSize: 15.5, fontWeight: '800', color: colors.brandDeep },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginHorizontal: space.lg, marginTop: 12, height: 46 },
  deleteText: { fontSize: 14, fontWeight: '700', color: colors.inkSoft },
  version: { textAlign: 'center', fontSize: 12.5, color: colors.inkMute, fontWeight: '600', marginTop: 18 },
});
