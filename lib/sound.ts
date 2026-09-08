import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

export type AppSound = 'request' | 'accept' | 'complete' | 'order' | 'message' | 'notif';
export type DriverSound = 'request' | 'accept' | 'complete';

const files: Record<AppSound, number> = {
  request: require('../assets/sounds/request.wav'),
  accept: require('../assets/sounds/accept.wav'),
  complete: require('../assets/sounds/complete.wav'),
  order: require('../assets/sounds/order.wav'),
  message: require('../assets/sounds/message.wav'),
  notif: require('../assets/sounds/notif.wav'),
};

const cache: Partial<Record<AppSound, AudioPlayer>> = {};
let configured = false;

function ensureMode() {
  if (configured) return;
  configured = true;
  // Joue même quand le téléphone est en mode silencieux (iOS).
  setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
}

/** Joue un effet sonore de l'app (client ou chauffeur). */
export function play(name: AppSound): void {
  try {
    ensureMode();
    let p = cache[name];
    if (!p) {
      p = createAudioPlayer(files[name]);
      cache[name] = p;
      p.play();
      return;
    }
    // Rejoue depuis le début si le son a déjà servi.
    p.seekTo(0)
      .then(() => p!.play())
      .catch(() => { try { p!.play(); } catch { /* ignore */ } });
  } catch {
    /* audio indisponible : on ignore silencieusement */
  }
}

/** Effet sonore côté chauffeur (nouvelle demande, acceptation, course terminée). */
export function playDriver(name: DriverSound): void {
  play(name);
}

/** Son d'un nouveau message (chat client ↔ chauffeur / support) : petit « pop ». */
export function playMessage(): void { play('message'); }

/** Son d'une nouvelle notification (cloche) : « ding » à deux notes. */
export function playNotif(): void { play('notif'); }

/**
 * Joue un effet à PLEIN volume (façon Uber Driver : passage en ligne / hors ligne).
 * Force volume=1.0 sur le lecteur pour un son bien marqué, même après réutilisation.
 */
export function playCue(name: AppSound): void {
  try {
    ensureMode();
    let p = cache[name];
    if (!p) { p = createAudioPlayer(files[name]); cache[name] = p; }
    p.volume = 1.0;
    p.seekTo(0)
      .then(() => p!.play())
      .catch(() => { try { p!.play(); } catch { /* ignore */ } });
  } catch {
    /* audio indisponible : on ignore */
  }
}

/* ===================== Sonnerie de demande (façon Uber, en boucle) ===================== */

let ringPlayer: AudioPlayer | null = null;
let ringTimer: ReturnType<typeof setTimeout> | null = null;
const ringFile = require('../assets/sounds/request_ring.wav');

/** Démarre la sonnerie forte en boucle (s'arrête seule au bout de `ms`, 20 s par défaut). */
export function startRequestRing(ms = 20000): void {
  try {
    ensureMode();
    if (!ringPlayer) ringPlayer = createAudioPlayer(ringFile);
    ringPlayer.loop = true;
    ringPlayer.volume = 1.0;
    ringPlayer.seekTo(0).catch(() => {});
    ringPlayer.play();
    if (ringTimer) clearTimeout(ringTimer);
    ringTimer = setTimeout(stopRequestRing, ms);
  } catch {
    /* audio indisponible : on ignore */
  }
}

/** Arrête la sonnerie (à l'acceptation, au refus ou à l'expiration). */
export function stopRequestRing(): void {
  if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
  try {
    if (ringPlayer) { ringPlayer.loop = false; ringPlayer.pause(); ringPlayer.seekTo(0).catch(() => {}); }
  } catch {
    /* ignore */
  }
}

/** Libère les lecteurs audio préchargés. */
export function unloadDriverSounds(): void {
  for (const k of Object.keys(cache) as AppSound[]) {
    try { cache[k]?.remove(); } catch { /* ignore */ }
    delete cache[k];
  }
}
