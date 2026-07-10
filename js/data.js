/* ============================================================
   MangaVerse — Built-in sample dataset (offline fallback)
   Used automatically when the MangaDex API is unreachable or
   blocked by the browser (CORS / rate limits). Covers and pages
   are generated as inline SVG data URIs so the site is fully
   functional with zero external dependencies.
   ============================================================ */
(function () {
  "use strict";

  const PALETTES = [
    ["#6366f1", "#0ea5e9"], ["#ec4899", "#8b5cf6"], ["#f59e0b", "#ef4444"],
    ["#10b981", "#06b6d4"], ["#3b82f6", "#9333ea"], ["#f43f5e", "#fb923c"],
    ["#14b8a6", "#6366f1"], ["#a855f7", "#ec4899"], ["#0ea5e9", "#22c55e"],
    ["#eab308", "#f97316"]
  ];

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // Robust inline-SVG -> data URI. base64 avoids any '#'-as-fragment truncation
  // and renders identically everywhere; falls back to percent-encoding.
  function svgUri(svg) {
    svg = svg.replace(/\n\s+/g, "");
    try { return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg))); }
    catch (e) { return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); }
  }

  // Generate an attractive gradient SVG cover with the title baked in.
  function cover(title, idx) {
    const p = PALETTES[idx % PALETTES.length];
    const initials = title.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='512' height='728' viewBox='0 0 512 728'>
        <defs>
          <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
            <stop offset='0' stop-color='${p[0]}'/><stop offset='1' stop-color='${p[1]}'/>
          </linearGradient>
          <radialGradient id='r' cx='0.3' cy='0.2' r='0.9'>
            <stop offset='0' stop-color='rgba(255,255,255,.35)'/><stop offset='1' stop-color='rgba(255,255,255,0)'/>
          </radialGradient>
        </defs>
        <rect width='512' height='728' fill='url(#g)'/>
        <rect width='512' height='728' fill='url(#r)'/>
        <g fill='rgba(0,0,0,.18)'>
          <circle cx='430' cy='120' r='120'/><circle cx='90' cy='560' r='150'/>
        </g>
        <text x='40' y='150' font-family='Sora, sans-serif' font-size='150' font-weight='800' fill='rgba(255,255,255,.92)'>${esc(initials)}</text>
        <rect x='40' y='600' width='432' height='4' rx='2' fill='rgba(255,255,255,.5)'/>
        <text x='40' y='660' font-family='Outfit, sans-serif' font-size='30' font-weight='700' fill='#fff'>${esc(title.length > 22 ? title.slice(0, 21) + "…" : title)}</text>
        <text x='40' y='698' font-family='Outfit, sans-serif' font-size='20' fill='rgba(255,255,255,.8)'>MangaVerse</text>
      </svg>`;
    return svgUri(svg);
  }

  // Generate a manga "page" image for the reader.
  function page(title, chapter, n, total, idx) {
    const p = PALETTES[idx % PALETTES.length];
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='1130' viewBox='0 0 800 1130'>
        <rect width='800' height='1130' fill='#11121a'/>
        <rect x='24' y='24' width='752' height='1082' rx='10' fill='none' stroke='${p[0]}' stroke-opacity='.4' stroke-width='2'/>
        <g opacity='.5'>
          <rect x='60' y='70' width='680' height='300' rx='8' fill='${p[0]}' fill-opacity='.12' stroke='${p[0]}' stroke-opacity='.35'/>
          <rect x='60' y='400' width='320' height='340' rx='8' fill='${p[1]}' fill-opacity='.12' stroke='${p[1]}' stroke-opacity='.35'/>
          <rect x='400' y='400' width='340' height='160' rx='8' fill='${p[0]}' fill-opacity='.10' stroke='${p[0]}' stroke-opacity='.30'/>
          <rect x='400' y='580' width='340' height='160' rx='8' fill='${p[1]}' fill-opacity='.10' stroke='${p[1]}' stroke-opacity='.30'/>
          <rect x='60' y='770' width='680' height='280' rx='8' fill='${p[0]}' fill-opacity='.12' stroke='${p[0]}' stroke-opacity='.35'/>
        </g>
        <text x='400' y='560' text-anchor='middle' font-family='Sora, sans-serif' font-size='40' font-weight='800' fill='rgba(255,255,255,.85)'>${esc(title)}</text>
        <text x='400' y='610' text-anchor='middle' font-family='Outfit, sans-serif' font-size='26' fill='rgba(255,255,255,.55)'>Chapter ${chapter}</text>
        <text x='400' y='1090' text-anchor='middle' font-family='Outfit, sans-serif' font-size='22' fill='rgba(255,255,255,.4)'>Page ${n} / ${total}</text>
      </svg>`;
    return svgUri(svg);
  }

  const RAW = [
    { t: "Celestial Blade", a: "Hiro Tanaka", g: ["Action", "Fantasy", "Adventure"], s: "ongoing", r: 9.1,
      d: "When a forgotten sword chooses orphan swordsman Ren as its wielder, he's thrust into a war between celestial clans. Each strike of the blade unlocks a fragment of a forgotten god's memory." },
    { t: "Neon Samurai", a: "Aya Kurosawa", g: ["Sci-Fi", "Action", "Cyberpunk"], s: "ongoing", r: 8.8,
      d: "In Neo-Edo, a masterless cyber-ronin hunts the corporation that replaced her heart with a bomb. Every contract brings her one byte closer to the truth." },
    { t: "Petals of the Quiet Café", a: "Mei Sato", g: ["Romance", "Slice of Life", "Drama"], s: "completed", r: 8.5,
      d: "A burnt-out pianist takes a job at a tiny seaside café and slowly relearns how to feel — one regular customer, and one quiet song, at a time." },
    { t: "Dungeon Architect", a: "Ken Mori", g: ["Fantasy", "Comedy", "Adventure"], s: "ongoing", r: 8.9,
      d: "Reincarnated not as a hero but as a dungeon's interior designer, Souta must lure adventurers in with five-star traps and tasteful lighting to survive." },
    { t: "Storm Caller", a: "Rin Abe", g: ["Action", "Supernatural", "Drama"], s: "ongoing", r: 8.7,
      d: "A girl who can speak to storms is the last hope of a drowning archipelago. But every prayer she answers takes a year of her life." },
    { t: "Midnight Ramen", a: "Taro Yoshida", g: ["Slice of Life", "Comedy", "Drama"], s: "completed", r: 8.3,
      d: "A 24-hour ramen stand and the strangers who wander in at 3am. Each bowl comes with a story you didn't know you needed." },
    { t: "Shadow Protocol", a: "Yuki Nakamura", g: ["Thriller", "Mystery", "Action"], s: "ongoing", r: 9.0,
      d: "An amnesiac wakes in a locked facility with a counter implanted in his wrist. When it hits zero, the people hunting him will know exactly who he is." },
    { t: "Garden of Echoes", a: "Sora Ito", g: ["Fantasy", "Mystery", "Drama"], s: "hiatus", r: 8.6,
      d: "A botanist discovers a greenhouse where every flower replays a memory of the dead. Some of them are memories she hasn't made yet." },
    { t: "Pixel Heart", a: "Nana Hoshino", g: ["Romance", "Comedy", "Sci-Fi"], s: "ongoing", r: 8.4,
      d: "A shy game developer's self-insert NPC gains sentience — and a crush on her real-life rival. Debugging her own love life was never in the design doc." },
    { t: "Iron Pilgrim", a: "Daichi Okada", g: ["Sci-Fi", "Adventure", "Drama"], s: "ongoing", r: 8.8,
      d: "The last mech pilot walks across a dead Earth carrying the final seed vault, hunted by salvagers who'd rather sell hope than plant it." },
    { t: "Crimson Vow", a: "Emi Fujita", g: ["Romance", "Supernatural", "Drama"], s: "ongoing", r: 8.7,
      d: "A vampire bound by an ancient promise must protect the descendant of the woman who once betrayed him — and falling in love is strictly forbidden." },
    { t: "The Last Alchemist", a: "Goro Saito", g: ["Fantasy", "Adventure", "Mystery"], s: "completed", r: 9.2,
      d: "Magic is dying. One stubborn alchemist refuses to let it go quietly, chasing the formula that started it all across a crumbling empire." },
    { t: "Sky Pirates of Lumen", a: "Hana Watanabe", g: ["Adventure", "Action", "Fantasy"], s: "ongoing", r: 8.5,
      d: "A ragtag airship crew steals from sky-barons and dreams of the legendary floating city that may not exist at all." },
    { t: "Quiet Monsters", a: "Jun Hayashi", g: ["Horror", "Mystery", "Drama"], s: "ongoing", r: 8.9,
      d: "In a town where everyone politely ignores the monsters, one new transfer student refuses to look away — and the monsters notice." },
    { t: "Bloom & Doom", a: "Kaori Tanabe", g: ["Comedy", "Action", "Supernatural"], s: "ongoing", r: 8.2,
      d: "A florist by day and demon exterminator by night discovers her bouquets are the only weapon hell actually fears." },
    { t: "Tidebound", a: "Leo Yamada", g: ["Fantasy", "Romance", "Adventure"], s: "ongoing", r: 8.6,
      d: "A lighthouse keeper and a creature of the deep share one impossible promise: meet at the shore every full moon, until the sea forgives them." }
  ];

  // Mature (18+) sample titles — used as the offline fallback for the
  // gated 18+ area. Covers are the same generated gradient art (no
  // explicit imagery); they carry an "erotica"/"pornographic" rating so
  // the UI shows the correct 18+ badges and keeps them out of the SFW lib.
  const RAW_NSFW = [
    { t: "Velvet Nights", a: "Rei Asano", g: ["Romance", "Mature", "Drama"], s: "ongoing", r: 8.4, cr: "erotica",
      d: "A commissioned portrait artist and her most demanding patron blur the line between the canvas and the bedroom across one long, sleepless summer." },
    { t: "Afterhours", a: "Mika Endo", g: ["Romance", "Mature", "Slice of Life"], s: "ongoing", r: 8.1, cr: "erotica",
      d: "When the office empties out, two rival colleagues discover the only thing sharper than their deadlines is the tension between them." },
    { t: "Scarlet Contract", a: "Yuna Mori", g: ["Drama", "Mature", "Supernatural"], s: "ongoing", r: 8.6, cr: "pornographic",
      d: "A succubus signs a binding deal with a lonely novelist: inspiration in exchange for nights he'll never be able to write about." },
    { t: "Heat Index", a: "Kai Sugimoto", g: ["Romance", "Mature", "Comedy"], s: "completed", r: 8.0, cr: "erotica",
      d: "A heatwave, a broken AC, and the upstairs neighbor who keeps knocking. Summer in the city has never felt this close." },
    { t: "Forbidden Pages", a: "Saki Hara", g: ["Fantasy", "Mature", "Romance"], s: "ongoing", r: 8.5, cr: "pornographic",
      d: "A librarian uncovers a grimoire that makes its reader irresistible — and learns too late that the book always collects its due." },
    { t: "Midnight Muse", a: "Ren Takagi", g: ["Drama", "Mature", "Music"], s: "ongoing", r: 8.3, cr: "erotica",
      d: "A jazz singer and her ghostwriter chase the perfect ballad through smoky clubs, hotel rooms, and the songs they can't admit are about each other." }
  ];

  function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

  function buildManga(m, i, prefix) {
    const id = (prefix || "sample-") + slugify(m.t);
    const chapterCount = 6 + (i % 8); // 6..13 chapters
    const chapters = [];
    for (let c = 1; c <= chapterCount; c++) {
      const pages = 8 + ((i + c) % 7); // 8..14 pages
      chapters.push({
        id: id + "-ch-" + c,
        number: c,
        title: "Chapter " + c,
        pages: pages,
        publishedAt: new Date(Date.now() - (chapterCount - c) * 86400000 * 9).toISOString(),
        source: "sample",
        getPages: function () {
          const arr = [];
          for (let n = 1; n <= pages; n++) arr.push(page(m.t, c, n, pages, i));
          return arr;
        }
      });
    }
    return {
      id: id,
      title: m.t,
      author: m.a,
      genres: m.g,
      status: m.s,
      rating: m.r,
      contentRating: m.cr || "safe",
      year: 2018 + (i % 8),
      description: m.d,
      cover: cover(m.t, i),
      source: "sample",
      chapters: chapters
    };
  }

  const SAMPLE_MANGA = RAW.map((m, i) => buildManga(m, i, "sample-"));
  const SAMPLE_NSFW = RAW_NSFW.map((m, i) => buildManga(m, i + 3, "sample-nsfw-"));

  // Public API for the sample dataset
  window.MangaData = {
    cover, page,
    sample: SAMPLE_MANGA,
    sampleNsfw: SAMPLE_NSFW,
    sampleFor: function (content) { return content === "nsfw" ? SAMPLE_NSFW : SAMPLE_MANGA; },
    allGenres: Array.from(new Set(SAMPLE_MANGA.flatMap(m => m.genres))).sort(),
    byId: function (id) {
      return SAMPLE_MANGA.find(m => m.id === id) ||
             SAMPLE_NSFW.find(m => m.id === id) || null;
    }
  };
})();
