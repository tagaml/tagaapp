// Deux apps à partir d'un seul code, choisies par APP_VARIANT :
//   - défaut            -> app client « Taga »
//   - APP_VARIANT=chauffeur -> app chauffeur « Taga Chauffeur »
// Démarrer l'app chauffeur :  APP_VARIANT=chauffeur npx expo start
const IS_DRIVER = process.env.APP_VARIANT === 'chauffeur';

// Clé Google Maps (obligatoire pour react-native-maps sur build Android/iOS).
// Colle ta clé ici (ou via la variable d'env GOOGLE_MAPS_KEY), puis relance le build.
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY || 'AIzaSyCE84Q_O9MPeSizT8jikR_bMsn7uq4_iLo';

export default ({ config }) => ({
  ...config,
  // slug constant => un seul projet EAS pour les deux variantes
  slug: 'taga',
  name: IS_DRIVER ? 'Taga Chauffeur' : 'Taga',
  scheme: IS_DRIVER ? 'tagachauffeur' : 'taga',
  // Icône distincte : client = flèche orange ; chauffeur = flèche nuit + « chauffeur ».
  icon: IS_DRIVER ? './assets/icon-chauffeur.png' : './assets/icon-orange.png',
  ios: {
    ...(config.ios || {}),
    bundleIdentifier: IS_DRIVER ? 'ml.tagamali.driver' : 'ml.tagamali.rider',
    config: { ...((config.ios || {}).config || {}), googleMapsApiKey: GOOGLE_MAPS_KEY },
  },
  android: {
    ...(config.android || {}),
    package: IS_DRIVER ? 'ml.tagamali.driver' : 'ml.tagamali.rider',
    // Icône adaptative Android par variante : client = flèche blanche sur fond orange ; chauffeur = fond nuit.
    adaptiveIcon: IS_DRIVER
      ? { foregroundImage: './assets/chauffeur-foreground.png', backgroundColor: '#161310' }
      : { foregroundImage: './assets/android-icon-foreground-orange.png', backgroundColor: '#E84B1F' },
    // FCM (push Android) : fichier google-services.json par variante (téléchargé depuis Firebase).
    // Override possible via GOOGLE_SERVICES_FILE. Requis seulement pour le build Android.
    googleServicesFile: process.env.GOOGLE_SERVICES_FILE
      || (IS_DRIVER ? './google-services.chauffeur.json' : './google-services.client.json'),
    config: {
      ...((config.android || {}).config || {}),
      googleMaps: { apiKey: GOOGLE_MAPS_KEY },
    },
  },
  extra: {
    ...(config.extra || {}),
    variant: IS_DRIVER ? 'chauffeur' : 'client',
  },
});
