import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Animated, PanResponder } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../theme';
import { Btn } from './ui';
import { fcfa } from '../data/mock';

export type ConfirmRow = { icon: keyof typeof Ionicons.glyphMap; label: string; value: string };

const SEUIL_FERMETURE = 0.25; // on ferme au-delà d'un quart de la hauteur de la feuille
const VITESSE_FERMETURE = 0.8; // ou si le doigt descend assez vite (px/ms)

/**
 * Récapitulatif avant recherche (façon Uber/Yango) : le client relit son trajet, le moyen de
 * déplacement et le prix, puis confirme. Rien n'est commandé tant qu'il n'a pas confirmé.
 *
 * La feuille est glissable : elle suit le doigt vers le bas et se ferme au-delà du seuil.
 */
export function ConfirmOrder({
  open, onClose, onConfirm, loading = false, titre = 'Confirmer la commande', moyen, rows, total, totalLabel = 'Total estimé', cta = 'Confirmer',
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
  titre?: string;
  moyen?: string;         // moyen de déplacement / service (ex : « Taga Eco », « Livraison Moto »)
  rows: ConfirmRow[];     // trajet, arrêts, options…
  total: number;
  totalLabel?: string;
  cta?: string;
}) {
  // Feuille glissable, même mécanique que la fiche chauffeur (app/trip-active.tsx) :
  // PanResponder + Animated de react-native (reanimated n'est pas installé sur le projet).
  const sheetY = useRef(new Animated.Value(0)).current;
  const sheetH = useRef(0);
  const [hauteur, setHauteur] = useState(0);

  // Le PanResponder n'est créé qu'une fois : on lit toujours la dernière version de onClose.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // À chaque réouverture, la feuille repart de sa position haute.
  useEffect(() => { if (open) sheetY.setValue(0); }, [open, sheetY]);

  const revenir = () => {
    Animated.spring(sheetY, { toValue: 0, useNativeDriver: true, bounciness: 4, speed: 14 }).start();
  };

  const pan = useRef(
    PanResponder.create({
      // On ne capte que les glissements vers le bas bien verticaux : un éventuel scroll du
      // contenu (ou un appui sur un bouton) n'est jamais volé par la feuille.
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        sheetY.setValue(Math.max(0, g.dy)); // vers le bas uniquement : la feuille suit le doigt
      },
      onPanResponderRelease: (_e, g) => {
        const h = sheetH.current || 1;
        // Assez descendu (1/4 de la feuille) ou geste rapide vers le bas → on ferme.
        if (g.dy > h * SEUIL_FERMETURE || g.vy > VITESSE_FERMETURE) {
          Animated.timing(sheetY, { toValue: h, duration: 160, useNativeDriver: true }).start(({ finished }) => {
            if (finished) closeRef.current();
          });
        } else {
          revenir(); // sinon retour en place, avec un petit ressort
        }
      },
      onPanResponderTerminate: () => revenir(),
    }),
  ).current;

  // Le voile s'estompe au fur et à mesure que la feuille descend.
  const opaciteVoile = sheetY.interpolate({
    inputRange: [0, Math.max(1, hauteur)],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={st.wrap}>
        <Animated.View style={[st.voile, { opacity: opaciteVoile }]} pointerEvents="none" />
        <Pressable style={{ flex: 1 }} onPress={onClose} />

        <Animated.View
          style={{ transform: [{ translateY: sheetY }] }}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            sheetH.current = h;
            setHauteur(h);
          }}
        >
          <SafeAreaView edges={['bottom']} style={st.sheet}>
            {/* Zone de préhension large : poignée + en-tête, pour viser facilement */}
            <View style={st.grab} {...pan.panHandlers}>
              <View style={st.handle} />
              <View style={st.head}>
                <Text style={st.title}>{titre}</Text>
                {moyen ? <View style={st.moyen}><Text style={st.moyenTxt}>{moyen}</Text></View> : null}
              </View>
            </View>

            <View style={st.card}>
              {rows.map((r, i) => (
                <View key={i} style={[st.row, i > 0 && st.rowSep]}>
                  <View style={st.rowIc}><Ionicons name={r.icon} size={17} color={colors.brand} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.rowLabel}>{r.label}</Text>
                    <Text style={st.rowValue} numberOfLines={2}>{r.value}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={st.totalRow}>
              <Text style={st.totalLabel}>{totalLabel}</Text>
              <Text style={st.totalVal}>{fcfa(total)}</Text>
            </View>

            <Btn label={cta} loading={loading} onPress={onConfirm} />
            <Pressable onPress={onClose} style={st.cancel} hitSlop={8}>
              <Text style={st.cancelTxt}>Modifier</Text>
            </Pressable>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  voile: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(21,17,14,0.45)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: 10, paddingBottom: 8, ...shadow.pop },
  // La zone de préhension déborde sur les marges de la feuille pour être large à viser.
  grab: { marginHorizontal: -space.lg, paddingHorizontal: space.lg, paddingTop: 4, marginTop: -4 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line2, alignSelf: 'center', marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontSize: 20, fontWeight: '800', color: colors.ink },
  moyen: { backgroundColor: colors.brandTint, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  moyenTxt: { fontSize: 13, fontWeight: '800', color: colors.brandDeep },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  rowSep: { borderTopWidth: 1, borderTopColor: colors.line },
  rowIc: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 11.5, fontWeight: '800', color: colors.inkMute, textTransform: 'uppercase', letterSpacing: 0.4 },
  rowValue: { fontSize: 14.5, fontWeight: '700', color: colors.ink, marginTop: 2 },
  // Ligne « libellé + montant » : le libellé CÈDE (flex 1, il se replie), le montant JAMAIS
  // (flexShrink 0). Sans ça, les deux textes prenaient leur largeur naturelle et le montant
  // sortait de la carte quand le libellé était long (ex. « Encaissé en espèces (déjà en main) »).
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 14, gap: 10 },
  totalLabel: { flex: 1, flexShrink: 1, fontSize: 13, fontWeight: '700', color: colors.inkSoft },
  totalVal: { flexShrink: 0, textAlign: 'right', fontSize: 22, fontWeight: '800', color: colors.ink },
  cancel: { alignItems: 'center', paddingVertical: 12, marginTop: 2 },
  cancelTxt: { fontSize: 14.5, fontWeight: '800', color: colors.inkSoft },
});
