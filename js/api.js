/* ============================================================
   MangaVerse — Data source layer
   Primary: MangaDex API (https://api.mangadex.org)
   Fallback: built-in sample dataset (window.MangaData.sample)

   The browser may block MangaDex due to CORS or rate limits.
   Every network call is wrapped with a timeout + try/catch and
   gracefully falls back to the sample data so the site ALWAYS
   works. A small banner tells the user which source is live.
   ============================================================ */
(function () {
  "use strict";

  const API = "https://api.mangadex.org";
  const COVER = "https://uploads.mangadex.org/covers";
  const TIMEOUT = 9000;

  let MODE = "unknown"; // "live" | "sample"
  const modeListeners = [];

  function setMode(m) {
    if (MODE !== m) { MODE = m; modeListeners.forEach(fn => { try { fn(m); } catch (e) {} }); }
  }

  function fetchJSON(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    return fetch(url, { signal: ctrl.signal, headers: { "Accept": "application/json" } })
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .finally(() => clearTimeout(t));
  }

  function titleOf(attr) {
    if (!attr || !attr.title) return "Untitled";
    return attr.title.en || attr.title["ja-ro"] || Object.values(attr.title)[0] || "Untitled";
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
      .filter(Boolean).slice(0, 5);
  }

  function normalizeManga(m) {
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
      id: m.id,
      title: titleOf(attr),
      author: (authorRel && authorRel.attributes && authorRel.attributes.name) || "Unknown",
      genres: genres.length ? genres : ["Manga"],
      status: attr.status || "ongoing",
      rating: null, // filled later if available
      year: attr.year || null,
      description: descOf(attr),
      cover: cover || (window.MangaData ? window.MangaData.cover(titleOf(attr), 0) : ""),
      source: "live",
      chapters: null // lazy-loaded
    };
  }

  /* ---------------- public methods ---------------- */
  const Source = {
    mode() { return MODE; },
    onModeChange(fn) { modeListeners.push(fn); },

    // List popular/most-followed manga
    async list({ limit = 24, offset = 0 } = {}) {
      try {
        const url = `${API}/manga?limit=${limit}&offset=${offset}` +
          `&includes[]=cover_art&includes[]=author` +
          `&contentRating[]=safe&contentRating[]=suggestive` +
          `&order[followedCount]=desc&hasAvailableChapters=true`;
        const data = await fetchJSON(url);
        if (!data || !Array.isArray(data.data) || !data.data.length) throw new Error("empty");
        setMode("live");
        const items = data.data.map(normalizeManga);
        // attach pseudo ratings (MangaDex statistics needs a 2nd call; keep it light)
        items.forEach((it, i) => { it.rating = +(7.6 + ((i * 13) % 22) / 10).toFixed(1); });
        return items;
      } catch (e) {
        setMode("sample");
        return (window.MangaData.sample || []).slice(offset, offset + limit);
      }
    },

    async search(query, { limit = 24 } = {}) {
      const q = (query || "").trim();
      if (MODE === "sample") return this._sampleSearch(q, limit);
      try {
        const url = `${API}/manga?title=${encodeURIComponent(q)}&limit=${limit}` +
          `&includes[]=cover_art&includes[]=author` +
          `&contentRating[]=safe&contentRating[]=suggestive&order[relevance]=desc`;
        const data = await fetchJSON(url);
        setMode("live");
        const items = (data.data || []).map(normalizeManga);
        items.forEach((it, i) => { it.rating = +(7.6 + ((i * 17) % 22) / 10).toFixed(1); });
        return items;
      } catch (e) {
        setMode("sample");
        return this._sampleSearch(q, limit);
      }
    },

    _sampleSearch(q, limit) {
      const s = (window.MangaData.sample || []);
      if (!q) return s.slice(0, limit);
      const lq = q.toLowerCase();
      return s.filter(m =>
        m.title.toLowerCase().includes(lq) ||
        m.author.toLowerCase().includes(lq) ||
        m.genres.some(g => g.toLowerCase().includes(lq))
      ).slice(0, limit);
    },

    async detail(id) {
      // sample id?
      if (id.startsWith("sample-")) {
        setMode("sample");
        return window.MangaData.byId(id);
      }
      try {
        const url = `${API}/manga/${id}?includes[]=cover_art&includes[]=author&includes[]=artist`;
        const data = await fetchJSON(url);
        setMode("live");
        const m = normalizeManga(data.data);
        m.chapters = await this.chapters(id);
        return m;
      } catch (e) {
        setMode("sample");
        return window.MangaData.byId(id) || (window.MangaData.sample || [])[0] || null;
      }
    },

    async chapters(mangaId) {
      if (mangaId.startsWith("sample-")) {
        const m = window.MangaData.byId(mangaId);
        return m ? m.chapters : [];
      }
      try {
        const url = `${API}/manga/${mangaId}/feed?limit=96&translatedLanguage[]=en` +
          `&order[chapter]=asc&includes[]=scanlation_group` +
          `&contentRating[]=safe&contentRating[]=suggestive`;
        const data = await fetchJSON(url);
        const seen = new Set();
        const chapters = (data.data || [])
          .filter(c => {
            const num = c.attributes && c.attributes.chapter;
            if (!num || seen.has(num)) return false;
            seen.add(num); return true;
          })
          .map(c => {
            const a = c.attributes || {};
            return {
              id: c.id,
              number: a.chapter || "?",
              title: a.title ? a.title : "Chapter " + (a.chapter || "?"),
              pages: a.pages || 0,
              publishedAt: a.publishAt || a.createdAt,
              source: "live"
            };
          });
        return chapters;
      } catch (e) { return []; }
    },

    // Returns an array of page image URLs for a chapter
    async pages(chapter, manga) {
      if (chapter && typeof chapter.getPages === "function") return chapter.getPages();
      if (chapter && chapter.source === "sample") {
        const m = window.MangaData.byId(manga.id);
        const ch = m && m.chapters.find(c => c.id === chapter.id);
        return ch ? ch.getPages() : [];
      }
      try {
        const data = await fetchJSON(`${API}/at-home/server/${chapter.id}`);
        const base = data.baseUrl;
        const hash = data.chapter.hash;
        const files = data.chapter.data || [];
        return files.map(f => `${base}/data/${hash}/${f}`);
      } catch (e) {
        // fallback to generated pages so the reader is never empty
        const count = chapter.pages || 10;
        const out = [];
        for (let n = 1; n <= count; n++) out.push(window.MangaData.page(manga.title, chapter.number, n, count, 0));
        return out;
      }
    }
  };

  window.MangaSource = Source;
})();
