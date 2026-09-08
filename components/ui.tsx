import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, Image, Animated, ActivityIndicator, ViewStyle, TextStyle, StyleProp,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, radius, shadow, space } from '../theme';

/* ---- Écran de base ---- */
export function Screen({ children, scroll = true, style, contentStyle }: {
  children: React.ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView edges={['top']} style={[{ flex: 1, backgroundColor: colors.bg }, style]}>
      {scroll ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[{ paddingBottom: 28 }, contentStyle]}>
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

/* ---- En-tête avec flèche retour ---- */
export function Header({ title, right }: { title: string; right?: React.ReactNode }) {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const insets = useSafeAreaInsets();
  // Depuis l'onglet Compte chauffeur, on revient explicitement sur Compte
  // (le navigateur à onglets renverrait sinon sur l'Accueil).
  const back = () => { if (from === 'compte') router.replace('/driver/compte'); else router.back(); };
  return (
    <View style={[s.header, { paddingTop: insets.top + 6 }]}>
      <Pressable onPress={back} hitSlop={10} style={s.backBtn}>
        <Ionicons name="chevron-back" size={24} color={colors.ink} />
      </Pressable>
      <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={{ minWidth: 40, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

/* ---- Bouton principal / secondaire ---- */
export function Btn({ label, onPress, variant = 'primary', style, disabled, loading }: {
  label: string; onPress?: () => void; variant?: 'primary' | 'ghost' | 'dark'; style?: StyleProp<ViewStyle>; disabled?: boolean; loading?: boolean;
}) {
  const bg = variant === 'primary' ? colors.brand : variant === 'dark' ? colors.ink : colors.surface;
  const fg = variant === 'ghost' ? colors.ink : colors.white;
  const handlePress = () => {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress?.();
  };
  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'ghost' && { borderWidth: 1.5, borderColor: colors.line2 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[s.btnText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

/* ---- Carte ---- */
export function Card({ children, style, onPress }: {
  children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void;
}) {
  const Comp: any = onPress ? Pressable : View;
  return (
    <Comp onPress={onPress} style={({ pressed }: any) => [s.card, onPress && pressed && { opacity: 0.9 }, style]}>
      {children}
    </Comp>
  );
}

/* ---- Ligne tappable (listes de réglages) ---- */
export function Row({ icon, label, value, onPress, badge, last }: {
  icon?: keyof typeof Ionicons.glyphMap; label: string; value?: string; onPress?: () => void; badge?: number; last?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, !last && s.rowBorder, pressed && { backgroundColor: colors.surface2 }]}>
      {icon && (
        <View style={s.rowIcon}>
          <Ionicons name={icon} size={19} color={colors.ink2} />
        </View>
      )}
      <Text style={s.rowLabel}>{label}</Text>
      {value ? <Text style={s.rowValue}>{value}</Text> : null}
      {badge ? <View style={s.rowBadge}><Text style={s.rowBadgeText}>{badge}</Text></View> : null}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.inkMute} style={{ marginLeft: 6 }} /> : null}
    </Pressable>
  );
}

/* ---- Badge / pastille ---- */
export function Tag({ text, tone = 'brand' }: { text: string; tone?: 'brand' | 'green' | 'gold' | 'mute' }) {
  const map = {
    brand: { bg: colors.brandSoft, fg: colors.brandDeep },
    green: { bg: colors.greenSoft, fg: colors.green },
    gold: { bg: colors.goldSoft, fg: colors.gold },
    mute: { bg: colors.surface2, fg: colors.inkSoft },
  }[tone];
  return (
    <View style={[s.tag, { backgroundColor: map.bg }]}>
      <Text style={[s.tagText, { color: map.fg }]}>{text}</Text>
    </View>
  );
}

/* ---- Barre d'action fixe en bas ---- */
export function CtaBar({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={[s.ctaBar, { paddingBottom: Math.max(insets.bottom, 14) }]}>{children}</View>;
}

/* ---- Faux fond de carte (map) ---- */
export function MapBack({ height = 220, children }: { height?: number; children?: React.ReactNode }) {
  return (
    <View style={[s.map, { height }]}>
      <View style={[s.mapRoad, { top: height * 0.4 }]} />
      <View style={[s.mapRoadV, { left: '55%' }]} />
      <View style={s.mapWater} />
      {children}
    </View>
  );
}

/* ---- Icônes de service (images illustrées) ---- */
export const serviceImages = {
  car: require('../assets/services/car.png'),
  moto: require('../assets/services/moto.png'),
  colis: require('../assets/services/colis.png'),
  scooterColis: require('../assets/services/scooter_colis.png'),
  tricycle: require('../assets/services/tricycle.png'),
  share: require('../assets/services/share.png'),
  food: require('../assets/services/food.png'),
  demenagement: require('../assets/demenagement.png'),
  // Visuels 3D par gamme (app client)
  classic: require('../assets/services/classic.png'),
  confort: require('../assets/services/confort.png'),
  xl: require('../assets/services/xl.png'),
} as const;

/* Visuel 3D de la voiture selon la gamme choisie */
export const voitureImages: Record<string, any> = {
  standard: serviceImages.classic,
  confort: serviceImages.confort,
  xl: serviceImages.xl,
};

export function ServiceIcon({ name, size = 40 }: { name: keyof typeof serviceImages; size?: number }) {
  return <Image source={serviceImages[name]} style={{ width: size, height: size }} resizeMode="contain" />;
}

/* ---- Image de plat / resto (avec repli emoji si l'image ne charge pas) ---- */
export function FoodImage({ uri, emoji, emojiSize = 30, radius: r, style }: {
  uri?: string; emoji?: string; emojiSize?: number; radius?: number; style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <View style={[{ backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, r != null && { borderRadius: r }, style]}>
      {(!uri || failed) && emoji ? <Text style={{ fontSize: emojiSize }}>{emoji}</Text> : null}
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill, !loaded && { opacity: 0 }]}
          resizeMode="cover"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}

/* ---- Pastille initiales (avatar) ---- */
export function Avatar({ text, size = 48, tone = 'brand', uri }: { text: string; size?: number; tone?: 'brand' | 'ink'; uri?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface2 }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: tone === 'brand' ? colors.brand : colors.ink }]}>
      <Text style={[s.avatarText, { fontSize: size * 0.36 }]}>{text}</Text>
    </View>
  );
}

/* ---- Toast (bandeau de confirmation) + haptique ---- */
type ToastFn = (message: string, opts?: { icon?: keyof typeof Ionicons.glyphMap; tone?: 'success' | 'info' | 'error' }) => void;
const ToastContext = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ message: string; icon: keyof typeof Ionicons.glyphMap; tone: string } | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<ToastFn>((message, opts = {}) => {
    const tone = opts.tone ?? 'success';
    const icon = opts.icon ?? (tone === 'error' ? 'alert-circle' : tone === 'info' ? 'information-circle' : 'checkmark-circle');
    Haptics.notificationAsync(
      tone === 'error' ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Success
    ).catch(() => {});
    setToast({ message, icon, tone });
    if (timer.current) clearTimeout(timer.current);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, bounciness: 8 }).start();
    timer.current = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setToast(null));
    }, 2200);
  }, [anim]);

  const toneColor = toast?.tone === 'error' ? colors.brandDeep : toast?.tone === 'info' ? colors.ink : colors.green;

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="none"
          style={[
            ts.toast,
            { bottom: insets.bottom + 90, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] },
          ]}
        >
          <Ionicons name={toast.icon} size={20} color={toneColor} />
          <Text style={ts.toastText} numberOfLines={2}>{toast.message}</Text>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

/* ---- Skeleton (bloc de chargement animé) ---- */
export function Skeleton({ width, height, radius: r = 12, style }: { width?: number | string; height: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const anim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return <Animated.View style={[{ width: width as any, height, borderRadius: r, backgroundColor: colors.surface2, opacity: anim }, style]} />;
}

const ts = StyleSheet.create({
  toast: { position: 'absolute', left: 20, right: 20, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 16, ...shadow.pop },
  toastText: { flex: 1, color: colors.white, fontSize: 14.5, fontWeight: '700' },
});

export const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: 12, gap: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  headerTitle: { flex: 1, fontSize: 17.5, fontWeight: '800', color: colors.ink, marginLeft: 4 },
  btn: { height: 54, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  btnText: { fontSize: 15, fontWeight: '800' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 16, gap: 13 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  rowIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontSize: 15.5, fontWeight: '700', color: colors.ink },
  rowValue: { fontSize: 14, fontWeight: '600', color: colors.inkSoft },
  rowBadge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  rowBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  tagText: { fontSize: 12, fontWeight: '800' },
  ctaBar: { padding: space.lg, paddingBottom: 28, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.line },
  map: { backgroundColor: '#ECE7DC', borderRadius: radius.lg, overflow: 'hidden', position: 'relative' },
  mapRoad: { position: 'absolute', left: 0, right: 0, height: 10, backgroundColor: '#FFFFFF' },
  mapRoadV: { position: 'absolute', top: 0, bottom: 0, width: 10, backgroundColor: '#FFFFFF' },
  mapWater: { position: 'absolute', right: -30, bottom: -30, width: 140, height: 140, borderRadius: 70, backgroundColor: '#CADCE8' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800' },
});
