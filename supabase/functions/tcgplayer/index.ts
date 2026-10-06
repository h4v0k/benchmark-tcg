// Supabase Edge Function: tcgplayer (retired)
// The old site looked up TCGplayer products here. The catalog-sync function now stores exact
// TCGplayer products for every card, so this endpoint is no longer used and does nothing.
Deno.serve((req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(JSON.stringify({ error: "This endpoint has been retired.", results: {} }), { status: 410, headers: { ...cors, "Content-Type": "application/json" } });
});
