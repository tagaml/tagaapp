import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Share } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../theme';
import { Header, Btn, FoodImage } from '../components/ui';
import { fcfa, FOOD_IMG } from '../data/mock';
import { getOrder, type OrderDetail } from '../lib/db';

// Formatage DÉTERMINISTE (pas de toLocaleDateString : l'ICU d'Hermes/Android peut ne pas
// rendre le mois « long » en français, voire échouer selon l'appareil).
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function dateLabel(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MOIS[d.getMonth()]}` +
    ` · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function Receipt() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    getOrder(id).then((o) => setOrder(o)).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Header title="Reçu" />
        <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
      </View>
    );
  }
  if (!order) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Header title="Reçu" />
        <Text style={st.emptyTxt}>Commande introuvable.</Text>
      </View>
    );
  }

  const sousTotal = order.sous_total ?? order.items.reduce((s, it) => s + it.prix * it.qte, 0);
  const livr = order.frais_livraison ?? 0;
  const service = order.frais_service ?? 0;
  const credit = (order as any).credit_applied > 0 ? (order as any).credit_applied : 0;
  const remise = Number((order as any).remise) > 0 ? Number((order as any).remise) : 0;
  // order.total est DÉJÀ net de la remise et du crédit (calculé côté serveur) : on ne re-soustrait rien.
  const totalPaye = order.total;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Reçu" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 30 }}>
        <View style={st.head}>
          <FoodImage uri={FOOD_IMG.chicken} emoji="🍗" emojiSize={30} radius={20} style={st.thumb} />
          <Text style={st.resto}>{order.restaurant_nom || 'Restaurant'}</Text>
          <Text style={st.date}>{dateLabel(order.created_at)} · Commande #{order.id.slice(0, 6).toUpperCase()}</Text>
        </View>

        <View style={st.infoBox}>
          {order.adresse ? <Info icon="location" text={`Livré à ${order.adresse}`} /> : null}
          <Info icon="card" text={`Payé avec ${order.paiement || 'Orange Money'}`} last />
        </View>

        <Text style={st.label}>Articles</Text>
        <View style={st.box}>
          {order.items.length ? order.items.map((it, i) => (
            <Article key={i} qte={String(it.qte)} nom={it.nom} prix={it.prix * it.qte} last={i === order.items.length - 1} />
          )) : <Text style={[st.infoText, { padding: 14 }]}>Aucun article enregistré.</Text>}
        </View>

        <Text style={st.label}>Détail du tarif</Text>
        <View style={st.box}>
          <Line label="Sous-total" value={fcfa(sousTotal)} />
          <Line label="Frais de livraison" value={livr > 0 ? fcfa(livr) : 'Offerte'} green={livr === 0} />
          {service > 0 ? <Line label="Frais de service" value={fcfa(service)} /> : null}
          {order.pourboire ? <Line label="Pourboire" value={fcfa(order.pourboire)} /> : null}
          {remise > 0 ? <Line label="Réduction" value={`-${fcfa(remise)}`} green /> : null}
          {credit > 0 ? <Line label="Crédit Taga appliqué" value={`-${fcfa(credit)}`} green /> : null}
          <View style={st.sep} />
          <Line label="Total payé" value={fcfa(totalPaye)} bold />
        </View>

        <Btn
          label="Partager le reçu"
          variant="ghost"
          onPress={() => {
            const lignes = [
              `Reçu Taga · ${order.restaurant_nom || 'Restaurant'}`,
              `Commande #${order.id.slice(0, 6).toUpperCase()} · ${dateLabel(order.created_at)}`,
              ...order.items.map((it) => `${it.qte}× ${it.nom} — ${fcfa(it.prix * it.qte)}`),
              ...(credit > 0 ? [`Crédit Taga : -${fcfa(credit)}`] : []),
              `Total payé : ${fcfa(totalPaye)}`,
            ].join('\n');
            Share.share({ message: lignes }).catch(() => {});
          }}
          style={{ marginTop: 20 }}
        />
        <Btn label="Commander à nouveau" onPress={() => router.push('/food')} style={{ marginTop: 12 }} />
      </ScrollView>
    </View>
  );
}

function Info({ icon, text, last }: { icon: any; text: string; last?: boolean }) {
  return (
    <View style={[st.info, !last && st.infoBorder]}>
      <Ionicons name={icon} size={18} color={colors.inkSoft} />
      <Text style={st.infoText}>{text}</Text>
    </View>
  );
}
function Article({ qte, nom, prix, last }: { qte: string; nom: string; prix: number; last?: boolean }) {
  return (
    <View style={[st.article, !last && st.infoBorder]}>
      <Text style={st.artQte}>{qte} ×</Text>
      <Text style={st.artNom}>{nom}</Text>
      <Text style={st.artPrix}>{fcfa(prix)}</Text>
    </View>
  );
}
function Line({ label, value, green, bold }: { label: string; value: string; green?: boolean; bold?: boolean }) {
  return (
    <View style={st.line}>
      <Text style={[st.lineLabel, bold && { color: colors.ink, fontWeight: '800', fontSize: 16 }]}>{label}</Text>
      <Text style={[st.lineValue, green && { color: colors.green }, bold && { fontSize: 18 }]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  emptyTxt: { textAlign: 'center', color: colors.inkSoft, fontWeight: '600', marginTop: 40, paddingHorizontal: space.lg },
  head: { alignItems: 'center', paddingTop: 8, paddingBottom: 8 },
  thumb: { width: 72, height: 72, borderRadius: 22, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  resto: { fontSize: 22, fontWeight: '800', color: colors.ink, marginTop: 14 },
  date: { fontSize: 13, color: colors.inkSoft, fontWeight: '600', marginTop: 4, textAlign: 'center' },
  infoBox: { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: 18, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  info: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  infoBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  infoText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: colors.ink2 },
  label: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 22, marginBottom: 10 },
  box: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  article: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13 },
  artQte: { fontSize: 14, fontWeight: '800', color: colors.brand },
  artNom: { flex: 1, fontSize: 14.5, fontWeight: '700', color: colors.ink },
  artPrix: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  // Ligne « libellé + montant » : le libellé CÈDE (flex 1, il se replie), le montant JAMAIS
  // (flexShrink 0). Sans ça, les deux textes prenaient leur largeur naturelle et le montant
  // sortait de la carte quand le libellé était long (ex. « Encaissé en espèces (déjà en main) »).
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, gap: 10 },
  lineLabel: { flex: 1, flexShrink: 1, fontSize: 14.5, color: colors.inkSoft, fontWeight: '600' },
  lineValue: { flexShrink: 0, textAlign: 'right', fontSize: 14.5, fontWeight: '700', color: colors.ink },
  sep: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
});
