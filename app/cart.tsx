import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../theme';
import { Header, Btn, CtaBar } from '../components/ui';
import { fcfa } from '../data/mock';
import { useCart } from '../components/cart';
import { getServiceFee } from '../lib/db';

export default function Cart() {
  const router = useRouter();
  const { restaurant, items, setQty } = useCart();

  const setQte = (id: string, d: number) => setQty(id, d);

  // Frais de service : 0 par défaut (Taga se rémunère sur la commission resto). On lit la
  // valeur résolue par le serveur pour afficher exactement ce que la commande enregistrera.
  const [fraisService, setFraisService] = React.useState(0);
  React.useEffect(() => {
    let on = true;
    getServiceFee(restaurant?.id ?? null).then((f) => { if (on) setFraisService(f); }).catch(() => {});
    return () => { on = false; };
  }, [restaurant?.id]);

  const sousTotal = items.reduce((s, i) => s + i.prix * i.qte, 0);
  // Le panier ne connaît pas encore l'adresse : la livraison est calculée au checkout.
  // Ce montant est donc un sous-total HORS livraison — il est libellé comme tel partout.
  const total = sousTotal + (items.length ? fraisService : 0);
  const vide = items.length === 0;

  if (vide) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Header title="Mon panier" />
        <View style={st.empty}>
          <Text style={{ fontSize: 56 }}>🛒</Text>
          <Text style={st.emptyTitle}>Ton panier est vide</Text>
          <Text style={st.emptySub}>Ajoute des plats depuis un restaurant pour commencer ta commande.</Text>
          <Btn label="Parcourir les restaurants" onPress={() => router.replace('/food')} style={{ marginTop: 22, paddingHorizontal: 26 }} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Mon panier" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
        {/* Resto */}
        <View style={st.resto}>
          <View style={st.restoThumb}><Ionicons name="restaurant" size={22} color={colors.brand} /></View>
          <View>
            <Text style={st.restoName}>{restaurant?.nom ?? 'Restaurant'}</Text>
            <Text style={st.restoEta}>Livraison estimée · {restaurant?.eta ?? '25 min'}</Text>
          </View>
        </View>

        <View style={st.itemsCard}>
          {items.map((it, idx) => (
            <View key={it.id} style={[st.item, idx < items.length - 1 && st.itemBorder]}>
              <View style={st.itemThumb}><Ionicons name="fast-food" size={20} color={colors.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.itemName}>{it.nom}</Text>
                <Text style={st.itemPrix}>{fcfa(it.prix)}</Text>
              </View>
              <View style={st.stepper}>
                <Pressable onPress={() => setQte(it.id, -1)} style={st.stepBtn}><Ionicons name="remove" size={18} color={colors.ink} /></Pressable>
                <Text style={st.qte}>{it.qte}</Text>
                <Pressable onPress={() => setQte(it.id, 1)} style={st.stepBtn}><Ionicons name="add" size={18} color={colors.ink} /></Pressable>
              </View>
            </View>
          ))}
        </View>

        <Pressable style={st.addMore} onPress={() => router.back()}>
          <Ionicons name="add-circle-outline" size={20} color={colors.brand} />
          <Text style={st.addMoreText}>Ajouter d'autres plats</Text>
        </Pressable>

        {/* Récap */}
        <View style={st.summary}>
          <Line label="Sous-total" value={fcfa(sousTotal)} />
          <Line label="Livraison" value="Calculée à l'étape suivante" />
          {/* Ligne masquée quand le frais vaut 0 : afficher « 0 F » n'apporte rien. */}
          {fraisService > 0 && <Line label="Frais de service" value={fcfa(fraisService)} />}
          <View style={st.sep} />
          <Line label={fraisService > 0 ? 'Sous-total + service' : 'Total hors livraison'} value={fcfa(total)} bold />
        </View>
      </ScrollView>

      <CtaBar>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* On ne présente jamais ce montant comme le total : la livraison s'ajoute au checkout. */}
          <View>
            <Text style={st.ctaTotal}>{fcfa(total)}</Text>
            <Text style={st.ctaNote}>Hors livraison</Text>
          </View>
          <Btn label="Finaliser ma commande" onPress={() => router.push('/checkout')} style={{ flex: 1, marginLeft: 14 }} />
        </View>
      </CtaBar>
    </View>
  );
}

function Line({ label, value, green, bold }: { label: string; value: string; green?: boolean; bold?: boolean }) {
  return (
    <View style={st.line}>
      <Text style={[st.lineLabel, bold && { fontWeight: '800', color: colors.ink, fontSize: 16 }]}>{label}</Text>
      <Text style={[st.lineValue, green && { color: colors.green }, bold && { fontSize: 18 }]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingBottom: 80 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: colors.ink, marginTop: 16 },
  emptySub: { fontSize: 14, color: colors.inkSoft, fontWeight: '600', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  resto: { flexDirection: 'row', alignItems: 'center', gap: 13, marginHorizontal: space.lg, marginTop: 6, marginBottom: 10, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  restoThumb: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  restoName: { fontSize: 16, fontWeight: '800', color: colors.ink },
  restoEta: { fontSize: 13, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  itemsCard: { marginHorizontal: space.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, ...shadow.card },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  itemThumb: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  itemName: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  itemPrix: { fontSize: 14, fontWeight: '700', color: colors.inkSoft, marginTop: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 4, height: 40, borderWidth: 1, borderColor: colors.line2 },
  stepBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  qte: { fontSize: 15, fontWeight: '800', color: colors.ink, minWidth: 16, textAlign: 'center' },
  addMore: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: space.lg, marginTop: 16, height: 50, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.brandSoft, backgroundColor: colors.brandTint },
  addMoreText: { fontSize: 14.5, fontWeight: '800', color: colors.brand },
  summary: { marginHorizontal: space.lg, marginTop: 18, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  // Ligne « libellé + montant » : le libellé CÈDE (flex 1, il se replie), le montant JAMAIS
  // (flexShrink 0). Sans ça, les deux textes prenaient leur largeur naturelle et le montant
  // sortait de la carte quand le libellé était long (ex. « Encaissé en espèces (déjà en main) »).
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, gap: 10 },
  lineLabel: { flex: 1, flexShrink: 1, fontSize: 14.5, color: colors.inkSoft, fontWeight: '600' },
  lineValue: { flexShrink: 0, textAlign: 'right', fontSize: 14.5, fontWeight: '700', color: colors.ink },
  sep: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
  ctaTotal: { fontSize: 19, fontWeight: '800', color: colors.ink },
  ctaNote: { fontSize: 11.5, fontWeight: '700', color: colors.inkSoft, marginTop: 1 },
});
