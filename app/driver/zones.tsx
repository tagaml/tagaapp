import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../../theme';
import { Header, Btn, useToast } from '../../components/ui';
import { bamakoZones } from '../../components/TripMap';
import { getDriverZones, addDriverZone, removeDriverZone, getDemandZones, type DriverZone } from '../../lib/db';

export default function Zones() {
  const toast = useToast();
  const [zones, setZones] = useState<DriverZone[]>([]);
  const [demande, setDemande] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [erreur, setErreur] = useState(false); // panne réseau ≠ « aucune zone » : on distingue les deux

  const charger = useCallback(async () => {
    setErreur(false);
    try {
      const [z, d] = await Promise.all([getDriverZones(), getDemandZones().catch(() => [])]);
      setZones(z);
      const map: Record<string, string> = {};
      (d as any[]).forEach((x) => { if (x?.nom) map[x.nom] = x.level; });
      setDemande(map);
    } catch {
      // Échec de chargement : ne pas faire passer une panne réseau pour « aucune zone ».
      setZones((prev) => { if (prev.length === 0) setErreur(true); return prev; });
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(useCallback(() => { charger(); }, [charger]));

  // Zones de Bamako pas encore ajoutées (pour le sélecteur).
  const dispo: { nom: string; level: string }[] = bamakoZones
    .filter((z) => !!z.nom && !zones.some((x) => x.nom === z.nom))
    .map((z) => ({ nom: z.nom as string, level: String(z.level) }));

  const ajouterZone = async (nom: string) => {
    setBusy(nom);
    try {
      await addDriverZone(nom);
      await charger();
      toast('Zone ajoutée', { tone: 'success' });
      if (dispo.length <= 1) setAddOpen(false); // c'était la dernière
    } catch {
      toast('Impossible d\'ajouter la zone. Réessaie.', { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const retirer = (z: DriverZone) => {
    Alert.alert('Retirer la zone', `Retirer « ${z.nom} » de tes zones préférées ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: async () => { try { await removeDriverZone(z.id); await charger(); } catch { toast('Impossible de retirer la zone. Réessaie.', { tone: 'error' }); } } },
    ]);
  };

  const niveau = (nom: string) => demande[nom];
  const lvlColor = (lvl?: string) => lvl === 'forte' ? colors.brandDeep : lvl === 'moyenne' ? colors.gold : colors.green;
  const lvlBg = (lvl?: string) => lvl === 'forte' ? colors.brandSoft : lvl === 'moyenne' ? colors.goldSoft : colors.greenSoft;
  const lvlText = (lvl?: string) => lvl === 'forte' ? 'Forte' : lvl === 'moyenne' ? 'Moyenne' : 'Faible';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Zones préférées" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
        <Text style={st.intro}>Reçois en priorité les courses qui partent de tes zones favorites.</Text>

        {!loaded ? (
          <View style={st.empty}>
            <ActivityIndicator color={colors.brand} size="large" />
          </View>
        ) : erreur && zones.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="cloud-offline-outline" size={38} color={colors.brand} />
            <Text style={st.emptyText}>Impossible de charger tes zones. Vérifie ta connexion — tes zones sont bien enregistrées.</Text>
            <Btn label="Réessayer" onPress={charger} style={{ alignSelf: 'stretch', marginTop: 4 }} />
          </View>
        ) : zones.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="location-outline" size={38} color={colors.inkMute} />
            <Text style={st.emptyText}>Aucune zone pour l'instant. Ajoute tes quartiers favoris ci-dessous.</Text>
          </View>
        ) : zones.map((z) => {
          const lvl = niveau(z.nom);
          return (
            <View key={z.id} style={st.item}>
              <View style={st.icon}><Ionicons name="location" size={20} color={colors.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.nom}>{z.nom}</Text>
                <Text style={st.sous}>{lvl === 'forte' ? 'Forte demande en ce moment' : lvl === 'moyenne' ? 'Demande moyenne' : lvl === 'faible' ? 'Demande faible' : 'Zone favorite'}</Text>
              </View>
              {lvl && (
                <View style={[st.tag, { backgroundColor: lvlBg(lvl) }]}>
                  <Text style={[st.tagText, { color: lvlColor(lvl) }]}>{lvlText(lvl)}</Text>
                </View>
              )}
              <Pressable onPress={() => retirer(z)} hitSlop={8} style={st.trash}>
                <Ionicons name="trash-outline" size={18} color={colors.inkMute} />
              </Pressable>
            </View>
          );
        })}

        <Btn
          label={dispo.length ? 'Ajouter une zone' : 'Toutes les zones sont ajoutées'}
          variant="ghost"
          onPress={() => dispo.length ? setAddOpen(true) : toast('Toutes les zones sont déjà ajoutées')}
          style={{ marginTop: 18 }}
        />
      </ScrollView>

      {/* Sélecteur de zones (modal) — remplace l'Alert qui ne gère pas plus de 3 boutons sur Android */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={st.backdrop} onPress={() => setAddOpen(false)} />
        <View style={st.sheet}>
          <View style={st.sheetHead}>
            <Text style={st.sheetTitle}>Ajouter une zone</Text>
            <Pressable onPress={() => setAddOpen(false)} hitSlop={10} style={st.sheetClose}>
              <Ionicons name="close" size={22} color={colors.ink} />
            </Pressable>
          </View>
          <Text style={st.sheetSub}>Choisis un quartier de Bamako</Text>
          <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ paddingBottom: 10 }} showsVerticalScrollIndicator={false}>
            {dispo.map((z) => (
              <Pressable key={z.nom} style={st.pick} disabled={!!busy} onPress={() => ajouterZone(z.nom)}>
                <View style={st.pickIcon}><Ionicons name="location-outline" size={18} color={colors.brand} /></View>
                <Text style={st.pickNom}>{z.nom}</Text>
                {/* Niveau de demande RÉEL (map live), pas la valeur statique de la seed. */}
                {niveau(z.nom) ? (
                  <View style={[st.tag, { backgroundColor: lvlBg(niveau(z.nom)) }]}>
                    <Text style={[st.tagText, { color: lvlColor(niveau(z.nom)) }]}>{lvlText(niveau(z.nom))}</Text>
                  </View>
                ) : null}
                <Ionicons name={busy === z.nom ? 'hourglass-outline' : 'add-circle'} size={22} color={colors.brand} />
              </Pressable>
            ))}
          </ScrollView>
          {/* Sortie explicite : croix, fond, retour Android… et un vrai bouton Annuler à portée de pouce. */}
          <Pressable style={st.cancel} onPress={() => setAddOpen(false)} disabled={!!busy}>
            <Text style={st.cancelText}>Annuler</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  intro: { fontSize: 14.5, fontWeight: '600', color: colors.inkSoft, lineHeight: 21, marginTop: 6, marginBottom: 18 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 36, paddingHorizontal: 20 },
  emptyText: { fontSize: 14, fontWeight: '600', color: colors.inkSoft, textAlign: 'center', lineHeight: 20 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line, marginBottom: 12 },
  icon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  nom: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  sous: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 3 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  tagText: { fontSize: 12, fontWeight: '800' },
  trash: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  // Modal
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space.lg, paddingTop: 16, paddingBottom: 28 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  sheetClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  sheetSub: { fontSize: 13.5, fontWeight: '600', color: colors.inkSoft, marginTop: 4, marginBottom: 12 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line, marginBottom: 10 },
  pickIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  pickNom: { flex: 1, fontSize: 15.5, fontWeight: '800', color: colors.ink },
  cancel: { height: 52, borderRadius: radius.lg, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  cancelText: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
});
