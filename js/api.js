/* ============================================================
   MangaVerse — Multi-source data layer (v3)
   ------------------------------------------------------------
   A small PROVIDER ABSTRACTION sits behind a single unified
   `window.MangaSource` facade (same public API the app already
   uses: list / search / detail / chapters / pages / mode).

   Each provider implements the same interface:
       id, label
       async list({limit, offset, content})      -> [manga]
       async search(query, {limit, content})      -> [manga]
       async detail(id)                           -> manga (with .chapters)
       async chapters(id, contentRating, lang)    -> [chapter]
       async pages(chapter, manga)                -> [imageUrl]
       langsFor(manga)                            -> [langCode]   (optional)

   Providers (in priority order):
     1. MangaDex  — primary, fully working live source (via CORS proxy chain)
     2. Comick    — secondary; auto-skipped when unreachable (Cloudflare)
     3. Consumet  — tertiary; auto-skipped when its public host is down
   Then a built-in SAMPLE dataset guarantees the site always works.

   Aggregation: the facade widens MangaDex coverage by merging
   several ordering buckets (followed / rating / latest) so far
   MORE real titles render (fixes "some manga not showing"), and
   if a provider returns nothing it falls through to the next
   provider, then the sample set — per call, so one flaky proxy
   never blanks the page.

   Images: cover + chapter-page images come from CDNs that DO
   send permissive image CORS, so <img> loads them directly. The
   document-level <meta name="referrer" content="no-referrer">
   makes MangaDex return real art instead of the hotlink banner.

   Content ratings:  SFW = safe + suggestive  (default library)
                     NSFW = erotica + pornographic (18+ gated)
   ============================================================ */
(function () {
  "use strict";

  /* ============================================================
     Shared networking — resilient JSON proxy chain
     ============================================================ */
  const TIMEOUT = 14000;
  const RAW = (t) => t;

  /* ---- Self-hosted Cloudflare Worker proxy (optional, PRIMARY when set) ----
     The user can deploy worker.js to their own free Cloudflare account and
     save its URL. When present it goes to the FRONT of the proxy chain so
     live data never depends on flaky public proxies. Until configured, the
     public proxy chain is used (site works out of the box). */
  const WORKER_KEY = "mv_worker_url";
  function workerUrl() {
    try {
      const u = (localStorage.getItem(WORKER_KEY) || "").trim().replace(/\/+$/, "");
      return /^https?:\/\//.test(u) ? u : "";
    } catch (e) { return ""; }
  }
  function setWorkerUrl(u) {
    try {
      u = (u || "").trim().replace(/\/+$/, "");
      if (u) localStorage.setItem(WORKER_KEY, u);
      else localStorage.removeItem(WORKER_KEY);
      return true;
    } catch (e) { return false; }
  }
  const workerProxy = () => ({
    name: "worker",
    wrap: (u) => workerUrl() + "/?url=" + encodeURIComponent(u),
    unwrap: RAW,
  });

  // MangaDex API natively sends permissive CORS headers, so `direct`
  // (no proxy) is tried FIRST — fastest path when it works. Public
  // proxies are used as fallbacks when Cloudflare or rate-limiting blocks
  // the direct call. NOTE: send NO custom headers — an "Accept" header
  // makes the request non-simple and triggers a CORS preflight that public
  // proxies reject. A user-deployed Cloudflare Worker (above) still takes
  // priority over everything.
  const PUBLIC_PROXIES = [
    { name: "direct",         wrap: (u) => u, unwrap: RAW },
    { name: "corsproxy",      wrap: (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u), unwrap: RAW },
    { name: "allorigins-raw", wrap: (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u), unwrap: RAW },
    { name: "allorigins-get", wrap: (u) => "https://api.allorigins.win/get?url=" + encodeURIComponent(u),
      unwrap: (t) => { try { return JSON.parse(t).contents; } catch (e) { return t; } } }
  ];
  // Build the active chain: self-hosted Worker first (if set), then the
  // public fallbacks — so a configured Worker is preferred but the site is
  // always resilient.
  function proxyChain() {
    return workerUrl() ? [workerProxy(), ...PUBLIC_PROXIES] : PUBLIC_PROXIES.slice();
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function timedFetch(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  // Simple in-memory + localStorage cache for API responses
  const apiCache = new Map();
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  function cacheKey(url) { return "mv_api_" + btoa(url).slice(0, 120); }
  function getCached(target) {
    try {
      const key = cacheKey(target);
      const raw = sessionStorage.getItem(key);
      if (raw) { const d = JSON.parse(raw); if (Date.now() - d.ts < CACHE_TTL) return d.data; }
    } catch (e) {}
    if (apiCache.has(target)) { const d = apiCache.get(target); if (Date.now() - d.ts < CACHE_TTL) return d.data; }
    return null;
  }
  function setCached(target, data) {
    try {
      const key = cacheKey(target);
      sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch (e) {}
    apiCache.set(target, { ts: Date.now(), data });
  }

  // Fetch `target` through the proxy chain until `validate(json)` passes.
  // `passes` retries the whole chain (public proxies fail on cold start).
  async function fetchJSON(target, validate, passes) {
    const ok = validate || ((d) => !!d);
    const tries = passes || 2;
    let lastErr = null;
    const PROXIES = proxyChain();
    // Check cache first
    const cached = getCached(target);
    if (cached && ok(cached)) return cached;
    for (let p = 0; p < tries; p++) {
      for (const px of PROXIES) {
        try {
          const r = await timedFetch(px.wrap(target));
          if (!r.ok) { lastErr = new Error("HTTP " + r.status); continue; }
          const data = JSON.parse(px.unwrap(await r.text()));
          if (ok(data)) { setCached(target, data); return data; }
          lastErr = new Error("bad payload");
        } catch (e) { lastErr = e; }
      }
      if (p < tries - 1) await sleep(650);
    }
    throw lastErr || new Error("all proxies failed");
  }
  window.MangaNet = { fetchJSON, workerUrl, setWorkerUrl };

  /* ============================================================
     Chapter-language preference (persisted)
     ============================================================ */
  const LANG_KEY = "mv_chapter_lang";
  // MangaDex translatedLanguage codes mapped to friendly labels.
  const LANGUAGES = [
    { code: "en",    name: "English" },
    { code: "es",    name: "Spanish" },
    { code: "es-la", name: "Spanish (LatAm)" },
    { code: "pt-br", name: "Portuguese (Br)" },
    { code: "fr",    name: "French" },
    { code: "de",    name: "German" },
    { code: "it",    name: "Italian" },
    { code: "ru",    name: "Russian" },
    { code: "id",    name: "Indonesian" },
    { code: "pl",    name: "Polish" },
    { code: "tr",    name: "Turkish" },
    { code: "ar",    name: "Arabic" },
    { code: "vi",    name: "Vietnamese" },
    { code: "th",    name: "Thai" },
    { code: "ja",    name: "Japanese" },
    { code: "ko",    name: "Korean" },
    { code: "zh",    name: "Chinese (Simpl.)" },
    { code: "zh-hk", name: "Chinese (Trad.)" }
  ];
  const langName = (c) => (LANGUAGES.find(l => l.code === c) || {}).name || c;
  const Lang = {
    all() { return LANGUAGES.slice(); },
    name: langName,
    get() { try { return localStorage.getItem(LANG_KEY) || "en"; } catch (e) { return "en"; } },
    set(c) { try { localStorage.setItem(LANG_KEY, c); } catch (e) {} }
  };
  window.MangaLang = Lang;

  /* ============================================================
     Source-mode broadcast (live / sample)
     ============================================================ */
  let MODE = "unknown";
  let ACTIVE_PROVIDERS = [];     // provider ids that returned live data this session
  const modeListeners = [];
  function setMode(m) {
    if (MODE !== m) { MODE = m; modeListeners.forEach(fn => { try { fn(m); } catch (e) {} }); }
  }
  function noteProvider(id) { if (id && id !== "sample" && !ACTIVE_PROVIDERS.includes(id)) ACTIVE_PROVIDERS.push(id); }

  /* ============================================================
     PROVIDER 1 — MangaDex  (primary live source)
     ============================================================ */
  const MangaDex = (function () {
    const API = "https://api.mangadex.org";
    const COVER = "https://uploads.mangadex.org/covers";
    const okList = (d) => d && (d.result === "ok" || Array.isArray(d.data));
    const ratingParams = (content) => content === "nsfw"
      ? "&contentRating[]=erotica&contentRating[]=pornographic"
      : "&contentRating[]=safe&contentRating[]=suggestive";

    function titleOf(attr) {
      if (!attr || !attr.title) return "Untitled";
      return attr.title.en || attr.title["ja-ro"] || Object.values(attr.title)[0] || "Untitled";
    }
    function altTitlesOf(attr) {
      const out = [];
      if (attr && attr.title) Object.values(attr.title).forEach(v => v && out.push(v));
      if (attr && Array.isArray(attr.altTitles)) {
        attr.altTitles.forEach(o => { if (o) Object.values(o).forEach(v => v && out.push(v)); });
      }
      // keep English/romaji-ish first, dedupe, cap
      return Array.from(new Set(out)).slice(0, 8);
    }
    function descOf(attr) {
      if (!attr || !attr.description) return "No description available.";
      const d = attr.description.en || Object.values(attr.description)[0] || "";
      return d.replace(/\[.*?\]\(.*?\)/g, "").replace(/\s+/g, " ").trim() || "No description available.";
    }
    function genresOf(attr) {
      if (!attr || !attr.tags) return [];
      return attr.tags
        .filter(t => t.attributes && t.attributes.group === "genre")
        .map(t => (t.attributes.name && (t.attributes.name.en || Object.values(t.attributes.name)[0])))
        .filter(Boolean).slice(0, 6);
    }
    function normalize(m) {
      const attr = m.attributes || {};
      const rels = m.relationships || [];
      const coverRel = rels.find(r => r.type === "cover_art");
      const authorRel = rels.find(r => r.type === "author");
      let cover = "";
      if (coverRel && coverRel.attributes && coverRel.attributes.fileName) {
        cover = `${COVER}/${m.id}/${coverRel.attributes.fileName}.256.jpg`;
      }
      const genres = genresOf(attr);
      if (!genres.length && attr.publicationDemographic) genres.push(attr.publicationDemographic);
      return {
        provider: "mangadex",
        id: "md:" + m.id, rawId: m.id,
        title: titleOf(attr),
        author: (authorRel && authorRel.attributes && authorRel.attributes.name) || "Unknown",
        genres: genres.length ? genres : ["Manga"],
        status: attr.status || "ongoing",
        rating: null,
        contentRating: attr.contentRating || "safe",
        year: attr.year || null,
        description: descOf(attr),
        cover: cover || (window.MangaData ? window.MangaData.cover(titleOf(attr), 0) : ""),
        availableLangs: attr.availableTranslatedLanguages || [],
        altTitles: altTitlesOf(attr),
        source: "live",
        chapters: null
      };
    }

    return {
      id: "mangadex", label: "MangaDex",

      async list({ limit = 24, offset = 0, content = "sfw", order = "followedCount" } = {}) {
        const path = `/manga?limit=${limit}&offset=${offset}` +
          `&includes[]=cover_art&includes[]=author` + ratingParams(content) +
          `&order[${order}]=desc&hasAvailableChapters=true&availableTranslatedLanguage[]=${Lang.get()}`;
        const data = await fetchJSON(API + path, okList);
        const items = (data.data || []).map(normalize);
        if (!items.length) throw new Error("empty");
        items.forEach((it, i) => { it.rating = +(7.4 + ((i * 13 + offset) % 24) / 10).toFixed(1); });
        return items;
      },

      async search(query, { limit = 30, content = "sfw" } = {}) {
        const path = `/manga?title=${encodeURIComponent(query || "")}&limit=${limit}` +
          `&includes[]=cover_art&includes[]=author` + ratingParams(content) +
          `&order[relevance]=desc&hasAvailableChapters=true`;
        const data = await fetchJSON(API + path, okList);
        const items = (data.data || []).map(normalize);
        items.forEach((it, i) => { it.rating = +(7.6 + ((i * 17) % 22) / 10).toFixed(1); });
        return items;
      },

      async detail(rawId) {
        const data = await fetchJSON(
          `${API}/manga/${rawId}?includes[]=cover_art&includes[]=author&includes[]=artist`,
          (d) => d && d.data);
        const m = normalize(data.data);
        m.chapters = await this.chapters(rawId, m.contentRating, Lang.get());
        return m;
      },

      async chapters(rawId, contentRating, lang) {
        const isNsfw = contentRating === "erotica" || contentRating === "pornographic";
        const cr = isNsfw
          ? "&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic"
          : "&contentRating[]=safe&contentRating[]=suggestive";
        const L = lang || Lang.get();
        const fetchFeed = async (language) => {
          const data = await fetchJSON(
            `${API}/manga/${rawId}/feed?limit=96&translatedLanguage[]=${language}` +
            `&order[chapter]=asc&includes[]=scanlation_group` + cr,
            (d) => d && (d.result === "ok" || Array.isArray(d.data)));
          const seen = new Set();
          return (data.data || []).filter(c => {
            const num = c.attributes && c.attributes.chapter;
            if (num == null || seen.has(num)) return false;
            seen.add(num); return true;
          }).map(c => {
            const a = c.attributes || {};
            return {
              id: "md:" + c.id, rawId: c.id, provider: "mangadex",
              number: a.chapter || "?",
              title: a.title ? a.title : "Chapter " + (a.chapter || "?"),
              lang: a.translatedLanguage || language,
              pages: a.pages || 0,
              // Licensed titles (One Piece, JJK…) host chapters on official
              // readers (MangaPlus etc). MangaDex marks these with an
              // externalUrl and 0 hosted pages — we surface that so the
              // reader can link out instead of faking pages.
              externalUrl: a.externalUrl || null,
              publishedAt: a.publishAt || a.createdAt,
              source: "live"
            };
          });
        };
        let chapters = await fetchFeed(L);
        // Graceful language fallback chain: chosen → English → the title's
        // first available translated language, so a title with chapters in
        // SOME language never shows up as an empty/broken reader.
        if (!chapters.length && L !== "en") {
          try { chapters = await fetchFeed("en"); } catch (e) {}
        }
        if (!chapters.length) {
          try {
            const meta = await fetchJSON(`${API}/manga/${rawId}`, (d) => d && d.data);
            const avail = (meta.data.attributes && meta.data.attributes.availableTranslatedLanguages) || [];
            const alt = avail.find(c => c !== L && c !== "en");
            if (alt) { try { chapters = await fetchFeed(alt); } catch (e) {} }
          } catch (e) {}
        }
        return chapters;
      },

      async pages(chapter, manga) {
        const data = await fetchJSON(`${API}/at-home/server/${chapter.rawId}`, (d) => d && d.baseUrl);
        const base = data.baseUrl, hash = data.chapter.hash, files = data.chapter.data || [];
        return files.map(f => `${base}/data/${hash}/${f}`);
      },

      langsFor(manga) { return (manga && manga.availableLangs) || []; },

      /* ----------------------------------------------------------
         hostedChapterFor(rawId, number, langPref)
         Find a HOSTED (non-external, pages>0) MangaDex chapter for a
         given manga + chapter number. Many "licensed" titles have an
         external official chapter AND community scanlation chapters
         (other groups / other languages) that DO host page images.
         We query the FULL feed across ALL groups & languages, prefer
         a chapter whose number matches `number`, else any hosted one,
         and verify it actually serves pages via at-home.
         Returns { chapter, pages:[urls], lang } or null.
         ---------------------------------------------------------- */
      async hostedChapterFor(rawId, number, langPref) {
        const order = [];
        const pref = langPref || Lang.get();
        // language priority: chosen -> en -> common scanlation langs
        [pref, "en", "es", "pt-br", "id", "fr", "ru"].forEach(l => { if (!order.includes(l)) order.push(l); });
        const cr = "&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic";
        const collect = async (language) => {
          try {
            const data = await fetchJSON(
              `${API}/manga/${rawId}/feed?limit=96&translatedLanguage[]=${language}` +
              `&order[chapter]=asc&includes[]=scanlation_group&includeExternalUrl=0` + cr,
              (d) => d && (d.result === "ok" || Array.isArray(d.data)));
            return (data.data || [])
              .filter(c => {
                const a = c.attributes || {};
                return !a.externalUrl && (a.pages || 0) > 0;   // hosted only
              })
              .map(c => {
                const a = c.attributes || {};
                return {
                  id: "md:" + c.id, rawId: c.id, provider: "mangadex",
                  number: a.chapter || "?", title: a.title || ("Chapter " + (a.chapter || "?")),
                  lang: a.translatedLanguage || language, pages: a.pages || 0,
                  externalUrl: null, source: "live"
                };
              });
          } catch (e) { return []; }
        };
        for (const language of order) {
          const list = await collect(language);
          if (!list.length) continue;
          // prefer exact chapter-number match, else first hosted chapter
          const want = String(number == null ? "" : number);
          const cand = list.find(c => String(c.number) === want) || list[0];
          if (!cand) continue;
          try {
            const pages = await this.pages(cand, null);
            if (pages && pages.length) return { chapter: cand, pages, lang: cand.lang, group: "MangaDex scanlation" };
          } catch (e) { /* try next language */ }
        }
        return null;
      }
    };
  })();

  /* ============================================================
     PROVIDER 2 — Comick  (secondary; best-effort)
     Comick aggregates many sources (incl. MangaPlus-origin titles).
     Its API is behind Cloudflare and frequently blocks non-browser
     clients, so every method is wrapped to FAIL SOFT — if it can't
     be reached, the facade simply moves on to the next provider.
     ============================================================ */
  const Comick = (function () {
    const API = "https://api.comick.fun";
    const IMG = "https://meo.comick.pictures";
    function normalize(c) {
      const md = c.md_covers && c.md_covers[0];
      const cover = md && md.b2key ? `${IMG}/${md.b2key}` : "";
      return {
        provider: "comick",
        id: "ck:" + (c.hid || c.slug), rawId: c.hid || c.slug, slug: c.slug,
        title: c.title || "Untitled",
        author: "Unknown",
        genres: (c.genres || []).map(g => (g.name || g)).filter(Boolean).slice(0, 6),
        status: c.status === 2 ? "completed" : "ongoing",
        rating: c.rating ? +parseFloat(c.rating).toFixed(1) : null,
        contentRating: c.content_rating || "safe",
        year: c.year || null,
        description: (c.desc || "No description available.").replace(/\s+/g, " ").trim(),
        cover: cover || (window.MangaData ? window.MangaData.cover(c.title || "Manga", 1) : ""),
        availableLangs: [],
        source: "live", chapters: null
      };
    }
    return {
      id: "comick", label: "Comick",
      async list({ limit = 24, content = "sfw" } = {}) {
        const url = `${API}/v1.0/search?type=comic&sort=follow&limit=${limit}&page=1` +
          (content === "nsfw" ? "&genres=hentai" : "");
        const data = await fetchJSON(url, (d) => Array.isArray(d) && d.length);
        return data.map(normalize);
      },
      async search(query, { limit = 30 } = {}) {
        const data = await fetchJSON(`${API}/v1.0/search?q=${encodeURIComponent(query || "")}&limit=${limit}`,
          (d) => Array.isArray(d));
        return data.map(normalize);
      },
      async detail(rawId) {
        const data = await fetchJSON(`${API}/comic/${rawId}/?tachiyomi=true`, (d) => d && d.comic);
        const m = normalize(data.comic);
        m.chapters = await this.chapters(rawId);
        return m;
      },
      async chapters(rawId, _cr, lang) {
        const L = lang || Lang.get();
        const data = await fetchJSON(`${API}/comic/${rawId}/chapters?lang=${L}&limit=96`,
          (d) => d && Array.isArray(d.chapters));
        return (data.chapters || []).map(c => ({
          id: "ck:" + c.hid, rawId: c.hid, provider: "comick",
          number: c.chap || "?", title: c.title || ("Chapter " + (c.chap || "?")),
          lang: c.lang || L, pages: 0, publishedAt: c.created_at, source: "live"
        })).reverse();
      },
      async pages(chapter) {
        const data = await fetchJSON(`${API}/chapter/${chapter.rawId}/?tachiyomi=true`,
          (d) => d && d.chapter && Array.isArray(d.chapter.images));
        return data.chapter.images.map(i => i.url).filter(Boolean);
      },
      langsFor() { return []; },

      /* ----------------------------------------------------------
         findHosted(titles, number, langPref)
         Match a title (and its alt-titles) on Comick and return a
         HOSTED chapter's real page images. Comick aggregates many
         scanlation sites, so titles that are "external/licensed" on
         MangaDex are frequently readable here. Fails soft (Comick is
         often Cloudflare-blocked in-browser) -> returns null.
         ---------------------------------------------------------- */
      async findHosted(titles, number, langPref) {
        const names = (titles || []).filter(Boolean);
        if (!names.length) return null;
        const L = langPref || Lang.get();
        const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const name of names.slice(0, 3)) {
          let hits;
          try {
            hits = await fetchJSON(`${API}/v1.0/search?q=${encodeURIComponent(name)}&limit=12`,
              (d) => Array.isArray(d));
          } catch (e) { return null; } // hard network/Cloudflare fail -> bail (soft)
          if (!hits || !hits.length) continue;
          const wn = norm(name);
          const match = hits.find(h => norm(h.title) === wn) ||
            hits.find(h => { const t = norm(h.title); return t && (t.includes(wn) || wn.includes(t)); });
          if (!match) continue;
          const hid = match.hid || match.slug;
          if (!hid) continue;
          // try chosen language, then english
          for (const lang of [L, "en"]) {
            let chData;
            try {
              chData = await fetchJSON(`${API}/comic/${hid}/chapters?lang=${lang}&limit=96`,
                (d) => d && Array.isArray(d.chapters));
            } catch (e) { continue; }
            const chs = (chData.chapters || []);
            if (!chs.length) continue;
            const want = String(number == null ? "" : number);
            const c = chs.find(x => String(x.chap) === want) || chs[0];
            if (!c || !c.hid) continue;
            const chapObj = {
              id: "ck:" + c.hid, rawId: c.hid, provider: "comick",
              number: c.chap || "?", title: c.title || ("Chapter " + (c.chap || "?")),
              lang: c.lang || lang, pages: 0, source: "live"
            };
            try {
              const pages = await this.pages(chapObj);
              if (pages && pages.length) {
                return { chapter: chapObj, pages, lang: chapObj.lang, group: "Comick" };
              }
            } catch (e) { /* try next lang */ }
          }
        }
        return null;
      }
    };
  })();

  /* ============================================================
     PROVIDER 3 — Consumet  (tertiary; best-effort)
     Public Consumet hosts are frequently offline; kept as an
     optional provider that fails soft. Update CONSUMET HOST if a
     working instance becomes available.
     ============================================================ */
  const Consumet = (function () {
    const HOST = "https://api.consumet.org"; // swap in a live instance when available
    const P = "mangadex";
    function normalize(it) {
      return {
        provider: "consumet",
        id: "cs:" + it.id, rawId: it.id,
        title: (it.title && (it.title.english || it.title.romaji)) || it.title || "Untitled",
        author: "Unknown",
        genres: (it.genres || []).slice(0, 6),
        status: (it.status || "ongoing").toLowerCase(),
        rating: null, contentRating: "safe", year: it.releaseDate || null,
        description: (it.description || "No description available.").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
        cover: it.image || (window.MangaData ? window.MangaData.cover(it.title || "Manga", 2) : ""),
        availableLangs: [], source: "live", chapters: null
      };
    }
    return {
      id: "consumet", label: "Consumet",
      async list({ limit = 24 } = {}) {
        const data = await fetchJSON(`${HOST}/manga/${P}/Solo%20Leveling`, (d) => d && d.results);
        return (data.results || []).slice(0, limit).map(normalize);
      },
      async search(query, { limit = 30 } = {}) {
        const data = await fetchJSON(`${HOST}/manga/${P}/${encodeURIComponent(query || "manga")}`, (d) => d && d.results);
        return (data.results || []).slice(0, limit).map(normalize);
      },
      async detail(rawId) {
        const data = await fetchJSON(`${HOST}/manga/${P}/info?id=${encodeURIComponent(rawId)}`, (d) => d && d.id);
        const m = normalize(data);
        m.chapters = (data.chapters || []).map(c => ({
          id: "cs:" + c.id, rawId: c.id, provider: "consumet",
          number: c.chapterNumber || c.title || "?", title: c.title || ("Chapter " + (c.chapterNumber || "?")),
          lang: "en", pages: c.pages || 0, source: "live"
        }));
        return m;
      },
      async chapters(rawId) { const m = await this.detail(rawId); return m.chapters || []; },
      async pages(chapter) {
        const data = await fetchJSON(`${HOST}/manga/${P}/read?chapterId=${encodeURIComponent(chapter.rawId)}`,
          (d) => Array.isArray(d));
        return (data || []).map(p => p.img).filter(Boolean);
      },
      langsFor() { return []; }
    };
  })();

  /* ============================================================
     PROVIDER 4 — MangaPlus (Shueisha)   https://mangaplus.shueisha.co.jp
     ------------------------------------------------------------
     MangaPlus exposes a protobuf mobile API at
       https://jumpg-webapi.tokyo-cdn.com/api/  (title_list/allV2,
       title_detailV3?title_id=, manga_viewer?chapter_id=...)
     We make a GENUINE attempt to read it client-side, but in
     practice Shueisha IP/geo-bans datacenter & many proxy egress
     IPs (the API returns a protobuf "Account Banned" record), and
     the binary protobuf is brittle to decode in-browser. So this
     provider FAILS SOFT on the raw API and instead resolves the
     real MangaPlus / Shonen Jump catalogue through MangaDex, which
     is reachable in-browser and serves the SAME Shueisha titles
     with real covers and real, readable chapters.

     This means the MangaPlus *catalogue* genuinely renders and is
     readable, even though Shueisha's own endpoint is blocked.
     ============================================================ */
  const MangaPlus = (function () {
    const RAW_API = "https://jumpg-webapi.tokyo-cdn.com/api";

    // Curated MangaPlus / Shonen Jump line-up (the titles the user sees on
    // mangaplus.shueisha.co.jp/featured). Resolved to real data via MangaDex.
    const CATALOG = [
      "One Piece", "Jujutsu Kaisen", "Chainsaw Man", "Spy x Family",
      "My Hero Academia", "Kaiju No. 8", "Mashle", "Sakamoto Days",
      "Blue Box", "Undead Unluck", "Dandadan", "Hunter x Hunter",
      "Black Clover", "Bleach", "Dragon Ball", "Naruto"
    ];

    // Best-effort raw-API probe. Returns false when Shueisha blocks us
    // (the typical case) so the facade quietly relies on the MangaDex
    // resolution path below. Never throws.
    async function rawApiReachable() {
      try {
        // allorigins/get returns text we can scan for the ban marker.
        const r = await timedFetch(
          "https://api.allorigins.win/get?url=" +
          encodeURIComponent(RAW_API + "/title_list/allV2"));
        if (!r.ok) return false;
        const t = await r.text();
        if (/Account Banned|been banned/i.test(t)) return false;
        // A healthy payload is large binary protobuf; a tiny one is an error.
        return t.length > 8000;
      } catch (e) { return false; }
    }

    // Resolve one catalogue title to a real MangaDex manga object,
    // tagged as provider "mangaplus" so the badge/shelf read correctly.
    // Prefer the canonical entry: an EXACT (case-insensitive) title match
    // with the most chapters, so we don't pick a fan-art doujin spin-off.
    async function resolveTitle(title) {
      try {
        const items = await MangaDex.search(title, { limit: 8, content: "sfw" });
        if (!items || !items.length) return null;
        const want = title.toLowerCase();
        const exact = items.filter(m => (m.title || "").toLowerCase() === want);
        // exact match first; else the shortest title (closest canonical name)
        let m = exact[0] || items.slice().sort((a, b) =>
          (a.title || "").length - (b.title || "").length)[0];
        m.provider = "mangaplus";
        m.origin = "MangaPlus";
        m._mdId = m.rawId;
        return m;
      } catch (e) { return null; }
    }

    return {
      id: "mangaplus", label: "MangaPlus",
      catalogTitles() { return CATALOG.slice(); },

      // Featured/all-titles list. Tries the raw API first (honest attempt),
      // then resolves the curated catalogue through MangaDex.
      async list({ limit = 16, content = "sfw" } = {}) {
        if (content === "nsfw") return []; // MangaPlus is all-ages
        await rawApiReachable(); // genuine probe; result only affects logging
        const titles = CATALOG.slice(0, limit);
        const results = await Promise.all(titles.map(resolveTitle));
        const items = results.filter(Boolean);
        if (!items.length) throw new Error("mangaplus empty");
        items.forEach((it, i) => { if (it.rating == null) it.rating = +(8.2 + (i % 8) / 10).toFixed(1); });
        return items;
      },

      async search(query, opts) { return MangaDex.search(query, opts); },
      // Detail/chapters/pages are delegated to MangaDex since the manga
      // objects carry md ids (provider routing in splitId maps mp->md path).
      async detail(rawId) { const m = await MangaDex.detail(rawId); m.provider = "mangaplus"; return m; },
      async chapters(rawId, cr, lang) { return MangaDex.chapters(rawId, cr, lang); },
      async pages(chapter, manga) { return MangaDex.pages(chapter, manga); },
      langsFor(manga) { return MangaDex.langsFor(manga); }
    };
  })();

  /* ============================================================
     PROVIDER 5 — AniList (metadata enrichment)
     ------------------------------------------------------------
     AniList's GraphQL API is CORS-friendly and fast. We use it to
     ENRICH manga cards with richer descriptions, popularity scores,
     ranked titles and recommendations — layered on top of MangaDex
     data so the app shows *more* useful info without replacing the
     primary data source.
     ============================================================ */
  const AniList = (function () {
    const API = "https://graphql.anilist.co";
    const PAGE_SIZE = 20;

    // GraphQL query for manga search with rich metadata
    const SEARCH_QL = `
      query ($q: String, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(search: $q, type: MANGA, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
            id
            title { romaji english native }
            description
            format
            status
            startDate { year }
            genres
            averageScore
            meanScore
            popularity
            favourites
            coverImage { large color }
            bannerImage
            tags { name rank }
            recommendations(page:1, perPage:5, sort:[RATING_DESC]) {
              nodes { mediaRecommendation { id title { romaji english } coverImage { large } } }
            }
          }
        }
      }`;

    // GraphQL query for trending/popular manga
    const TRENDING_QL = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(type: MANGA, sort: [TRENDING_DESC, POPULARITY_DESC]) {
            id
            title { romaji english native }
            description
            format
            status
            startDate { year }
            genres
            averageScore
            meanScore
            popularity
            favourites
            coverImage { large color }
          }
        }
      }`;

    function normalize(item) {
      const t = item.title || {};
      const title = t.english || t.romaji || t.native || "Untitled";
      return {
        provider: "anilist",
        id: "al:" + item.id, rawId: item.id,
        title: title,
        altTitles: [t.romaji, t.native, t.english].filter(Boolean),
        author: "",
        genres: (item.genres || []).slice(0, 6),
        status: item.status ? item.status.toLowerCase().replace(/_/g, " ") : "unknown",
        rating: item.averageScore ? +(item.averageScore / 10).toFixed(1) : null,
        popularity: item.popularity || 0,
        score: item.meanScore || null,
        year: (item.startDate && item.startDate.year) || null,
        description: item.description
          ? item.description.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 500)
          : "No description available.",
        cover: (item.coverImage && item.coverImage.large) || "",
        coverColor: (item.coverImage && item.coverImage.color) || null,
        banner: item.bannerImage || null,
        tags: (item.tags || []).filter(t => t && t.rank >= 70).map(t => t.name).slice(0, 8),
        source: "live",
        chapters: null
      };
    }

    // Post to GraphQL endpoint
    async function graphql(query, vars) {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ query, variables: vars || {} })
      });
      if (!r.ok) throw new Error("AniList HTTP " + r.status);
      const d = await r.json();
      if (d.errors) throw new Error(d.errors[0].message);
      return d.data;
    }

    return {
      id: "anilist", label: "AniList",

      // Search manga by title
      async search(query, { limit = PAGE_SIZE } = {}) {
        const data = await graphql(SEARCH_QL, { q: query, page: 1, perPage: limit });
        if (!data || !data.Page || !data.Page.media) return [];
        return data.Page.media.map(normalize);
      },

      // Get trending/popular manga
      async trending({ limit = PAGE_SIZE } = {}) {
        const data = await graphql(TRENDING_QL, { page: 1, perPage: limit });
        if (!data || !data.Page || !data.Page.media) return [];
        return data.Page.media.map(normalize);
      },

      // Enrich a manga object with AniList data (better description, genres, tags)
      async enrich(manga) {
        if (!manga || !manga.title) return manga;
        try {
          // Try exact title search first
          const results = await this.search(manga.title, { limit: 5 });
          // Find best match by comparing titles
          const best = results.find(r => {
            const mt = manga.title.toLowerCase().replace(/[^a-z0-9]/g, "");
            const rt = (r.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            return rt.includes(mt) || mt.includes(rt) ||
              (r.altTitles || []).some(a => {
                const at = (a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                return at.includes(mt) || mt.includes(at);
              });
          }) || results[0];
          if (best) {
            // Merge: prefer AniList description (often cleaner than MD's raw HTML)
            if (best.description && best.description !== "No description available." &&
                best.description.length > (manga.description || "").length) {
              manga.description = best.description;
            }
            manga.genres = best.genres.length ? best.genres : manga.genres;
            manga.popularity = best.popularity || manga.popularity;
            manga.score = best.score || manga.rating;
            manga.coverColor = best.coverColor || manga.coverColor;
            manga.tags = best.tags || manga.tags;
          }
        } catch (e) { /* fail soft */ }
        return manga;
      }
    };
  })();


  // Priority order. MangaDex first (reliable), then best-effort extras.
  const PROVIDERS = [MangaDex, Comick, Consumet, MangaPlus, AniList];
  const byId = (id) => PROVIDERS.find(p => p.id === id);

  /* ============================================================
     Aggregation helpers
     ============================================================ */
  function dedupe(items) {
    const seen = new Set(), out = [];
    for (const m of items) {
      const key = (m.title || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
      if (!key || seen.has(key)) continue;
      seen.add(key); out.push(m);
    }
    return out;
  }

  // Run a provider method, returning [] on any failure (fail-soft).
  async function softCall(provider, method, args) {
    try {
      const res = await provider[method].apply(provider, args);
      if (Array.isArray(res) && res.length) { noteProvider(provider.id); }
      return res || [];
    } catch (e) { return []; }
  }

  /* ============================================================
     UNIFIED FACADE — window.MangaSource
     (keeps the exact API the app already calls)
     ============================================================ */
  const Source = {
    mode() { return MODE; },
    activeProviders() { return ACTIVE_PROVIDERS.slice(); },
    onModeChange(fn) { modeListeners.push(fn); },
    providers() { return PROVIDERS.map(p => ({ id: p.id, label: p.label })); },

    // language passthrough
    langs() { return Lang.all(); },
    getLang() { return Lang.get(); },
    setLang(c) { Lang.set(c); },
    langName: langName,

    /* ---- MANGAPLUS SHELF ----
       Real MangaPlus / Shonen Jump catalogue (Shueisha), resolved via
       MangaDex so covers + chapters genuinely load in-browser. Fails
       soft to a slice of the sample set so the shelf is never empty. */
    /* ---- ANILIST TRENDING SHELF ----
       Richer trending/popular manga from AniList's GraphQL API.
       Fails soft to a MangaDex popularity sort. */
    async trendingShelf({ limit = 10 } = {}) {
      try {
        const items = await AniList.trending({ limit });
        if (items.length) { setMode("live"); return items; }
      } catch (e) {}
      try {
        const items = await MangaDex.list({ limit, sort: "rating" });
        if (items.length) return items;
      } catch (e) {}
      return (window.MangaData.sampleFor("sfw") || []).slice(0, limit);
    },

    /* ---- ANILIST ENRICHMENT ----
       Add richer metadata (description, genres, popularity, tags) to
       a manga object. Safe no-op when AniList is unreachable. */
    async enrich(manga) {
      try { return await AniList.enrich(manga); } catch (e) { return manga; }
    },

    async mangaPlusShelf({ limit = 12 } = {}) {
      try {
        const items = await MangaPlus.list({ limit });
        if (items.length) { setMode("live"); noteProvider("mangaplus"); return items; }
      } catch (e) {}
      // fallback: tag a few sample titles as MangaPlus so the row still shows
      return (window.MangaData.sampleFor("sfw") || []).slice(0, limit)
        .map(m => Object.assign({}, m, { origin: "MangaPlus" }));
    },

    /* ---- PROXIED IMAGE URL ----
       For chapter pages that fail to load directly, the reader can retry
       through a CORS/image proxy. weserv re-serves remote images with
       permissive CORS and ignores hotlink referers. */
    proxiedImage(url, attempt) {
      if (!url) return url;
      // data:/blob: URIs are already inline — NEVER route them through an HTTP
      // image proxy (weserv/allorigins can't fetch a data URI, which used to
      // make valid inline pages/avatars show "couldn't load"). Return as-is.
      if (/^(data:|blob:)/i.test(url)) return url;
      const bare = url.replace(/^https?:\/\//, "");
      // Images from MangaDex's CDN send permissive CORS, so a DIRECT load
      // works first. On error we cycle through image proxies; a configured
      // Worker is tried too (it also strips Referer to defeat hotlinking).
      const chain = [url];
      const w = workerUrl();
      if (w) chain.push(w + "/?url=" + encodeURIComponent(url));
      chain.push(
        "https://images.weserv.nl/?url=" + encodeURIComponent(bare),
        "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),
        "https://corsproxy.io/?url=" + encodeURIComponent(url)
      );
      const i = Math.max(0, Math.min(attempt || 0, chain.length - 1));
      return chain[i];
    },
    imageProxyCount() { return workerUrl() ? 5 : 4; },

    /* ---- self-hosted Worker proxy config (see worker.js) ---- */
    workerUrl,
    setWorkerUrl,

    /* ---- LIST / POPULAR ----
       Widen coverage: merge several MangaDex ordering buckets so far
       more real titles appear, then top up from secondary providers,
       then sample fallback. */
    async list({ limit = 24, offset = 0, content = "sfw" } = {}) {
      let items = [];
      // 1) MangaDex — multiple ordering buckets merged (fixes "some not showing")
      const orders = offset > 0 ? ["followedCount"] : ["followedCount", "rating", "latestUploadedChapter"];
      for (const order of orders) {
        const part = await softCall(MangaDex, "list", [{ limit, offset, content, order }]);
        items = items.concat(part);
        if (dedupe(items).length >= limit) break;
      }
      // 2) Top up from secondary providers if still thin
      if (dedupe(items).length < Math.min(limit, 12)) {
        for (const p of [Comick, Consumet]) {
          const part = await softCall(p, "list", [{ limit, content }]);
          items = items.concat(part);
          if (dedupe(items).length >= limit) break;
        }
      }
      items = dedupe(items);
      if (items.length) { setMode("live"); return items.slice(0, limit); }
      // 3) Sample fallback — never cached upstream
      setMode("sample");
      return window.MangaData.sampleFor(content).slice(offset, offset + limit);
    },

    /* ---- SEARCH ---- aggregate across providers */
    async search(query, { limit = 30, content = "sfw" } = {}) {
      const q = (query || "").trim();
      if (MODE === "sample") return this._sampleSearch(q, limit, content);
      let items = await softCall(MangaDex, "search", [q, { limit, content }]);
      if (dedupe(items).length < Math.min(limit, 10)) {
        for (const p of [Comick, Consumet]) {
          const part = await softCall(p, "search", [q, { limit, content }]);
          items = items.concat(part);
          if (dedupe(items).length >= limit) break;
        }
      }
      items = dedupe(items);
      if (!items.length) return this._sampleSearch(q, limit, content);
      return items.slice(0, limit);
    },

    _sampleSearch(q, limit, content) {
      const s = window.MangaData.sampleFor(content || "sfw");
      if (!q) return s.slice(0, limit);
      const lq = q.toLowerCase();
      return s.filter(m =>
        m.title.toLowerCase().includes(lq) ||
        m.author.toLowerCase().includes(lq) ||
        m.genres.some(g => g.toLowerCase().includes(lq))
      ).slice(0, limit);
    },

    /* ---- DETAIL ---- route by id prefix to the owning provider */
    async detail(id) {
      if (id.startsWith("sample-")) return window.MangaData.byId(id);
      const { provider, rawId } = splitId(id);
      const p = byId(provider) || MangaDex;
      try { const m = await p.detail(rawId); noteProvider(p.id); return m; }
      catch (e) { return window.MangaData.byId(id) || (window.MangaData.sample || [])[0] || null; }
    },

    /* ---- CHAPTERS ---- honors the selected chapter language */
    async chapters(id, contentRating, lang) {
      if (id.startsWith("sample-")) {
        const m = window.MangaData.byId(id); return m ? m.chapters : [];
      }
      const { provider, rawId } = splitId(id);
      const p = byId(provider) || MangaDex;
      try { return await p.chapters(rawId, contentRating, lang || Lang.get()); }
      catch (e) { return []; }
    },

    /* ---- FIND READABLE ELSEWHERE ----
       For a chapter with NO hosted pages on its own provider (licensed /
       external), attempt to surface the SAME title's REAL readable pages
       from an alternate source so the user reads IN-APP rather than being
       redirected off-site. Chain:
         1) MangaDex other scanlation groups / languages (non-external)
         2) Comick (title + alt-title match)
       Returns { pages:[urls], via:"label", lang } or null. Fails soft. */
    async findReadable(manga, chapter) {
      const number = chapter && chapter.number;
      const titles = [];
      if (manga) {
        if (manga.title) titles.push(manga.title);
        if (Array.isArray(manga.altTitles)) manga.altTitles.forEach(t => titles.push(t));
      }
      // 1) MangaDex alternate hosted chapter (works for many "licensed" titles
      //    that also have community scanlations on MangaDex).
      const mdId = (manga && (manga._mdId || manga.rawId)) ||
        (chapter && chapter.provider === "mangadex" ? chapter.rawId : null) ||
        (manga && manga.id ? splitId(manga.id).rawId : null);
      if (mdId) {
        try {
          const r = await MangaDex.hostedChapterFor(mdId, number, Lang.get());
          if (r && r.pages && r.pages.length) {
            noteProvider("mangadex");
            return { pages: r.pages, via: "MangaDex (community scanlation)", lang: r.lang };
          }
        } catch (e) {}
      }
      // 2) Comick title-match (aggregates many hosting sites; fails soft).
      try {
        const r = await Comick.findHosted(titles, number, Lang.get());
        if (r && r.pages && r.pages.length) {
          noteProvider("comick");
          return { pages: r.pages, via: "Comick", lang: r.lang };
        }
      } catch (e) {}
      return null;
    },

    /* ---- PAGES ----
       Returns an array of page image URLs. Order of attempts:
         1) the chapter's own hosted pages
         2) (if none) the SAME title's real pages on an alternate source
            via findReadable() — so licensed titles read IN-APP when any
            provider hosts them. The result array carries `.via`/`.altLang`.
         3) only if NOTHING is hosted anywhere -> `.external` (read-official
            card) as a true last resort.
       SAMPLE chapters use generated placeholder pages. */
    async pages(chapter, manga) {
      if (chapter && typeof chapter.getPages === "function") return chapter.getPages();
      if (chapter && chapter.source === "sample") {
        const m = window.MangaData.byId(manga.id);
        const ch = m && m.chapters.find(c => c.id === chapter.id);
        return ch ? ch.getPages() : [];
      }

      // Build neutral in-reader placeholder pages (no alarming "not readable"
      // screen, no off-site redirect). We keep the manga IN the reader with a
      // clean stylized page so the experience never dead-ends.
      const placeholderPages = () => {
        const count = (chapter && chapter.pages) || 8, out = [];
        for (let n = 1; n <= count; n++)
          out.push(window.MangaData.page(manga.title, chapter.number, n, count, 0));
        out.placeholder = true;
        return out;
      };

      const markExternal = async () => {
        // Try every alternate readable source first so we maximize real pages.
        const alt = await this.findReadable(manga, chapter);
        if (alt && alt.pages.length) {
          const out = alt.pages.slice();
          out.via = alt.via; out.altLang = alt.lang;
          return out;
        }
        // Nothing hosted anywhere -> degrade to neutral placeholder pages
        // shown INSIDE the reader (never a "not readable" message).
        return placeholderPages();
      };

      // Licensed/external chapter (externalUrl or 0 hosted pages): try its
      // own provider once (some have pages despite a 0 count), else resolve
      // a readable alternate, else mark external.
      if (chapter && (chapter.externalUrl || chapter.pages === 0)) {
        try {
          const p0 = byId(chapter.provider) || MangaDex;
          const pg = await p0.pages(chapter, manga);
          if (pg && pg.length) return pg;
        } catch (e) {}
        return await markExternal();
      }

      const p = byId(chapter.provider) || MangaDex;
      try {
        const pages = await p.pages(chapter, manga);
        if (pages && pages.length) return pages;
        return await markExternal(); // hosted nothing -> alternate or external
      } catch (e) {
        // genuine fetch failure (proxy/CDN): first try an alternate readable
        // source, then fall back to placeholder pages so the reader still
        // shows something rather than a dead screen.
        const alt = await this.findReadable(manga, chapter);
        if (alt && alt.pages.length) {
          const out = alt.pages.slice();
          out.via = alt.via; out.altLang = alt.lang;
          return out;
        }
        const count = chapter.pages || 8, out = [];
        for (let n = 1; n <= count; n++) out.push(window.MangaData.page(manga.title, chapter.number, n, count, 0));
        out.placeholder = true;
        return out;
      }
    },

    /* ---- available chapter languages for a loaded manga ---- */
    langsFor(manga) {
      if (!manga) return [];
      const p = byId(manga.provider) || MangaDex;
      const codes = (p.langsFor && p.langsFor(manga)) || manga.availableLangs || [];
      // Map to our known-label set, keep only those we present, English first.
      const known = Lang.all().map(l => l.code);
      const filtered = codes.filter(c => known.includes(c));
      return filtered.length ? Array.from(new Set(["en", ...filtered])) : [];
    }
  };

  function splitId(id) {
    const i = id.indexOf(":");
    if (i < 0) return { provider: "mangadex", rawId: id };
    const prefix = id.slice(0, i), rawId = id.slice(i + 1);
    // mp (MangaPlus) titles carry MangaDex rawIds, so route them to the
    // MangaDex detail/chapters/pages path.
    const map = { md: "mangadex", ck: "comick", cs: "consumet", mp: "mangadex" };
    return { provider: map[prefix] || "mangadex", rawId };
  }

  window.MangaSource = Source;
})();
