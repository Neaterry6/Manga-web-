/* ============================================================
   MangaVerse — App shell, hash router & views
   ============================================================ */
(function () {
  "use strict";

  const app = document.getElementById("app");
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ---------------- helpers ---------------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function statusBadge(status) {
    const map = { ongoing: "Ongoing", completed: "Completed", hiatus: "Hiatus", cancelled: "Cancelled" };
    return `<span class="badge badge-${esc(status)}">${esc(map[status] || status)}</span>`;
  }
  function ratingStars(r) {
    if (!r) return "";
    return `<span class="rating"><i data-lucide="star"></i>${r.toFixed(1)}</span>`;
  }
  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60); if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60); if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24); if (d < 30) return d + "d ago";
    return new Date(ts).toLocaleDateString();
  }
  function toast(msg, type) {
    const el = document.createElement("div");
    el.className = "toast toast-" + (type || "info");
    el.innerHTML = `<i class="icon icon-${type === "error" ? "alert-circle" : type === "success" ? "check-circle" : "info"}"></i><span>${esc(msg)}</span>`;
    document.getElementById("toasts").appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 3200);
  }
  function icons() { if (window.lucide) window.lucide.createIcons(); }

  function mangaCard(m) {
    return `<a class="card" href="#/manga/${encodeURIComponent(m.id)}" data-link>
      <div class="card-cover">
        <img loading="lazy" src="${esc(m.cover)}" alt="${esc(m.title)} cover" onerror="this.src='${esc(window.MangaData.cover(m.title || 'Manga', 0))}'" />
        <div class="card-overlay">
          <span class="card-read"><i data-lucide="book-open"></i> Read</span>
        </div>
        ${statusBadge(m.status)}
      </div>
      <div class="card-body">
        <h3 class="card-title">${esc(m.title)}</h3>
        <div class="card-meta">${ratingStars(m.rating)}<span class="card-author">${esc(m.author || "")}</span></div>
        <div class="card-tags">${(m.genres || []).slice(0, 3).map(g => `<span class="tag">${esc(g)}</span>`).join("")}</div>
      </div>
    </a>`;
  }

  function skeletonGrid(n) {
    let s = "";
    for (let i = 0; i < n; i++) s += `<div class="card skeleton"><div class="card-cover sk"></div><div class="card-body"><div class="sk-line"></div><div class="sk-line sm"></div></div></div>`;
    return `<div class="grid">${s}</div>`;
  }

  function sourceBanner() {
    const mode = window.MangaSource.mode();
    if (mode === "sample") {
      return `<div class="source-banner"><i data-lucide="database"></i> Showing built-in sample library (live MangaDex API unavailable in this browser). All features work normally.</div>`;
    }
    if (mode === "live") {
      return `<div class="source-banner live"><i data-lucide="wifi"></i> Live data from the MangaDex API.</div>`;
    }
    return "";
  }

  /* ---------------- Auth modal UI ---------------- */
  const authModal = document.getElementById("authModal");
  function openAuth(tab) {
    authModal.classList.add("open");
    authModal.setAttribute("aria-hidden", "false");
    switchAuthTab(tab || "login");
  }
  function closeAuth() {
    authModal.classList.remove("open");
    authModal.setAttribute("aria-hidden", "true");
    $$(".form-error", authModal).forEach(e => e.textContent = "");
  }
  function switchAuthTab(tab) {
    $$(".auth-tab", authModal).forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
    $("#loginForm").classList.toggle("hidden", tab !== "login");
    $("#signupForm").classList.toggle("hidden", tab !== "signup");
  }
  $("#authClose").addEventListener("click", closeAuth);
  authModal.addEventListener("click", e => { if (e.target === authModal) closeAuth(); });
  $$(".auth-tab", authModal).forEach(t => t.addEventListener("click", () => switchAuthTab(t.dataset.tab)));

  $("#loginForm").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target, errEl = $("[data-error]", f);
    try {
      Auth.login({ identifier: f.identifier.value, password: f.password.value });
      closeAuth(); f.reset();
      toast("Welcome back!", "success");
    } catch (err) { errEl.textContent = err.message; }
  });
  $("#signupForm").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target, errEl = $("[data-error]", f);
    try {
      Auth.signup({ username: f.username.value, email: f.email.value, password: f.password.value, confirm: f.confirm.value });
      closeAuth(); f.reset();
      toast("Account created — happy reading!", "success");
    } catch (err) { errEl.textContent = err.message; }
  });

  /* ---------------- Nav account area ---------------- */
  function renderAccount() {
    const acc = document.getElementById("navAccount");
    const u = Auth.current();
    if (u) {
      acc.innerHTML = `
        <div class="account">
          <button class="account-btn" id="accountBtn">
            <span class="avatar">${esc(u.username[0].toUpperCase())}</span>
            <span class="account-name">${esc(u.username)}</span>
            <i data-lucide="chevron-down"></i>
          </button>
          <div class="account-menu" id="accountMenu">
            <a href="#/bookmarks" data-link><i data-lucide="bookmark"></i> Bookmarks</a>
            <a href="#/history" data-link><i data-lucide="history"></i> History</a>
            <button id="logoutBtn"><i data-lucide="log-out"></i> Log out</button>
          </div>
        </div>`;
      $("#accountBtn").addEventListener("click", e => {
        e.stopPropagation();
        $("#accountMenu").classList.toggle("open");
      });
      document.addEventListener("click", () => { const m = $("#accountMenu"); if (m) m.classList.remove("open"); });
      $("#logoutBtn").addEventListener("click", () => { Auth.logout(); toast("Logged out.", "info"); location.hash = "#/"; });
    } else {
      acc.innerHTML = `<button class="btn btn-primary btn-sm" id="loginCta"><i data-lucide="user"></i> Sign In</button>`;
      $("#loginCta").addEventListener("click", () => openAuth("login"));
    }
    document.body.classList.toggle("is-auth", !!u);
    icons();
  }
  Auth.onChange(() => { renderAccount(); buildMobileMenu(); });

  function requireAuth(actionMsg) {
    if (Auth.isLoggedIn()) return true;
    toast(actionMsg || "Please sign in to continue.", "info");
    openAuth("login");
    return false;
  }

  /* ---------------- Mobile menu ---------------- */
  function buildMobileMenu() {
    const m = document.getElementById("navMobile");
    const authLinks = Auth.isLoggedIn()
      ? `<a href="#/bookmarks" data-link><i data-lucide="bookmark"></i> Bookmarks</a>
         <a href="#/history" data-link><i data-lucide="history"></i> History</a>`
      : "";
    m.innerHTML = `
      <a href="#/" data-link><i data-lucide="home"></i> Home</a>
      <a href="#/library" data-link><i data-lucide="library"></i> Library</a>
      ${authLinks}`;
    icons();
  }
  document.getElementById("navBurger").addEventListener("click", () => {
    document.getElementById("navMobile").classList.toggle("open");
  });

  /* ---------------- Global search ---------------- */
  const globalSearch = document.getElementById("globalSearch");
  globalSearch.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      const q = globalSearch.value.trim();
      location.hash = q ? "#/library?q=" + encodeURIComponent(q) : "#/library";
    }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "/" && document.activeElement !== globalSearch && !/input|textarea/i.test(document.activeElement.tagName)) {
      e.preventDefault(); globalSearch.focus();
    }
  });

  /* ============================================================
     ROUTER
     ============================================================ */
  function parseHash() {
    let h = location.hash.replace(/^#/, "") || "/";
    const [path, query] = h.split("?");
    const params = {};
    if (query) query.split("&").forEach(kv => {
      const [k, v] = kv.split("="); params[decodeURIComponent(k)] = decodeURIComponent(v || "");
    });
    return { path, params };
  }

  async function router() {
    const { path, params } = parseHash();
    const parts = path.split("/").filter(Boolean);
    window.scrollTo(0, 0);
    document.getElementById("navMobile").classList.remove("open");
    setActiveNav(path);

    if (parts.length === 0) return viewHome();
    if (parts[0] === "library") return viewLibrary(params);
    if (parts[0] === "manga" && parts[1]) return viewDetail(decodeURIComponent(parts[1]));
    if (parts[0] === "read" && parts[1] && parts[2]) return viewReader(decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
    if (parts[0] === "bookmarks") return viewBookmarks();
    if (parts[0] === "history") return viewHistory();
    return viewHome();
  }

  function setActiveNav(path) {
    $$(".nav-link").forEach(a => {
      const href = a.getAttribute("href").replace(/^#/, "");
      a.classList.toggle("active", href === path || (href === "/" && path === "/"));
    });
  }

  /* ============================================================
     VIEW: HOME
     ============================================================ */
  let HOME_CACHE = null;
  async function viewHome() {
    const u = Auth.current();
    const continueItems = u ? Auth.continueReading().slice(0, 8) : [];

    app.innerHTML = `
      <section class="hero">
        <div class="hero-glow"></div>
        <div class="hero-content">
          <span class="hero-kicker"><i data-lucide="sparkles"></i> Thousands of titles, one clean reader</span>
          <h1 class="hero-title">Read manga the <span class="grad">beautiful</span> way.</h1>
          <p class="hero-sub">Browse a huge library, bookmark your favorites, track what you've read, and dive into a distraction-free vertical reader. ${u ? "Welcome back, <strong>" + esc(u.username) + "</strong>." : "Create a free local account to sync your shelf."}</p>
          <div class="hero-cta">
            <a class="btn btn-primary" href="#/library" data-link><i data-lucide="compass"></i> Explore Library</a>
            ${u ? "" : `<button class="btn btn-ghost" id="heroSignup"><i data-lucide="user-plus"></i> Create Account</button>`}
          </div>
        </div>
      </section>

      ${continueItems.length ? `
      <section class="row-section">
        <div class="section-head"><h2><i data-lucide="play-circle"></i> Continue Reading</h2></div>
        <div class="hscroll">
          ${continueItems.map(c => `
            <a class="continue-card" href="#/read/${encodeURIComponent(c.mangaId)}/${encodeURIComponent(c.chapterId)}" data-link>
              <img loading="lazy" src="${esc(c.cover)}" alt="${esc(c.title)}" />
              <div class="continue-info">
                <h4>${esc(c.title)}</h4>
                <span>Ch. ${esc(c.chapterNumber)} · ${timeAgo(c.at)}</span>
              </div>
              <i data-lucide="play"></i>
            </a>`).join("")}
        </div>
      </section>` : ""}

      <section class="row-section" id="popularSection">
        <div class="section-head">
          <h2><i data-lucide="flame"></i> Popular Now</h2>
          <a href="#/library" data-link class="see-all">See all <i data-lucide="arrow-right"></i></a>
        </div>
        <div id="sourceBannerSlot"></div>
        <div id="popularGrid">${skeletonGrid(12)}</div>
      </section>`;

    if ($("#heroSignup")) $("#heroSignup").addEventListener("click", () => openAuth("signup"));
    icons();

    try {
      const items = HOME_CACHE || await window.MangaSource.list({ limit: 18 });
      HOME_CACHE = items;
      $("#sourceBannerSlot").innerHTML = sourceBanner();
      $("#popularGrid").innerHTML = `<div class="grid">${items.map(mangaCard).join("")}</div>`;
      icons();
    } catch (e) {
      $("#popularGrid").innerHTML = `<p class="empty">Couldn't load manga. Please refresh.</p>`;
    }
  }

  /* ============================================================
     VIEW: LIBRARY (search + genre filters)
     ============================================================ */
  let LIB_ALL = null;
  async function viewLibrary(params) {
    const q0 = params.q || "";
    app.innerHTML = `
      <section class="page">
        <div class="page-head">
          <h1><i data-lucide="library"></i> Library</h1>
          <p>Search the catalog and filter by genre.</p>
        </div>
        <div class="filters">
          <div class="search-box">
            <i data-lucide="search"></i>
            <input type="text" id="libSearch" placeholder="Search titles, authors, genres…" value="${esc(q0)}" />
            <button id="libSearchBtn" class="btn btn-primary btn-sm">Search</button>
          </div>
          <div class="genre-chips" id="genreChips"></div>
        </div>
        <div id="sourceBannerSlot"></div>
        <div id="libGrid">${skeletonGrid(12)}</div>
      </section>`;
    icons();

    const libSearch = $("#libSearch");
    const doSearch = async () => {
      const q = libSearch.value.trim();
      $("#libGrid").innerHTML = skeletonGrid(12);
      try {
        const items = q ? await window.MangaSource.search(q) : await window.MangaSource.list({ limit: 30 });
        LIB_ALL = items;
        $("#sourceBannerSlot").innerHTML = sourceBanner();
        buildGenreChips(items);
        applyGenreFilter();
      } catch (e) { $("#libGrid").innerHTML = `<p class="empty">No results.</p>`; }
    };

    $("#libSearchBtn").addEventListener("click", doSearch);
    libSearch.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

    let activeGenre = "All";
    function buildGenreChips(items) {
      const genres = ["All", ...Array.from(new Set(items.flatMap(m => m.genres))).sort()];
      $("#genreChips").innerHTML = genres.map(g =>
        `<button class="chip ${g === activeGenre ? "active" : ""}" data-genre="${esc(g)}">${esc(g)}</button>`).join("");
      $$("#genreChips .chip").forEach(c => c.addEventListener("click", () => {
        activeGenre = c.dataset.genre;
        $$("#genreChips .chip").forEach(x => x.classList.toggle("active", x === c));
        applyGenreFilter();
      }));
    }
    function applyGenreFilter() {
      const items = (LIB_ALL || []).filter(m => activeGenre === "All" || m.genres.includes(activeGenre));
      $("#libGrid").innerHTML = items.length
        ? `<div class="grid">${items.map(mangaCard).join("")}</div>`
        : `<p class="empty">No manga match this filter.</p>`;
      icons();
    }

    await doSearch();
  }

  /* ============================================================
     VIEW: DETAIL
     ============================================================ */
  async function viewDetail(id) {
    app.innerHTML = `<div class="page"><div class="detail-loading">${skeletonGrid(1)}<p class="loading-text"><i data-lucide="loader"></i> Loading…</p></div></div>`;
    icons();
    let m;
    try { m = await window.MangaSource.detail(id); } catch (e) { m = null; }
    if (!m) { app.innerHTML = `<div class="page"><p class="empty">Manga not found. <a href="#/library" data-link>Back to library</a></p></div>`; return; }
    if (!m.chapters) { try { m.chapters = await window.MangaSource.chapters(id); } catch (e) { m.chapters = []; } }

    const bookmarked = Auth.isBookmarked(m.id);
    const lastRead = Auth.lastReadFor(m.id);
    const chapters = (m.chapters || []).slice();

    app.innerHTML = `
      <section class="detail">
        <div class="detail-banner" style="background-image:url('${esc(m.cover)}')"></div>
        <div class="detail-main">
          <div class="detail-cover">
            <img src="${esc(m.cover)}" alt="${esc(m.title)} cover" onerror="this.src='${esc(window.MangaData.cover(m.title, 0))}'" />
          </div>
          <div class="detail-info">
            <div class="detail-badges">${statusBadge(m.status)}${ratingStars(m.rating)}${m.year ? `<span class="muted">${esc(m.year)}</span>` : ""}</div>
            <h1>${esc(m.title)}</h1>
            <p class="detail-author"><i data-lucide="pen-tool"></i> ${esc(m.author || "Unknown")}</p>
            <div class="detail-tags">${(m.genres || []).map(g => `<a class="tag" href="#/library?q=${encodeURIComponent(g)}" data-link>${esc(g)}</a>`).join("")}</div>
            <p class="detail-desc">${esc(m.description)}</p>
            <div class="detail-actions">
              ${chapters.length ? `<a class="btn btn-primary" href="#/read/${encodeURIComponent(m.id)}/${encodeURIComponent((lastRead && chapters.find(c=>c.id===lastRead.chapterId) ? lastRead.chapterId : chapters[0].id))}" data-link><i data-lucide="book-open"></i> ${lastRead ? "Continue Ch. " + esc(lastRead.chapterNumber) : "Start Reading"}</a>` : ""}
              <button class="btn btn-ghost ${bookmarked ? "active" : ""}" id="bmBtn"><i data-lucide="bookmark"></i> <span>${bookmarked ? "Bookmarked" : "Bookmark"}</span></button>
            </div>
          </div>
        </div>

        <div class="detail-chapters">
          <h2><i data-lucide="list"></i> Chapters <span class="muted">(${chapters.length})</span></h2>
          ${chapters.length ? `<div class="chapter-list">
            ${chapters.map(c => {
              const read = Auth.history().some(h => h.mangaId === m.id && h.chapterId === c.id);
              return `<a class="chapter-row ${read ? "read" : ""}" href="#/read/${encodeURIComponent(m.id)}/${encodeURIComponent(c.id)}" data-link>
                <span class="ch-num">${esc(c.number)}</span>
                <span class="ch-title">${esc(c.title)}</span>
                ${read ? `<span class="ch-read"><i data-lucide="check"></i> Read</span>` : ""}
                <i data-lucide="chevron-right"></i>
              </a>`;
            }).join("")}
          </div>` : `<p class="empty">No English chapters available for this title.${m.source === "live" ? " Try another manga." : ""}</p>`}
        </div>
      </section>`;
    icons();

    $("#bmBtn").addEventListener("click", () => {
      if (!requireAuth("Sign in to bookmark manga.")) return;
      const nowOn = Auth.toggleBookmark(m);
      const btn = $("#bmBtn");
      btn.classList.toggle("active", nowOn);
      $("span", btn).textContent = nowOn ? "Bookmarked" : "Bookmark";
      toast(nowOn ? "Added to bookmarks." : "Removed from bookmarks.", nowOn ? "success" : "info");
    });
  }

  /* ============================================================
     VIEW: READER (vertical scroll + prev/next)
     ============================================================ */
  async function viewReader(mangaId, chapterId) {
    app.innerHTML = `<div class="reader-loading"><i data-lucide="loader"></i> Loading chapter…</div>`;
    icons();

    let m;
    try { m = await window.MangaSource.detail(mangaId); } catch (e) { m = null; }
    if (!m) { app.innerHTML = `<div class="page"><p class="empty">Couldn't load this manga.</p></div>`; return; }
    if (!m.chapters) m.chapters = await window.MangaSource.chapters(mangaId);
    const chapters = m.chapters || [];
    let idx = chapters.findIndex(c => c.id === chapterId);
    if (idx < 0) idx = 0;
    const chapter = chapters[idx];
    if (!chapter) { app.innerHTML = `<div class="page"><p class="empty">Chapter not found.</p></div>`; return; }

    const prev = chapters[idx - 1] || null;
    const next = chapters[idx + 1] || null;

    if (Auth.isLoggedIn()) Auth.recordRead(m, chapter);

    const navBar = (pos) => `
      <div class="reader-nav ${pos}">
        <a class="btn btn-ghost btn-sm" href="#/manga/${encodeURIComponent(m.id)}" data-link><i data-lucide="arrow-left"></i> Details</a>
        <div class="reader-nav-mid">
          ${prev ? `<a class="btn btn-ghost btn-sm" href="#/read/${encodeURIComponent(m.id)}/${encodeURIComponent(prev.id)}" data-link><i data-lucide="chevron-left"></i> Prev</a>` : `<span class="btn btn-ghost btn-sm disabled"><i data-lucide="chevron-left"></i> Prev</span>`}
          <span class="reader-chapter-label">Ch. ${esc(chapter.number)}</span>
          ${next ? `<a class="btn btn-primary btn-sm" href="#/read/${encodeURIComponent(m.id)}/${encodeURIComponent(next.id)}" data-link>Next <i data-lucide="chevron-right"></i></a>` : `<span class="btn btn-ghost btn-sm disabled">Next <i data-lucide="chevron-right"></i></span>`}
        </div>
        <select class="reader-chapter-select" id="chapterSelect${pos}">
          ${chapters.map(c => `<option value="${esc(c.id)}" ${c.id === chapter.id ? "selected" : ""}>Chapter ${esc(c.number)}</option>`).join("")}
        </select>
      </div>`;

    app.innerHTML = `
      <div class="reader">
        <div class="reader-head">
          <div class="reader-title">
            <a href="#/manga/${encodeURIComponent(m.id)}" data-link>${esc(m.title)}</a>
            <span class="muted">— ${esc(chapter.title)}</span>
          </div>
        </div>
        ${navBar("top")}
        <div class="reader-pages" id="readerPages">
          <div class="reader-loading"><i data-lucide="loader"></i> Loading pages…</div>
        </div>
        ${navBar("bottom")}
      </div>
      <div class="reader-progress" id="readerProgress"><div class="bar" id="readerBar"></div></div>`;
    icons();

    $$("[id^=chapterSelect]").forEach(sel => sel.addEventListener("change", e => {
      location.hash = `#/read/${encodeURIComponent(m.id)}/${encodeURIComponent(e.target.value)}`;
    }));

    let pages = [];
    try { pages = await window.MangaSource.pages(chapter, m); } catch (e) { pages = []; }
    if (!pages.length) {
      $("#readerPages").innerHTML = `<p class="empty">No pages found for this chapter.</p>`;
      return;
    }
    $("#readerPages").innerHTML = pages.map((src, i) =>
      `<div class="reader-page"><img loading="lazy" src="${esc(src)}" alt="Page ${i + 1}" onerror="this.closest('.reader-page').classList.add('img-fail');this.style.display='none';this.insertAdjacentHTML('afterend','<div class=&quot;page-fail&quot;>Page ${i + 1} unavailable</div>')" /></div>`
    ).join("") + `<div class="reader-end">
        <p><i data-lucide="check-circle"></i> End of Chapter ${esc(chapter.number)}</p>
        ${next ? `<a class="btn btn-primary" href="#/read/${encodeURIComponent(m.id)}/${encodeURIComponent(next.id)}" data-link>Next Chapter <i data-lucide="arrow-right"></i></a>` : `<a class="btn btn-ghost" href="#/manga/${encodeURIComponent(m.id)}" data-link>Back to details</a>`}
      </div>`;
    icons();

    // reading progress bar
    const bar = $("#readerBar");
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + "%";
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    // keyboard nav
    const keyNav = (e) => {
      if (e.key === "ArrowLeft" && prev) location.hash = `#/read/${m.id}/${prev.id}`;
      if (e.key === "ArrowRight" && next) location.hash = `#/read/${m.id}/${next.id}`;
    };
    document.addEventListener("keydown", keyNav);
    // cleanup on next route
    const cleanup = () => { window.removeEventListener("scroll", onScroll); document.removeEventListener("keydown", keyNav); window.removeEventListener("hashchange", cleanup); };
    window.addEventListener("hashchange", cleanup);
  }

  /* ============================================================
     VIEW: BOOKMARKS
     ============================================================ */
  function viewBookmarks() {
    if (!requireAuth("Sign in to view your bookmarks.")) { viewHome(); return; }
    const items = Auth.bookmarks();
    app.innerHTML = `
      <section class="page">
        <div class="page-head"><h1><i data-lucide="bookmark"></i> Your Bookmarks</h1><p>${items.length} saved title${items.length === 1 ? "" : "s"}.</p></div>
        ${items.length ? `<div class="grid">${items.map(mangaCard).join("")}</div>`
          : `<div class="empty-state"><i data-lucide="bookmark"></i><h3>No bookmarks yet</h3><p>Tap the bookmark button on any manga to save it here.</p><a class="btn btn-primary" href="#/library" data-link>Browse Library</a></div>`}
      </section>`;
    icons();
  }

  /* ============================================================
     VIEW: HISTORY
     ============================================================ */
  function viewHistory() {
    if (!requireAuth("Sign in to view your reading history.")) { viewHome(); return; }
    const items = Auth.history();
    app.innerHTML = `
      <section class="page">
        <div class="page-head">
          <h1><i data-lucide="history"></i> Reading History</h1>
          <p>${items.length} recently read chapter${items.length === 1 ? "" : "s"}.</p>
          ${items.length ? `<button class="btn btn-ghost btn-sm" id="clearHist"><i data-lucide="trash-2"></i> Clear</button>` : ""}
        </div>
        ${items.length ? `<div class="history-list">${items.map(h => `
          <a class="history-row" href="#/read/${encodeURIComponent(h.mangaId)}/${encodeURIComponent(h.chapterId)}" data-link>
            <img loading="lazy" src="${esc(h.cover)}" alt="${esc(h.title)}" />
            <div class="history-info"><h4>${esc(h.title)}</h4><span>Chapter ${esc(h.chapterNumber)} · ${timeAgo(h.at)}</span></div>
            <i data-lucide="play"></i>
          </a>`).join("")}</div>`
          : `<div class="empty-state"><i data-lucide="history"></i><h3>No history yet</h3><p>Chapters you read will appear here so you can pick up where you left off.</p><a class="btn btn-primary" href="#/library" data-link>Start Reading</a></div>`}
      </section>`;
    if ($("#clearHist")) $("#clearHist").addEventListener("click", () => { Auth.clearHistory(); toast("History cleared.", "info"); viewHistory(); });
    icons();
  }

  /* ---------------- boot ---------------- */
  window.addEventListener("hashchange", router);
  renderAccount();
  buildMobileMenu();
  router();
})();
