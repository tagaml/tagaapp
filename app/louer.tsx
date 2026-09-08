import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Image, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { colors, radius, space } from '../theme';
import { Header, Btn, CtaBar, ServiceIcon, voitureImages } from '../components/ui';
import { fcfa } from '../data/mock';
import { createRide, getLocationTarifs, getLocationGammes, getServiceFees } from '../lib/db';
import { AdjustOnMap, DestinationPicker, type Place } from '../components/RideMap';
import { TripMap, BAMAKO } from '../components/TripMap';
import { getRecentDestinations } from '../lib/db';
import { PaymentSelector, type PaymentChoice } from '../components/PaymentSelector';
import { ensureInMali, HORS_MALI_MSG, RESTRICT_TO_MALI, inMaliBox } from '../lib/geoGuard';
import { play } from '../lib/sound';
import { st } from './ride-voiture';

type Pt = { latitude: number; longitude: number };

const VEHICULES = [
  { id: 'voiture' as const, nom: 'Voiture', icon: 'car' as const },
  { id: 'moto' as const, nom: 'Moto', icon: 'moto' as const },
];

const GAMMES = [
  { id: 'standard', nom: 'Eco', mult: 1, badge: '' },
  { id: 'confort', nom: 'Fresh', mult: 1.5, badge: 'Clim' },
  { id: 'xl', nom: 'SUV', mult: 1.9, badge: '6 places' },
];

const HOUR_MAX = 12;
const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

const pad = (n: number) => String(n).padStart(2, '0');
function fmtHours(h: number): string {
  if (h <= 0) return '';
  const wh = Math.floor(h);
  return `${wh}h${h - wh >= 0.5 ? '30' : ''}`;
}
function dayLabel(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  if (offset === 0) return "Aujourd'hui";
  if (offset === 1) return 'Demain';
  return `${JOURS[d.getDay()]} ${d.getDate()}`;
}
// Créneaux horaires 06:00 → 22:00 par pas de 30 min.
const ALL_TIMES: string[] = [];
for (let h = 6; h <= 22; h++) { ALL_TIMES.push(`${pad(h)}:00`); if (h < 22) ALL_TIMES.push(`${pad(h)}:30`); }

export default function Louer() {
  const router = useRouter();
  const [veh, setVeh] = useState<'voiture' | 'moto'>('voiture');
  const [gamme, setGamme] = useState('standard');
  const [hours, setHours] = useState(0); // 0 = pas encore choisi (prix masqué)
  const [mode, setMode] = useState<'now' | 'plan'>('now');
  const [dayOffset, setDayOffset] = useState(0);
  const [time, setTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tarifs, setTarifs] = useState<Record<string, number>>({ voiture: 5000, moto: 3000 });
  // Prix horaire ABSOLU par gamme (Eco/Fresh/SUV), réglé côté admin.
  const [gTarif, setGTarif] = useState<Record<string, number>>({ standard: 5000, confort: 7500, xl: 9500 });
  const [locFeeH, setLocFeeH] = useState(200); // frais de service par heure (réglé admin)
  const [pay, setPay] = useState<PaymentChoice>({ method: 'Espèces', creditApplied: 0 });

  // Point de prise en charge (adresse + coordonnées) — visible, cherchable et ajustable.
  const [pickup, setPickup] = useState<{ label: string; point: Pt } | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recents, setRecents] = useState<Place[]>([]);
  useEffect(() => { getRecentDestinations().then((r) => setRecents(r as Place[])).catch(() => {}); }, []);
  useEffect(() => {
    getLocationTarifs().then(setTarifs).catch(() => {});
    getLocationGammes().then(setGTarif).catch(() => {});
    getServiceFees().then((f) => setLocFeeH(f.locHour)).catch(() => {});
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        // Restriction Mali activée : hors du Mali on ignore le GPS et on laisse choisir un point à Bamako.
        if (RESTRICT_TO_MALI && !inMaliBox(p.coords.latitude, p.coords.longitude)) return;
        const point: Pt = { latitude: p.coords.latitude, longitude: p.coords.longitude };
        let label = 'Ma position';
        try {
          const g = (await Location.reverseGeocodeAsync(point))[0];
          if (g) { const l = [g.name || g.street, g.district || g.city].filter(Boolean).join(', '); if (l) label = l; }
        } catch { /* garde « Ma position » */ }
        setPickup({ label, point });
      } catch { /* pas de position : le pickup restera à préciser */ }
    })();
  }, []);

  const vObj = VEHICULES.find((v) => v.id === veh)!;
  const gObj = GAMMES.find((g) => g.id === gamme)!;
  const hasDuree = hours >= 1;
  // Tarif horaire voiture = gamme sélectionnée (identique aux tuiles de gamme, pour rester cohérent).
  const voitureTarifH = Math.round((gTarif[gamme] ?? (5000 * gObj.mult)) / 500) * 500;
  const tarifH = veh === 'voiture' ? voitureTarifH : (tarifs.moto ?? 3000);
  const baseTotal = hasDuree ? Math.round((tarifH * hours) / 50) * 50 : 0;
  // Frais de service Taga : locFeeH F par heure (transparent, ajouté au tarif).
  const fraisService = hasDuree ? Math.round(locFeeH * hours) : 0;
  const total = baseTotal + fraisService;

  const inc = () => setHours((h) => (h === 0 ? 1 : Math.min(HOUR_MAX, h + 0.5)));
  const dec = () => setHours((h) => (h <= 1 ? 0 : Math.max(0, h - 0.5)));

  // Créneaux dispo : si aujourd'hui, on masque les heures déjà passées (+30 min de marge).
  const times = dayOffset === 0
    ? ALL_TIMES.filter((t) => {
        const [hh, mm] = t.split(':').map(Number);
        const d = new Date(); d.setHours(hh, mm, 0, 0);
        return d.getTime() > Date.now() + 30 * 60000;
      })
    : ALL_TIMES;

  const scheduledISO = (): string | null => {
    if (mode === 'now' || !time) return null;
    const [hh, mm] = time.split(':').map(Number);
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hh, mm, 0, 0);
    return d.toISOString();
  };

  const planPret = mode === 'now' || !!time;

  const reserver = async () => {
    if (!hasDuree) return;
    if (!pickup) { Alert.alert('Location', 'Indique le point de prise en charge.'); return; }
    if (!(await ensureInMali())) { Alert.alert('Taga au Mali', HORS_MALI_MSG); return; }
    const sched = scheduledISO();
    if (mode === 'plan' && !sched) { Alert.alert('Réservation', "Choisis la date et l'heure de départ."); return; }
    play('order');
    setLoading(true);
    try {
      const quand = sched ? ` · ${dayLabel(dayOffset)} ${time}` : '';
      await createRide({
        type: veh,
        tier: veh === 'voiture' ? gamme : undefined,
        locationHours: hours,
        scheduledAt: sched,
        depart: pickup?.label ?? 'Ma position',
        destination: `Chauffeur à l'heure · ${fmtHours(hours)}${quand}`,
        distanceKm: 0,
        prix: total,
        fraisService,
        paiement: pay.method,
        creditApplied: pay.creditApplied,
        vehicule: `Location ${vObj.nom}${veh === 'voiture' ? ` ${gObj.nom}` : ''} · ${fmtHours(hours)}`,
        departLat: pickup?.point.latitude,
        departLng: pickup?.point.longitude,
      });
      // La location est assignée par Taga (admin), pas d'auto-dispatch → message dédié + Activité.
      Alert.alert(
        mode === 'plan' && sched ? 'Réservation enregistrée' : 'Demande envoyée',
        mode === 'plan' && sched
          ? `Ta location ${vObj.nom.toLowerCase()} est réservée pour ${dayLabel(dayOffset)} à ${time} (${fmtHours(hours)}). Taga t'assigne un chauffeur et te prévient.`
          : `Ta demande de location (${fmtHours(hours)}) est envoyée. Taga t'assigne un chauffeur et te prévient dès qu'il est confirmé.`,
        [{ text: 'OK', onPress: () => router.replace('/activite') }],
      );
    } catch (e: any) {
      // On REMONTE la cause au lieu de l'avaler : un « Oups » générique a masqué pendant des jours
      // une colonne manquante en base (chauffeur_note), qui faisait échouer toute réservation.
      console.error('[taga] location — échec de la réservation', e);
      const detail = e?.message ? `\n\n(${e.message})` : '';
      Alert.alert('Oups', `La réservation n'a pas pu être enregistrée. Réessaie.${detail}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Louer un chauffeur" />

      {/* Carte : aperçu figé + toucher pour ouvrir le plein écran zoomable avec le repère déplaçable. */}
      <View style={{ position: 'relative' }}>
        <TripMap
          origin={pickup?.point ?? BAMAKO.aci2000}
          self={pickup?.point}
          height={132}
          interactive={false}
          vehicle={veh === 'moto' ? 'moto' : 'car'}
        />
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setAdjustOpen(true)} accessibilityLabel="Ajuster le point de départ sur la carte" />
        <View style={ls.mapHint} pointerEvents="none">
          <Ionicons name="scan-outline" size={13} color={colors.white} />
          <Text style={ls.mapHintText}>Toucher pour zoomer et placer le repère</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        <Text style={ls.label}>Point de prise en charge</Text>
        <Pressable style={ls.pickup} onPress={() => setPickerOpen(true)}>
          <View style={ls.pickupDot}><View style={ls.pickupInner} /></View>
          <View style={{ flex: 1 }}>
            <Text style={ls.pickupText} numberOfLines={1}>{pickup?.label ?? 'Choisir le point de départ'}</Text>
          </View>
          <Pressable hitSlop={10} onPress={() => setAdjustOpen(true)} style={ls.pickupAdj}>
            <Ionicons name="location" size={18} color={colors.brand} />
          </Pressable>
        </Pressable>

        <Text style={ls.label}>Véhicule</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {VEHICULES.map((v) => {
            const on = v.id === veh;
            return (
              <Pressable key={v.id} onPress={() => setVeh(v.id)} style={[ls.veh, on && ls.vehOn]}>
                <ServiceIcon name={v.icon} size={36} />
                <Text style={ls.vehNom}>{v.nom}</Text>
                {hasDuree && <Text style={ls.vehTarif}>{fcfa(v.id === 'voiture' ? voitureTarifH : (tarifs.moto ?? 0))}/h</Text>}
              </Pressable>
            );
          })}
        </View>

        {veh === 'voiture' && (
          <>
            <Text style={ls.label}>Gamme</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {GAMMES.map((g) => {
                const on = g.id === gamme;
                const prixH = Math.round((gTarif[g.id] ?? (5000 * g.mult)) / 500) * 500;
                return (
                  <Pressable key={g.id} onPress={() => setGamme(g.id)} style={[ls.gamme, on && ls.vehOn]}>
                    {g.badge ? <View style={ls.gBadge}><Text style={ls.gBadgeText}>{g.badge}</Text></View> : null}
                    <Image source={voitureImages[g.id]} style={ls.gImg} resizeMode="contain" />
                    <Text style={ls.gNom}>{g.nom}</Text>
                    {hasDuree && <Text style={ls.vehTarif}>{fcfa(prixH)}/h</Text>}
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {/* Durée (stepper par pas de 30 min) */}
        <Text style={ls.label}>Durée</Text>
        <View style={ls.stepper}>
          <Pressable onPress={dec} disabled={hours === 0} style={[ls.stepBtn, hours === 0 && ls.stepBtnOff]}>
            <Ionicons name="remove" size={24} color={hours === 0 ? colors.inkMute : colors.ink} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            {hours === 0 ? (
              <Text style={ls.stepHint}>Choisis la durée</Text>
            ) : (
              <Text style={ls.stepVal}>{fmtHours(hours)}</Text>
            )}
          </View>
          <Pressable onPress={inc} disabled={hours >= HOUR_MAX} style={[ls.stepBtn, hours >= HOUR_MAX && ls.stepBtnOff]}>
            <Ionicons name="add" size={24} color={hours >= HOUR_MAX ? colors.inkMute : colors.ink} />
          </Pressable>
        </View>

        {/* Quand */}
        <Text style={ls.label}>Quand</Text>
        <View style={ls.seg}>
          {(['now', 'plan'] as const).map((m) => {
            const on = mode === m;
            return (
              <Pressable key={m} onPress={() => setMode(m)} style={[ls.segItem, on && ls.segItemOn]}>
                <Ionicons name={m === 'now' ? 'flash' : 'calendar'} size={16} color={on ? colors.white : colors.ink2} />
                <Text style={[ls.segText, on && { color: colors.white }]}>{m === 'now' ? 'Maintenant' : 'Planifier'}</Text>
              </Pressable>
            );
          })}
        </View>

        {mode === 'plan' && (
          <>
            <Text style={ls.subLabel}>Date</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingVertical: 2 }}>
              {Array.from({ length: 8 }).map((_, i) => {
                const on = dayOffset === i;
                return (
                  <Pressable key={i} onPress={() => { setDayOffset(i); setTime(null); }} style={[ls.chip, on && ls.chipOn]}>
                    <Text style={[ls.chipText, on && { color: colors.white }]}>{dayLabel(i)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={ls.subLabel}>Heure de départ</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingVertical: 2 }}>
              {times.length === 0 ? (
                <Text style={ls.noSlot}>Plus de créneau aujourd'hui — choisis un autre jour.</Text>
              ) : times.map((t) => {
                const on = time === t;
                return (
                  <Pressable key={t} onPress={() => setTime(t)} style={[ls.chip, on && ls.chipOn]}>
                    <Text style={[ls.chipText, on && { color: colors.white }]}>{t}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}

        {hasDuree && (
          <View style={ls.breakdown}>
            <View style={ls.bdRow}>
              <Text style={ls.bdLabel}>Location · {fmtHours(hours)} × {fcfa(tarifH)}/h</Text>
              <Text style={ls.bdVal}>{fcfa(baseTotal)}</Text>
            </View>
            {fraisService > 0 && (
              <View style={ls.bdRow}>
                <Text style={ls.bdLabel}>Frais de service · {fcfa(locFeeH)}/h</Text>
                <Text style={ls.bdVal}>{fcfa(fraisService)}</Text>
              </View>
            )}
            <View style={ls.bdSep} />
            <View style={ls.bdRow}>
              <Text style={ls.bdTotalLabel}>Total</Text>
              <Text style={ls.bdTotalVal}>{fcfa(total)}</Text>
            </View>
          </View>
        )}

        <View style={ls.note}>
          <Ionicons name="information-circle" size={18} color={colors.brand} />
          <Text style={ls.noteText}>Carburant inclus dans Bamako.</Text>
        </View>
      </ScrollView>

      <CtaBar>
        {hasDuree && <PaymentSelector total={total} onChange={setPay} />}
        <View style={st.totalRow}>
          <View>
            <Text style={st.totalLabel}>{hasDuree ? `Total · ${fmtHours(hours)}` : 'Total'}</Text>
            <Text style={st.totalVal}>{hasDuree ? fcfa(Math.max(0, total - pay.creditApplied)) : '—'}</Text>
          </View>
          <Btn
            label={!hasDuree ? 'Choisis la durée' : !pickup ? 'Indique le point de départ' : mode === 'plan' && !planPret ? "Choisis l'heure" : mode === 'plan' ? 'Réserver' : 'Envoyer la demande'}
            disabled={!hasDuree || !pickup || (mode === 'plan' && !planPret)}
            loading={loading}
            onPress={reserver}
            style={{ flex: 1, marginLeft: 14 }}
          />
        </View>
      </CtaBar>

      <DestinationPicker
        open={pickerOpen}
        title="Point de prise en charge"
        recents={recents}
        onPickOnMap={() => { setPickerOpen(false); setAdjustOpen(true); }}
        onClose={() => setPickerOpen(false)}
        onSelect={(p) => { setPickup({ label: p.label, point: p.point }); setPickerOpen(false); }}
      />

      <AdjustOnMap
        open={adjustOpen}
        initial={pickup?.point ?? { latitude: 12.6392, longitude: -8.0029 }}
        title="Ajuster la prise en charge"
        onClose={() => setAdjustOpen(false)}
        onConfirm={(pt, label) => { setPickup({ label, point: pt }); setAdjustOpen(false); }}
      />
    </View>
  );
}

const ls = StyleSheet.create({
  intro: { fontSize: 14, color: colors.inkSoft, fontWeight: '600', lineHeight: 20, marginTop: 14 },
  label: { fontSize: 15, fontWeight: '800', color: colors.ink, marginTop: 14, marginBottom: 8 },
  pickup: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 11, borderWidth: 1, borderColor: colors.line },
  mapHint: { position: 'absolute', bottom: 10, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(21,17,14,0.72)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  mapHintText: { color: colors.white, fontSize: 12, fontWeight: '800' },
  pickupDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(26,115,232,0.16)', alignItems: 'center', justifyContent: 'center' },
  pickupInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#1A73E8', borderWidth: 2, borderColor: '#fff' },
  pickupAdj: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  pickupText: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  pickupSub: { fontSize: 12, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  subLabel: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, marginTop: 16, marginBottom: 9 },
  veh: { flex: 1, alignItems: 'center', gap: 2, backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: 10, borderWidth: 2, borderColor: colors.line },
  vehOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  vehNom: { fontSize: 15, fontWeight: '800', color: colors.ink, marginTop: 2 },
  vehTarif: { fontSize: 13, fontWeight: '700', color: colors.inkSoft },
  gamme: { flex: 1, alignItems: 'center', gap: 2, backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: 9, paddingHorizontal: 4, borderWidth: 2, borderColor: colors.line },
  gImg: { width: 58, height: 38 },
  gNom: { fontSize: 13.5, fontWeight: '800', color: colors.ink, marginTop: 1 },
  gBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: colors.green, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 },
  gBadgeText: { color: colors.white, fontSize: 8.5, fontWeight: '800' },
  // Stepper durée
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.line, padding: 7 },
  stepBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  stepBtnOff: { opacity: 0.5 },
  stepVal: { fontSize: 22, fontWeight: '800', color: colors.ink },
  stepSub: { fontSize: 12, fontWeight: '700', color: colors.inkMute, marginTop: 1 },
  stepHint: { fontSize: 16, fontWeight: '800', color: colors.inkMute },
  // Segmented Quand
  seg: { flexDirection: 'row', gap: 10 },
  segItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.line },
  segItemOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  segText: { fontSize: 15, fontWeight: '800', color: colors.ink2 },
  // Chips date / heure
  chip: { paddingHorizontal: 16, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 14, fontWeight: '800', color: colors.ink2 },
  noSlot: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, paddingVertical: 12 },
  breakdown: { marginTop: 14, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line },
  bdRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: 5 },
  bdLabel: { flex: 1, fontSize: 13.5, color: colors.inkSoft, fontWeight: '600' },
  bdVal: { fontSize: 13.5, color: colors.ink, fontWeight: '700' },
  bdSep: { height: 1, backgroundColor: colors.line, marginVertical: 6 },
  bdTotalLabel: { fontSize: 15, color: colors.ink, fontWeight: '800' },
  bdTotalVal: { fontSize: 17, color: colors.ink, fontWeight: '800' },
  note: { flexDirection: 'row', gap: 10, marginTop: 12, backgroundColor: colors.brandTint, borderRadius: radius.md, padding: 10, borderWidth: 1, borderColor: colors.brandSoft },
  noteText: { flex: 1, fontSize: 12.5, color: colors.ink2, fontWeight: '600', lineHeight: 18 },
});
