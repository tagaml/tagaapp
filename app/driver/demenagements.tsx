import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Linking, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../../theme';
import { Header, Btn, useToast } from '../../components/ui';
import { fcfa } from '../../data/mock';
import { getMyMovings, markMovingDone, setMovingStatut, getCamionCommission, setMovingClientRating, getMovingContactPhone, type MovingRequest } from '../../lib/db';
import { openNavigation } from '../../lib/navigation';
import { contactParty } from '../../lib/contact';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function dateLabel(iso: string | null): string {
  if (!iso) return 'Date à confirmer';
  const d = new Date(iso + (iso.length <= 10 ? 'T00:00:00' : ''));
  return `${d.getDate()} ${MOIS[d.getMonth()]}`;
}

export default function DriverMovings() {
  const toast = useToast();
  const [items, setItems] = useState<MovingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [commPct, setCommPct] = useState(15); // commission Taga (%) sur le déménagement
  const [erreur, setErreur] = useState(false); // panne réseau ≠ « aucun déménagement »

  const charger = useCallback(async () => {
    setErreur(false);
    try {
      setItems(await getMyMovings());
      getCamionCommission().then(setCommPct).catch(() => {});
    } catch {
      // Échec de chargement : ne pas afficher « aucun déménagement assigné » comme si c'était réel.
      setItems((prev) => { if (prev.length === 0) setErreur(true); return prev; });
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { charger(); }, [charger]));

  // Note du client, après un déménagement terminé (facultative). Le chauffeur camion note son client
  // exactement comme en fin de course : c'est la MÊME note agrégée côté serveur.
  const [noter, setNoter] = useState<MovingRequest | null>(null); // déménagement en cours de notation
  const [note, setNote] = useState(0);
  const [saving, setSaving] = useState(false);

  const ouvrirNote = (m: MovingRequest) => { setNote(0); setNoter(m); };
  const fermerNote = () => { setNoter(null); setNote(0); };
  const envoyerNote = async () => {
    if (!noter || note < 1 || saving) return;
    setSaving(true);
    try {
      await setMovingClientRating(noter.id, note);
      toast('Merci, note enregistrée');
      fermerNote();
      await charger(); // le déménagement passe en « noté » → le bouton disparaît
    } catch {
      toast('Note non enregistrée — réessaie.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const terminer = (m: MovingRequest) => {
    Alert.alert('Terminer le déménagement', 'Confirmer que le déménagement est terminé ?', [
      { text: 'Pas encore', style: 'cancel' },
      {
        text: 'Terminé', onPress: async () => {
          setBusy(m.id);
          try {
            await markMovingDone(m.id);
            toast('Déménagement terminé');
            await charger();
            ouvrirNote(m); // enchaîne sur la note du client (il peut passer)
          }
          catch { toast('Échec. Réessaie.', { tone: 'error' }); }
          finally { setBusy(null); }
        },
      },
    ]);
  };

  // Progression live : le chauffeur déclenche « en route » puis « sur place » (le client suit).
  const avancer = (m: MovingRequest, next: 'en_route' | 'arrive') => {
    setBusy(m.id);
    setMovingStatut(m.id, next)
      .then(async () => { toast(next === 'en_route' ? 'En route' : 'Sur place'); await charger(); })
      .catch(() => toast('Échec. Réessaie.', { tone: 'error' }))
      .finally(() => setBusy(null));
  };

  const actifs = items.filter((m) => m.statut !== 'termine' && m.statut !== 'annule');
  const passes = items.filter((m) => m.statut === 'termine' || m.statut === 'annule');

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Mes déménagements" />
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : erreur && items.length === 0 ? (
        <View style={st.empty}>
          <Ionicons name="cloud-offline-outline" size={44} color={colors.brand} />
          <Text style={st.emptyText}>Impossible de charger tes déménagements. Vérifie ta connexion — rien n'est perdu.</Text>
          <Pressable style={st.retry} onPress={charger} hitSlop={8}>
            <Text style={st.retryTxt}>Réessayer</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={st.empty}>
          <Ionicons name="cube-outline" size={44} color={colors.inkMute} />
          <Text style={st.emptyText}>Aucun déménagement assigné pour l'instant. Taga t'assigne les missions camion ici.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
          {actifs.length ? <Text style={st.section}>À venir</Text> : null}
          {actifs.map((m) => (
            <Card key={m.id} m={m} commPct={commPct} busy={busy === m.id} onNav={() => openNavigation({ address: m.depart ?? undefined, lat: (m as any).depart_lat, lng: (m as any).depart_lng, preferAddress: true, label: m.depart || 'Départ' })} onDone={() => terminer(m)} onAdvance={(next) => avancer(m, next)} />
          ))}
          {passes.length ? <Text style={st.section}>Historique</Text> : null}
          {passes.map((m) => (
            <Card
              key={m.id}
              m={m}
              commPct={commPct}
              past
              // Déménagement terminé et pas encore noté (y compris ceux clôturés par l'admin) :
              // le chauffeur peut encore noter son client. Le serveur refuse tout le reste.
              onNote={m.statut === 'termine' && m.client_note == null ? () => ouvrirNote(m) : undefined}
            />
          ))}
        </ScrollView>
      )}

      {/* Note du client — mêmes 5 étoiles que la fin de course. Facultative : « Passer » ferme. */}
      <Modal visible={!!noter} animationType="slide" transparent onRequestClose={fermerNote}>
        <View style={st.noteBackdrop}>
          <View style={st.noteSheet}>
            <Text style={st.noteDone}>Déménagement terminé</Text>
            <View style={st.rateCard}>
              <Text style={st.rateName} numberOfLines={1}>Note ton client</Text>
              <View style={st.stars}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <Pressable key={i} onPress={() => setNote(i)} hitSlop={6}>
                    <Ionicons name={i <= note ? 'star' : 'star-outline'} size={38} color={i <= note ? colors.gold : colors.line2} />
                  </Pressable>
                ))}
              </View>
            </View>
            <Btn label="Terminer" onPress={envoyerNote} loading={saving} disabled={note < 1} style={{ marginTop: 20 }} />
            <Pressable onPress={fermerNote} hitSlop={8} style={st.skip}>
              <Text style={st.skipTxt}>Passer</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Card({ m, busy, past, commPct = 15, onNav, onDone, onNote, onAdvance }: { m: MovingRequest; busy?: boolean; past?: boolean; commPct?: number; onNav?: () => void; onDone?: () => void; onNote?: () => void; onAdvance?: (next: 'en_route' | 'arrive') => void }) {
  const netPrix = m.prix != null ? Math.round((Number(m.prix) || 0) * (100 - commPct) / 100) : null;
  // Étape d'exécution → prochaine action. On ne peut DÉMARRER que si le déménagement est PLANIFIÉ
  // (devis accepté + planifié par l'admin). Avant ça (nouveau/devis/confirmé), aucun bouton : le
  // chauffeur ne peut pas court-circuiter le devis, la confirmation client et la planification.
  const step: { label: string; run: () => void } | null = m.statut === 'en_route'
    ? { label: 'Je suis sur place', run: () => onAdvance?.('arrive') }
    : m.statut === 'arrive'
      ? { label: 'Marquer terminé', run: () => onDone?.() }
      : m.statut === 'planifie'
        ? { label: 'Démarrer · en route', run: () => onAdvance?.('en_route') }
        : null;
  const stepBadge = m.statut === 'en_route' ? 'En route' : m.statut === 'arrive' ? 'Sur place' : null;
  return (
    <View style={[st.card, past && { opacity: 0.7 }]}>
      <View style={st.cardHead}>
        <View style={st.datePill}><Text style={st.datePillText}>{dateLabel(m.date_souhaitee)}</Text></View>
        {m.creneau ? <Text style={st.creneau}>{m.creneau}</Text> : null}
        {stepBadge ? <View style={st.stepBadge}><Text style={st.stepBadgeText}>{stepBadge}</Text></View> : null}
        <View style={{ flex: 1 }} />
        {netPrix != null ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={st.prix}>{fcfa(netPrix)}</Text>
            <Text style={st.prixNet}>net · {fcfa(Number(m.prix) || 0)} − {commPct}% Taga</Text>
          </View>
        ) : null}
      </View>
      <View style={st.route}>
        <View style={st.routeRow}><View style={[st.dot, { backgroundColor: colors.green }]} /><Text style={st.routeText} numberOfLines={2}>{m.depart ?? '—'}{m.depart_etage ? ` · ${m.depart_etage}` : ''}</Text></View>
        <View style={st.routeLine} />
        <View style={st.routeRow}><View style={[st.dot, { backgroundColor: colors.brand }]} /><Text style={st.routeText} numberOfLines={2}>{m.arrivee ?? '—'}{m.arrivee_etage ? ` · ${m.arrivee_etage}` : ''}</Text></View>
      </View>
      <Text style={st.meta}>{[m.volume, m.manutentionnaires ? `${m.manutentionnaires} manutentionnaire${m.manutentionnaires > 1 ? 's' : ''}` : null, m.options].filter(Boolean).join(' · ')}</Text>
      {m.note ? <Text style={st.note}>« {m.note} »</Text> : null}
      {!past && (
        <>
          {/* Contact client : le chauffeur camion doit pouvoir appeler pour coordonner l'accès/l'étage. */}
          <Pressable style={st.callRow} onPress={async () => { const tel = await getMovingContactPhone(m.id); contactParty(tel, 'le client'); }}>
            <Ionicons name="call" size={16} color={colors.ink} />
            <Text style={st.callRowText}>Appeler le client</Text>
          </Pressable>
          <View style={st.actions}>
            <Pressable style={st.navBtn} onPress={onNav}><Ionicons name="navigate" size={16} color={colors.ink} /><Text style={st.navText}>Itinéraire</Text></Pressable>
            {step ? (
              <Pressable style={st.doneBtn} onPress={step.run} disabled={busy}>
                <Text style={st.doneText}>{busy ? '…' : step.label}</Text>
              </Pressable>
            ) : (
              <View style={[st.doneBtn, { backgroundColor: colors.surface2 }]}>
                <Text style={[st.doneText, { color: colors.inkSoft }]}>En attente de planification</Text>
              </View>
            )}
          </View>
        </>
      )}
      {/* Terminé mais pas encore noté : la note du client reste à portée de main. */}
      {past && onNote && (
        <Pressable style={st.rateBtn} onPress={onNote}>
          <Ionicons name="star-outline" size={16} color={colors.gold} />
          <Text style={st.rateBtnTxt}>Noter le client</Text>
        </Pressable>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: space.xl },
  emptyText: { fontSize: 14.5, fontWeight: '600', color: colors.inkSoft, textAlign: 'center', lineHeight: 21 },
  section: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 20, marginBottom: 10 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 16, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  datePill: { backgroundColor: colors.ink, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  datePillText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  creneau: { fontSize: 13, fontWeight: '700', color: colors.inkSoft },
  stepBadge: { backgroundColor: colors.green, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3 },
  stepBadgeText: { fontSize: 11.5, fontWeight: '800', color: colors.white },
  // Gain net + explication de la commission = info décisive : lisible, pas en gris pâle.
  prix: { fontSize: 18, fontWeight: '800', color: colors.green },
  prixNet: { fontSize: 11.5, fontWeight: '700', color: colors.inkSoft, marginTop: 1 },
  retry: { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: 18, paddingVertical: 11, marginTop: 4 },
  retryTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },
  route: { marginBottom: 10 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  dot: { width: 11, height: 11, borderRadius: 6 },
  routeLine: { width: 2, height: 16, backgroundColor: colors.line2, marginLeft: 4.5, marginVertical: 3 },
  routeText: { flex: 1, fontSize: 14.5, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  note: { fontSize: 13, fontWeight: '600', color: colors.ink2, marginTop: 6, fontStyle: 'italic' },
  callRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line, marginTop: 14 },
  callRowText: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  navBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 46, paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line },
  navText: { fontSize: 14, fontWeight: '800', color: colors.ink },
  doneBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  doneText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  rateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 44, borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line, marginTop: 12 },
  rateBtnTxt: { fontSize: 14, fontWeight: '800', color: colors.ink },
  // Note du client (5 étoiles) — même vocabulaire visuel que la fin de course.
  noteBackdrop: { flex: 1, backgroundColor: 'rgba(21,17,14,0.45)', justifyContent: 'flex-end' },
  noteSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: 22, paddingBottom: 26 },
  noteDone: { fontSize: 20, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  rateCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 22, borderWidth: 1, borderColor: colors.line, alignItems: 'center', marginTop: 18 },
  rateName: { fontSize: 16, fontWeight: '800', color: colors.ink },
  stars: { flexDirection: 'row', gap: 8, marginTop: 16 },
  skip: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 20, marginTop: 4 },
  skipTxt: { fontSize: 15, fontWeight: '800', color: colors.inkSoft },
});
