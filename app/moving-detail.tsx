import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Pressable, Linking } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useLiveRefresh, srcDemenagement } from '../lib/live';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';
import { Header, Btn, CtaBar, useToast } from '../components/ui';
import { fcfa } from '../data/mock';
import { getMovingRequest, confirmMoving, getTagaPayNumber, getMovingContactPhone, type MovingRequest } from '../lib/db';
import { contactParty } from '../lib/contact';
import { CopyNumber } from '../components/CopyNumber';

const STATUT: Record<string, { label: string; sub: string; color: string; soft: string; icon: keyof typeof Ionicons.glyphMap }> = {
  nouveau: { label: 'Demande envoyée', sub: 'Taga prépare ton devis.', color: colors.brandDeep, soft: colors.brandTint, icon: 'time' },
  devis: { label: 'Devis reçu', sub: 'Vérifie le montant et confirme pour planifier.', color: colors.gold, soft: colors.goldSoft, icon: 'pricetag' },
  confirme: { label: 'Confirmé', sub: 'Taga planifie ton déménagement.', color: colors.green, soft: colors.greenSoft, icon: 'checkmark-circle' },
  planifie: { label: 'Planifié', sub: 'Une équipe est réservée pour toi.', color: colors.green, soft: colors.greenSoft, icon: 'calendar' },
  en_route: { label: 'Chauffeur en route', sub: 'Il arrive au départ.', color: colors.brandDeep, soft: colors.brandTint, icon: 'car-sport' },
  arrive: { label: 'Sur place', sub: 'Chargement en cours.', color: colors.brandDeep, soft: colors.brandTint, icon: 'cube' },
  termine: { label: 'Terminé', sub: 'Merci d\'avoir choisi Taga !', color: colors.green, soft: colors.greenSoft, icon: 'checkmark-done' },
  annule: { label: 'Annulé', sub: 'Cette demande a été annulée.', color: colors.brandDeep, soft: colors.brandTint, icon: 'close-circle' },
};

// Libellés lisibles (répliqués depuis demenagement.tsx) — la DB stocke les ids bruts.
const VOLUME_LABEL: Record<string, string> = { studio: 'Studio', '2-3': '2 – 3 pièces', villa: 'Villa / grande maison' };
const CRENEAU_LABEL: Record<string, string> = { matin: 'Matin', 'apres-midi': 'Après-midi', soir: 'Soir', 'demi-journee': 'Demi-journée', journee: 'Journée' };

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function dateLabel(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length <= 10 ? 'T00:00:00' : ''));
  return `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
}

export default function MovingDetail() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const toast = useToast();
  const [m, setM] = useState<MovingRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false); // échec du chargement (≠ demande introuvable)
  const [busy, setBusy] = useState(false);
  const [tagaNum, setTagaNum] = useState('');

  React.useEffect(() => { getTagaPayNumber().then(setTagaNum).catch(() => {}); }, []);
  const charger = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    try { const r = await getMovingRequest(id); setM(r); setError(false); } catch { setError(true); } finally { setLoading(false); }
  }, [id]);
  // Temps réel : le devis envoyé par l'admin, et la confirmation du paiement, arrivent à l'instant.
  useLiveRefresh(charger, srcDemenagement);

  const confirmer = () => {
    if (!id) return;
    Alert.alert('Confirmer le devis', `Accepter le devis${m?.prix ? ` de ${fcfa(m.prix)}` : ''} et planifier le déménagement ?`, [
      { text: 'Pas encore', style: 'cancel' },
      {
        text: 'Confirmer', onPress: async () => {
          setBusy(true);
          try { await confirmMoving(id); toast('Devis confirmé · Taga planifie'); await charger(); }
          catch { toast('Échec de la confirmation', { tone: 'error' }); }
          finally { setBusy(false); }
        },
      },
    ]);
  };

  const s = m ? (STATUT[m.statut] ?? STATUT.nouveau) : STATUT.nouveau;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Déménagement" />
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg, gap: 14 }}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.inkSoft} />
          <Text style={{ color: colors.inkSoft, fontWeight: '700', textAlign: 'center' }}>Impossible de charger cette demande.</Text>
          <Btn label="Réessayer" onPress={() => { setLoading(true); setError(false); charger(); }} style={{ paddingHorizontal: 26 }} />
        </View>
      ) : !m ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg }}>
          <Text style={{ color: colors.inkSoft, fontWeight: '700' }}>Demande introuvable.</Text>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
            <View style={[st.statut, { backgroundColor: s.soft }]}>
              <View style={[st.statutIcon, { backgroundColor: s.color }]}><Ionicons name={s.icon} size={22} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <Text style={[st.statutLabel, { color: s.color }]}>{s.label}</Text>
                <Text style={st.statutSub}>{s.sub}</Text>
              </View>
            </View>

            {m.prix != null ? (
              <View style={st.devis}>
                <Text style={st.devisLabel}>Devis</Text>
                <Text style={st.devisVal}>{fcfa(m.prix)}</Text>
              </View>
            ) : null}

            {!m.paye && ['confirme', 'planifie', 'en_route', 'arrive'].includes(m.statut) ? (
              <View style={st.payCard}>
                <View style={st.payIcon}><Ionicons name="phone-portrait" size={22} color={colors.brand} /></View>
                <Text style={st.payTitle}>Règle au numéro Taga</Text>
                {m.prix != null ? <Text style={st.payAmount}>{fcfa(m.prix)}</Text> : null}
                {tagaNum ? (
                  <CopyNumber number={tagaNum} />
                ) : (
                  <Text style={st.paySub}>Le numéro de paiement te sera communiqué par Taga.</Text>
                )}
                <Text style={st.paySub}>Une équipe est planifiée dès le paiement reçu.</Text>
              </View>
            ) : null}

            {m.statut === 'confirme' && m.paye ? (
              <View style={st.paidCard}>
                <Ionicons name="checkmark-circle" size={20} color={colors.green} />
                <Text style={st.paidText}>Paiement reçu · Taga planifie ton déménagement.</Text>
              </View>
            ) : null}

            {/* Chauffeur camion assigné : le client voit qui vient et peut l'appeler pour coordonner. */}
            {m.driver_nom ? (
              <>
                <Text style={st.section}>Ton chauffeur</Text>
                <View style={st.driverCard}>
                  <View style={st.driverAv}><Ionicons name="person" size={20} color={colors.brand} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.driverName} numberOfLines={1}>{m.driver_nom}</Text>
                    <Text style={st.driverSub}>Chauffeur camion Taga</Text>
                  </View>
                  <Pressable style={st.driverCall} onPress={async () => { if (!id) return; const tel = await getMovingContactPhone(id); contactParty(tel, 'ton chauffeur'); }}>
                    <Ionicons name="call" size={18} color={colors.white} />
                  </Pressable>
                </View>
              </>
            ) : null}

            <Text style={st.section}>Trajet</Text>
            <View style={st.card}>
              <Row icon="ellipse" tint="#1A73E8" label="Départ" value={`${m.depart ?? '—'}${m.depart_etage ? ' · ' + m.depart_etage : ''}`} />
              <View style={st.sep} />
              <Row icon="location" tint="#1A73E8" label="Arrivée" value={`${m.arrivee ?? '—'}${m.arrivee_etage ? ' · ' + m.arrivee_etage : ''}`} />
            </View>

            <Text style={st.section}>Détails</Text>
            <View style={st.card}>
              <Line label="Volume" value={m.volume ? (VOLUME_LABEL[m.volume] ?? m.volume) : '—'} />
              <Line label="Date souhaitée" value={`${dateLabel(m.date_souhaitee)}${m.creneau ? ' · ' + (CRENEAU_LABEL[m.creneau] ?? m.creneau) : ''}`} />
              {/* Même intitulé que le formulaire (demenagement.tsx) : « Chargement et déchargement ». */}
              <Line label="Chargement et déchargement" value={m.manutentionnaires ? `${m.manutentionnaires} personne${m.manutentionnaires > 1 ? 's' : ''}` : 'Aucune'} />
              {m.options ? <Line label="Options" value={m.options} /> : null}
              {m.note ? <Line label="Précisions" value={m.note} last /> : null}
            </View>

          </ScrollView>

          {m.statut === 'devis' ? (
            <CtaBar>
              <Btn label={`Confirmer le devis${m.prix ? ` · ${fcfa(m.prix)}` : ''}`} loading={busy} onPress={confirmer} />
            </CtaBar>
          ) : null}
        </>
      )}
    </View>
  );
}

function Row({ icon, tint, label, value }: { icon: keyof typeof Ionicons.glyphMap; tint: string; label: string; value: string }) {
  return (
    <View style={st.row}>
      <Ionicons name={icon} size={13} color={tint} style={{ marginTop: 3 }} />
      <View style={{ flex: 1 }}>
        <Text style={st.rowLabel}>{label}</Text>
        <Text style={st.rowValue}>{value}</Text>
      </View>
    </View>
  );
}
function Line({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[st.line, !last && st.lineBorder]}>
      <Text style={st.lineLabel}>{label}</Text>
      <Text style={st.lineValue}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  driverCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line, marginTop: 8 },
  driverAv: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  driverName: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  driverSub: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  driverCall: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  statut: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, borderRadius: radius.lg, marginTop: 14 },
  statutIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  statutLabel: { fontSize: 16, fontWeight: '800' },
  statutSub: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 3, lineHeight: 18 },
  payCard: { backgroundColor: colors.brandTint, borderRadius: radius.lg, padding: 16, marginTop: 12, borderWidth: 1, borderColor: colors.brandSoft, alignItems: 'center' },
  payIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  payTitle: { fontSize: 15.5, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  payAmount: { fontSize: 26, fontWeight: '900', color: colors.brand, marginTop: 4 },
  payNumRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 10, marginTop: 10, borderWidth: 1, borderColor: colors.brandSoft },
  payNum: { fontSize: 18, fontWeight: '800', color: colors.ink, letterSpacing: 0.5 },
  paySub: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, textAlign: 'center', marginTop: 8, lineHeight: 18 },
  paidCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.greenSoft, borderRadius: radius.lg, padding: 14, marginTop: 12 },
  paidText: { flex: 1, fontSize: 13.5, fontWeight: '700', color: colors.green, lineHeight: 18 },
  // Ligne « libellé + montant » : le libellé CÈDE (flex 1), le montant JAMAIS (flexShrink 0).
  devis: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.ink, borderRadius: radius.lg, padding: 18, marginTop: 12, gap: 10 },
  devisLabel: { flex: 1, flexShrink: 1, fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.8)' },
  devisVal: { flexShrink: 0, textAlign: 'right', fontSize: 24, fontWeight: '800', color: '#fff' },
  section: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 24, marginBottom: 10 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 16 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  rowLabel: { fontSize: 12, fontWeight: '700', color: colors.inkSoft },
  rowValue: { fontSize: 15, fontWeight: '800', color: colors.ink, marginTop: 2 },
  sep: { height: 14, borderLeftWidth: 2, borderLeftColor: colors.line2, marginLeft: 6, marginVertical: 2 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  lineBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  // flexShrink : un intitulé long ne doit jamais pousser la valeur hors de l'écran.
  lineLabel: { fontSize: 14, fontWeight: '600', color: colors.inkSoft, flexShrink: 1, marginRight: 10 },
  lineValue: { fontSize: 14.5, fontWeight: '800', color: colors.ink, flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  info: { flexDirection: 'row', gap: 9, marginTop: 20, paddingHorizontal: 2 },
  infoText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, lineHeight: 18 },
});
