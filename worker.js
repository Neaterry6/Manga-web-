/* ============================================================
 * MangaVerse — tiny CORS proxy (Cloudflare Worker)
 * ------------------------------------------------------------
 * Deploy this to your own free Cloudflare account and paste the
 * resulting URL into MangaVerse (Settings → "Live data proxy",
 * or run in the browser console:
 *     localStorage.setItem('mv_worker_url','https://<name>.<you>.workers.dev')
 * )
 *
 * Once configured, MangaVerse uses this Worker as the PRIMARY
 * proxy in front of the MangaDex / Comick JSON APIs and the
 * cover/chapter image CDNs, so live data no longer depends on
 * flaky public proxies and (almost) never falls back to sample.
 *
 * Usage from the client:
 *     https://<worker>/?url=<ENCODED_TARGET_URL>
 *
 * It forwards the request to the target, streams the response
 * back, and adds permissive CORS headers. It also strips the
 * Referer so MangaDex's image CDN returns real artwork instead
 * of the "view on mangadex.org" hotlink placeholder.
 * ============================================================ */

// Only allow proxying to these hosts (prevents open-proxy abuse).
const ALLOWED = [
  "api.mangadex.org",
  "uploads.mangadex.org",
  "mangadex.org",
  "api.comick.fun",
  "api.comick.io",
  "meo.comick.pictures",
  "meo3.comick.pictures",
  "images.weserv.nl",
];

function corsHeaders(extra) {
  const h = new Headers(extra || {});
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET,HEAD,POST,OPTIONS");
  h.set("Access-Control-Allow-Headers", "*");
  h.set("Access-Control-Max-Age", "86400");
  return h;
}

export default {
  async fetch(request) {
    // Pre-flight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get("url");
    if (!target) {
      return new Response(
        "MangaVerse CORS proxy. Use ?url=<encoded target url>.",
        { status: 400, headers: corsHeaders({ "Content-Type": "text/plain" }) }
      );
    }

    let t;
    try { t = new URL(target); } catch (e) {
      return new Response("Bad target url.", { status: 400, headers: corsHeaders() });
    }

    // Host allow-list
    if (!ALLOWED.some(h => t.hostname === h || t.hostname.endsWith("." + h))) {
      return new Response("Host not allowed: " + t.hostname, {
        status: 403, headers: corsHeaders({ "Content-Type": "text/plain" }),
      });
    }

    // Forward the request WITHOUT a Referer (so MangaDex serves real art)
    // and without hop-by-hop headers.
    const fwd = new Request(t.toString(), {
      method: request.method === "POST" ? "POST" : "GET",
      headers: { "User-Agent": "MangaVerse/1.0 (+cloudflare-worker)" },
      redirect: "follow",
      body: request.method === "POST" ? request.body : undefined,
    });

    let resp;
    try {
      resp = await fetch(fwd, { cf: { cacheTtl: 300, cacheEverything: true } });
    } catch (e) {
      return new Response("Upstream fetch failed: " + e.message, {
        status: 502, headers: corsHeaders({ "Content-Type": "text/plain" }),
      });
    }

    // Copy through content-type etc., but override CORS.
    const outHeaders = corsHeaders();
    const ct = resp.headers.get("Content-Type");
    if (ct) outHeaders.set("Content-Type", ct);
    const cc = resp.headers.get("Cache-Control");
    if (cc) outHeaders.set("Cache-Control", cc);

    return new Response(resp.body, { status: resp.status, headers: outHeaders });
  },
};
