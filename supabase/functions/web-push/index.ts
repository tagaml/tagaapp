import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Auth interne (appelé par les triggers DB via pg_net). Pas de JWT utilisateur.
const INTERNAL = "tgwp_b7d1f3a9c4e2486fa1c0d9e8b5a6f3c2";
const VAPID_PUBLIC = "BFBF3iWPzYIEsGaGUTha6xOUh4IxyJt_c-EkdcLOu1sBIlWQGbCXXNzVmIJ0s6WI9I9GC_pROFjwROcO10wOSNM";
const VAPID_PRIVATE = "op47g7JPTwgqnSY21uma1dMALmbdLr29f-4hobdegoE";
webpush.setVapidDetails("mailto:support@taga.ml", VAPID_PUBLIC, VAPID_PRIVATE);

Deno.serve(async (req: Request) => {
  try {
    if (req.headers.get("x-internal-token") !== INTERNAL) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    const { targets, title, body, url } = await req.json();
    if (!Array.isArray(targets) || targets.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { headers: { "Content-Type": "application/json" } });
    }
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: subs } = await sb.from("web_push_subscriptions").select("id, subscription").in("user_id", targets);
    const payload = JSON.stringify({ title: title ?? "Taga", body: body ?? "", url: url ?? "/" });
    let sent = 0;
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(s.subscription, payload);
        sent++;
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) { await sb.from("web_push_subscriptions").delete().eq("id", s.id); }
      }
    }
    return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
