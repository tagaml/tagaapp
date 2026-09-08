import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';

// Projet Supabase "taga"
const SUPABASE_URL = 'https://dquzsztxjsvwjefgztrh.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_GpwwDabYns_WRq2xD0F0Xw_kUO-TWiF';

// ⚠️ DÉCONNEXIONS CHAUFFEUR — ne pas remettre `autoRefreshToken: true` ici.
//
// Le chauffeur reste « en ligne » via une tâche de localisation en arrière-plan
// (lib/backgroundPresence). Cette tâche tourne dans un CONTEXTE JS SÉPARÉ et importe
// ce module : elle instancie donc un 2e client Supabase. Avec l'auto-refresh activé,
// ce 2e client lançait un minuteur qui faisait TOURNER le refresh token (rotation)
// dans le dos de l'app. Au relancement, le token stocké côté app était déjà consommé
// → Supabase détecte une réutilisation → session invalidée → chauffeur déconnecté.
//
// Correctif : un SEUL rafraîchisseur, piloté par AppState dans components/auth.tsx
// (startAutoRefresh au premier plan / stopAutoRefresh en arrière-plan).
// Le rafraîchissement « à la demande » reste actif : si le token est expiré au moment
// d'une requête, supabase-js le renouvelle quand même — la présence en arrière-plan
// continue donc de fonctionner, sans minuteur concurrent.
// `processLock` sérialise les rafraîchissements pour éviter toute course.
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: false, // piloté par AppState (components/auth.tsx) — voir note ci-dessus
    persistSession: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
});

// Le numéro (indicatif + numéro) devient un e-mail interne déterministe, pour "numéro + mot de passe".
// Aligné sur la fonction serveur (send-otp/toIntl) : on prend le numéro international tel quel.
// Repli : un numéro à 8 chiffres SANS indicatif = numéro MALIEN local → on préfixe 223 (rétrocompat
// avec les comptes déjà créés `223XXXXXXXX@taga.app`).
export function phoneToEmail(phone: string): string {
  let d = (phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (!d.startsWith('223') && d.length === 8) d = '223' + d;
  return `${d}@taga.app`;
}
