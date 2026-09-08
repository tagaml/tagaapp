import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useLiveRefresh, srcAbonnement } from '../../lib/live';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { colors, radius, shadow, space } from '../../theme';
import { Btn, useToast } from '../../components/ui';
import { fcfa } from '../../data/mock';
import {
  getDriverPlans,
  getActiveSubscription,
  getPendingSubscription,
  createSubscription,
  getDriverProfile,
  getOmPaymentNumber,
  getCamionCommission,
  type DriverPlan,
  type DriverSubscription,
} from '../../lib/db';

const VEH_LABEL: Record<string, string> = { voiture: 'Voiture', moto: 'Moto', tricycle: 'Tricycle', camion: 'Camion' };

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function dateLabel(iso: string): string {
  const d = new Date(iso);
  const h = `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getDate()} ${MOIS[d.getMonth()]} à ${h}`;
}
function joursRestants(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

// Sous-titre par durée (marche pour tous les véhicules, quel que soit le code).
const SOUS_TITRE_DUREE: Record<number, string> = {
  1: 'Accès chauffeur pour 1 journée',
  7: '7 jours · le plus choisi',
  30: '30 jours · meilleur tarif',
};

export default function Abonnement() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  // Le retour ramène TOUJOURS à l'écran d'où l'on vient (inscription, compte) — jamais à l'accueil par surprise.
  const goBack = () => router.replace(
    from === 'compte' ? '/driver/compte' : from === 'onboarding' ? '/driver/onboarding' : '/driver',
  );
  const toast = useToast();
  const insets = useSafeAreaInsets();

  const [plans, setPlans] = useState<DriverPlan[]>([]);
  const [active, setActive] = useState<DriverSubscription | null>(null);
  const [pending, setPending] = useState<DriverSubscription | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [veh, setVeh] = useState<string | null>(null);
  const [camionPct, setCamionPct] = useState(15); // commission camion (sans abonnement)
  const [payOpen, setPayOpen] = useState(false);
  const [omNumero, setOmNumero] = useState('+223 76 00 00 00');
  const [erreur, setErreur] = useState(false); // panne réseau ≠ « aucun forfait disponible »

  const charger = async () => {
    setErreur(false);
    try {
      const prof = await getDriverProfile();
      const vt = (prof?.type || prof?.vehicle_types?.[0] || 'voiture');
      setVeh(vt);
      if (vt === 'camion') { getCamionCommission().then(setCamionPct).catch(() => {}); }
      const [p, a, pend, om] = await Promise.all([getDriverPlans(vt), getActiveSubscription(), getPendingSubscription(), getOmPaymentNumber()]);
      setPlans(p);
      setActive(a);
      setPending(pend);
      setOmNumero(om);
      setSel((s) => {
        const stillThere = s && p.some((x) => x.code === s);
        return stillThere ? s : (p.find((x) => x.duree_jours === 7)?.code ?? p[0]?.code ?? null);
      });
    } catch {
      // Sans forfaits chargés, ne pas laisser croire qu'il n'y en a aucun : on l'indique clairement.
      setErreur(true);
    } finally {
      setLoading(false);
    }
  };

  // Temps réel : dès que l'admin encaisse et ACTIVE l'abonnement, l'écran passe à « actif » tout
  // seul — le chauffeur n'a plus à quitter et rouvrir l'application pour pouvoir rouler.
  useLiveRefresh(charger, srcAbonnement);

  // « J'ai payé » : enregistre la demande (en attente) après paiement OM manuel.
  const confirmerPaiement = async () => {
    if (!sel) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await createSubscription(sel);
      setPayOpen(false);
      toast('Paiement signalé · Taga vérifie et active ton abonnement');
      await charger();
    } catch {
      toast('Échec de l\'envoi. Réessaie.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const planSel = plans.find((p) => p.code === sel);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={st.head}>
        <Pressable onPress={goBack} hitSlop={10} style={st.back}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Text style={st.headTitle}>Mon abonnement</Text>
        <View style={{ width: 42 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      ) : (
        veh === 'camion' ? (
          /* Camion / déménagement : PAS d'abonnement — Taga prélève une commission par course. */
          <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
            <View style={[st.statut, { backgroundColor: colors.greenSoft, borderColor: colors.green }]}>
              <View style={[st.statutIcon, { backgroundColor: colors.green }]}>
                <Ionicons name="checkmark-circle" size={22} color={colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[st.statutTitle, { color: colors.green }]}>Aucun abonnement requis</Text>
                <Text style={st.statutSub}>Pour le camion, tu roules sans forfait : Taga se rémunère sur chaque course.</Text>
              </View>
            </View>

            <Text style={st.section}>Comment tu es facturé</Text>
            <View style={st.commCard}>
              <Text style={st.commPct}>{camionPct}%</Text>
              <Text style={st.commLabel}>de commission Taga par course</Text>
              <Text style={st.commSub}>Tu gardes {100 - camionPct}% du montant de chaque course camion / déménagement. Rien à payer à l'avance, aucun abonnement.</Text>
            </View>

            <View style={st.info}>
              <Ionicons name="information-circle-outline" size={18} color={colors.inkSoft} />
              <Text style={st.infoText}>Le taux de commission est réglé par Taga. Tu peux passer en ligne dès que ton dossier est validé.</Text>
            </View>
          </ScrollView>
        ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + 120 }} showsVerticalScrollIndicator={false}>
          {/* Statut actuel */}
          {active ? (
            <View style={[st.statut, { backgroundColor: colors.greenSoft, borderColor: colors.green }]}>
              <View style={[st.statutIcon, { backgroundColor: colors.green }]}>
                <Ionicons name="checkmark-circle" size={22} color={colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[st.statutTitle, { color: colors.green }]}>Abonnement actif</Text>
                <Text style={st.statutSub}>
                  Valable encore {joursRestants(active.expires_at)} jour{joursRestants(active.expires_at) > 1 ? 's' : ''} · jusqu'au {dateLabel(active.expires_at)}
                </Text>
              </View>
            </View>
          ) : pending ? (
            <View style={[st.statut, { backgroundColor: colors.goldSoft, borderColor: colors.gold }]}>
              <View style={[st.statutIcon, { backgroundColor: colors.gold }]}>
                <Ionicons name="time" size={22} color={colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[st.statutTitle, { color: colors.gold }]}>Demande en attente</Text>
                <Text style={st.statutSub}>Paie ton forfait via Orange Money — Taga active ton abonnement dès réception.</Text>
              </View>
            </View>
          ) : (
            <View style={[st.statut, { backgroundColor: colors.brandTint, borderColor: colors.brandSoft }]}>
              <View style={[st.statutIcon, { backgroundColor: colors.brand }]}>
                <Ionicons name="alert-circle" size={22} color={colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[st.statutTitle, { color: colors.brandDeep }]}>Aucun abonnement actif</Text>
                <Text style={st.statutSub}>Choisis un forfait pour pouvoir passer en ligne et recevoir des courses.</Text>
              </View>
            </View>
          )}

          <Text style={st.section}>{active ? 'Prolonger mon abonnement' : 'Choisir un forfait'}</Text>
          {veh ? <Text style={st.vehNote}>Tarifs pour ton véhicule : {VEH_LABEL[veh] ?? veh}</Text> : null}

          {/* Échec de chargement : on le dit, au lieu d'afficher une liste vide comme si Taga n'avait aucun forfait. */}
          {erreur && plans.length === 0 ? (
            <View style={st.errBox}>
              <Ionicons name="cloud-offline-outline" size={18} color={colors.brandDeep} />
              <Text style={st.errTxt}>Impossible de charger les forfaits. Vérifie ta connexion.</Text>
              <Pressable style={st.errRetry} onPress={() => { setLoading(true); charger(); }} hitSlop={8}>
                <Text style={st.errRetryTxt}>Réessayer</Text>
              </Pressable>
            </View>
          ) : null}

          {plans.map((p) => {
            const on = p.code === sel;
            const populaire = p.duree_jours === 7;
            return (
              <Pressable key={p.code} onPress={() => setSel(p.code)} style={[st.plan, on && st.planOn]}>
                <View style={[st.radio, on && st.radioOn]}>
                  {on && <View style={st.radioDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={st.planLabel}>{p.label}</Text>
                    {populaire && <View style={st.populaire}><Text style={st.populaireText}>POPULAIRE</Text></View>}
                  </View>
                  <Text style={st.planSub}>{SOUS_TITRE_DUREE[p.duree_jours] ?? `${p.duree_jours} jours`}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={st.planPrix}>{fcfa(p.prix)}</Text>
                  <Text style={st.planUnit}>/ {p.duree_jours === 1 ? 'jour' : p.duree_jours === 7 ? 'semaine' : `${p.duree_jours}j`}</Text>
                </View>
              </Pressable>
            );
          })}

          {/* Paiement Orange Money manuel */}
          <View style={st.payNote}>
            <View style={st.omBadge}><Text style={st.omText}>OM</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={st.payTitle}>Paiement par Orange Money</Text>
              <Text style={st.paySub}>Tu envoies le montant sur le numéro Taga, puis tu appuies sur « J'ai payé ». L'équipe vérifie et active ton abonnement.</Text>
            </View>
          </View>

          <View style={st.info}>
            <Ionicons name="information-circle-outline" size={18} color={colors.inkSoft} />
            <Text style={st.infoText}>Les tarifs sont réglés par l'administrateur. Sans abonnement actif, tu ne peux pas recevoir de courses.</Text>
          </View>
        </ScrollView>
        )
      )}

      {!loading && veh !== 'camion' && (
        <View style={[st.bottom, { paddingBottom: insets.bottom + 14 }]}>
          <Btn
            label={pending ? 'Demande déjà envoyée' : planSel ? `${active ? 'Prolonger' : 'Payer'} · ${fcfa(planSel.prix)}` : 'Choisir un forfait'}
            onPress={() => setPayOpen(true)}
            disabled={!sel || !!pending}
          />
        </View>
      )}

      {/* Paiement Orange Money manuel : numéro à créditer + « J'ai payé » */}
      <Modal visible={payOpen} transparent animationType="slide" onRequestClose={() => setPayOpen(false)}>
        <Pressable style={st.backdrop} onPress={() => !busy && setPayOpen(false)} />
        <SafeAreaView edges={['bottom']} style={st.sheet}>
          <View style={st.sheetHead}>
            <Text style={st.sheetTitle}>Paiement Orange Money</Text>
            <Pressable onPress={() => !busy && setPayOpen(false)} hitSlop={10} style={st.sheetClose}>
              <Ionicons name="close" size={22} color={colors.ink} />
            </Pressable>
          </View>

          {planSel ? (
            <Text style={st.paySheetSub}>
              Envoie <Text style={st.payStrong}>{fcfa(planSel.prix)}</Text> par Orange Money au numéro Taga ci-dessous, puis appuie sur « J'ai payé ».
            </Text>
          ) : null}

          <Text style={st.omLabel}>Numéro Orange Money · Taga</Text>
          <Pressable
            style={st.omBox}
            onPress={async () => {
              try {
                await Clipboard.setStringAsync(omNumero);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                toast('Numéro copié');
              } catch { /* ignore */ }
            }}
          >
            <View style={[st.omBadge, { width: 44, height: 44 }]}><Text style={st.omText}>OM</Text></View>
            <Text style={st.omNum}>{omNumero}</Text>
            <Ionicons name="copy-outline" size={20} color={colors.brand} />
          </Pressable>
          <View style={st.stepsBox}>
            <Step n="1" text="Ouvre Orange Money et envoie le montant au numéro ci-dessus." />
            <Step n="2" text={`Indique le montant exact : ${planSel ? fcfa(planSel.prix) : '—'}.`} />
            <Step n="3" text="Reviens ici et appuie sur « J'ai payé »." />
          </View>

          <Btn
            label={busy ? 'Envoi…' : "J'ai payé"}
            onPress={confirmerPaiement}
            loading={busy}
            disabled={!sel}
            style={{ marginTop: 18 }}
          />
          {/* Sortie explicite (en plus de la croix, du fond et du retour Android). */}
          <Pressable style={st.sheetCancel} onPress={() => !busy && setPayOpen(false)} disabled={busy}>
            <Text style={st.sheetCancelText}>Annuler</Text>
          </Pressable>
          <Text style={st.payWarn}>Taga vérifie chaque paiement avant d'activer. Une fausse déclaration peut entraîner la suspension du compte.</Text>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <View style={st.step}>
      <View style={st.stepNum}><Text style={st.stepNumText}>{n}</Text></View>
      <Text style={st.stepText}>{text}</Text>
    </View>
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
  section: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 24, marginBottom: 12 },
  vehNote: { fontSize: 13, fontWeight: '700', color: colors.brandDeep, marginTop: -4, marginBottom: 12 },
  commCard: { backgroundColor: colors.brandTint, borderRadius: radius.lg, padding: 20, borderWidth: 1, borderColor: colors.brandSoft, alignItems: 'center' },
  commPct: { fontSize: 46, fontWeight: '800', color: colors.brand },
  commLabel: { fontSize: 15, fontWeight: '800', color: colors.ink, marginTop: 2 },
  commSub: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 10, lineHeight: 19, textAlign: 'center' },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 2, borderColor: colors.line, marginBottom: 10 },
  planOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.brand },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.brand },
  planLabel: { fontSize: 16.5, fontWeight: '800', color: colors.ink },
  planSub: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 3 },
  populaire: { backgroundColor: colors.brand, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  populaireText: { color: colors.white, fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  planPrix: { fontSize: 17, fontWeight: '800', color: colors.ink },
  planUnit: { fontSize: 12, fontWeight: '700', color: colors.inkSoft, marginTop: 1 },
  payNote: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line, marginTop: 16 },
  omBadge: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#FF6600', alignItems: 'center', justifyContent: 'center' },
  omText: { color: colors.white, fontSize: 12, fontWeight: '800' },
  payTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  paySub: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 3, lineHeight: 17 },
  info: { flexDirection: 'row', gap: 9, marginTop: 16, paddingHorizontal: 2 },
  infoText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, lineHeight: 18 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingTop: 12, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.line },
  // Modal paiement OM
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space.lg, paddingTop: 16, paddingBottom: 20 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontSize: 19, fontWeight: '800', color: colors.ink },
  sheetClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  paySheetSub: { fontSize: 14, fontWeight: '600', color: colors.inkSoft, lineHeight: 20, marginBottom: 16 },
  payStrong: { fontWeight: '800', color: colors.ink },
  omLabel: { fontSize: 12.5, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  omBox: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 2, borderColor: colors.brandSoft, borderStyle: 'dashed' },
  omNum: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.ink, letterSpacing: 1 },
  omHint: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 8, lineHeight: 18 },
  stepsBox: { marginTop: 16, gap: 12 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: colors.white, fontSize: 13, fontWeight: '800' },
  stepText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink2, lineHeight: 19 },
  payWarn: { fontSize: 12, fontWeight: '600', color: colors.inkSoft, textAlign: 'center', marginTop: 12, lineHeight: 17 },
  sheetCancel: { height: 52, borderRadius: radius.lg, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  sheetCancelText: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  errBox: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.brandTint, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.brandSoft, padding: 12, marginBottom: 14 },
  errTxt: { flex: 1, fontSize: 12.5, fontWeight: '700', color: colors.brandDeep, lineHeight: 17 },
  errRetry: { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  errRetryTxt: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
