import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useLiveRefresh, srcKyc, srcAbonnement, srcVehicule } from '../../lib/live';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../../theme';
import { getDriverProfile, getKyc, getActiveSubscription } from '../../lib/db';

type StepState = { done: boolean; pending: boolean; refused: boolean; label: string };

export default function DriverOnboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState(false); // échec de chargement (connexion) → on l'indique au lieu de tout afficher « À compléter »
  const [veh, setVeh] = useState<StepState>({ done: false, pending: false, refused: false, label: 'À compléter' });
  const [docs, setDocs] = useState<StepState>({ done: false, pending: false, refused: false, label: 'À compléter' });
  const [abo, setAbo] = useState<StepState>({ done: false, pending: false, refused: false, label: 'À compléter' });
  const [camion, setCamion] = useState(false); // camion = commission, pas d'abonnement

  const charger = useCallback(async () => {
    setErreur(false);
    try {
      const [p, k, a] = await Promise.all([getDriverProfile(), getKyc(), getActiveSubscription()]);
      // 1) Véhicule
      const vehOk = !!(p && ((p.vehicle_types && p.vehicle_types.length) || p.vehicule));
      setVeh({ done: vehOk, pending: false, refused: false, label: vehOk ? 'Renseigné' : 'À compléter' });
      // Camion : modèle commission → pas d'abonnement exigé pour rouler.
      const isCamion = (p?.type || p?.vehicle_types?.[0]) === 'camion';
      setCamion(isCamion);
      // 2) Documents
      const submitted = !!(k && (k.submitted_at || k.permis_path || k.identite_path));
      const valide = k?.statut === 'valide';
      const refuse = k?.statut === 'refuse';
      setDocs({
        done: valide, pending: submitted && !valide && !refuse, refused: refuse,
        label: valide ? 'Validé par Taga' : refuse ? 'Refusé — à corriger' : submitted ? 'En attente de validation' : 'À compléter',
      });
      // 3) Abonnement — camion : non requis (modèle commission), l'étape est donc validée d'office.
      const aboOk = isCamion || !!a;
      setAbo({ done: aboOk, pending: false, refused: false, label: isCamion ? 'Non requis · commission' : a ? 'Actif' : 'À compléter (paiement)' });
    } catch { setErreur(true); } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); charger(); }, [charger]));

  // Temps réel : validation des documents, activation de l'abonnement, changement de véhicule
  // approuvé — les 3 étapes de l'inscription se cochent toutes seules dès que l'admin agit.
  useLiveRefresh(charger, (uid) => [...srcKyc(uid), ...srcAbonnement(uid), ...srcVehicule(uid)]);

  const ready = veh.done && docs.done && abo.done;
  const doneCount = [veh.done, docs.done, abo.done].filter(Boolean).length;

  const Step = ({ n, title, desc, state, route }: { n: number; title: string; desc: string; state: StepState; route: string }) => {
    const tone = state.done ? colors.green : state.refused ? '#D8261C' : state.pending ? '#E0A82E' : colors.brand;
    return (
      // `from: 'onboarding'` : le retour de l'étape doit revenir ICI (parcours d'inscription),
      // et surtout pas éjecter le chauffeur vers l'accueil au milieu de son inscription.
      <Pressable style={st.step} onPress={() => router.push({ pathname: route as any, params: { from: 'onboarding' } })}>
        <View style={[st.stepNum, { backgroundColor: state.done ? colors.green : colors.ink }]}>
          {state.done ? <Ionicons name="checkmark" size={18} color="#fff" /> : <Text style={st.stepNumTxt}>{n}</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.stepTitle}>{title}</Text>
          <Text style={st.stepDesc}>{desc}</Text>
          <Text style={[st.stepState, { color: tone }]}>{state.label}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.inkMute} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={st.head}>
        <Pressable onPress={() => router.replace('/driver')} hitSlop={10} style={st.back}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Text style={st.headTitle}>Devenir chauffeur Taga</Text>
        <View style={{ width: 42 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false}>
          <Text style={st.intro}>{ready ? 'Tout est prêt ! Tu peux passer en ligne et recevoir des courses.' : 'Termine ces étapes pour pouvoir rouler. Taga valide ton dossier ensuite.'}</Text>

          {erreur && (
            <View style={st.errBox}>
              <Ionicons name="cloud-offline-outline" size={18} color="#D8261C" />
              <Text style={st.errTxt}>Impossible de charger ta progression. Vérifie ta connexion — les étapes ci-dessous ne sont peut-être pas à jour.</Text>
              <Pressable style={st.retry} onPress={() => { setLoading(true); charger(); }} hitSlop={8}>
                <Text style={st.retryTxt}>Réessayer</Text>
              </Pressable>
            </View>
          )}

          {/* Progression */}
          <View style={st.progressRow}>
            <View style={st.progressTrack}><View style={[st.progressFill, { width: `${(doneCount / 3) * 100}%` }]} /></View>
            <Text style={st.progressTxt}>{doneCount}/3</Text>
          </View>

          <Step n={1} title="Mon véhicule" desc="Type (voiture, moto, tricycle, camion) et gamme (Eco / Fresh / SUV)" state={veh} route="/driver/vehicule" />
          <Step n={2} title="Mes documents" desc="Permis, pièce d'identité, carte grise, assurance" state={docs} route="/driver/documents" />
          <Step n={3} title={camion ? 'Commission camion' : 'Mon abonnement'} desc={camion ? 'Aucun abonnement : Taga prélève une commission par course' : 'Choisis un forfait — paiement Orange Money'} state={abo} route="/driver/abonnement" />

          {ready ? (
            <Pressable style={st.ready} onPress={() => router.replace('/driver')}>
              <Ionicons name="rocket" size={20} color="#fff" />
              <Text style={st.readyTxt}>C'est parti — aller à l'accueil</Text>
            </Pressable>
          ) : (
            <View style={st.note}>
              <Ionicons name="information-circle-outline" size={18} color={colors.inkSoft} />
              <Text style={st.noteTxt}>Taga valide ton dossier après envoi. Tu es notifié dès que tu peux rouler.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: 8 },
  back: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  headTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  intro: { fontSize: 14.5, fontWeight: '600', color: colors.inkSoft, lineHeight: 21, marginTop: 12, marginBottom: 16 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  progressTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.line2, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.brand },
  progressTxt: { fontSize: 13, fontWeight: '800', color: colors.ink2 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line, marginBottom: 12, ...shadow.card },
  stepNum: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  stepNumTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  stepTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  stepDesc: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 2, lineHeight: 17 },
  stepState: { fontSize: 12.5, fontWeight: '800', marginTop: 5 },
  ready: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.green, borderRadius: radius.lg, height: 54, marginTop: 8 },
  readyTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  note: { flexDirection: 'row', gap: 9, marginTop: 8, paddingHorizontal: 2 },
  noteTxt: { flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, lineHeight: 18 },
  errBox: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#FDECEA', borderRadius: radius.lg, borderWidth: 1, borderColor: '#F2B8B2', padding: 12, marginBottom: 16 },
  errTxt: { flex: 1, fontSize: 12.5, fontWeight: '700', color: '#B4241B', lineHeight: 17 },
  retry: { backgroundColor: '#D8261C', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  retryTxt: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
