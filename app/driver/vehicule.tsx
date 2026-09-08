import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, radius, shadow, space } from '../../theme';
import { Btn, useToast } from '../../components/ui';
import {
  getDriverProfile, saveDriverProfile, getDriverServices, saveDriverServices, servicesCompatibles,
  getVehicleLock, requestVehicleChange, servicesParDefaut, type VehicleDetails, type VehicleLock,
} from '../../lib/db';

type VehType = 'voiture' | 'moto' | 'tricycle' | 'camion';

const TYPES: { code: VehType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { code: 'voiture', label: 'Voiture', icon: 'car-outline' },
  { code: 'moto', label: 'Moto', icon: 'bicycle-outline' },
  { code: 'tricycle', label: 'Tricycle', icon: 'cube-outline' },
  { code: 'camion', label: 'Camion', icon: 'bus-outline' },
];

// Gammes de voiture (Taga Eco / Fresh / SUV) — définit le niveau de service du chauffeur.
// Un chauffeur Fresh reçoit AUSSI les courses Eco (hiérarchie côté dispatch).
const GAMMES: { code: string; label: string; desc: string }[] = [
  { code: 'standard', label: 'Eco', desc: 'Berline classique' },
  { code: 'vip', label: 'Fresh', desc: 'Confort · climatisé' },
  { code: 'suv', label: 'SUV', desc: '4×4 / 6 places' },
];

// Services que le chauffeur peut accepter. Le dispatch ne lui enverra QUE ceux qu'il coche.
// La liste dépend du véhicule (voir servicesCompatibles dans lib/db) :
//   voiture  → passagers + location   (jamais de colis, jamais de repas)
//   moto     → passagers + colis + repas + location
//   tricycle → colis lourd    |   camion → déménagement
// La LOCATION n'est jamais cochée d'office : prêter son véhicule se décide.
const SERVICES: Record<string, { label: string; desc: string; icon: keyof typeof Ionicons.glyphMap }> = {
  courses: { label: 'Courses (passagers)', desc: 'Tu transportes des passagers', icon: 'people-outline' },
  colis: { label: 'Colis', desc: 'Tu livres des colis', icon: 'cube-outline' },
  livraison: { label: 'Livraison de repas', desc: 'Tu livres les commandes des restaurants', icon: 'fast-food-outline' },
  // La location, c'est prêter SON véhicule à la demi-journée ou à la journée : ça ne s'impose pas.
  // Le chauffeur la coche s'il le souhaite ; sinon Taga ne lui proposera jamais de location.
  location: { label: 'Location', desc: 'Tu acceptes de louer ton véhicule (avec toi au volant)', icon: 'key-outline' },
  demenagement: { label: 'Déménagement', desc: 'Courses de camion assignées par Taga', icon: 'home-outline' },
};

// Libellés des champs adaptés à chaque type de véhicule.
const FIELDS: Record<VehType, { vehicule: string; couleur: string; plaque: string; phVeh: string; phCoul: string; phPlaque: string }> = {
  voiture: { vehicule: 'Marque & modèle', couleur: 'Couleur', plaque: "Plaque d'immatriculation", phVeh: 'Toyota Corolla', phCoul: 'Gris', phPlaque: 'MA 7821 BK' },
  moto: { vehicule: 'Marque & modèle', couleur: 'Couleur', plaque: "Plaque d'immatriculation", phVeh: 'Yamaha YBR 125', phCoul: 'Rouge', phPlaque: 'MB 3245 BK' },
  tricycle: { vehicule: 'Marque & modèle', couleur: 'Couleur', plaque: "Plaque d'immatriculation", phVeh: 'Piaggio Ape', phCoul: 'Bleu', phPlaque: 'MC 1190 BK' },
  camion: { vehicule: 'Type de camion', couleur: 'Capacité (m³ / tonnes)', plaque: "Plaque d'immatriculation", phVeh: 'Camionnette, fourgon, benne…', phCoul: 'Ex : 12 m³', phPlaque: 'MD 4501 BK' },
};

export default function Vehicule() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  // Le retour ramène TOUJOURS à l'écran d'où l'on vient (inscription, compte) — jamais à l'accueil par surprise.
  const goBack = () => router.replace(
    from === 'compte' ? '/driver/compte' : from === 'onboarding' ? '/driver/onboarding' : '/driver',
  );
  const toast = useToast();
  const insets = useSafeAreaInsets();

  const [type, setType] = useState<VehType>('voiture'); // un SEUL véhicule
  // Détails du véhicule (marque, couleur, plaque) — par type.
  const [details, setDetails] = useState<Record<string, VehicleDetails>>({});
  // Services acceptés (courses / colis / livraison / demenagement) : le dispatch filtre STRICTEMENT dessus.
  const [services, setServices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Dossier validé ⇒ le véhicule est VERROUILLÉ : les pièces (permis, carte grise, assurance) sont
  // attachées à ce véhicule. Pour en changer, l'admin doit confirmer.
  const [lock, setLock] = useState<VehicleLock>({ locked: false, pending: null });

  const setField = (t: VehType, key: keyof VehicleDetails, val: string) =>
    setDetails((d) => ({ ...d, [t]: { ...(d[t] ?? {}), [key]: val } }));

  // Services proposés pour le type de véhicule choisi.
  const dispos = servicesCompatibles(type);
  // Un seul service possible (voiture, tricycle, camion) : il est IMPOSÉ, pas à cocher.
  const serviceImpose = dispos.length === 1;

  // Changement de type : on repart sur TOUS les services du nouveau véhicule (le chauffeur peut décocher).
  // Avant, on gardait l'intersection : en passant de voiture (courses) à moto, il ne restait que
  // « courses » — le moto-livreur ne recevait donc jamais de commande food. Un changement de véhicule
  // remet les métiers à plat.
  const choisirType = (t: VehType) => {
    if (t === type) return;
    // Véhicule verrouillé (dossier validé) : le chauffeur ne bascule pas seul, il DEMANDE.
    if (lock.locked) { demanderChangement(t); return; }
    setType(t);
    // On coche les métiers du nouveau véhicule — MAIS PAS la location : prêter son véhicule
    // est un engagement à part, le chauffeur le décide lui-même.
    setServices(servicesParDefaut(t));
  };

  const LABELS: Record<VehType, string> = { voiture: 'Voiture', moto: 'Moto', tricycle: 'Tricycle', camion: 'Camion' };

  const demanderChangement = (t: VehType) => {
    if (lock.pending) {
      toast(`Demande déjà envoyée (${LABELS[lock.pending.to_type as VehType] ?? lock.pending.to_type}). Un admin doit la confirmer.`);
      return;
    }
    Alert.alert(
      'Changer de véhicule ?',
      `Ton dossier est validé pour « ${LABELS[type]} ». Passer en « ${LABELS[t]} » demande une confirmation de l'équipe Taga, et tes documents seront à revérifier.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Envoyer la demande',
          onPress: async () => {
            try {
              await requestVehicleChange(t, type);
              setLock((l) => ({ ...l, pending: { to_type: t } }));
              toast('Demande envoyée. Un admin va la confirmer.');
            } catch {
              toast('Échec de l\'envoi. Réessaie.', { tone: 'error' });
            }
          },
        },
      ],
    );
  };

  const toggleService = (code: string) => {
    if (serviceImpose) return; // service unique : on ne peut pas le décocher
    Haptics.selectionAsync().catch(() => {});
    setServices((prev) => (prev.includes(code) ? prev.filter((s) => s !== code) : [...prev, code]));
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [p, svc, lk] = await Promise.all([
          getDriverProfile(),
          getDriverServices().catch(() => [] as string[]),
          getVehicleLock().catch(() => ({ locked: false, pending: null }) as VehicleLock),
        ]);
        if (!mounted) return;
        setLock(lk);
        if (!p) return;
        const valid = (p.vehicle_types && p.vehicle_types.length ? p.vehicle_types : [p.type]).filter((t): t is VehType => t === 'voiture' || t === 'moto' || t === 'tricycle' || t === 'camion');
        const principal = valid[0] ?? 'voiture';
        setType(principal);
        // Détails : on prend la map `vehicles`, sinon on retombe sur les colonnes plates.
        const map: Record<string, VehicleDetails> = { ...(p.vehicles ?? {}) };
        if (!map[principal] && (p.vehicule || p.couleur || p.plaque)) {
          map[principal] = { vehicule: p.vehicule, couleur: p.couleur, plaque: p.plaque };
        }
        setDetails(map);
        // Services déjà enregistrés (limités à ceux que le véhicule sait faire).
        // Rien d'enregistré ? On pré-coche les métiers du véhicule SAUF la location — elle doit
        // rester un choix du chauffeur (même défaut que le serveur : services_defaut()).
        const ok = servicesCompatibles(principal);
        const gardes = (svc ?? []).filter((s) => ok.includes(s));
        setServices(gardes.length ? gardes : servicesParDefaut(principal));
      } catch {
        /* champs vides */
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const enregistrer = async () => {
    // Véhicule à service unique : le service est imposé, on l'enregistre tel quel.
    const choisis = serviceImpose ? dispos : services;
    // Au moins un service : sinon le chauffeur ne recevrait plus AUCUNE demande.
    if (!choisis.length) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      toast('Coche au moins un service, sinon tu ne recevras aucune demande.', { tone: 'error' });
      return;
    }
    const d = details[type] ?? {};
    const veh: VehicleDetails = {
      vehicule: (d.vehicule ?? '').trim() || null,
      couleur: (d.couleur ?? '').trim() || null,
      plaque: (d.plaque ?? '').trim() || null,
      gamme: type === 'voiture' ? (d.gamme || 'standard') : null,
    };
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await saveDriverProfile({
        type,                       // un seul type : le chauffeur ne roule que sur celui-ci
        vehicle_types: [type],
        vehicles: { [type]: veh },
        vehicule: veh.vehicule ?? null,
        couleur: veh.couleur ?? null,
        plaque: veh.plaque ?? null,
      });
      // Services acceptés : écrits après le profil (le dispatch s'en sert pour filtrer les offres).
      await saveDriverServices(choisis);
      toast('Véhicule enregistré !');
      // On n'enchaîne sur les documents QUE pour un NOUVEAU chauffeur en cours d'inscription
      // (dossier pas encore validé). Un chauffeur déjà validé qui corrige un détail ne doit PAS
      // être renvoyé dans le parcours de validation : on le ramène simplement d'où il vient.
      if (from === 'onboarding' && !lock.locked) {
        router.replace({ pathname: '/driver/documents', params: { from } });
      } else {
        goBack();
      }
    } catch {
      toast('Échec de l\'enregistrement. Réessaie.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={st.head}>
        <Pressable onPress={goBack} hitSlop={10} style={st.back}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Text style={st.headTitle}>Mon véhicule</Text>
        <View style={{ width: 42 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={80}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + 320 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={st.section}>Type de véhicule</Text>
          <View style={st.typeRow}>
            {TYPES.map((t) => {
              const on = type === t.code;
              return (
                <Pressable
                  key={t.code}
                  onPress={() => choisirType(t.code)}
                  style={[st.typeCard, on && st.typeCardOn]}
                >
                  <Ionicons name={on ? 'checkmark-circle' : t.icon} size={24} color={on ? colors.brand : colors.ink2} />
                  <Text style={[st.typeLabel, on && { color: colors.brandDeep }]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {lock.locked ? (
            <View style={st.lockBox}>
              <Ionicons name="lock-closed" size={16} color={colors.brandDeep} />
              <Text style={st.lockTxt}>
                {lock.pending
                  ? `Demande de changement vers « ${LABELS[lock.pending.to_type as VehType] ?? lock.pending.to_type} » envoyée. Un admin doit la confirmer.`
                  : 'Ton dossier est validé pour ce véhicule. Touche un autre véhicule pour demander un changement : un admin le confirmera.'}
              </Text>
            </View>
          ) : (
            <Text style={st.hint}>Tu ne reçois que les courses de ce véhicule.</Text>
          )}

          {(() => {
            const f = FIELDS[type];
            const d = details[type] ?? {};
            const t = TYPES.find((x) => x.code === type)!;
            return (
              <View>
                <View style={st.detailHead}>
                  <Ionicons name={t.icon} size={18} color={colors.brand} />
                  <Text style={st.detailTitle}>Détails · {t.label}</Text>
                </View>

                <Text style={st.label}>{f.vehicule}</Text>
                <TextInput
                  style={st.input}
                  value={d.vehicule ?? ''}
                  onChangeText={(v) => setField(type, 'vehicule', v)}
                  placeholder={f.phVeh}
                  placeholderTextColor={colors.inkMute}
                />

                <Text style={st.label}>{f.couleur}</Text>
                <TextInput
                  style={st.input}
                  value={d.couleur ?? ''}
                  onChangeText={(v) => setField(type, 'couleur', v)}
                  placeholder={f.phCoul}
                  placeholderTextColor={colors.inkMute}
                />

                <Text style={st.label}>{f.plaque}</Text>
                <TextInput
                  style={st.input}
                  value={d.plaque ?? ''}
                  onChangeText={(v) => setField(type, 'plaque', v)}
                  placeholder={f.phPlaque}
                  placeholderTextColor={colors.inkMute}
                  autoCapitalize="characters"
                />

                {/* Gamme de service : uniquement pour une voiture. Détermine quelles courses tu reçois. */}
                {type === 'voiture' ? (
                  <>
                    <Text style={st.label}>Gamme de service</Text>
                    <View style={st.gammeRow}>
                      {GAMMES.map((g) => {
                        const on = (d.gamme || 'standard') === g.code;
                        // Gamme LIBREMENT modifiable (même dossier validé) : c'est la déclaration du
                        // niveau réel de la voiture, pas un document KYC. Seul le TYPE reste verrouillé.
                        return (
                          <Pressable key={g.code} onPress={() => { Haptics.selectionAsync().catch(() => {}); setField(type, 'gamme', g.code); }} style={[st.gammeCard, on && st.gammeCardOn]}>
                            <Text style={[st.gammeLabel, on && { color: colors.brandDeep }]}>{g.label}</Text>
                            <Text style={st.gammeDesc}>{g.desc}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={st.hint}>Un chauffeur Fresh reçoit les courses Eco ET Fresh. Un chauffeur Eco ne reçoit que les courses Eco. Une course SUV ne part qu'aux SUV.</Text>
                  </>
                ) : null}
              </View>
            );
          })()}

          {/* Services acceptés : ne s'affichent que ceux que le véhicule choisi sait faire.
              Véhicule à service unique (voiture, tricycle, camion) : le service est imposé, pas cochable. */}
          <Text style={st.section}>{serviceImpose ? 'Ton service' : 'Que veux-tu transporter ?'}</Text>
          <View style={st.svcList}>
            {dispos.map((code) => {
              const s = SERVICES[code];
              if (!s) return null;
              const on = serviceImpose || services.includes(code);
              return (
                <Pressable
                  key={code}
                  onPress={() => toggleService(code)}
                  disabled={serviceImpose}
                  style={[st.svcCard, on && st.svcCardOn]}
                >
                  <Ionicons name={s.icon} size={22} color={on ? colors.brand : colors.ink2} />
                  <View style={{ flex: 1 }}>
                    <Text style={[st.svcLabel, on && { color: colors.brandDeep }]}>{s.label}</Text>
                    <Text style={st.svcDesc}>{s.desc}</Text>
                  </View>
                  <Ionicons
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={on ? colors.brand : colors.line2}
                  />
                </Pressable>
              );
            })}
          </View>
          <Text style={st.hint}>
            {serviceImpose
              ? 'Seul service possible avec ce véhicule.'
              : 'Tu ne reçois que les services cochés. Coches-en au moins un.'}
          </Text>
        </ScrollView>
        </KeyboardAvoidingView>
      )}

      {!loading && (
        <View style={[st.bottom, { paddingBottom: insets.bottom + 14 }]}>
          {/* « et continuer » seulement pendant l'inscription d'un nouveau chauffeur ; sinon simple enregistrement. */}
          <Btn label={from === 'onboarding' && !lock.locked ? 'Enregistrer et continuer' : 'Enregistrer'} onPress={enregistrer} loading={busy} />
        </View>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: 8 },
  back: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  headTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  section: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 22, marginBottom: 12 },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 4, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.line },
  detailTitle: { fontSize: 14, fontWeight: '800', color: colors.ink, textTransform: 'uppercase', letterSpacing: 0.4 },
  typeRow: { flexDirection: 'row', gap: 12 },
  typeCard: { flex: 1, alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: 18, borderWidth: 2, borderColor: colors.line },
  typeCardOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  typeLabel: { fontSize: 15, fontWeight: '800', color: colors.ink2 },
  gammeRow: { flexDirection: 'row', gap: 10 },
  gammeCard: { flex: 1, alignItems: 'center', gap: 2, backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 6, borderWidth: 2, borderColor: colors.line },
  gammeCardOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  gammeLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
  gammeDesc: { fontSize: 11, fontWeight: '600', color: colors.inkSoft, textAlign: 'center' },
  svcList: { gap: 10 },
  svcCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 14, borderWidth: 2, borderColor: colors.line },
  svcCardOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  svcLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
  svcDesc: { fontSize: 12, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  hint: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 10, lineHeight: 18 },
  lockBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 10,
    backgroundColor: colors.brandTint, borderRadius: radius.md, padding: 10,
  },
  lockTxt: { flex: 1, fontSize: 12.5, fontWeight: '700', color: colors.brandDeep, lineHeight: 18 },
  label: { fontSize: 13.5, fontWeight: '800', color: colors.ink2, marginBottom: 8, marginTop: 14 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, paddingHorizontal: 16, height: 52, fontSize: 15.5, fontWeight: '600', color: colors.ink },
  info: { flexDirection: 'row', gap: 9, marginTop: 20, paddingHorizontal: 2 },
  infoText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, lineHeight: 18 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingTop: 12, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.line },
});
