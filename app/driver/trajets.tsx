import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../../theme';
import { Header, Btn } from '../../components/ui';
import { fcfa } from '../../data/mock';
import {
  getDriverRides, getDriverDeliveries, getMyMovings, getDeliveryDriverPct, getCamionCommission, gainLivraison,
  type DriverRide, type DeliveryOrder, type MovingRequest,
} from '../../lib/db';

const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const STATUT_LABEL: Record<string, string> = {
  termine: 'Terminée', annule: 'Annulée', en_cours: 'En cours', en_route: 'En route', arrive: 'Arrivé',
  recherche: 'En recherche', programme: 'Programmée', livraison: 'En livraison', prete: 'Prête',
  confirme: 'Confirmé', devis: 'Devis', paye: 'Payé',
  confirmee: 'Confirmée', preparation: 'En préparation', livree: 'Livrée', annulee: 'Annulée',
};

type Kind = 'course' | 'livraison' | 'demenagement';
type Hist = {
  key: string; kind: Kind; icon: any; title: string; when: number; dateISO: string;
  amount: number; annule: boolean; statut: string; depart?: string | null; arrivee?: string | null;
  rows: { label: string; value: string; strong?: boolean }[];
};

const KIND_LABEL: Record<Kind, string> = { course: 'Course', livraison: 'Livraison', demenagement: 'Déménagement' };

const FILTRES: { key: 'tout' | Kind; label: string }[] = [
  { key: 'tout', label: 'Tout' },
  { key: 'course', label: 'Courses' },
  { key: 'livraison', label: 'Livraisons' },
  { key: 'demenagement', label: 'Déménagements' },
];

function dateComplete(iso: string): string {
  const d = new Date(iso);
  const h = `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]} · ${h}`;
}
function dateCourt(iso: string): string {
  const d = new Date(iso);
  const jc = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][d.getDay()];
  return `${jc} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const sl = (s: string) => STATUT_LABEL[s] ?? s;

export default function Trajets() {
  const [items, setItems] = useState<Hist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sel, setSel] = useState<Hist | null>(null);
  const [filtre, setFiltre] = useState<'tout' | Kind>('tout');

  const charger = useCallback(async () => {
    setError(false);
    try {
      const [rides, deliveries, movings, pct, commPct] = await Promise.all([
        getDriverRides(), getDriverDeliveries(), getMyMovings(), getDeliveryDriverPct(), getCamionCommission(),
      ]);

      const list: Hist[] = [];

      for (const r of rides as DriverRide[]) {
        const annule = r.statut === 'annule';
        const typeLabel = r.type === 'moto' ? 'Course moto' : r.type === 'colis' ? 'Course colis' : 'Course voiture';
        list.push({
          key: 'r' + r.id, kind: 'course',
          icon: r.type === 'moto' ? 'bicycle' : r.type === 'colis' ? 'cube' : 'navigate',
          title: r.destination ?? typeLabel, when: new Date(r.created_at).getTime(), dateISO: r.created_at,
          amount: annule ? (r.cancel_fee ?? 0) : r.prix, annule, statut: r.statut,
          depart: r.depart, arrivee: r.destination,
          rows: [
            { label: 'Type', value: typeLabel },
            { label: 'Statut', value: sl(r.statut) },
            ...(r.passager_nom ? [{ label: 'Client', value: r.passager_nom }] : []),
            ...(r.distance_km != null ? [{ label: 'Distance', value: `${r.distance_km.toFixed(1).replace('.', ',')} km` }] : []),
            ...(r.vehicule ? [{ label: 'Véhicule', value: r.vehicule }] : []),
            annule
              ? { label: "Frais d'annulation", value: fcfa(r.cancel_fee ?? 0), strong: true }
              : { label: 'Gain de la course', value: `+${fcfa(r.prix)}`, strong: true },
            ...(r.pourboire ? [{ label: 'Pourboire', value: `+${fcfa(r.pourboire)}` }] : []),
            ...(r.chauffeur_note != null ? [{ label: 'Ta note', value: `${r.chauffeur_note.toFixed(1).replace('.', ',')} ★` }] : []),
          ],
        });
      }

      for (const o of deliveries as DeliveryOrder[]) {
        const annule = o.statut === 'annulee';
        const gain = o.frais_livraison != null ? gainLivraison(Number(o.frais_livraison), Number(o.pourboire ?? 0), pct) : 0;
        list.push({
          key: 'd' + o.id, kind: 'livraison', icon: 'fast-food',
          title: o.restaurant_nom ?? 'Livraison', when: new Date(o.created_at).getTime(), dateISO: o.created_at,
          amount: annule ? 0 : gain, annule, statut: o.statut,
          depart: o.restaurant_nom, arrivee: o.adresse,
          rows: [
            { label: 'Type', value: 'Livraison repas' },
            { label: 'Statut', value: sl(o.statut) },
            ...(o.client_nom ? [{ label: 'Client', value: o.client_nom }] : []),
            annule ? { label: 'Livraison', value: 'Annulée', strong: true }
                   : { label: 'Gain livraison', value: `+${fcfa(gain)}`, strong: true },
            ...(o.pourboire ? [{ label: 'Pourboire', value: `+${fcfa(Number(o.pourboire))} (inclus)` }] : []),
          ],
        });
      }

      for (const m of movings as MovingRequest[]) {
        const net = m.prix != null ? Math.round((Number(m.prix) || 0) * (100 - commPct) / 100) : 0;
        const annule = m.statut === 'annule';
        list.push({
          key: 'm' + m.id, kind: 'demenagement', icon: 'bus',
          title: m.arrivee ? `Vers ${m.arrivee}` : 'Déménagement', when: new Date(m.created_at).getTime(), dateISO: m.created_at,
          amount: annule ? 0 : net, annule, statut: m.statut,
          depart: m.depart, arrivee: m.arrivee,
          rows: [
            { label: 'Type', value: 'Déménagement' },
            { label: 'Statut', value: sl(m.statut) },
            ...(m.volume ? [{ label: 'Volume', value: m.volume }] : []),
            ...(m.creneau ? [{ label: 'Créneau', value: m.creneau }] : []),
            annule ? { label: 'Déménagement', value: 'Annulé', strong: true }
                   : { label: 'Gain net', value: `+${fcfa(net)}`, strong: true },
            ...(m.prix != null && !annule ? [{ label: 'Détail', value: `${fcfa(Number(m.prix))} − ${commPct}% Taga` }] : []),
          ],
        });
      }

      list.sort((a, b) => b.when - a.when);
      setItems(list);
    } catch {
      setItems((prev) => { if (prev.length === 0) setError(true); return prev; });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { charger(); }, [charger]));

  const filtres = useMemo(() => {
    const counts: Record<string, number> = { course: 0, livraison: 0, demenagement: 0 };
    items.forEach((i) => { counts[i.kind]++; });
    // On masque un onglet de type totalement vide (sauf « Tout »), pour ne pas encombrer.
    return FILTRES.filter((f) => f.key === 'tout' || counts[f.key] > 0);
  }, [items]);

  const visibles = filtre === 'tout' ? items : items.filter((i) => i.kind === filtre);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Mes courses" />

      {!loading && !error && items.length > 0 && filtres.length > 2 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tabs}>
          {filtres.map((f) => (
            <Pressable key={f.key} onPress={() => setFiltre(f.key)} style={[st.tab, filtre === f.key && st.tabOn]}>
              <Text style={[st.tabText, filtre === f.key && st.tabTextOn]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={st.empty}><ActivityIndicator color={colors.brand} size="large" /></View>
        ) : error ? (
          <View style={st.empty}>
            <Ionicons name="cloud-offline-outline" size={48} color={colors.inkMute} />
            <Text style={st.emptyText}>Impossible de charger ton historique</Text>
            <Btn label="Réessayer" onPress={charger} style={{ marginTop: 4 }} />
          </View>
        ) : visibles.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="time-outline" size={48} color={colors.inkMute} />
            <Text style={st.emptyText}>Rien pour l'instant</Text>
          </View>
        ) : (
          visibles.map((h) => (
            <Pressable key={h.key} style={({ pressed }) => [st.item, pressed && { backgroundColor: colors.surface2 }]} onPress={() => setSel(h)}>
              <View style={[st.itemIcon, h.annule && st.itemIconMute]}><Ionicons name={h.icon} size={19} color={h.annule ? colors.inkSoft : colors.brand} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={st.itemTop}>
                  <Text style={st.dest} numberOfLines={1}>{h.title}</Text>
                  <Text style={[st.prix, h.annule && st.prixMute]}>{h.annule ? (h.amount > 0 ? fcfa(h.amount) : '—') : `+${fcfa(h.amount)}`}</Text>
                </View>
                <View style={st.itemBot}>
                  <Text style={st.meta} numberOfLines={1}>{dateCourt(h.dateISO)} · {KIND_LABEL[h.kind]}</Text>
                  {h.annule ? <View style={st.cancelPill}><Text style={st.cancelPillText}>Annulée</Text></View> : null}
                </View>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable style={st.backdrop} onPress={() => setSel(null)} />
        {sel && (
          <View style={st.sheet}>
            <View style={st.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={st.sheetTitle}>{sel.kind === 'livraison' ? 'Livraison' : sel.kind === 'demenagement' ? 'Déménagement' : 'Course'}</Text>
                <Text style={st.sheetSub}>{dateComplete(sel.dateISO)}</Text>
              </View>
              <Pressable onPress={() => setSel(null)} hitSlop={10} style={st.sheetClose}>
                <Ionicons name="close" size={22} color={colors.ink} />
              </Pressable>
            </View>

            {(sel.depart || sel.arrivee) ? (
              <View style={st.route}>
                <View style={st.routeRow}>
                  <View style={[st.routeDot, { backgroundColor: colors.green }]} />
                  <Text style={st.routeText} numberOfLines={2}>{sel.depart ?? 'Départ'}</Text>
                </View>
                <View style={st.routeLine} />
                <View style={st.routeRow}>
                  <View style={[st.routeDot, { backgroundColor: colors.brand }]} />
                  <Text style={st.routeText} numberOfLines={2}>{sel.arrivee ?? '—'}</Text>
                </View>
              </View>
            ) : null}

            <View style={st.rows}>
              {sel.rows.map((r, i) => (
                <View key={i} style={[st.dRow, i === sel.rows.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={st.dLabel}>{r.label}</Text>
                  <Text style={[st.dValue, r.strong && { fontSize: 16, color: colors.green }]}>{r.value}</Text>
                </View>
              ))}
            </View>

            <Btn label="Fermer" variant="ghost" onPress={() => setSel(null)} style={{ marginTop: 16 }} />
          </View>
        )}
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  tabs: { gap: 8, paddingHorizontal: space.lg, paddingTop: 10, paddingBottom: 6 },
  tab: { paddingHorizontal: 15, height: 36, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  tabText: { fontSize: 13.5, fontWeight: '800', color: colors.ink2 },
  tabTextOn: { color: colors.white },
  empty: { alignItems: 'center', marginTop: 80, gap: 14 },
  emptyText: { fontSize: 15.5, fontWeight: '700', color: colors.inkSoft },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line, marginBottom: 12 },
  itemIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  itemIconMute: { backgroundColor: colors.surface2 },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemBot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  dest: { flex: 1, fontSize: 15.5, fontWeight: '800', color: colors.ink },
  meta: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.inkSoft },
  prix: { fontSize: 15.5, fontWeight: '800', color: colors.green },
  prixMute: { color: colors.inkSoft },
  cancelPill: { backgroundColor: colors.brandTint, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  cancelPillText: { fontSize: 11, fontWeight: '800', color: colors.brandDeep },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space.lg, paddingTop: 16, paddingBottom: 32 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  sheetSub: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 3 },
  sheetClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  route: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line, marginBottom: 14 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  routeDot: { width: 11, height: 11, borderRadius: 6 },
  routeLine: { width: 2, height: 18, backgroundColor: colors.line2, marginLeft: 4.5, marginVertical: 3 },
  routeText: { flex: 1, fontSize: 14.5, fontWeight: '700', color: colors.ink },
  rows: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.line },
  dRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.line },
  dLabel: { fontSize: 14, fontWeight: '600', color: colors.inkSoft },
  dValue: { fontSize: 14.5, fontWeight: '800', color: colors.ink, flexShrink: 1, textAlign: 'right', marginLeft: 12 },
});
