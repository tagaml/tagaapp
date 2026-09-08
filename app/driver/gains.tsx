import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useLiveRefresh, srcPayouts } from '../../lib/live';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../../theme';
import { Header, Btn, useToast } from '../../components/ui';
import { fcfa, nombre } from '../../data/mock';
import { getDriverStats, createPayout, getMyPayouts, getDriverOfferStats, type DriverStats, type DriverOfferStats } from '../../lib/db';

type Payout = { montant: number; statut: string; created_at: string };

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function dateCourte(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MOIS[d.getMonth()]}`;
}

const STATUT: Record<string, { label: string; bg: string; fg: string }> = {
  pending: { label: 'En attente', bg: colors.goldSoft, fg: colors.gold },
  paid: { label: 'Payé', bg: colors.greenSoft, fg: colors.green },
  refused: { label: 'Refusé', bg: colors.brandSoft, fg: colors.brandDeep },
};

export default function Gains() {
  const toast = useToast();
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [offers, setOffers] = useState<DriverOfferStats | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasStats = useRef(false); // au moins un chargement réussi (évite d'afficher des zéros trompeurs)

  const chargerRetraits = async () => {
    try {
      const p = await getMyPayouts();
      setPayouts(p);
    } catch {
      /* ignore */
    }
  };

  // Recharge stats + retraits (recalculés en direct depuis la base).
  const charger = useCallback(async () => {
    setError(false);
    try {
      const [s, p, o] = await Promise.all([getDriverStats(), getMyPayouts(), getDriverOfferStats()]);
      setStats(s);
      setPayouts(p);
      setOffers(o);
      hasStats.current = true;
    } catch {
      // Sur ouverture à froid (aucune donnée encore chargée), on affiche une carte d'erreur
      // plutôt que des zéros trompeurs. Si on a déjà des stats, on garde l'affichage + un toast.
      if (!hasStats.current) setError(true);
      else toast('Actualisation impossible — données précédentes affichées.', { tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const midnightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Programme un rafraîchissement au prochain minuit puis chaque 24 h,
  // pour que « Aujourd'hui » se remette à zéro automatiquement.
  const planifierMinuit = useCallback(() => {
    if (midnightTimer.current) clearTimeout(midnightTimer.current);
    const now = new Date();
    const minuit = new Date(now);
    minuit.setHours(24, 0, 5, 0); // 5 s après minuit
    const delay = minuit.getTime() - now.getTime();
    midnightTimer.current = setTimeout(function tick() {
      charger();
      midnightTimer.current = setTimeout(tick, 24 * 60 * 60 * 1000); // chaque 24 h ensuite
    }, delay);
  }, [charger]);

  // À chaque ouverture de l'écran : recharge + (re)programme le passage de minuit.
  useFocusEffect(
    useCallback(() => {
      charger();
      planifierMinuit();
      return () => { if (midnightTimer.current) { clearTimeout(midnightTimer.current); midnightTimer.current = null; } };
    }, [charger, planifierMinuit]),
  );

  // Temps réel : dès que la Finance paie (ou refuse) un retrait, le chauffeur le voit ici —
  // et une course terminée met les gains à jour sans avoir à ressortir de l'écran.
  useLiveRefresh(charger, (uid) => [
    ...srcPayouts(uid),
    { table: 'rides', filter: `driver_id=eq.${uid}` },
    { table: 'orders', filter: `driver_id=eq.${uid}` },
  ]);

  const solde = stats?.soldeDisponible ?? 0;

  const demanderRetrait = () => {
    if (solde <= 0) return;
    Alert.alert('Demander un retrait', `Demander le retrait de ${fcfa(solde)} ? Taga effectuera le versement sur ton Orange Money sous peu.`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Confirmer',
        onPress: async () => {
          setBusy(true);
          try {
            await createPayout(solde, 'Orange Money');
            toast('Demande envoyée · Taga traite le versement');
            const s = await getDriverStats().catch(() => null);
            if (s) setStats(s);
            await chargerRetraits();
          } catch {
            toast('Échec de la demande. Réessaie.', { tone: 'error' });
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Mes gains" />
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      ) : error && !stats ? (
        <View style={st.errorWrap}>
          <View style={st.errorIcon}><Ionicons name="cloud-offline-outline" size={34} color={colors.brand} /></View>
          <Text style={st.errorTitle}>Impossible de charger tes gains</Text>
          <Text style={st.errorText}>Vérifie ta connexion. Tes gains sont bien enregistrés — rien n'est perdu.</Text>
          <Btn label="Réessayer" onPress={charger} style={{ marginTop: 16, alignSelf: 'stretch' }} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
          {/* Total des gains (hero) */}
          <View style={st.hero}>
            <Text style={st.heroLabel}>Gain total</Text>
            <Text style={st.heroNum} numberOfLines={1} adjustsFontSizeToFit>{nombre(stats?.gainsTotal ?? 0)}</Text>
            <Text style={st.heroUnit}>
              FCFA · {stats?.coursesTotal ?? 0} course{(stats?.coursesTotal ?? 0) > 1 ? 's' : ''}
            </Text>
          </View>

          {/* Aujourd'hui & cette semaine */}
          <View style={st.duo}>
            <StatCard
              icon="today-outline"
              titre="Aujourd'hui"
              gains={stats?.today.gains ?? 0}
              courses={stats?.today.courses ?? 0}
            />
            <StatCard
              icon="calendar-outline"
              titre="Cette semaine"
              gains={stats?.semaine.gains ?? 0}
              courses={stats?.semaine.courses ?? 0}
            />
          </View>

          {/* Taux d'acceptation / refus des offres (façon Uber / Yango) */}
          <Text style={st.section}>Mes offres de courses</Text>
          <View style={st.duo}>
            <View style={st.statCard}>
              <View style={[st.statIcon, { backgroundColor: colors.greenSoft }]}>
                <Ionicons name="checkmark-circle-outline" size={18} color={colors.green} />
              </View>
              <Text style={st.statTitre}>Acceptation</Text>
              <Text style={[st.statGains, { color: colors.green }]}>{offers?.acceptRate ?? 0}%</Text>
              <Text style={st.statCourses}>{offers?.accepted ?? 0} acceptée{(offers?.accepted ?? 0) > 1 ? 's' : ''}</Text>
            </View>
            <View style={st.statCard}>
              <View style={[st.statIcon, { backgroundColor: colors.brandSoft }]}>
                <Ionicons name="close-circle-outline" size={18} color={colors.brand} />
              </View>
              <Text style={st.statTitre}>Refus</Text>
              <Text style={[st.statGains, { color: colors.brand }]}>{offers?.refuseRate ?? 0}%</Text>
              <Text style={st.statCourses}>{(offers?.declined ?? 0) + (offers?.expired ?? 0)} refusée{((offers?.declined ?? 0) + (offers?.expired ?? 0)) > 1 ? 's' : ''}</Text>
            </View>
          </View>
          <Text style={st.offerHint}>Sur {offers?.total ?? 0} offre{(offers?.total ?? 0) > 1 ? 's' : ''} reçue{(offers?.total ?? 0) > 1 ? 's' : ''}. Un bon taux d'acceptation te fait passer en priorité.</Text>

          {/* Récapitulatif */}
          <Text style={st.section}>Récapitulatif</Text>
          <View style={st.detailCard}>
            <DetailRow label="Gains aujourd'hui" value={fcfa(stats?.today.gains ?? 0)} />
            <DetailRow label="Courses aujourd'hui" value={`${stats?.today.courses ?? 0}`} />
            <DetailRow label="Gains de la semaine" value={fcfa(stats?.semaine.gains ?? 0)} />
            <DetailRow label="Courses de la semaine" value={`${stats?.semaine.courses ?? 0}`} />
            <DetailRow label="Total des courses" value={`${stats?.coursesTotal ?? 0}`} />
            {(stats?.especes ?? 0) > 0 ? <DetailRow label="Encaissé en espèces (déjà en main)" value={fcfa(stats?.especes ?? 0)} /> : null}
            {(stats?.fraisDus ?? 0) > 0 ? <DetailRow label="Frais Taga à reverser (encaissé espèces)" value={`− ${fcfa(stats?.fraisDus ?? 0)}`} /> : null}
            <DetailRow label="Déjà versé / en attente" value={fcfa(stats?.verse ?? 0)} />
            <DetailRow label="Solde à retirer (électronique)" value={fcfa(solde)} last />
          </View>

          {/* Demander un retrait */}
          <View style={{ marginTop: 22 }}>
            <Btn
              label={solde > 0 ? `Retirer ${fcfa(solde)}` : 'Aucun solde à retirer'}
              onPress={demanderRetrait}
              loading={busy}
              disabled={solde <= 0}
            />
          </View>

          {/* Retraits récents */}
          <Text style={st.section}>Retraits récents</Text>
          <View style={st.detailCard}>
            {payouts.length === 0 ? (
              <View style={st.empty}>
                <Text style={st.emptyText}>Aucun retrait</Text>
              </View>
            ) : (
              payouts.map((p, i) => {
                const s = STATUT[p.statut] ?? STATUT.pending;
                return (
                  <View key={i} style={[st.dRow, i < payouts.length - 1 && st.dRowBorder]}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.dValue}>{fcfa(p.montant)}</Text>
                      <Text style={st.payoutDate}>{dateCourte(p.created_at)}</Text>
                    </View>
                    <View style={[st.badge, { backgroundColor: s.bg }]}>
                      <Text style={[st.badgeText, { color: s.fg }]}>{s.label}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StatCard({ icon, titre, gains, courses }: {
  icon: keyof typeof Ionicons.glyphMap; titre: string; gains: number; courses: number;
}) {
  return (
    <View style={st.statCard}>
      <View style={st.statIcon}>
        <Ionicons name={icon} size={18} color={colors.brand} />
      </View>
      <Text style={st.statTitre}>{titre}</Text>
      <Text style={st.statGains} numberOfLines={1} adjustsFontSizeToFit>{fcfa(gains)}</Text>
      <Text style={st.statCourses}>{courses} course{courses > 1 ? 's' : ''}</Text>
    </View>
  );
}

function DetailRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[st.dRow, !last && st.dRowBorder]}>
      {/* Le LIBELLÉ cède (il peut passer à la ligne), le MONTANT jamais : un montant tronqué ou
          qui déborde de la carte est pire qu'un libellé sur deux lignes. Sans ces contraintes,
          les deux textes prenaient leur largeur naturelle et la somme sortait du cadre
          (« Encaissé en espèces (déjà en main) 6 659 250 F »). */}
      <Text style={st.dLabel}>{label}</Text>
      <Text style={st.dValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  hero: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 22, borderWidth: 1, borderColor: colors.line, marginTop: 14, alignItems: 'center' },
  heroLabel: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroNum: { fontSize: 44, fontWeight: '800', color: colors.ink, marginTop: 6 },
  heroUnit: { fontSize: 14, fontWeight: '700', color: colors.inkSoft, marginTop: 4 },
  duo: { flexDirection: 'row', gap: 12, marginTop: 14 },
  statCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line },
  statIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  statTitre: { fontSize: 13, fontWeight: '700', color: colors.inkSoft, marginTop: 12 },
  statGains: { fontSize: 22, fontWeight: '800', color: colors.ink, marginTop: 4 },
  statCourses: { fontSize: 13, fontWeight: '700', color: colors.inkSoft, marginTop: 2 },
  offerHint: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 10, lineHeight: 18 },
  section: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 26, marginBottom: 12 },
  detailCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16 },
  dRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, gap: 12 },
  dRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  // flexShrink 1 : le libellé se replie sur deux lignes s'il le faut, au lieu de pousser le montant dehors.
  dLabel: { flex: 1, flexShrink: 1, fontSize: 15, fontWeight: '700', color: colors.ink2 },
  // flexShrink 0 : le montant garde TOUTE sa largeur — un chiffre coupé induirait le chauffeur en erreur.
  dValue: { flexShrink: 0, fontSize: 15, fontWeight: '800', color: colors.ink, textAlign: 'right' },
  payoutDate: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'center' },
  badgeText: { fontSize: 12, fontWeight: '800' },
  empty: { paddingVertical: 22, alignItems: 'center' },
  emptyText: { fontSize: 14, fontWeight: '700', color: colors.inkSoft },
  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl, gap: 6 },
  errorIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  errorTitle: { fontSize: 17, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  errorText: { fontSize: 14, fontWeight: '600', color: colors.inkSoft, textAlign: 'center', lineHeight: 20, marginTop: 4 },
});
