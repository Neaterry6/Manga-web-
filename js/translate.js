/* ============================================================
   MangaVerse — Client-side UI translator (v3)
   ------------------------------------------------------------
   Translates the surrounding TEXT/METADATA shown in the UI —
   manga titles, synopses, genre tags and English UI labels —
   into a user-chosen language. It does NOT (and cannot) translate
   the manga PAGE IMAGES, which are baked-in artwork; for reading
   in another language the per-manga chapter-language selector
   (MangaLang / translatedLanguage) is used instead.

   Engine: Google Translate's free "gtx" endpoint, which was
   verified to work DIRECTLY from the browser (returns HTTP 200 +
   JSON). An AllOrigins-proxied call is kept as a fallback. Results
   are cached in localStorage so we never re-translate the same
   string, keeping it fast and request-light.
   ============================================================ */
(function () {
  "use strict";

  const TGT_KEY = "mv_ui_lang";     // target UI language ("off" or "en" = no translation)
  const CACHE_KEY = "mv_tr_cache";
  const GTX = "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=auto&tl=";
  const SENTINEL = "\n~~|~~\n";     // splits batched strings in one request

  // Languages offered for UI translation (superset friendly to Google tl codes).
  const UI_LANGS = [
    { code: "off", name: "Off (English)" },
    { code: "es",  name: "Spanish" },
    { code: "fr",  name: "French" },
    { code: "pt",  name: "Portuguese" },
    { code: "de",  name: "German" },
    { code: "it",  name: "Italian" },
    { code: "ru",  name: "Russian" },
    { code: "id",  name: "Indonesian" },
    { code: "ar",  name: "Arabic" },
    { code: "hi",  name: "Hindi" },
    { code: "ja",  name: "Japanese" },
    { code: "ko",  name: "Korean" },
    { code: "zh-CN", name: "Chinese" },
    { code: "tr",  name: "Turkish" },
    { code: "vi",  name: "Vietnamese" },
    { code: "fil", name: "Filipino" }
  ];

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch (e) { return {}; }
  }
  let CACHE = loadCache();
  let cacheDirty = false;
  function flushCache() {
    if (!cacheDirty) return;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(CACHE)); cacheDirty = false; } catch (e) {}
  }
  setInterval(flushCache, 1500);

  function timedFetch(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 12000);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  // Low-level: translate one chunk of text to `tl`. Returns translated string.
  async function gtxTranslate(text, tl) {
    const target = GTX + encodeURIComponent(tl) + "&q=" + encodeURIComponent(text);
    // 1) direct (verified working in-browser)
    try {
      const r = await timedFetch(target);
      if (r.ok) {
        const j = await r.json();
        if (j && j[0]) return j[0].map(seg => seg[0]).join("");
      }
    } catch (e) { /* fall through to proxy */ }
    // 2) allorigins proxy fallback
    try {
      const r = await timedFetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(target));
      if (r.ok) {
        const j = JSON.parse(await r.text());
        if (j && j[0]) return j[0].map(seg => seg[0]).join("");
      }
    } catch (e) { /* give up */ }
    return null;
  }

  const Translate = {
    langs() { return UI_LANGS.slice(); },
    get() { try { return localStorage.getItem(TGT_KEY) || "off"; } catch (e) { return "off"; } },
    set(c) { try { localStorage.setItem(TGT_KEY, c); } catch (e) {} },
    active() { const t = this.get(); return t && t !== "off" && t !== "en"; },
    name(code) { const l = UI_LANGS.find(x => x.code === code); return l ? l.name : code; },

    // Translate a single string (cached). Returns original on no-op/failure.
    async t(text) {
      if (!this.active() || !text || !String(text).trim()) return text;
      const tl = this.get();
      const key = tl + "::" + text;
      if (CACHE[key] != null) return CACHE[key];
      const out = await gtxTranslate(String(text), tl);
      if (out) { CACHE[key] = out; cacheDirty = true; return out; }
      return text;
    },

    // Translate many strings efficiently. Uncached ones are sent in
    // ONE batched request (joined by a sentinel) then split back.
    async batch(texts) {
      const tl = this.get();
      if (!this.active()) return texts.slice();
      const result = new Array(texts.length);
      const pending = [], pendingIdx = [];
      texts.forEach((tx, i) => {
        if (!tx || !String(tx).trim()) { result[i] = tx; return; }
        const key = tl + "::" + tx;
        if (CACHE[key] != null) { result[i] = CACHE[key]; }
        else { pending.push(String(tx)); pendingIdx.push(i); }
      });
      if (!pending.length) return result;

      const joined = pending.join(SENTINEL);
      let translatedParts = null;
      // Only batch when it stays within a safe query length; else per-string.
      if (joined.length < 1400) {
        const out = await gtxTranslate(joined, tl);
        if (out) {
          const parts = out.split(/\s*~~\s*\|\s*~~\s*/);
          if (parts.length === pending.length) translatedParts = parts;
        }
      }
      if (translatedParts) {
        translatedParts.forEach((p, k) => {
          const i = pendingIdx[k], key = tl + "::" + pending[k];
          CACHE[key] = p.trim(); cacheDirty = true; result[i] = p.trim();
        });
      } else {
        // Fallback: translate each pending string individually (still cached).
        for (let k = 0; k < pending.length; k++) {
          const i = pendingIdx[k];
          result[i] = await this.t(pending[k]);
        }
      }
      flushCache();
      return result;
    },

    /* Translate every element matching [data-tr] in a container, in place.
       Stores the original text in data-tr-src so re-translation/reset works
       across language switches. */
    async apply(root) {
      const scope = root || document;
      const nodes = Array.from(scope.querySelectorAll("[data-tr]"));
      if (!nodes.length) return;
      // capture originals
      nodes.forEach(n => { if (n.dataset.trSrc == null) n.dataset.trSrc = n.textContent; });
      if (!this.active()) { nodes.forEach(n => { n.textContent = n.dataset.trSrc; }); return; }
      const srcs = nodes.map(n => n.dataset.trSrc);
      const outs = await this.batch(srcs);
      nodes.forEach((n, i) => { n.textContent = outs[i] != null ? outs[i] : n.dataset.trSrc; });
    }
  };

  window.MangaTranslate = Translate;
})();
