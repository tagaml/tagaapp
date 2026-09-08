import Constants from 'expo-constants';

/** true dans l'app « Taga Chauffeur », false dans l'app client « Taga ». */
export const IS_DRIVER_APP =
  ((Constants.expoConfig?.extra as any)?.variant ?? 'client') === 'chauffeur';
