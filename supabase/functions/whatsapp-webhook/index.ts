// Webhook WhatsApp (Meta Cloud API).
//  - GET  : handshake de vérification (Meta envoie hub.mode / hub.verify_token / hub.challenge).
//  - POST : accusés de réception / messages entrants — on log et on acquitte (200).
// Déployée SANS vérification JWT (Meta n'envoie pas de JWT Supabase).
//
// Le jeton de vérification est une simple chaîne de handshake (pas un secret sensible) :
// on le met en dur ici pour que la validation Meta fonctionne sans configuration supplémentaire.
// Surchargeable via le secret WHATSAPP_VERIFY_TOKEN si besoin.

const VERIFY = Deno.env.get('WHATSAPP_VERIFY_TOKEN') || 'taga_24d07988a7538691a9f856a87ced2bd8b13dccee';

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') || '';
    if (mode === 'subscribe' && token === VERIFY) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      console.log('WA webhook', JSON.stringify(body));
    } catch { /* payload illisible : on acquitte quand même */ }
    return new Response('ok', { status: 200 });
  }

  return new Response('ok', { status: 200 });
});
