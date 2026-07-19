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

  // Apply UI translation to any [data-tr] nodes currently in the DOM.
  // Safe no-op when translation is off. Called after every render.
  function translateUI(root) {
    if (window.MangaTranslate) { window.MangaTranslate.apply(root).catch(() => {}); }
  }
  // Render icons + translate in one shot after injecting markup.
  function afterRender(root) { icons(); translateUI(root); }

  /* ---------------- Image compressor (client-side) ---------------- */
  // Compress an image file (avatar, post image) to a small base64 data URL.
  // maxW/maxH: max dimensions, quality: 0-1, stripMetadata: remove EXIF
  function compressImage(fileOrBlob, { maxW = 400, maxH = 400, quality = 0.7, format = "webp" } = {}) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
          let w = img.width, h = img.height;
          if (w > maxW) { h = h * maxW / w; w = maxW; }
          if (h > maxH) { w = w * maxH / h; h = maxH; }
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, w, h);
          // Strip EXIF orientation by drawing full then scaling
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error("Compression failed")); return; }
            // Also return the data URL for direct <img> use
            const fr2 = new FileReader();
            fr2.onload = function (ev) { resolve({ blob, dataUrl: ev.target.result, width: w, height: h }); };
            fr2.readAsDataURL(blob);
          }, "image/" + format, quality);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(fileOrBlob);
    });
  }
  // Expose globally
  window.compressImage = compressImage;

  // Avatar upload helper — compress then save to localStorage
  async function uploadAvatar(file) {
    try {
      const result = await compressImage(file, { maxW: 256, maxH: 256, quality: 0.6 });
      const u = Auth.current();
      if (u) { u.avatar = result.dataUrl; Auth.update(u); }
      return result.dataUrl;
    } catch (e) { throw new Error("Couldn't process image: " + e.message); }
  }
  window.uploadAvatar = uploadAvatar;

  /* ============================================================
     BACKGROUND PUSH NOTIFICATIONS (Notification API)
     Fires a real browser notification for new DM/group messages and
     reactions WHEN THE TAB IS HIDDEN/BLURRED (document.hidden). Clicking
     the notification focuses the app and opens the relevant thread.
     Degrades gracefully when the API is unsupported or permission denied.
     ============================================================ */
  const Push = {
    supported() { return typeof window !== "undefined" && "Notification" in window; },
    permission() { return this.supported() ? Notification.permission : "unsupported"; },
    async request() {
      if (!this.supported()) { toast("Your browser doesn't support notifications.", "error"); return "unsupported"; }
      if (Notification.permission === "granted") return "granted";
      try {
        const p = await Notification.requestPermission();
        toast(p === "granted" ? "Background notifications enabled." : "Notifications not enabled.", p === "granted" ? "success" : "info");
        return p;
      } catch (e) { return Notification.permission; }
    },
    // Raise a notification for an incoming notif payload, ONLY when hidden.
    maybeNotify(notif) {
      if (!this.supported() || Notification.permission !== "granted") return;
      if (!document.hidden) return;               // only when tab is in background
      if (!notif || (notif.type !== "message" && notif.type !== "reaction")) return;
      let from = "Someone";
      try { const a = S().resolveAuthor(notif.fromId); from = a.displayName || a.username || "Someone"; } catch (e) {}
      const title = notif.type === "message"
        ? (notif.group ? (from + " in " + notif.group) : from)
        : (from + " reacted");
      const body = notif.type === "message"
        ? (notif.text || "New message")
        : (notif.text || "reacted to your message");
      const href = (notif.type === "message" || notif.type === "group") && notif.convId
        ? ("#/dm/" + encodeURIComponent(notif.convId)) : "#/notifications";
      try {
        const n = new Notification(title, { body: body.slice(0, 140), tag: notif.convId || notif.id, icon: BRAND_ICON });
        n.onclick = () => { window.focus(); location.hash = href; n.close(); };
      } catch (e) { /* ignore */ }
    }
  };
  window.MVPush = Push;
  // small brand icon (data-uri) for the notification
  const BRAND_ICON = (function () {
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' rx='14' fill='#00e5ff'/><text x='32' y='44' font-size='36' text-anchor='middle' font-family='Arial' fill='#06121a' font-weight='700'>M</text></svg>";
    try { return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg))); }
    catch (e) { return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); }
  })();
  // Listen for new notifications app-wide and raise a background push when hidden.
  window.addEventListener("mv:notif", (e) => {
    const d = e && e.detail; if (d && d.notif) Push.maybeNotify(d.notif);
  });

  function adultBadge(cr) {
    if (cr === "pornographic") return `<span class="badge badge-adult">18+ Hentai</span>`;
    if (cr === "erotica") return `<span class="badge badge-adult">18+</span>`;
    return "";
  }

  function mangaCard(m) {
    return `<a class="card" href="#/manga/${encodeURIComponent(m.id)}" data-link>
      <div class="card-cover">
        <img loading="lazy" src="${esc(m.cover)}" alt="${esc(m.title)} cover" onerror="this.onerror=null;this.src='${esc(window.MangaData.cover(m.title || 'Manga', 0))}'" />
        <div class="card-overlay">
          <span class="card-read"><i data-lucide="book-open"></i> Read</span>
        </div>
        ${statusBadge(m.status)}
        ${adultBadge(m.contentRating)}
      </div>
      <div class="card-body">
        <h3 class="card-title" data-tr>${esc(m.title)}</h3>
        <div class="card-meta">${ratingStars(m.rating)}<span class="card-author">${esc(m.author || "")}</span></div>
        <div class="card-tags">${(m.genres || []).slice(0, 3).map(g => `<span class="tag" data-tr>${esc(g)}</span>`).join("")}</div>
      </div>
    </a>`;
  }

  function skeletonGrid(n) {
    let s = "";
    for (let i = 0; i < n; i++) s += `<div class="card skeleton"><div class="card-cover sk"></div><div class="card-body"><div class="sk-line"></div><div class="sk-line sm"></div></div></div>`;
    return `<div class="grid">${s}</div>`;
  }

  // Horizontal skeleton for shelf rows (fixed-width cards in an .hscroll).
  function skeletonRow(n) {
    let s = "";
    for (let i = 0; i < n; i++) s += `<div class="shelf-item card skeleton"><div class="card-cover sk"></div><div class="card-body"><div class="sk-line"></div><div class="sk-line sm"></div></div></div>`;
    return s;
  }

  // mangaCard variant that is fixed-width for horizontal shelves.
  function shelfCard(m) { return mangaCard(m).replace('class="card"', 'class="card shelf-item"'); }

  function sourceBanner() {
    const mode = window.MangaSource.mode();
    if (mode === "sample") {
      return `<div class="source-banner"><i data-lucide="database"></i> <span>Live MangaDex couldn't be reached right now — showing the built-in sample library. Public CORS proxies are rate-limited, so live data may take a couple of tries.</span> <button class="banner-retry" id="retryLive"><i data-lucide="refresh-cw"></i> Try live data</button></div>`;
    }
    if (mode === "live") {
      return `<div class="source-banner live"><i data-lucide="wifi"></i> Live data from the MangaDex API (via CORS proxy). Real covers &amp; chapters.</div>`;
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

  // Forgot password flow
  if ($("#forgotPwdBtn")) $("#forgotPwdBtn").addEventListener("click", function() {
    $("#loginForm").classList.add("hidden");
    $("#forgotForm").classList.remove("hidden");
    $("#signupForm").classList.add("hidden");
    $$(".auth-tab").forEach(function(t) { t.classList.remove("active"); });
  });
  if ($("#backToLoginBtn")) $("#backToLoginBtn").addEventListener("click", function() {
    $("#forgotForm").classList.add("hidden");
    $("#loginForm").classList.remove("hidden");
    $$(".auth-tab").forEach(function(t) { t.classList.toggle("active", t.dataset.tab === "login"); });
    var s = $("#resetSuccess"); if (s) s.style.display = "none";
  });
  $("#forgotForm").addEventListener("submit", async function(e) {
    e.preventDefault();
    var email = e.target.resetEmail.value.trim();
    var errEl = $("[data-error]", e.target);
    var successEl = $("#resetSuccess");
    if (errEl) errEl.textContent = "";
    if (successEl) successEl.style.display = "none";
    if (!email || !email.includes("@")) { if (errEl) errEl.textContent = "Enter a valid email."; return; }
    if (window.Cloud && window.Cloud.client && window.Cloud.client.auth) {
      try {
        var res = await window.Cloud.client.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname
        });
        if (res.error) throw res.error;
        if (successEl) { successEl.style.display = "block"; successEl.textContent = "Reset link sent! Check your email."; }
        toast("Reset link sent! Check your email.", "success");
      } catch (ex) { if (errEl) errEl.textContent = ex.message || "Failed to send reset email."; }
    } else {
      if (successEl) { successEl.style.display = "block"; successEl.textContent = "⚠️ Supabase Auth not ready. Open Settings to connect Supabase first."; }
    }
  });
  
  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, errEl = $("[data-error]", f);
    const btn = f.querySelector("button[type=submit]");
    errEl.textContent = "";
    try {
      if (btn) btn.disabled = true;
      await Auth.loginSmart({ identifier: f.identifier.value, password: f.password.value });
      closeAuth(); f.reset();
      toast("Welcome back!", "success");
    } catch (err) { errEl.textContent = err.message; }
    finally { if (btn) btn.disabled = false; }
  });
  $("#signupForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, errEl = $("[data-error]", f);
    const btn = f.querySelector("button[type=submit]");
    errEl.textContent = "";
    try {
      if (Auth.features && Auth.features().signups === false) throw new Error("New sign-ups are currently disabled by an administrator.");
      if (btn) btn.disabled = true;
      const res = await Auth.signupSmart({ username: f.username.value, email: f.email.value, password: f.password.value, confirm: f.confirm.value });
      if (res && res.needsConfirm) toast("Check your email to confirm your account, then log in.", "info");
      else toast("Account created — happy reading!", "success");
      closeAuth(); f.reset();
    } catch (err) { errEl.textContent = err.message; }
    finally { if (btn) btn.disabled = false; }
  });

  // OAuth login buttons (show when Supabase Auth is configured)
  function refreshOAuth() {
    const hasCloud = window.Cloud && window.Cloud.hasAuth && window.Cloud.hasAuth();
    const div = document.getElementById("oauthDivider");
    const btns = document.getElementById("oauthBtns");
    if (hasCloud && div && btns) { div.style.display = "flex"; btns.style.display = "flex"; }
    else if (div && btns) { div.style.display = "none"; btns.style.display = "none"; }
  }
  const _origOA = openAuth;
  openAuth = function(t) {
    _origOA(t);
    setTimeout(refreshOAuth, 100);
  };
  document.addEventListener("click", function(e) {
    var btn = e.target.closest(".oauth-btn");
    if (!btn) return;
    var provider = btn.dataset.provider;
    // If Supabase isn't connected, show setup instructions
    if (!window.Cloud || !window.Cloud.hasAuth || !window.Cloud.hasAuth()) {
      toast("Set up Supabase in Settings first to enable " + provider + " login.", "info");
      return;
    }
    btn.disabled = true; btn.textContent = "Redirecting...";
    window.Cloud.authWithOAuth(provider).catch(function(err) {
      btn.disabled = false;
      toast(err.message || "OAuth failed.", "error");
    });
  });

  /* ---------------- Nav account area ---------------- */
  function renderAccount() {
    const acc = document.getElementById("navAccount");
    const u = Auth.current();
    if (u) {
      acc.innerHTML = `
        <div class="account">
          <a class="notif-bell" href="#/notifications" data-link title="Notifications"><i data-lucide="bell"></i><span class="notif-badge" id="notifBadge" hidden>0</span></a>
          <button class="account-btn" id="accountBtn">
            <img class="avatar-img sm" src="${esc(Auth.avatarFor(u))}" alt="${esc(u.username)}" />
            <span class="account-name">${esc(u.displayName || u.username)}</span>
            <i data-lucide="chevron-down"></i>
          </button>
          <div class="account-menu" id="accountMenu">
            <a href="#/profile" data-link><i data-lucide="user"></i> Profile</a>
            <a href="#/feed" data-link><i data-lucide="rss"></i> Feed</a>
            <a href="#/notifications" data-link><i data-lucide="bell"></i> Notifications</a>
            <a href="#/chat" data-link><i data-lucide="message-circle"></i> Chat</a>
            <a href="#/bookmarks" data-link><i data-lucide="bookmark"></i> Bookmarks</a>
            <a href="#/history" data-link><i data-lucide="history"></i> History</a>
            ${u.isAdmin ? `<a href="#/admin" data-link><i data-lucide="shield"></i> Admin</a>` : ""}
            <a href="#/docs" data-link><i data-lucide="book-open"></i> Docs</a>
            <a href="#/api" data-link><i data-lucide="code-2"></i> API</a>
            <a href="#/settings" data-link><i data-lucide="settings"></i> Settings</a>
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
    refreshNotifBadge();
  }
  // Update the unread-notification badge in the nav + bottom nav.
  function refreshNotifBadge() {
    const n = (window.Social && Auth.isLoggedIn()) ? window.Social.unreadCount() : 0;
    const b = document.getElementById("notifBadge");
    if (b) { b.hidden = n === 0; b.textContent = n > 99 ? "99+" : String(n); }
    const bn = document.getElementById("bnNotifBadge");
    if (bn) { bn.hidden = n === 0; bn.textContent = n > 9 ? "9+" : String(n); }
  }
  window.addEventListener("mv:notif", refreshNotifBadge);
  Auth.onChange(() => { renderAccount(); buildMobileMenu(); });

  function requireAuth(actionMsg) {
    if (Auth.isLoggedIn()) return true;
    toast(actionMsg || "Please sign in to continue.", "info");
    openAuth("login");
    return false;
  }

  /* ---------------- Age gate (18+) ---------------- */
  const AGE_KEY = "mv_age_ok";
  function isAgeVerified() { try { return localStorage.getItem(AGE_KEY) === "1"; } catch (e) { return false; } }
  function setAgeVerified() { try { localStorage.setItem(AGE_KEY, "1"); } catch (e) {} }

  const ageModal = document.getElementById("ageModal");
  let agePending = false; // true while we wait for a yes/no
  function openAgeGate() {
    agePending = true;
    ageModal.classList.add("open");
    ageModal.setAttribute("aria-hidden", "false");
    icons();
  }
  function closeAgeGate() {
    agePending = false;
    ageModal.classList.remove("open");
    ageModal.setAttribute("aria-hidden", "true");
  }
  document.getElementById("ageYes").addEventListener("click", () => {
    setAgeVerified();
    closeAgeGate();
    toast("Age confirmed — welcome to the 18+ area.", "success");
    viewAdult();
  });
  document.getElementById("ageNo").addEventListener("click", () => {
    closeAgeGate();
    location.hash = "#/";
  });
  ageModal.addEventListener("click", e => {
    if (e.target === ageModal) { closeAgeGate(); if (location.hash.replace(/^#/, "").startsWith("/adult")) location.hash = "#/"; }
  });

  /* ---------------- Mobile menu ---------------- */
  function buildMobileMenu() {
    const m = document.getElementById("navMobile");
    const u = Auth.current();
    const authLinks = u
      ? `<a href="#/profile" data-link><i data-lucide="user"></i> Profile</a>
         <a href="#/notifications" data-link><i data-lucide="bell"></i> Notifications</a>
         <a href="#/chat" data-link><i data-lucide="message-circle"></i> Chat</a>
         <a href="#/bookmarks" data-link><i data-lucide="bookmark"></i> Bookmarks</a>
         <a href="#/history" data-link><i data-lucide="history"></i> History</a>
         ${u.isAdmin ? `<a href="#/admin" data-link><i data-lucide="shield"></i> Admin</a>` : ""}`
      : "";
    m.innerHTML = `
      <a href="#/" data-link><i data-lucide="home"></i> Home</a>
      <a href="#/library" data-link><i data-lucide="library"></i> Library</a>
      <a href="#/feed" data-link><i data-lucide="rss"></i> Feed</a>
      <a href="#/search" data-link><i data-lucide="search"></i> Search</a>
      ${authLinks}
      <a href="#/docs" data-link><i data-lucide="book-open"></i> Docs</a>
      <a href="#/api" data-link><i data-lucide="code-2"></i> API</a>
      <a href="#/settings" data-link><i data-lucide="settings"></i> Settings</a>
      <a href="#/adult" data-link class="nav-link-adult"><i data-lucide="flame"></i> 18+ Adult</a>`;
    icons();
  }
  /* ---------------- Slide-in left drawer (mobile) ----------------
     The hamburger opens a drawer that slides in from the left with a dim
     backdrop. Tap the backdrop (or a link) to close; the drawer is the
     existing #navMobile menu, restyled + animated on mobile. */
  function ensureDrawerBackdrop() {
    let bd = document.getElementById("drawerBackdrop");
    if (!bd) {
      bd = document.createElement("div");
      bd.id = "drawerBackdrop";
      bd.className = "drawer-backdrop";
      document.body.appendChild(bd);
      bd.addEventListener("click", closeDrawer);
    }
    return bd;
  }
  function openDrawer() {
    buildMobileMenu();
    ensureDrawerBackdrop().classList.add("show");
    document.getElementById("navMobile").classList.add("open");
    document.body.classList.add("drawer-open");
  }
  function closeDrawer() {
    const bd = document.getElementById("drawerBackdrop");
    if (bd) bd.classList.remove("show");
    document.getElementById("navMobile").classList.remove("open");
    document.body.classList.remove("drawer-open");
  }
  window.__closeDrawer = closeDrawer;
  document.getElementById("navBurger").addEventListener("click", () => {
    const m = document.getElementById("navMobile");
    if (m.classList.contains("open")) closeDrawer(); else openDrawer();
  });
  // close the drawer whenever a link inside it is tapped
  document.getElementById("navMobile").addEventListener("click", e => {
    if (e.target.closest("a")) closeDrawer();
  });

  /* ---------------- Pull-to-refresh (mobile) ----------------
     Pull down while scrolled to the very top to re-run the current route.
     Touch-only; ignored on desktop / when not at the top. */
  (function initPullToRefresh() {
    let indicator = null, startY = 0, pulling = false, dist = 0;
    const THRESHOLD = 70, MAX = 110;
    function ind() {
      if (!indicator) {
        indicator = document.createElement("div");
        indicator.className = "ptr-indicator";
        indicator.innerHTML = `<span class="ptr-spinner"><i data-lucide="loader"></i></span>`;
        document.body.appendChild(indicator);
      }
      return indicator;
    }
    window.addEventListener("touchstart", e => {
      if (window.innerWidth > 720) return;
      if (window.scrollY > 2) return;
      if (e.touches.length !== 1) return;
      startY = e.touches[0].clientY; pulling = true; dist = 0;
    }, { passive: true });
    window.addEventListener("touchmove", e => {
      if (!pulling) return;
      dist = e.touches[0].clientY - startY;
      if (dist <= 0) { ind().style.transform = "translateX(-50%) translateY(-60px)"; return; }
      const d = Math.min(dist, MAX);
      const el = ind();
      el.style.transform = `translateX(-50%) translateY(${Math.min(d - 40, 24)}px)`;
      el.style.opacity = Math.min(d / THRESHOLD, 1);
      el.classList.toggle("ready", d >= THRESHOLD);
    }, { passive: true });
    window.addEventListener("touchend", () => {
      if (!pulling) return;
      pulling = false;
      const el = ind();
      if (dist >= THRESHOLD) {
        el.classList.add("spinning");
        el.style.transform = "translateX(-50%) translateY(16px)";
        el.style.opacity = "1";
        Promise.resolve(router()).finally(() => {
          setTimeout(() => {
            el.classList.remove("spinning", "ready");
            el.style.transform = "translateX(-50%) translateY(-60px)";
            el.style.opacity = "0";
          }, 400);
        });
      } else {
        el.classList.remove("ready");
        el.style.transform = "translateX(-50%) translateY(-60px)";
        el.style.opacity = "0";
      }
    });
  })();

  /* ---------------- Edge-swipe to open the drawer (mobile) ----------------
     Swipe right starting from the LEFT edge of the screen to open the nav
     drawer. Touch-only + mobile-only; only triggers on a mostly-horizontal
     swipe so it never fights vertical scrolling. Closing is handled by the
     existing backdrop / link handlers (tap backdrop or a link to close). */
  (function initEdgeSwipe() {
    let sx = 0, sy = 0, tracking = false;
    const EDGE = 28, DX = 60, MAX_DY = 45;
    window.addEventListener("touchstart", e => {
      if (window.innerWidth > 720) return;
      if (e.touches.length !== 1) return;
      const x = e.touches[0].clientX;
      // only start tracking from the very left edge, and not when already open
      if (x > EDGE) { tracking = false; return; }
      if (document.body.classList.contains("drawer-open")) { tracking = false; return; }
      sx = x; sy = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    window.addEventListener("touchend", e => {
      if (!tracking) return;
      tracking = false;
      const t = (e.changedTouches && e.changedTouches[0]);
      if (!t) return;
      const dx = t.clientX - sx, dy = Math.abs(t.clientY - sy);
      // mostly-horizontal rightward swipe from the edge → open drawer
      if (dx >= DX && dy <= MAX_DY && dx > dy) {
        if (typeof openDrawer === "function") openDrawer();
      }
    }, { passive: true });
  })();

  /* ---------------- Global search ---------------- */
  const globalSearch = document.getElementById("globalSearch");
  let searchTimer = null;
  let searchSuggestBox = null;

  // Create suggestions dropdown
  function ensureSuggestBox() {
    if (!searchSuggestBox) {
      searchSuggestBox = document.createElement("div");
      searchSuggestBox.id = "searchSuggestions";
      searchSuggestBox.className = "search-suggestions";
      document.getElementById("navSearch").appendChild(searchSuggestBox);
    }
    return searchSuggestBox;
  }

  // Fetch search suggestions from MangaDex
  async function fetchSuggestions(q) {
    if (q.length < 2) { const b = document.getElementById("searchSuggestions"); if (b) b.classList.remove("show"); return; }
    try {
      const results = await window.MangaSource.search(q, { limit: 5 });
      const box = ensureSuggestBox();
      if (results.length) {
        box.innerHTML = results.slice(0, 5).map(r => 
          `<a class="suggest-item" href="#/manga/${encodeURIComponent(r.id)}" data-link>
            <img src="${esc(r.cover)}" alt="" onerror="this.style.display='none'" />
            <span>${esc(r.title)}</span>
          </a>`
        ).join("");
        box.classList.add("show");
        if (window.lucide) window.lucide.createIcons();
      } else {
        box.classList.remove("show");
      }
    } catch (e) { const b = document.getElementById("searchSuggestions"); if (b) b.classList.remove("show"); }
  }

  globalSearch.addEventListener("input", () => {
    const q = globalSearch.value.trim();
    clearTimeout(searchTimer);
    if (q.length >= 2) searchTimer = setTimeout(() => fetchSuggestions(q), 250);
    else { const b = document.getElementById("searchSuggestions"); if (b) b.classList.remove("show"); }
  });

  globalSearch.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      const q = globalSearch.value.trim();
      const b = document.getElementById("searchSuggestions");
      if (b) b.classList.remove("show");
      location.hash = q ? "#/library?q=" + encodeURIComponent(q) : "#/library";
    }
    if (e.key === "Escape") {
      const b = document.getElementById("searchSuggestions");
      if (b) b.classList.remove("show");
      globalSearch.blur();
    }
  });

  // Close suggestions on click outside
  document.addEventListener("click", e => {
    const b = document.getElementById("searchSuggestions");
    if (b && !e.target.closest("#navSearch")) b.classList.remove("show");
  });
  document.addEventListener("keydown", e => {
    if (e.key === "/" && document.activeElement !== globalSearch && !/input|textarea/i.test(document.activeElement.tagName)) {
      e.preventDefault(); globalSearch.focus();
    }
  });

  /* ============================================================
     LANGUAGE + TRANSLATE selectors (navbar)
     ============================================================ */
  function buildLangSelectors() {
    const chSel = document.getElementById("chapterLang");
    const uiSel = document.getElementById("uiLang");
    if (chSel) {
      chSel.innerHTML = window.MangaSource.langs()
        .map(l => `<option value="${l.code}">${esc(l.name)}</option>`).join("");
      chSel.value = window.MangaSource.getLang();
      chSel.addEventListener("change", () => {
        window.MangaSource.setLang(chSel.value);
        toast("Chapter language: " + window.MangaSource.langName(chSel.value), "info");
        // reset caches so chapter lists reload in the new language
        HOME_CACHE = null; LIB_ALL = null; ADULT_ALL = null; MP_CACHE = null;
        router();
      });
    }
    if (uiSel) {
      uiSel.innerHTML = window.MangaTranslate.langs()
        .map(l => `<option value="${l.code}">${esc(l.name)}</option>`).join("");
      uiSel.value = window.MangaTranslate.get();
      uiSel.addEventListener("change", async () => {
        window.MangaTranslate.set(uiSel.value);
        if (window.MangaTranslate.active())
          toast("Translating site to " + window.MangaTranslate.name(uiSel.value) + "…", "info");
        else toast("Showing original English text.", "info");
        // Re-translate everything currently on screen (titles, synopses, labels…)
        await window.MangaTranslate.apply(document);
      });
    }
  }
  // Keep both navbar selects in sync with stored values (e.g. after a
  // per-manga language change on the detail page).
  function syncLangSelectors() {
    const chSel = document.getElementById("chapterLang");
    if (chSel) chSel.value = window.MangaSource.getLang();
  }

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
    if (window.__closeDrawer) window.__closeDrawer();
    else document.getElementById("navMobile").classList.remove("open");
    setActiveNav(path);

    // Admin feature flags — block disabled areas gracefully.
    const feat = (window.Auth && Auth.features) ? Auth.features() : {};
    const blocked = { feed: "Feed", chat: "Chat", adult: "18+ section", api: "API" };
    for (const k in blocked) {
      if (parts[0] === (k === "adult" ? "adult" : k) && feat[k] === false && !Auth.isAdmin()) {
        app.innerHTML = `<section class="page"><div class="empty-state"><i data-lucide="lock"></i><h3>${blocked[k]} is turned off</h3><p>An administrator has disabled this feature.</p><a class="btn btn-primary" href="#/" data-link>Back home</a></div></section>`;
        afterRender(); return;
      }
    }

    if (parts.length === 0) return viewHome();
    if (parts[0] === "library") return viewLibrary(params);
    if (parts[0] === "manga" && parts[1]) return viewDetail(decodeURIComponent(parts[1]));
    if (parts[0] === "read" && parts[1] && parts[2]) return viewReader(decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
    if (parts[0] === "bookmarks") return viewBookmarks();
    if (parts[0] === "history") return viewHistory();
    if (parts[0] === "feed") return viewFeed();
    if (parts[0] === "post") return viewComposer();
    if (parts[0] === "chat") return viewChat();
    if (parts[0] === "dm" && parts[1]) return viewDM(decodeURIComponent(parts[1]));
    if (parts[0] === "notifications") return viewNotifications();
    if (parts[0] === "search") return viewSearch(params);
    if (parts[0] === "admin") return viewAdmin();
    if (parts[0] === "docs") return viewDocs();
    if (parts[0] === "api") return viewApi();
    if (parts[0] === "settings") return viewSettings();
    if (parts[0] === "profile") return viewProfile(null);
    if (parts[0] === "u" && parts[1]) return viewProfile(decodeURIComponent(parts[1]));
    if (parts[0] === "adult") {
      if (!isAgeVerified()) { openAgeGate(); return; }
      return viewAdult(params);
    }
    return viewHome();
  }

  function setActiveNav(path) {
    $$(".nav-link").forEach(a => {
      const href = a.getAttribute("href").replace(/^#/, "");
      a.classList.toggle("active", href === path || (href === "/" && path === "/"));
    });
    // bottom nav active state
    const root = "/" + (path.split("/").filter(Boolean)[0] || "");
    $$(".bn-item").forEach(a => {
      const bn = a.getAttribute("data-bn");
      a.classList.toggle("active", bn === root || (bn === "/" && path === "/"));
    });
  }

  /* ============================================================
     "FOR YOU" RECOMMENDATION ENGINE
     Personalizes from the signed-in user's bookmarks + reading history.
     Scores each candidate title by overlap of genres (and author) with the
     titles they've bookmarked / read, excludes already-read/bookmarked, and
     falls back to popular/trending for new users with no signal.
     ============================================================ */
  async function recommendFor(limit = 12) {
    const u = Auth.current();
    let pool = [];
    try { pool = await window.MangaSource.list({ limit: 30 }); } catch (e) { pool = []; }
    if (!pool.length) return { items: [], personalized: false };

    // Build a taste profile from bookmarks + history.
    const seen = new Set();
    const genreWeight = {};
    const authorWeight = {};
    const addSignal = (obj, weight) => {
      if (!obj) return;
      const id = obj.id || obj.mangaId;
      if (id) seen.add(id);
      (obj.genres || []).forEach(g => { genreWeight[g] = (genreWeight[g] || 0) + weight; });
      if (obj.author) authorWeight[obj.author] = (authorWeight[obj.author] || 0) + weight;
    };
    if (u) {
      Auth.bookmarks().forEach(b => addSignal(b, 3));         // bookmarks = strong signal
      Auth.history().forEach(h => addSignal(h, 1));           // history entries = softer
    }
    const hasSignal = Object.keys(genreWeight).length > 0 || Object.keys(authorWeight).length > 0;

    if (!hasSignal) {
      // New user / no history → fall back to popular (trending) titles.
      return { items: pool.slice(0, limit), personalized: false };
    }

    // Score candidates by shared genres/author; exclude what they've already seen.
    const scored = pool
      .filter(m => !seen.has(m.id))
      .map(m => {
        let score = 0;
        (m.genres || []).forEach(g => { if (genreWeight[g]) score += genreWeight[g]; });
        if (m.author && authorWeight[m.author]) score += authorWeight[m.author] * 2;
        score += (m.rating || 0) * 0.15; // gentle quality nudge
        return { m, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.m);

    // If personalization thinned the list too much, top up with popular titles.
    let items = scored.slice(0, limit);
    if (items.length < limit) {
      const have = new Set(items.map(m => m.id));
      for (const m of pool) {
        if (items.length >= limit) break;
        if (!have.has(m.id) && !seen.has(m.id)) { items.push(m); have.add(m.id); }
      }
    }
    return { items, personalized: true };
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
          <h1 class="hero-title" data-tr>Read manga the beautiful way.</h1>
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

      <section class="row-section" id="forYouSection" hidden>
        <div class="section-head">
          <h2><i data-lucide="sparkles"></i> <span data-tr>For You</span></h2>
          <span class="shelf-note" id="forYouNote"></span>
        </div>
        <div class="hscroll" id="forYouRow">${skeletonRow(6)}</div>
      </section>

      <section class="row-section" id="popularSection">
        <div class="section-head">
          <h2><i data-lucide="flame"></i> <span data-tr>Popular Now</span></h2>
          <a href="#/library" data-link class="see-all"><span data-tr>See all</span> <i data-lucide="arrow-right"></i></a>
        </div>
        <div id="sourceBannerSlot"></div>
        <div id="popularGrid">${skeletonGrid(12)}</div>
      </section>

      <section class="row-section" id="trendingSection">
        <div class="section-head">
          <h2><i data-lucide="trending-up"></i> <span data-tr>Trending</span></h2>
        </div>
        <div class="hscroll" id="trendingRow">${skeletonRow(8)}</div>
      </section>

      <section class="row-section" id="mangaPlusSection">
        <div class="section-head">
          <h2><i data-lucide="zap"></i> <span data-tr>MangaPlus / Shonen Jump</span></h2>
          <span class="shelf-note"><i data-lucide="badge-check"></i> <span data-tr>Shueisha titles</span></span>
        </div>
        <div class="hscroll" id="mangaPlusRow">${skeletonRow(8)}</div>
      </section>`;

    if ($("#heroSignup")) $("#heroSignup").addEventListener("click", () => openAuth("signup"));
    icons();

    try {
      const items = HOME_CACHE || await window.MangaSource.list({ limit: 18 });
          // Fetch Trending from AniList
    (async () => {
      try {
        const items = await window.MangaSource.trendingShelf({ limit: 8 });
        if (items.length) {
          $("#trendingRow").innerHTML = items.map(shelfCard).join("");
          afterRender($("#trendingRow"));
          return;
        }
      } catch (e) {}
      const fb = window.MangaData.sampleFor("sfw");
      $("#trendingRow").innerHTML = fb.slice(0, 8).map(shelfCard).join("");
      afterRender($("#trendingRow"));
    })();

    // Only cache LIVE results — if we got the sample fallback, leave the
      // cache empty so a later visit / retry can still reach live data.
      if (window.MangaSource.mode() === "live") HOME_CACHE = items;
      $("#sourceBannerSlot").innerHTML = sourceBanner();
      $("#popularGrid").innerHTML = `<div class="grid">${items.map(mangaCard).join("")}</div>`;
      afterRender($("#popularGrid"));
      icons();
    } catch (e) {
      $("#popularGrid").innerHTML = `<p class="empty">Couldn't load manga. Please refresh.</p>`;
    }

    // "For You" personalized shelf — from bookmarks + reading history.
    try {
      const rec = await recommendFor(12);
      const sec = $("#forYouSection");
      const row = $("#forYouRow");
      if (sec && row && rec.items.length) {
        sec.hidden = false;
        row.innerHTML = rec.items.map(shelfCard).join("");
        const note = $("#forYouNote");
        if (note) note.innerHTML = rec.personalized
          ? `<i data-lucide="badge-check"></i> <span>Based on your bookmarks & history</span>`
          : `<i data-lucide="trending-up"></i> <span>Popular picks to get you started</span>`;
        afterRender(row);
        icons();
      }
    } catch (e) { /* non-fatal: shelf stays hidden */ }

    // MangaPlus / Shonen Jump shelf — real Shueisha catalogue via MangaDex.
    try {
      const mp = MP_CACHE || await window.MangaSource.mangaPlusShelf({ limit: 12 });
      if (window.MangaSource.mode() === "live") MP_CACHE = mp;
      const row = $("#mangaPlusRow");
      if (row) {
        row.innerHTML = mp.length
          ? mp.map(shelfCard).join("")
          : `<p class="empty">MangaPlus catalogue unavailable right now.</p>`;
        afterRender(row);
        icons();
      }
    } catch (e) {
      const row = $("#mangaPlusRow");
      if (row) row.innerHTML = `<p class="empty">Couldn't load the MangaPlus shelf.</p>`;
    }
  }
  let MP_CACHE = null;

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
      afterRender($("#libGrid"));
    }

    await doSearch();
  }

  /* ============================================================
     VIEW: ADULT (18+) — NSFW library behind the age gate
     ============================================================ */
  let ADULT_ALL = null;
  async function viewAdult(params) {
    const q0 = (params && params.q) || "";
    app.innerHTML = `
      <section class="page adult-page">
        <div class="adult-head">
          <div>
            <h1><span class="age-badge sm"><i data-lucide="flame"></i> 18+</span> Adult Library</h1>
            <p>Mature manga — erotica &amp; hentai. Hidden from the main library and gated behind age confirmation.</p>
          </div>
          <button class="btn btn-ghost btn-sm" id="adultLock"><i data-lucide="lock"></i> Lock 18+</button>
        </div>
        <div class="adult-warning"><i data-lucide="alert-triangle"></i> You're viewing explicit adult content. Make sure no one underage can see your screen.</div>
        <div class="filters">
          <div class="search-box">
            <i data-lucide="search"></i>
            <input type="text" id="adultSearch" placeholder="Search adult titles, genres…" value="${esc(q0)}" />
            <button id="adultSearchBtn" class="btn btn-primary btn-sm">Search</button>
          </div>
          <div class="genre-chips" id="adultChips"></div>
        </div>
        <div id="sourceBannerSlot"></div>
        <div id="adultGrid">${skeletonGrid(12)}</div>
      </section>`;
    icons();

    $("#adultLock").addEventListener("click", () => {
      try { localStorage.removeItem("mv_age_ok"); } catch (e) {}
      toast("18+ area locked.", "info");
      location.hash = "#/";
    });

    const adultSearch = $("#adultSearch");
    let activeGenre = "All";

    const doSearch = async () => {
      const q = adultSearch.value.trim();
      $("#adultGrid").innerHTML = skeletonGrid(12);
      try {
        const items = q
          ? await window.MangaSource.search(q, { content: "nsfw" })
          : await window.MangaSource.list({ limit: 30, content: "nsfw" });
        ADULT_ALL = items;
        $("#sourceBannerSlot").innerHTML = sourceBanner();
        buildChips(items);
        applyFilter();
      } catch (e) { $("#adultGrid").innerHTML = `<p class="empty">No results.</p>`; }
    };

    function buildChips(items) {
      const genres = ["All", ...Array.from(new Set(items.flatMap(m => m.genres))).sort()];
      $("#adultChips").innerHTML = genres.map(g =>
        `<button class="chip ${g === activeGenre ? "active" : ""}" data-genre="${esc(g)}">${esc(g)}</button>`).join("");
      $$("#adultChips .chip").forEach(c => c.addEventListener("click", () => {
        activeGenre = c.dataset.genre;
        $$("#adultChips .chip").forEach(x => x.classList.toggle("active", x === c));
        applyFilter();
      }));
    }
    function applyFilter() {
      const items = (ADULT_ALL || []).filter(m => activeGenre === "All" || m.genres.includes(activeGenre));
      $("#adultGrid").innerHTML = items.length
        ? `<div class="grid">${items.map(mangaCard).join("")}</div>`
        : `<p class="empty">No titles match this filter.</p>`;
      afterRender($("#adultGrid"));
    }

    $("#adultSearchBtn").addEventListener("click", doSearch);
    adultSearch.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

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
    // Enrich with AniList metadata for richer descriptions, tags, popularity
    try { m = await window.MangaSource.enrich(m); } catch (e) {}

    const bookmarked = Auth.isBookmarked(m.id);
    const lastRead = Auth.lastReadFor(m.id);
    const chapters = (m.chapters || []).slice();
    // Available chapter languages for this title (English-first); current selection.
    const availLangs = window.MangaSource.langsFor(m);
    const curLang = window.MangaSource.getLang();

    app.innerHTML = `
      <section class="detail">
        <div class="detail-banner" style="background-image:url('${esc(m.cover)}')"></div>
        <div class="detail-main">
          <div class="detail-cover">
            <img src="${esc(m.cover)}" alt="${esc(m.title)} cover" onerror="this.src='${esc(window.MangaData.cover(m.title, 0))}'" />
          </div>
          <div class="detail-info">
            <div class="detail-badges">${statusBadge(m.status)}${adultBadge(m.contentRating)}${ratingStars(m.rating)}${m.year ? `<span class="muted">${esc(m.year)}</span>` : ""}</div>
            <h1 data-tr>${esc(m.title)}</h1>
            <p class="detail-author"><i data-lucide="pen-tool"></i> ${esc(m.author || "Unknown")}</p>
            <div class="detail-tags">${(m.genres || []).map(g => `<a class="tag" href="#/library?q=${encodeURIComponent(g)}" data-link data-tr>${esc(g)}</a>`).join("")}</div>
            <p class="detail-desc" data-tr>${esc(m.description)}</p>
            <div class="detail-actions">
              ${chapters.length ? `<a class="btn btn-primary" href="#/read/${encodeURIComponent(m.id)}/${encodeURIComponent((lastRead && chapters.find(c=>c.id===lastRead.chapterId) ? lastRead.chapterId : chapters[0].id))}" data-link><i data-lucide="book-open"></i> ${lastRead ? "Continue Ch. " + esc(lastRead.chapterNumber) : "Start Reading"}</a>` : ""}
              <button class="btn btn-ghost ${bookmarked ? "active" : ""}" id="bmBtn"><i data-lucide="bookmark"></i> <span>${bookmarked ? "Bookmarked" : "Bookmark"}</span></button>
              <button class="btn btn-ghost btn-sm btn-random" id="detailRandomBtn" title="Random manga"><i data-lucide="shuffle"></i></button>
              <button class="btn btn-ghost btn-sm btn-share" id="detailShareBtn" title="Share"><i data-lucide="share-2"></i></button>
            </div>
          </div>
        </div>

        <div class="detail-chapters">
          <div class="chapters-head">
            <h2><i data-lucide="list"></i> Chapters <span class="muted">(${chapters.length})</span></h2>
            ${availLangs.length > 1 ? `<label class="ch-lang-pick"><i data-lucide="languages"></i> <span>Language</span>
              <select id="detailLang">${availLangs.map(c => `<option value="${esc(c)}" ${c === curLang ? "selected" : ""}>${esc(window.MangaSource.langName(c))}</option>`).join("")}</select>
            </label>` : (availLangs.length === 1 ? `<span class="ch-lang-single"><i data-lucide="languages"></i> ${esc(window.MangaSource.langName(availLangs[0]))}</span>` : "")}
          </div>
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
          </div>` : `<p class="empty">No chapters available in ${esc(window.MangaSource.langName(curLang))} for this title.${availLangs.length > 1 ? " Try another language above." : (m.source === "live" ? " Try another manga." : "")}</p>`}
        </div>
      </section>`;
    afterRender();

    // Per-manga chapter-language switch: persist + reload chapters in that language.
    const detailLang = $("#detailLang");
    if (detailLang) detailLang.addEventListener("change", async (e) => {
      const lang = e.target.value;
      window.MangaSource.setLang(lang);
      syncLangSelectors();
      const list = $(".detail-chapters .chapter-list, .detail-chapters .empty");
      if (list) list.innerHTML = `<div class="reader-loading"><i data-lucide="loader"></i> Loading ${esc(window.MangaSource.langName(lang))} chapters…</div>`;
      icons();
      try { m.chapters = await window.MangaSource.chapters(m.id, m.contentRating, lang); }
      catch (err) { m.chapters = []; }
      viewDetail(id);
    });

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

        const __rs = (() => { try { return JSON.parse(localStorage.getItem('mv_reader_settings') || '{}'); } catch(e) { return {}; } })();
    const defBg = __rs.bg || 'dark';
    const defBright = __rs.brightness || 100;

    app.innerHTML = `
      <div class="reader" id="readerRoot" data-bg="${esc(defBg)}" style="filter: brightness(${defBright}%)">
        <div class="reader-head">
          <div class="reader-title">
            <a href="#/manga/${encodeURIComponent(m.id)}" data-link>${esc(m.title)}</a>
            <span class="muted">— ${esc(chapter.title)}</span>
          </div>
          <button class="btn btn-ghost btn-sm reader-settings-btn" id="readerSettingsBtn" title="Reader settings"><i data-lucide="settings"></i></button>
        </div>
        <div class="reader-settings-panel" id="readerSettingsPanel" style="display:none">
          <div class="rs-row">
            <label>Brightness</label>
            <input type="range" id="rsBrightness" min="30" max="150" value="${esc(defBright)}" />
            <span class="rs-val" id="rsBrightnessVal">${defBright}%</span>
          </div>
          <div class="rs-row">
            <label>Theme</label>
            <div class="rs-themes">
              <button class="rs-theme ${defBg === 'dark' ? 'active' : ''}" data-bg="dark" style="background:#0b131e;color:#fff">Dark</button>
              <button class="rs-theme ${defBg === 'sepia' ? 'active' : ''}" data-bg="sepia" style="background:#fbf3d9;color:#3b2f1a">Sepia</button>
              <button class="rs-theme ${defBg === 'light' ? 'active' : ''}" data-bg="light" style="background:#f5f5f5;color:#222">Light</button>
            </div>
          </div>
          <div class="rs-row">
            <label>Mode</label>
            <div class="rs-modes">
              <button class="rs-mode ${(__rs.mode||'scroll')==='scroll'?'active':''}" data-mode="scroll">Scroll</button>
              <button class="rs-mode ${__rs.mode==='page'?'active':''}" data-mode="page">Page</button>
            </div>
          </div>
          <div class="rs-row">
            <label>Layout</label>
            <div class="rs-modes">
              <button class="rs-mode ${(__rs.layout||'portrait')==='portrait'?'active':''}" data-layout="portrait">Portrait</button>
              <button class="rs-mode ${__rs.layout==='landscape'?'active':''}" data-layout="landscape">Landscape</button>
            </div>
          </div>
          <div class="rs-row">
            <label>Turn Page</label>
            <div class="rs-modes">
              <button class="rs-mode ${__rs.tapMode==='off'?'active':''}" data-tap="off">Off</button>
              <button class="rs-mode ${(__rs.tapMode||'chapter')==='chapter'?'active':''}" data-tap="chapter">Chapters</button>
            </div>
          </div>
          <div class="rs-row">
            <label>Direction</label>
            <div class="rs-modes">
              <button class="rs-mode ${(__rs.direction||'ltr')==='ltr'?'active':''}" data-dir="ltr">LTR</button>
              <button class="rs-mode ${__rs.direction==='rtl'?'active':''}" data-dir="rtl">RTL</button>
            </div>
          </div>
          <div class="rs-row">
            <label>Auto Nav</label>
            <div class="rs-modes">
              <button class="rs-mode ${(__rs.autoHide||'on')==='on'?'active':''}" data-autohide="on">Auto</button>
              <button class="rs-mode ${__rs.autoHide==='off'?'active':''}" data-autohide="off">Always</button>
            </div>
          </div>
        </div>
        ${navBar("top")}
        <div class="reader-pages" id="readerPages" data-layout="${esc(defBg === "landscape" ? "landscape" : (__rs.layout || "portrait"))}" data-dir="${esc(__rs.direction || "ltr")}" data-autohide="${esc(__rs.autoHide || "on")}">
          <div class="reader-loading"><i data-lucide="loader"></i> Loading pages… <span class="muted">(finding the best readable source)</span></div>
        </div>
        ${navBar("bottom")}
      </div>
      <div class="reader-progress" id="readerProgress"><div class="bar" id="readerBar"></div></div>`;

    // Reader settings panel logic
    setTimeout(() => {
      const panel = document.getElementById('readerSettingsPanel');
      const btn = document.getElementById('readerSettingsBtn');
      if (btn) btn.addEventListener('click', () => { if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });

      const root = document.getElementById('readerRoot');
      const brightness = document.getElementById('rsBrightness');
      const brightVal = document.getElementById('rsBrightnessVal');
      if (brightness) brightness.addEventListener('input', () => {
        const v = brightness.value;
        if (brightVal) brightVal.textContent = v + '%';
        if (root) root.style.filter = 'brightness(' + v + '%)';
        const s = JSON.parse(localStorage.getItem('mv_reader_settings') || '{}');
        s.brightness = parseInt(v);
        localStorage.setItem('mv_reader_settings', JSON.stringify(s));
      });

      document.querySelectorAll('.rs-theme').forEach(b => b.addEventListener('click', () => {
        document.querySelectorAll('.rs-theme').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const bg = b.dataset.bg;
        if (root) root.dataset.bg = bg;
        const s = JSON.parse(localStorage.getItem('mv_reader_settings') || '{}');
        s.bg = bg;
        localStorage.setItem('mv_reader_settings', JSON.stringify(s));
      }));

      document.querySelectorAll('.rs-mode').forEach(b => b.addEventListener('click', () => {
        document.querySelectorAll('.rs-mode').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const s = JSON.parse(localStorage.getItem('mv_reader_settings') || '{}');
        if (b.dataset.mode) s.mode = b.dataset.mode;
        if (b.dataset.layout) {
          s.layout = b.dataset.layout;
          const pages = document.getElementById('readerPages');
          if (pages) pages.dataset.layout = s.layout;
        }
        if (b.dataset.tap) s.tapMode = b.dataset.tap;
        if (b.dataset.dir) {
          s.direction = b.dataset.dir;
          const pages = document.getElementById('readerPages');
          if (pages) pages.dataset.dir = s.direction;
        }
        if (b.dataset.autohide) {
          s.autoHide = b.dataset.autohide;
          // Apply auto-hide immediately
          const topNav = document.querySelector('.reader-nav.top');
          if (topNav) topNav.dataset.autohide = s.autoHide;
        }
        localStorage.setItem('mv_reader_settings', JSON.stringify(s));
      }));
    }, 100);

    icons();

    $$("[id^=chapterSelect]").forEach(sel => sel.addEventListener("change", e => {
      location.hash = `#/read/${encodeURIComponent(m.id)}/${encodeURIComponent(e.target.value)}`;
    }));

    let pages = [];
    try { pages = await window.MangaSource.pages(chapter, m); } catch (e) { pages = []; }

    // The source layer now ALWAYS returns pages (real, alternate-source, or
    // neutral placeholder) — it never signals "not readable" and never asks
    // us to send the reader off-site. As a final safety net, if we somehow
    // got an empty array, synthesize neutral placeholder pages so the reader
    // still shows a clean chapter instead of a dead screen.
    if (!pages.length) {
      const count = chapter.pages || 8;
      for (let n = 1; n <= count; n++) pages.push(window.MangaData.page(m.title, chapter.number, n, count, 0));
      pages.placeholder = true;
    }

    // Placeholder pages (live copy unavailable) — show a calm, non-alarming
    // note. No "not readable" wording, no off-site redirect.
    if (pages.placeholder) {
      $("#readerPages").insertAdjacentHTML("beforebegin",
        `<div class="reader-notice"><i data-lucide="info"></i> Live pages for this chapter aren't loading from the source right now — you're viewing preview pages. Pull to refresh or check back shortly.</div>`);
    }
    // Alternate readable source — this title is licensed/unhosted on its
    // primary provider, but we found real readable pages elsewhere and are
    // showing them IN-APP. Tell the user where they're reading from.
    if (pages.via) {
      const langNote = pages.altLang && pages.altLang !== window.MangaSource.getLang()
        ? ` · ${esc(window.MangaSource.langName(pages.altLang))}` : "";
      $("#readerPages").insertAdjacentHTML("beforebegin",
        `<div class="reader-notice reader-notice-alt"><i data-lucide="check-circle"></i> Reading in-app via <strong>${esc(pages.via)}</strong>${langNote}.</div>`);
    }
    // Each page <img> carries its original URL + a retry counter. On error
    // we cycle through the CORS/image-proxy chain before showing a graceful
    // placeholder with a manual retry — one broken page never breaks the
    // whole chapter.
    $("#readerPages").innerHTML = pages.map((src, i) =>
      `<div class="reader-page">
        <img loading="lazy" data-src="${esc(src)}" data-try="0" src="${esc(window.MangaSource.proxiedImage(src, 0))}" alt="Page ${i + 1}" class="reader-img" />
       </div>`
    ).join("") + `<div class="reader-end">
        <p><i data-lucide="check-circle"></i> End of Chapter ${esc(chapter.number)}</p>
        ${next ? `<a class="btn btn-primary" href="#/read/${encodeURIComponent(m.id)}/${encodeURIComponent(next.id)}" data-link>Next Chapter <i data-lucide="arrow-right"></i></a>` : `<a class="btn btn-ghost" href="#/manga/${encodeURIComponent(m.id)}" data-link>Back to details</a>`}
      </div>`;
    icons();

    // Per-image proxy-retry: on error, cycle the CORS/image-proxy chain;
    // after all proxies fail, show a friendly retryable placeholder so a
    // single broken page never breaks the whole chapter. If EVERY page
    // fails (a genuinely unservable scanlation, e.g. a dead CDN host for a
    // licensed title's only community copy), degrade to the official-read
    // card instead of leaving a wall of Retry boxes.
    const maxTry = window.MangaSource.imageProxyCount();
    const totalPages = pages.length;
    let failedPages = 0;
    let degraded = false;
    // If EVERY page image fails to load (a genuinely unservable live copy),
    // don't show a "not readable" screen or link off-site — quietly swap in
    // neutral preview pages so the reader always shows a clean chapter.
    function degradeToPreview() {
      if (degraded) return;
      degraded = true;
      const count = chapter.pages || 8;
      const preview = [];
      for (let n = 1; n <= count; n++) preview.push(window.MangaData.page(m.title, chapter.number, n, count, 0));
      $("#readerPages").innerHTML = `<div class="reader-notice"><i data-lucide="info"></i> Live pages aren't loading from the source right now — you're viewing preview pages. Check back shortly.</div>` +
        preview.map((src, i) => `<div class="reader-page"><img loading="lazy" src="${esc(src)}" alt="Page ${i + 1}" class="reader-img" /></div>`).join("") +
        `<div class="reader-end">
          <p><i data-lucide="check-circle"></i> End of Chapter ${esc(chapter.number)}</p>
          ${next ? `<a class="btn btn-primary" href="#/read/${encodeURIComponent(m.id)}/${encodeURIComponent(next.id)}" data-link>Next Chapter <i data-lucide="arrow-right"></i></a>` : `<a class="btn btn-ghost" href="#/manga/${encodeURIComponent(m.id)}" data-link>Back to details</a>`}
        </div>`;
      icons();
    }
    function attachImg(imgEl, idx) {
      imgEl.addEventListener("load", function () {
        imgEl.setAttribute("data-ok", "1");
      });
      imgEl.addEventListener("error", function () {
        const orig = imgEl.getAttribute("data-src");
        const t = parseInt(imgEl.getAttribute("data-try") || "0", 10) + 1;
        // Inline data:/blob: pages are self-contained — retrying through an
        // HTTP proxy is pointless (and breaks them). Skip straight to the
        // graceful per-page fallback for these.
        const isInline = /^(data:|blob:)/i.test(orig || "");
        if (!isInline && t < maxTry) {
          imgEl.setAttribute("data-try", String(t));
          imgEl.src = window.MangaSource.proxiedImage(orig, t);
          return;
        }
        const wrap = imgEl.closest(".reader-page");
        if (!wrap || wrap.classList.contains("img-fail")) return;
        wrap.classList.add("img-fail");
        failedPages++;
        // If every page has exhausted all proxies, quietly show preview pages.
        if (failedPages >= totalPages && totalPages > 0) { degradeToPreview(); return; }
        wrap.innerHTML = `<div class="page-fail">
            <i data-lucide="image-off"></i>
            <span>Page ${idx + 1} couldn't load</span>
            <button class="btn btn-ghost btn-sm page-retry"><i data-lucide="refresh-cw"></i> Retry</button>
          </div>`;
        const btn = wrap.querySelector(".page-retry");
        if (btn) btn.addEventListener("click", () => {
          wrap.classList.remove("img-fail");
          failedPages = Math.max(0, failedPages - 1);
          wrap.innerHTML = `<img loading="lazy" data-src="${esc(orig)}" data-try="0" src="${esc(window.MangaSource.proxiedImage(orig, 0))}" alt="Page ${idx + 1}" class="reader-img" />`;
          attachImg(wrap.querySelector(".reader-img"), idx);
          if (window.lucide) window.lucide.createIcons();
        });
        if (window.lucide) window.lucide.createIcons();
      });
    }
    $$("#readerPages .reader-img").forEach((img, i) => attachImg(img, i));

    // reading progress bar
    const bar = $("#readerBar");
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + "%";
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    // Auto-hide nav on scroll
    let lastScrollY = window.scrollY;
    const onScrollDir = () => {
      const topNav = document.querySelector('.reader-nav.top');
      if (!topNav || topNav.dataset.autohide === 'off') return;
      const sy = window.scrollY;
      if (sy > lastScrollY && sy > 80) topNav.classList.add('nav-hidden');
      else if (sy < lastScrollY) topNav.classList.remove('nav-hidden');
      lastScrollY = sy;
    };
    window.addEventListener("scroll", onScrollDir, { passive: true });

    // Tap zones for chapter navigation
    if (window.__rs_tap !== false) {
      const zones = document.createElement("div");
      zones.className = "reader-tap-zones";
      zones.innerHTML = '<div class="tap-zone tap-left" id="tapLeft"></div><div class="tap-zone tap-right" id="tapRight"></div>';
      document.querySelector(".reader").appendChild(zones);
      const rs = (() => { try { return JSON.parse(localStorage.getItem('mv_reader_settings') || '{}'); } catch(e) { return {}; } })();
      if (rs.tapMode !== 'off') {
        document.getElementById("tapLeft").addEventListener("click", () => { if (prev) location.hash = '#/read/${m.id}/${prev.id}'; });
        document.getElementById("tapRight").addEventListener("click", () => { if (next) location.hash = '#/read/${m.id}/${next.id}'; });
      }
    }

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
    afterRender();
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

  /* ---------------- live-data retry (delegated) ---------------- */
  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest("#retryLive");
    if (!btn) return;
    e.preventDefault();
    HOME_CACHE = null; LIB_ALL = null; ADULT_ALL = null;
    btn.innerHTML = `<i data-lucide="loader"></i> Loading…`;
    icons();
    toast("Reconnecting to MangaDex…", "info");
    router();
  });

  /* ============================================================
     SOCIAL LAYER VIEWS — Feed / Post composer / Chat / DM / Profile
     Design matches the reference screenshots (DevzConn dark theme,
     cyan accents, glassmorphism cards, chat bubbles, bottom nav).
     ============================================================ */
  const S = () => window.Social;

  /* ---------- lightweight inline SVG charts (no libs) ---------- */
  // series = [{label, value}, ...]
  function lineChart(series, color) {
    color = color || "#00e5ff";
    const W = 520, H = 160, pad = 26;
    const max = Math.max(1, ...series.map(d => d.value));
    const n = series.length;
    const x = i => pad + (i * (W - pad * 2) / Math.max(1, n - 1));
    const y = v => H - pad - (v / max) * (H - pad * 2);
    const pts = series.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
    const area = `${pad},${H - pad} ${pts} ${x(n - 1).toFixed(1)},${H - pad}`;
    const dots = series.map((d, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(d.value).toFixed(1)}" r="3" fill="${color}"><title>${d.label}: ${d.value}</title></circle>`).join("");
    const labels = series.map((d, i) => (i % 2 === 0 || i === n - 1) ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="ch-lbl">${d.label}</text>` : "").join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
      <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" class="ch-axis"/>
      <polygon points="${area}" fill="${color}" opacity="0.12"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}${labels}
      <text x="${pad}" y="14" class="ch-max">max ${max}</text>
    </svg>`;
  }
  function barChart(series, color) {
    color = color || "#00ffa3";
    const W = 520, H = 160, pad = 26;
    const max = Math.max(1, ...series.map(d => d.value));
    const n = series.length;
    const bw = (W - pad * 2) / n * 0.62;
    const gap = (W - pad * 2) / n;
    const bars = series.map((d, i) => {
      const h = (d.value / max) * (H - pad * 2);
      const bx = pad + i * gap + (gap - bw) / 2;
      const by = H - pad - h;
      return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="3" fill="${color}"><title>${d.label}: ${d.value}</title></rect>`;
    }).join("");
    const labels = series.map((d, i) => (i % 2 === 0 || i === n - 1) ? `<text x="${(pad + i * gap + gap / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="ch-lbl">${d.label}</text>` : "").join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
      <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" class="ch-axis"/>
      ${bars}${labels}
      <text x="${pad}" y="14" class="ch-max">max ${max}</text>
    </svg>`;
  }

  // Stacked bar chart for retention: each day = new (bottom) + returning (top).
  // series = [{label, newUsers, returning}, ...]
  function stackedBarChart(series, cNew, cRet) {
    cNew = cNew || "#00e5ff"; cRet = cRet || "#00ffa3";
    const W = 520, H = 160, pad = 26;
    const max = Math.max(1, ...series.map(d => (d.newUsers || 0) + (d.returning || 0)));
    const n = series.length;
    const gap = (W - pad * 2) / n;
    const bw = gap * 0.62;
    const bars = series.map((d, i) => {
      const bx = pad + i * gap + (gap - bw) / 2;
      const hNew = ((d.newUsers || 0) / max) * (H - pad * 2);
      const hRet = ((d.returning || 0) / max) * (H - pad * 2);
      const yNew = H - pad - hNew;
      const yRet = yNew - hRet;
      const rNew = hNew > 0 ? `<rect x="${bx.toFixed(1)}" y="${yNew.toFixed(1)}" width="${bw.toFixed(1)}" height="${hNew.toFixed(1)}" rx="2" fill="${cNew}"><title>${d.label} · new: ${d.newUsers || 0}</title></rect>` : "";
      const rRet = hRet > 0 ? `<rect x="${bx.toFixed(1)}" y="${yRet.toFixed(1)}" width="${bw.toFixed(1)}" height="${hRet.toFixed(1)}" rx="2" fill="${cRet}"><title>${d.label} · returning: ${d.returning || 0}</title></rect>` : "";
      return rNew + rRet;
    }).join("");
    const step = n > 20 ? Math.ceil(n / 10) : (n > 10 ? 2 : 1);
    const labels = series.map((d, i) => (i % step === 0 || i === n - 1) ? `<text x="${(pad + i * gap + gap / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="ch-lbl">${d.label}</text>` : "").join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
      <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" class="ch-axis"/>
      ${bars}${labels}
      <text x="${pad}" y="14" class="ch-max">max ${max}</text>
    </svg>
    <div class="ch-legend"><span><i style="background:${cNew}"></i> New</span><span><i style="background:${cRet}"></i> Returning</span></div>`;
  }

  // Retention cohort heatmap (HTML grid). Rows = signup-day cohorts, columns =
  // day-N; cell color intensity encodes the % of that cohort active on day N.
  function cohortHeatmap(data) {
    const cohorts = (data && data.cohorts) || [];
    const maxN = (data && data.maxN) || 0;
    if (!cohorts.length) return `<p class="muted heatmap-empty">Not enough activity yet — cohorts appear as users return on later days.</p>`;
    const cellColor = pct => {
      if (pct == null) return "transparent";
      // cyan scale: 0% -> faint, 100% -> solid
      const a = 0.08 + (pct / 100) * 0.92;
      return `rgba(0,229,255,${a.toFixed(2)})`;
    };
    let head = `<th class="hm-cohort">Cohort</th><th class="hm-size">Users</th>`;
    for (let n = 0; n <= maxN; n++) head += `<th>D${n}</th>`;
    const rows = cohorts.map(c => {
      let tds = `<td class="hm-cohort">${esc(c.label)}</td><td class="hm-size">${c.size}</td>`;
      c.cells.forEach(cell => {
        if (cell.active == null) { tds += `<td class="hm-cell empty"></td>`; return; }
        const dark = cell.pct != null && cell.pct >= 55;
        tds += `<td class="hm-cell${dark ? " dark" : ""}" style="background:${cellColor(cell.pct)}" title="${esc(c.label)} · D${cell.n}: ${cell.active}/${c.size} (${cell.pct}%)">${cell.pct != null ? cell.pct + "%" : ""}</td>`;
      });
      return `<tr>${tds}</tr>`;
    }).join("");
    return `<div class="heatmap-scroll"><table class="cohort-heatmap"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // avatar <img> markup for any author/user object (always renders)
  function avatarImg(user, cls) {
    const url = Auth.avatarFor(user);
    // If an uploaded avatar is somehow unrenderable, fall back to the
    // guaranteed inline SVG-initials avatar instead of a broken-image icon.
    const fallback = Auth.initialsAvatar((user && (user.displayName || user.username)) || "?", (user && (user.id || user.username)) || "x");
    const name = (user && (user.displayName || user.username)) || "user";
    return `<img class="avatar-img ${cls || ""}" src="${esc(url)}" alt="${esc(name)}" loading="lazy" onerror="this.onerror=null;this.src='${esc(fallback)}'" />`;
  }
  // Verified badge — only shown for users an admin has verified.
  function verifiedTick(user) {
    if (!user || !user.verified) return "";
    return `<span class="verified" title="Verified"><i data-lucide="badge-check"></i></span>`;
  }
  // MangaBot inline title cards: cover thumbnail + title + tappable "Open"
  // button that navigates to the manga detail page. Rendered inside bot bubbles.
  function botRefsHTML(refs) {
    if (!refs || !refs.length) return "";
    return `<div class="bot-cards">${refs.map(r => `
      <div class="bot-card">
        <a class="bot-card-cover" href="#/manga/${encodeURIComponent(r.id)}" data-link title="${esc(r.title)}">
          ${r.cover ? `<img loading="lazy" src="${esc(r.cover)}" alt="${esc(r.title)}" />` : `<span class="bot-card-noimg"><i data-lucide="book"></i></span>`}
        </a>
        <div class="bot-card-body">
          <a class="bot-card-title" href="#/manga/${encodeURIComponent(r.id)}" data-link>${esc(r.title)}</a>
          ${r.genres && r.genres.length ? `<span class="bot-card-genres">${esc(r.genres.join(" · "))}</span>` : ""}
          <a class="bot-card-open btn-open" href="#/manga/${encodeURIComponent(r.id)}" data-link><i data-lucide="external-link"></i> Open</a>
        </div>
      </div>`).join("")}</div>`;
  }

  function mediaHTML(media) {
    if (!media) return "";
    if (media.type === "image") return `<div class="post-media"><img src="${esc(media.url)}" alt="post image" loading="lazy" onerror="this.onerror=null;this.closest('.post-media').style.display='none'" /></div>`;
    if (media.type === "video") return `<div class="post-media"><video src="${esc(media.url)}" controls playsinline></video></div>`;
    if (media.type === "audio") return `<div class="post-media"><audio src="${esc(media.url)}" controls></audio></div>`;
    return "";
  }

  /* ---------------- FEED ---------------- */
  function postCard(p) {
    const a = S().resolveAuthor(p.author);
    const liked = S().hasLiked(p);
    const me = Auth.current();
    const canDelete = me && p.author && p.author.id === me.id;
    return `
      <article class="post-card" data-post="${esc(p.id)}">
        ${p.reposted ? `<div class="repost-tag"><i data-lucide="repeat-2"></i> Someone reposted</div>` : ""}
        <div class="post-head">
          <a class="post-avatar" href="#/u/${encodeURIComponent(a.username)}" data-link>${avatarImg(a)}</a>
          <div class="post-id">
            <a class="post-name" href="#/u/${encodeURIComponent(a.username)}" data-link>${esc(a.displayName || a.username)}</a>${verifiedTick(a)}
            <div class="post-meta">@${esc(a.username)} · ${timeAgo(p.at)}${a.role ? " · " + esc(a.role) : ""}</div>
          </div>
          ${canDelete ? `<button class="post-del" data-del="${esc(p.id)}">Delete</button>` : `<button class="post-more" aria-label="More"><i data-lucide="more-horizontal"></i></button>`}
        </div>
        ${p.text ? `<div class="post-body">${esc(p.text)}</div>` : ""}
        ${mediaHTML(p.media)}
        <div class="post-actions">
          <button class="pa ${liked ? "liked" : ""}" data-like="${esc(p.id)}"><i data-lucide="heart"></i> <span>${p.likes || 0}</span></button>
          <button class="pa" data-cmt="${esc(p.id)}"><i data-lucide="message-square"></i> <span>${(p.comments || []).length}</span></button>
          <button class="pa" data-react="${esc(p.id)}" title="React"><i data-lucide="smile-plus"></i></button>
          <button class="pa" data-repost title="Repost"><i data-lucide="repeat-2"></i></button>
          <button class="pa pa-right" data-save title="Bookmark"><i data-lucide="bookmark"></i></button>
        </div>
        ${reactionBar(p)}
        <div class="post-comments" data-comments="${esc(p.id)}">
          ${(p.comments || []).slice(-3).map(commentRow).join("")}
          ${me ? `<div class="add-comment">
            ${avatarImg(me, "xs")}
            <input type="text" class="cmt-input" data-cmtinput="${esc(p.id)}" placeholder="Add a comment…" />
            <label class="cmt-img-btn" title="Add image"><i data-lucide="image"></i><input type="file" class="cmt-img" data-cmtimg="${esc(p.id)}" accept="image/*" hidden /></label>
          </div>` : `<a class="add-comment-cta" href="#" data-signin>Sign in to comment</a>`}
        </div>
      </article>`;
  }
  // Emoji reaction pills row (with the current user's picks highlighted)
  function reactionBar(p) {
    const counts = S().reactionCounts(p);
    const mine = S().myReactions(p);
    const keys = Object.keys(counts);
    const pills = S().REACTIONS
      .filter(r => keys.includes(r.key) || mine.includes(r.key))
      .map(r => `<button class="react-pill ${mine.includes(r.key) ? "on" : ""}" data-reactpill="${esc(p.id)}" data-rk="${r.key}"><span class="re">${r.emoji}</span> <span class="rc">${counts[r.key] || 0}</span></button>`)
      .join("");
    return `<div class="react-bar" data-reactbar="${esc(p.id)}">${pills}</div>`;
  }
  function commentRow(c) {
    const a = S().resolveAuthor(c.author);
    return `<div class="comment-row">
      ${avatarImg(a, "xs")}
      <div class="comment-bubble">
        <strong>${esc(a.displayName || a.username)}</strong> ${esc(c.text || "")}
        ${c.media && c.media.type === "image" ? `<div class="comment-img"><img src="${esc(c.media.url)}" alt="comment image" loading="lazy" onerror="this.onerror=null;this.closest('.comment-img').style.display='none'" /></div>` : ""}
      </div>
    </div>`;
  }

  // Current feed tab (persisted for the session): following | trending | foryou
  let FEED_TAB = "foryou";
  // Build the "Suggested users" strip: real accounts (excl. me + anyone I
  // already follow), most-followed first, plus MangaBot to discover it.
  function suggestedUsers() {
    const me = Auth.current();
    const following = (me && me.following) || [];
    let list = (S().mostFollowed ? S().mostFollowed(12) : Auth.allUsers())
      .filter(u => (!me || u.id !== me.id) && !following.includes(u.id));
    // surface MangaBot as a suggestion if it isn't already there
    const bot = S().botProfile();
    if (!list.some(u => u.id === bot.id)) list = [bot].concat(list);
    return list.slice(0, 12);
  }
  function suggestedRowHTML() {
    const users = suggestedUsers();
    if (!users.length) return "";
    return `<div class="suggest-row" id="suggestRow" aria-label="Suggested users">
      <div class="suggest-head"><i data-lucide="user-plus"></i> Suggested for you</div>
      <div class="suggest-scroll">
        ${users.map(u => `
          <div class="suggest-card" data-uid="${esc(u.id)}">
            <a href="#/u/${encodeURIComponent(u.username)}" data-link class="suggest-av">${avatarImg(u)}</a>
            <a href="#/u/${encodeURIComponent(u.username)}" data-link class="suggest-name">${esc(u.displayName || u.username)}${verifiedTick(u)}</a>
            <span class="suggest-handle">@${esc(u.username)}</span>
            ${u.bot
              ? `<a class="btn btn-sm btn-primary suggest-follow" href="#/u/${encodeURIComponent(u.username)}" data-link>Chat</a>`
              : `<button class="btn btn-sm btn-primary suggest-follow" data-follow="${esc(u.id)}">Follow</button>`}
          </div>`).join("")}
      </div>
    </div>`;
  }
  // Filter/sort posts for the active feed tab.
  function feedPostsFor(tab) {
    const me = Auth.current();
    const all = S().posts();
    if (tab === "following") {
      const following = (me && me.following) || [];
      return all.filter(p => {
        const a = S().resolveAuthor(p.author);
        return a && following.includes(a.id);
      });
    }
    if (tab === "trending") {
      // rank by engagement (reactions + likes + comments), newest as tiebreak
      const score = p =>
        (p.likes || 0) +
        (p.reactions ? Object.values(p.reactions).reduce((n, arr) => n + (arr ? arr.length : 0), 0) : 0) +
        (p.comments ? p.comments.length : 0);
      return all.slice().sort((a, b) => (score(b) - score(a)) || (b.at - a.at));
    }
    return all; // for you = everything, newest first (already sorted)
  }
  function renderFeedList(tab) {
    const list = $("#feedList");
    if (!list) return;
    const posts = feedPostsFor(tab);
    if (posts.length) { list.innerHTML = posts.map(postCard).join(""); }
    else {
      const msg = tab === "following"
        ? { h: "No posts from people you follow", p: "Follow some readers to see their posts here." }
        : { h: "No posts yet", p: "Be the first to share something." };
      list.innerHTML = `<div class="empty-state"><i data-lucide="rss"></i><h3>${msg.h}</h3><p>${msg.p}</p><a class="btn btn-primary" href="#/post" data-link>Create a post</a></div>`;
    }
    icons();
  }
  function viewFeed() {
    const me = Auth.current();
    app.innerHTML = `
      <section class="page feed-page">
        <div class="page-head feed-head">
          <h1><i data-lucide="rss"></i> Feed</h1>
          <p>See what the community is reading and building.</p>
        </div>
        <div class="composer-card" id="quickComposer">
          ${me ? avatarImg(me) : `<span class="avatar-img"></span>`}
          <button class="composer-open" id="composerOpen">${me ? "Share an update…" : "Sign in to share an update…"}</button>
          <div class="composer-actions">
            <a href="#/post" data-link class="ca"><i data-lucide="pen-line"></i> Post</a>
            <a href="#/post" data-link class="ca"><i data-lucide="image"></i> Image</a>
            <a href="#/post" data-link class="ca ca-create">Create</a>
          </div>
        </div>
        ${suggestedRowHTML()}
        <div class="pill-tabs feed-tabs" id="feedTabs" role="tablist">
          <button class="pill-tab" data-ftab="following">Following</button>
          <button class="pill-tab" data-ftab="trending">Trending</button>
          <button class="pill-tab" data-ftab="foryou">For You</button>
        </div>
        <div class="feed-list" id="feedList"></div>
      </section>`;
    // set the active pill + render its posts
    const setTab = (t) => {
      FEED_TAB = t;
      $$("#feedTabs .pill-tab").forEach(b => b.classList.toggle("active", b.getAttribute("data-ftab") === t));
      renderFeedList(t);
    };
    afterRender();
    setTab(FEED_TAB);
    // pill tab switching
    const tabs = $("#feedTabs");
    if (tabs) tabs.addEventListener("click", e => {
      const b = e.target.closest("[data-ftab]"); if (!b) return;
      setTab(b.getAttribute("data-ftab"));
    });
    // follow buttons inside the suggested-users strip
    const srow = $("#suggestRow");
    if (srow) srow.addEventListener("click", e => {
      const fb = e.target.closest("[data-follow]"); if (!fb) return;
      if (!requireAuth("Sign in to follow people.")) return;
      const now = Auth.toggleFollow(fb.getAttribute("data-follow"));
      fb.textContent = now ? "Following" : "Follow";
      fb.classList.toggle("following", now);
    });
    wireFeed();
  }

  function wireFeed(container) {
    const openC = $("#composerOpen");
    if (openC) openC.addEventListener("click", () => {
      if (!Auth.isLoggedIn()) { openAuth("login"); return; }
      location.hash = "#/post";
    });
    // delegated interactions inside the feed list
    const list = container || $("#feedList") || app;
    list.addEventListener("click", (e) => {
      const likeBtn = e.target.closest("[data-like]");
      if (likeBtn) {
        if (!requireAuth("Sign in to like posts.")) return;
        const r = S().toggleLike(likeBtn.getAttribute("data-like"));
        if (r) {
          likeBtn.classList.toggle("liked", r.liked);
          likeBtn.querySelector("span").textContent = r.likes;
        }
        return;
      }
      // open the emoji reaction picker
      const reactBtn = e.target.closest("[data-react]");
      if (reactBtn) {
        if (!requireAuth("Sign in to react.")) return;
        openReactionPicker(reactBtn, reactBtn.getAttribute("data-react"), list);
        return;
      }
      // toggle an existing reaction pill
      const pill = e.target.closest("[data-reactpill]");
      if (pill) {
        if (!requireAuth("Sign in to react.")) return;
        const id = pill.getAttribute("data-reactpill");
        S().toggleReaction(id, pill.getAttribute("data-rk"));
        rerenderReactions(id, list);
        return;
      }
      const delBtn = e.target.closest("[data-del]");
      if (delBtn) {
        if (S().deletePost(delBtn.getAttribute("data-del"))) {
          const card = delBtn.closest(".post-card"); if (card) card.remove();
          toast("Post deleted.", "info");
        }
        return;
      }
      const cmtBtn = e.target.closest("[data-cmt]");
      if (cmtBtn) {
        const box = list.querySelector(`[data-comments="${cmtBtn.getAttribute("data-cmt")}"] .cmt-input`);
        if (box) box.focus();
        return;
      }
      if (e.target.closest("[data-signin]")) { e.preventDefault(); openAuth("login"); }
    });
    // image comment upload
    list.addEventListener("change", async (e) => {
      const imgInp = e.target.closest("[data-cmtimg]");
      if (!imgInp) return;
      if (!requireAuth("Sign in to comment.")) return;
      const f = e.target.files[0]; if (!f) return;
      try {
        const img = await S().processCommentImage(f);
        const id = imgInp.getAttribute("data-cmtimg");
        const c = S().addComment(id, "", { type: "image", url: img });
        if (c) { appendComment(id, c, list); refreshNotifBadge(); }
      } catch (ex) { toast(ex.message || "Couldn't attach image.", "error"); }
      e.target.value = "";
    });
    // submit a comment on Enter
    list.addEventListener("keydown", (e) => {
      const inp = e.target.closest("[data-cmtinput]");
      if (inp && e.key === "Enter") {
        if (!requireAuth("Sign in to comment.")) return;
        const id = inp.getAttribute("data-cmtinput");
        const c = S().addComment(id, inp.value);
        if (c) { inp.value = ""; appendComment(id, c, list); refreshNotifBadge(); }
      }
    });
  }
  function appendComment(id, c, list) {
    const wrap = list.querySelector(`[data-comments="${id}"]`);
    if (!wrap) return;
    const anchor = wrap.querySelector(".add-comment") || wrap.querySelector(".add-comment-cta");
    anchor.insertAdjacentHTML("beforebegin", commentRow(c));
    const cnt = list.querySelector(`[data-cmt="${id}"] span`);
    if (cnt) cnt.textContent = parseInt(cnt.textContent || "0", 10) + 1;
    icons();
  }
  function rerenderReactions(id, list) {
    const p = S().getPost(id);
    const bar = list.querySelector(`[data-reactbar="${id}"]`);
    if (p && bar) { bar.outerHTML = reactionBar(p); icons(); }
  }
  // Floating emoji picker anchored to the react button
  function openReactionPicker(anchorBtn, postId, list) {
    document.querySelectorAll(".react-picker").forEach(x => x.remove());
    const pick = document.createElement("div");
    pick.className = "react-picker";
    pick.innerHTML = S().REACTIONS.map(r => `<button data-pk="${r.key}" title="${r.label}">${r.emoji}</button>`).join("");
    document.body.appendChild(pick);
    const rect = anchorBtn.getBoundingClientRect();
    pick.style.top = (window.scrollY + rect.top - 52) + "px";
    pick.style.left = (window.scrollX + rect.left) + "px";
    pick.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-pk]"); if (!b) return;
      S().toggleReaction(postId, b.getAttribute("data-pk"));
      rerenderReactions(postId, list || $("#feedList") || app);
      refreshNotifBadge();
      pick.remove();
    });
    setTimeout(() => {
      const off = (ev) => { if (!pick.contains(ev.target)) { pick.remove(); document.removeEventListener("click", off); } };
      document.addEventListener("click", off);
    }, 0);
  }

  /* ---------------- POST COMPOSER ---------------- */
  function viewComposer() {
    if (!requireAuth("Sign in to create a post.")) { viewFeed(); return; }
    const me = Auth.current();
    app.innerHTML = `
      <section class="page composer-page">
        <div class="composer-topbar">
          <a class="icon-btn" href="#/feed" data-link><i data-lucide="arrow-left"></i></a>
          <h1>Create post</h1>
          <button class="btn btn-primary btn-sm" id="publishBtn"><i data-lucide="send"></i> Post</button>
        </div>
        <div class="composer-main">
          <div class="composer-who">${avatarImg(me)}<div><strong>${esc(me.displayName || me.username)}</strong><span>@${esc(me.username)}</span></div></div>
          <textarea id="postText" class="post-textarea" placeholder="What's on your mind? Share a manga, a build, an update…" maxlength="1000"></textarea>
          <div class="composer-preview" id="mediaPreview"></div>
          <div class="composer-toolbar">
            <label class="tool-btn"><i data-lucide="image"></i> Image
              <input type="file" id="imgInput" accept="image/*" hidden />
            </label>
            <label class="tool-btn"><i data-lucide="video"></i> Video
              <input type="file" id="vidInput" accept="video/*" hidden />
            </label>
            <button class="tool-btn tool-clear" id="clearMedia" hidden><i data-lucide="x"></i> Remove media</button>
            <span class="char-count" id="charCount">0/1000</span>
          </div>
          <div class="form-error" id="postError"></div>
        </div>
      </section>`;
    afterRender();

    let media = null;
    const preview = $("#mediaPreview");
    const clearBtn = $("#clearMedia");
    const err = $("#postError");
    const textEl = $("#postText");
    const count = $("#charCount");
    textEl.addEventListener("input", () => { count.textContent = textEl.value.length + "/1000"; });

    async function handleFile(file) {
      if (!file) return;
      err.textContent = "";
      preview.innerHTML = `<div class="preview-loading"><i data-lucide="loader"></i> Processing…</div>`;
      icons();
      try {
        media = await S().processMedia(file);
        preview.innerHTML = mediaHTML(media);
        clearBtn.hidden = false;
        icons();
      } catch (ex) {
        media = null; preview.innerHTML = "";
        err.textContent = ex.message || "Couldn't process that file.";
      }
    }
    $("#imgInput").addEventListener("change", (e) => handleFile(e.target.files[0]));
    $("#vidInput").addEventListener("change", (e) => handleFile(e.target.files[0]));
    clearBtn.addEventListener("click", () => { media = null; preview.innerHTML = ""; clearBtn.hidden = true; });

    $("#publishBtn").addEventListener("click", () => {
      err.textContent = "";
      try {
        S().createPost({ text: textEl.value, media });
        toast("Posted! 🎉", "success");
        location.hash = "#/feed";
      } catch (ex) {
        err.textContent = ex.message || "Couldn't publish. Try again.";
      }
    });
    // Random manga
    if ($("#detailRandomBtn")) $("#detailRandomBtn").addEventListener("click", async () => {
      try {
        const items = await window.MangaSource.list({ limit: 50 });
        if (items.length) {
          const pick = items[Math.floor(Math.random() * items.length)];
          location.hash = "#/manga/" + encodeURIComponent(pick.id);
        }
      } catch (e) { toast("Couldn't load random manga.", "error"); }
    });
    // Share
    if ($("#detailShareBtn")) $("#detailShareBtn").addEventListener("click", () => {
      const url = window.location.origin + window.location.pathname + "#/manga/" + encodeURIComponent(m.id);
      if (navigator.share) { navigator.share({ title: m.title, url }).catch(() => {}); }
      else { navigator.clipboard.writeText(url).then(() => toast("Link copied!", "success")).catch(() => {}); }
    });
  }

  /* ---------------- CHAT INBOX (real users + groups) ---------------- */
  function viewChat() {
    if (!requireAuth("Sign in to use chat.")) { viewHome(); return; }
    const convos = S().conversations();
    app.innerHTML = `
      <section class="page chat-inbox">
        <div class="chat-topbar">
          <div class="chat-topbar-left"><a class="icon-btn" href="#/" data-link><i data-lucide="arrow-left"></i></a><h1>Messages</h1></div>
          <button class="chat-new" id="newChatBtn"><i data-lucide="plus"></i> New</button>
        </div>
        <div class="chat-search"><i data-lucide="search"></i><input type="text" id="convSearch" placeholder="Search conversations…" /></div>
        <div class="conv-list" id="convList">
          ${convos.length ? convos.map(convRow).join("") :
            `<div class="empty-state"><i data-lucide="message-circle"></i><h3>No conversations yet</h3><p>Start a chat with another registered user, or create a group.</p><button class="btn btn-primary" id="newChatEmpty"><i data-lucide="plus"></i> New chat</button></div>`}
        </div>
      </section>`;
    afterRender();
    const search = $("#convSearch");
    if (search) search.addEventListener("input", () => {
      const q = search.value.toLowerCase();
      $$("#convList .conv-row").forEach(r => {
        r.style.display = r.getAttribute("data-name").includes(q) ? "" : "none";
      });
    });
    if ($("#newChatBtn")) $("#newChatBtn").addEventListener("click", openNewChat);
    if ($("#newChatEmpty")) $("#newChatEmpty").addEventListener("click", openNewChat);
  }
  function convRow(c) {
    const d = S().convDisplay(c);
    const last = c.messages[c.messages.length - 1];
    const preview = last ? (last.text || (last.media ? "📎 Attachment" : "")) : (d.group ? "Group created" : "Say hi 👋");
    const avatar = d.group
      ? `<span class="avatar-img group-av"><i data-lucide="users"></i></span>`
      : avatarImg(d.peer);
    return `<a class="conv-row" href="#/dm/${encodeURIComponent(c.id)}" data-link data-name="${esc((d.title || "").toLowerCase())}">
      ${avatar}
      <div class="conv-info">
        <div class="conv-top"><span class="conv-name">${esc(d.title)}</span>${d.group ? `<span class="group-tag">Group</span>` : verifiedTick(d.peer)}<span class="conv-time">${last ? timeAgo(last.at) : "now"}</span></div>
        <div class="conv-preview">${esc(preview)}</div>
      </div>
    </a>`;
  }

  // New-chat modal: pick a registered user for a 1:1, or several for a group.
  function openNewChat() {
    const me = Auth.current();
    // Include MangaBot as a chat-able "user" (top of the list) so anyone can
    // DM it directly, plus every other real registered account.
    const bot = S().botProfile();
    const others = [bot].concat(Auth.allUsers().filter(u => u.id !== me.id && u.id !== bot.id));
    let overlay = document.getElementById("newChatModal");
    if (overlay) overlay.remove();
    overlay = document.createElement("div");
    overlay.className = "modal-overlay open";
    overlay.id = "newChatModal";
    overlay.innerHTML = `
      <div class="modal newchat-card" role="dialog" aria-modal="true">
        <button class="modal-close" id="ncClose"><i data-lucide="x"></i></button>
        <h2>New chat</h2>
        <p class="auth-sub">Chat with a registered user, or select several and make a group.</p>
        <label class="group-name-field" id="grpNameField" hidden>Group name<input type="text" id="ncGroupName" placeholder="e.g. Manga Buddies" maxlength="40" /></label>
        <input type="text" id="ncSearch" class="nc-search" placeholder="Search people…" />
        <div class="nc-list" id="ncList">
          ${others.length ? others.map(u => `
            <label class="nc-row" data-name="${esc((u.displayName || u.username).toLowerCase())}">
              <input type="checkbox" class="nc-pick" value="${esc(u.id)}" />
              ${avatarImg(u)}
              <div class="nc-id"><strong>${esc(u.displayName || u.username)}</strong><span>@${esc(u.username)}</span></div>
            </label>`).join("") :
            `<p class="muted">No other registered users yet. Ask a friend to sign up in this browser, or use another account.</p>`}
        </div>
        <div class="form-error" id="ncError"></div>
        <button class="btn btn-primary btn-block" id="ncStart"><i data-lucide="message-circle"></i> Start chat</button>
      </div>`;
    document.body.appendChild(overlay);
    icons();
    const close = () => overlay.remove();
    $("#ncClose").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    const picks = () => $$(".nc-pick").filter(c => c.checked).map(c => c.value);
    const syncMode = () => {
      const n = picks().length;
      $("#grpNameField").hidden = n < 2;
      $("#ncStart").innerHTML = n >= 2
        ? `<i data-lucide="users"></i> Create group (${n})`
        : `<i data-lucide="message-circle"></i> Start chat`;
      icons();
    };
    overlay.addEventListener("change", (e) => { if (e.target.classList.contains("nc-pick")) syncMode(); });
    $("#ncSearch").addEventListener("input", () => {
      const q = $("#ncSearch").value.toLowerCase();
      $$("#ncList .nc-row").forEach(r => { r.style.display = r.getAttribute("data-name").includes(q) ? "" : "none"; });
    });
    $("#ncStart").addEventListener("click", () => {
      const chosen = picks();
      const err = $("#ncError");
      err.textContent = "";
      try {
        if (chosen.length === 0) { err.textContent = "Pick at least one person."; return; }
        let conv;
        if (chosen.length === 1) conv = S().openConversation(chosen[0]);
        else conv = S().createGroup($("#ncGroupName").value || "New group", chosen);
        close();
        location.hash = "#/dm/" + encodeURIComponent(conv.id);
      } catch (ex) { err.textContent = ex.message || "Couldn't start chat."; }
    });
  }

  /* ---------------- DM / GROUP THREAD ---------------- */
  let DM_CLEANUP = null;
  function viewDM(convId) {
    if (!requireAuth("Sign in to chat.")) { viewHome(); return; }
    const conv = S().getConversation(convId);
    if (!conv) { toast("Conversation not found.", "error"); location.hash = "#/chat"; return; }
    const me = Auth.current();
    const d = S().convDisplay(conv);
    const isGroup = d.group;
    const isOwner = isGroup && conv.owner === me.id;

    const headAvatar = isGroup
      ? `<span class="avatar-img sm group-av"><i data-lucide="users"></i></span>`
      : `<a href="#/u/${encodeURIComponent(d.peer.username)}" data-link>${avatarImg(d.peer, "sm")}</a>`;
    const headTitle = isGroup
      ? `<span class="dm-name">${esc(d.title)}</span><span class="dm-status">${(conv.members || []).length} members</span>`
      : `<a class="dm-name" href="#/u/${encodeURIComponent(d.peer.username)}" data-link>${esc(d.title)}</a><span class="dm-status">Tap name to view profile</span>`;

    app.innerHTML = `
      <section class="page dm-page">
        <div class="dm-topbar">
          <a class="icon-btn" href="#/chat" data-link><i data-lucide="arrow-left"></i></a>
          ${headAvatar}
          <div class="dm-peer">${headTitle}</div>
          <button class="icon-btn" id="dmSearchBtn" title="Search in conversation"><i data-lucide="search"></i></button>
          ${isGroup ? `<button class="icon-btn" id="grpInfoBtn" title="Group members"><i data-lucide="users"></i></button>` : ""}
          ${isOwner ? `<button class="icon-btn" id="grpAddBtn" title="Add members"><i data-lucide="user-plus"></i></button>` : ""}
        </div>
        <div class="dm-searchbar" id="dmSearchBar" hidden>
          <i data-lucide="search"></i>
          <input type="text" id="dmSearchInput" placeholder="Search messages…" autocomplete="off" />
          <span class="dm-search-count" id="dmSearchCount"></span>
          <button class="icon-btn" id="dmSearchClose" title="Close"><i data-lucide="x"></i></button>
        </div>
        <div class="dm-thread" id="dmThread"></div>
        <div class="dm-typing" id="dmTyping" hidden></div>
        <div class="dm-reply-bar" id="dmReplyBar" hidden></div>
        <form class="dm-composer" id="dmComposer">
          <label class="dm-media-btn"><i data-lucide="image"></i><input type="file" id="dmFile" accept="image/*,video/*" hidden /></label>
          <input type="text" id="dmInput" class="dm-input" placeholder="Message…" autocomplete="off" />
          <button type="submit" class="dm-send" aria-label="Send"><i data-lucide="send"></i></button>
        </form>
      </section>`;
    afterRender();

    const CHAT_EMOJI = ["👍", "❤️", "😂", "🔥", "😮", "😢"];
    let replyingTo = null;      // message id we're replying to (or null)
    let searchIds = null;       // array of matching msg ids, or null = no search

    function statusIcon(st) {
      if (st === "read") return `<span class="msg-status read" title="Read"><i data-lucide="check-check"></i></span>`;
      if (st === "delivered") return `<span class="msg-status" title="Delivered"><i data-lucide="check-check"></i></span>`;
      if (st === "sent") return `<span class="msg-status" title="Sent"><i data-lucide="check"></i></span>`;
      return "";
    }
    function msgReactionsHTML(m) {
      const rc = S().messageReactionCounts(m);
      if (!rc.length) return "";
      return `<div class="msg-reacts">${rc.map(r => `<button class="msg-react-pill ${r.mine ? "on" : ""}" data-mreact="${esc(m.id)}" data-emoji="${esc(r.emoji)}">${r.emoji} ${r.count}</button>`).join("")}</div>`;
    }

    // highlight the search query within a plain (already-escaped) text run
    function highlight(escText) {
      const q = ($("#dmSearchInput") && $("#dmSearchInput").value || "").trim();
      if (!q || searchIds === null) return escText;
      try {
        const re = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
        return escText.replace(re, '<mark class="msg-hl">$1</mark>');
      } catch (e) { return escText; }
    }

    function renderThread() {
      const t = $("#dmThread");
      if (!t) return;
      const c = S().getConversation(convId);
      if (!c) return;
      // mark incoming messages as read whenever the thread is (re)rendered
      S().markConversationRead(convId);
      const lastOwnId = S().lastOwnMessageId(c);
      const searching = searchIds !== null;
      t.innerHTML = c.messages.map(m => {
        // when a search is active, hide non-matching messages
        if (searching && !searchIds.includes(m.id)) return "";
        const isBot = m.from === S().botId();
        const mine = m.from === me.id;
        const sender = mine ? me : S().resolveAuthor(m.from);
        const st = mine ? S().messageStatus(c, m) : null;
        if (m.deleted) {
          return `<div class="bubble-row ${mine ? "mine" : "theirs"}" data-mid="${esc(m.id)}">
            ${!mine ? `<a href="#/u/${encodeURIComponent(sender.username)}" data-link>${avatarImg(sender, "xs")}</a>` : ""}
            <div class="bubble-wrap"><div class="bubble bubble-deleted"><i data-lucide="ban"></i> <em>message deleted</em></div></div>
          </div>`;
        }
        // 'seen by' avatars: under MY most recent (non-deleted) message — for
        // BOTH group threads and 1:1 DMs. Tap to open the full read-receipt list.
        let seenHTML = "";
        if (mine && m.id === lastOwnId) {
          const seers = S().seenByForMessage(c, m);
          if (seers.length) {
            seenHTML = `<div class="seen-by" data-seen="${esc(m.id)}" role="button" title="Seen by — tap for details">${seers.slice(0, 5).map(u => avatarImg(u, "seen")).join("")}` +
              `${seers.length > 5 ? `<span class="seen-more">+${seers.length - 5}</span>` : ""}` +
              `<span class="seen-lbl">Seen</span></div>`;
          }
        }
        // quoted reply preview (if this message is a reply)
        let replyHTML = "";
        if (m.replyTo) {
          replyHTML = `<button class="bubble-quote" data-jump="${esc(m.replyTo.id)}">
            <span class="quote-name">${esc(m.replyTo.name || "message")}</span>
            <span class="quote-text">${esc((m.replyTo.text || "").slice(0, 90))}</span>
          </button>`;
        }
        const textHTML = m.text ? `<span class="bubble-text">${highlight(esc(m.text))}</span>` : "";
        return `<div class="bubble-row ${mine ? "mine" : "theirs"}${isBot ? " bot" : ""}" data-mid="${esc(m.id)}">
          ${!mine ? `${isBot ? `<span class="bubble-av">${avatarImg(sender, "xs")}</span>` : `<a href="#/u/${encodeURIComponent(sender.username)}" data-link>${avatarImg(sender, "xs")}</a>`}` : ""}
          <div class="bubble-wrap">
            <div class="bubble ${mine ? "bubble-mine" : (isBot ? "bubble-bot" : "bubble-theirs")}">
              ${((isGroup && !mine) || isBot) ? `<span class="bubble-sender">${esc(sender.displayName || sender.username)}${isBot ? ` <span class="bot-tag">BOT</span>` : ""}</span>` : ""}
              ${replyHTML}
              ${m.media ? mediaHTML(m.media) : ""}
              ${textHTML}
              ${botRefsHTML(m.refs)}
              <span class="bubble-time">${m.edited ? `<span class="edited-lbl">edited</span> · ` : ""}${new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${mine ? statusIcon(st) : ""}</span>
              <button class="bubble-react-btn" data-mreactbtn="${esc(m.id)}" title="React"><i data-lucide="smile-plus"></i></button>
              <button class="bubble-reply-btn" data-mreply="${esc(m.id)}" title="Reply"><i data-lucide="reply"></i></button>
              ${mine ? `<button class="bubble-menu-btn" data-mmenu="${esc(m.id)}" title="More"><i data-lucide="more-horizontal"></i></button>` : ""}
            </div>
            ${msgReactionsHTML(m)}
            ${seenHTML}
          </div>
        </div>`;
      }).join("") || `<div class="dm-empty">${searching ? "No messages match your search." : "No messages yet — say hi 👋"}</div>`;
      icons();
      if (!searching) t.scrollTop = t.scrollHeight;
    }
    renderThread();

    function renderTyping() {
      const el = $("#dmTyping");
      if (!el) return;
      const typers = S().typingMembers(convId);
      if (!typers.length) { el.hidden = true; el.innerHTML = ""; return; }
      const names = typers.map(t => esc(t.displayName || t.username)).join(", ");
      el.hidden = false;
      el.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span> ${names} ${typers.length > 1 ? "are" : "is"} typing…`;
    }

    // Per-message reaction picker
    function openMsgReactPicker(anchorBtn, msgId) {
      document.querySelectorAll(".react-picker").forEach(x => x.remove());
      const pick = document.createElement("div");
      pick.className = "react-picker";
      pick.innerHTML = CHAT_EMOJI.map(e => `<button data-me="${e}">${e}</button>`).join("");
      document.body.appendChild(pick);
      const rect = anchorBtn.getBoundingClientRect();
      pick.style.top = (window.scrollY + rect.top - 52) + "px";
      pick.style.left = (window.scrollX + Math.max(8, rect.left - 40)) + "px";
      pick.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-me]"); if (!b) return;
        S().toggleMessageReaction(convId, msgId, b.getAttribute("data-me"));
        renderThread(); pick.remove();
      });
      setTimeout(() => {
        const off = (ev) => { if (!pick.contains(ev.target)) { pick.remove(); document.removeEventListener("click", off); } };
        document.addEventListener("click", off);
      }, 0);
    }

    // Action menu (edit / delete) for MY messages.
    function openMsgMenu(anchorBtn, msgId) {
      document.querySelectorAll(".msg-menu").forEach(x => x.remove());
      const menu = document.createElement("div");
      menu.className = "msg-menu";
      menu.innerHTML =
        `<button data-act="edit"><i data-lucide="pencil"></i> Edit</button>` +
        `<button data-act="delete" class="danger"><i data-lucide="trash-2"></i> Delete</button>`;
      document.body.appendChild(menu);
      if (window.lucide) window.lucide.createIcons();
      const rect = anchorBtn.getBoundingClientRect();
      menu.style.top = (window.scrollY + rect.bottom + 4) + "px";
      menu.style.left = (window.scrollX + Math.max(8, rect.right - 150)) + "px";
      menu.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-act]"); if (!b) return;
        const act = b.getAttribute("data-act");
        menu.remove();
        if (act === "edit") startInlineEdit(msgId);
        else if (act === "delete") {
          try { if (S().deleteMessage(convId, msgId)) { renderThread(); } }
          catch (ex) { toast(ex.message || "Couldn't delete.", "error"); }
        }
      });
      setTimeout(() => {
        const off = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("click", off); } };
        document.addEventListener("click", off);
      }, 0);
    }
    // Inline edit: replace the bubble text with an input + save/cancel.
    function startInlineEdit(msgId) {
      const conv = S().getConversation(convId);
      const m = conv && (conv.messages || []).find(x => x.id === msgId);
      if (!m) return;
      const row = $(`#dmThread .bubble-row[data-mid="${CSS.escape(msgId)}"]`);
      const bubble = row && row.querySelector(".bubble");
      if (!bubble) return;
      bubble.innerHTML = `<div class="edit-box">
        <input type="text" class="edit-input" value="${esc(m.text || "")}" />
        <div class="edit-actions">
          <button class="btn btn-primary btn-sm edit-save">Save</button>
          <button class="btn btn-ghost btn-sm edit-cancel">Cancel</button>
        </div></div>`;
      const inp = bubble.querySelector(".edit-input");
      inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
      const save = () => {
        try { S().editMessage(convId, msgId, inp.value); renderThread(); }
        catch (ex) { toast(ex.message || "Couldn't edit.", "error"); renderThread(); }
      };
      bubble.querySelector(".edit-save").addEventListener("click", save);
      bubble.querySelector(".edit-cancel").addEventListener("click", renderThread);
      inp.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); save(); }
        else if (ev.key === "Escape") renderThread();
      });
    }

    // Full read-receipt list modal (works for DMs and groups).
    function openReceipts(msgId) {
      const c = S().getConversation(convId);
      const m = c && (c.messages || []).find(x => x.id === msgId);
      if (!m) return;
      const rows = S().readReceipts(c, m);
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay open";
      overlay.innerHTML = `
        <div class="modal receipts-card" role="dialog" aria-modal="true">
          <button class="modal-close" id="rcClose"><i data-lucide="x"></i></button>
          <h2><i data-lucide="check-check"></i> Read receipts</h2>
          <div class="nc-list">
            ${rows.length ? rows.map(r => `
              <div class="receipt-row">
                ${avatarImg(r.user, "sm")}
                <div class="nc-id"><strong>${esc(r.user.displayName || r.user.username)}${r.isMe ? " (you)" : ""}</strong><span>@${esc(r.user.username)}</span></div>
                <span class="receipt-state ${r.read ? "read" : ""}">${r.read ? `<i data-lucide="check-check"></i> Read` : `<i data-lucide="check"></i> Delivered`}</span>
              </div>`).join("") : `<p class="muted">No other members to show.</p>`}
          </div>
        </div>`;
      document.body.appendChild(overlay);
      icons();
      const close = () => overlay.remove();
      overlay.querySelector("#rcClose").addEventListener("click", close);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    }

    // Reply bar (shows what you're replying to; X to cancel).
    function renderReplyBar() {
      const bar = $("#dmReplyBar");
      if (!bar) return;
      if (!replyingTo) { bar.hidden = true; bar.innerHTML = ""; return; }
      const c = S().getConversation(convId);
      const m = c && (c.messages || []).find(x => x.id === replyingTo);
      if (!m) { replyingTo = null; bar.hidden = true; bar.innerHTML = ""; return; }
      const who = m.from === me.id ? "yourself" : (S().resolveAuthor(m.from).displayName || S().resolveAuthor(m.from).username);
      const prev = m.deleted ? "message deleted" : (m.text || (m.media ? "📎 Attachment" : ""));
      bar.hidden = false;
      bar.innerHTML = `<div class="reply-preview"><i data-lucide="reply"></i>
        <div class="reply-preview-txt"><strong>Replying to ${esc(who)}</strong><span>${esc(prev.slice(0, 100))}</span></div>
        <button class="icon-btn" id="dmReplyCancel" title="Cancel"><i data-lucide="x"></i></button></div>`;
      icons();
      $("#dmReplyCancel").addEventListener("click", () => { replyingTo = null; renderReplyBar(); $("#dmInput").focus(); });
    }

    // Scroll to a message and flash it (tap on a quote).
    function jumpToMessage(mid) {
      const row = $(`#dmThread .bubble-row[data-mid="${CSS.escape(mid)}"]`);
      if (!row) return;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("flash");
      setTimeout(() => row.classList.remove("flash"), 1200);
    }

    // delegated clicks in the thread: open picker / toggle a reaction pill / menu / reply / quote-jump / receipts
    $("#dmThread").addEventListener("click", (e) => {
      const seen = e.target.closest("[data-seen]");
      if (seen) { openReceipts(seen.getAttribute("data-seen")); return; }
      const jump = e.target.closest("[data-jump]");
      if (jump) { jumpToMessage(jump.getAttribute("data-jump")); return; }
      const rp = e.target.closest("[data-mreply]");
      if (rp) { replyingTo = rp.getAttribute("data-mreply"); renderReplyBar(); $("#dmInput").focus(); return; }
      const mm = e.target.closest("[data-mmenu]");
      if (mm) { e.stopPropagation(); openMsgMenu(mm, mm.getAttribute("data-mmenu")); return; }
      const rb = e.target.closest("[data-mreactbtn]");
      if (rb) { openMsgReactPicker(rb, rb.getAttribute("data-mreactbtn")); return; }
      const pill = e.target.closest("[data-mreact]");
      if (pill) { S().toggleMessageReaction(convId, pill.getAttribute("data-mreact"), pill.getAttribute("data-emoji")); renderThread(); }
    });

    // In-thread search: toggle bar, filter + highlight as you type.
    if ($("#dmSearchBtn")) $("#dmSearchBtn").addEventListener("click", () => {
      const bar = $("#dmSearchBar");
      bar.hidden = !bar.hidden;
      if (!bar.hidden) { $("#dmSearchInput").focus(); }
      else { searchIds = null; $("#dmSearchInput").value = ""; $("#dmSearchCount").textContent = ""; renderThread(); }
    });
    if ($("#dmSearchClose")) $("#dmSearchClose").addEventListener("click", () => {
      $("#dmSearchBar").hidden = true; searchIds = null; $("#dmSearchInput").value = ""; $("#dmSearchCount").textContent = ""; renderThread();
    });
    if ($("#dmSearchInput")) $("#dmSearchInput").addEventListener("input", () => {
      const q = $("#dmSearchInput").value.trim();
      searchIds = q ? S().searchMessages(convId, q) : null;
      $("#dmSearchCount").textContent = q ? (searchIds.length + " found") : "";
      renderThread();
    });
    // long-press on a bubble (mobile) opens the menu for my own messages
    let lpTimer = null;
    // swipe-to-reply (mobile): swipe a message bubble sideways to reply to it.
    let swRow = null, swX = 0, swY = 0, swMid = null, swiped = false;
    $("#dmThread").addEventListener("touchstart", (e) => {
      // long-press menu (own messages only)
      const mineRow = e.target.closest(".bubble-row.mine");
      if (mineRow) {
        const mid = mineRow.getAttribute("data-mid");
        const btn = mineRow.querySelector("[data-mmenu]");
        lpTimer = setTimeout(() => { if (btn) openMsgMenu(btn, mid); }, 480);
      }
      // swipe-to-reply tracking (any non-deleted bubble)
      if (window.innerWidth <= 720 && e.touches.length === 1) {
        const row = e.target.closest(".bubble-row");
        if (row && !row.querySelector(".bubble-deleted")) {
          swRow = row; swMid = row.getAttribute("data-mid");
          swX = e.touches[0].clientX; swY = e.touches[0].clientY; swiped = false;
        }
      }
    }, { passive: true });
    $("#dmThread").addEventListener("touchmove", (e) => {
      if (!swRow || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - swX;
      const dy = Math.abs(e.touches[0].clientY - swY);
      if (dy > 24) { swRow.style.transform = ""; swRow = null; return; } // vertical scroll wins
      const shift = Math.max(-70, Math.min(70, dx));
      if (Math.abs(shift) > 8) {
        swRow.style.transform = `translateX(${shift}px)`;
        swRow.classList.add("swiping");
        if (Math.abs(shift) >= 48) swiped = true;
      }
    }, { passive: true });
    const endSwipe = () => {
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
      if (swRow) {
        swRow.style.transition = "transform .18s ease";
        swRow.style.transform = "";
        const rowRef = swRow;
        setTimeout(() => { if (rowRef) { rowRef.style.transition = ""; rowRef.classList.remove("swiping"); } }, 200);
        if (swiped && swMid) { replyingTo = swMid; renderReplyBar(); $("#dmInput").focus(); }
      }
      swRow = null; swMid = null; swiped = false;
    };
    ["touchend", "touchcancel"].forEach(ev =>
      $("#dmThread").addEventListener(ev, endSwipe, { passive: true }));

    let pendingMedia = null;
    $("#dmFile").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { pendingMedia = await S().processMedia(f); toast("Attachment ready — hit send.", "info"); }
      catch (ex) { toast(ex.message || "Couldn't attach that file.", "error"); }
    });

    // typing indicator: flag myself typing while I type (auto-clears after 3s idle)
    let typingTimer = null;
    $("#dmInput").addEventListener("input", () => {
      S().setTyping(convId, true);
      if (typingTimer) clearTimeout(typingTimer);
      typingTimer = setTimeout(() => S().setTyping(convId, false), 3000);
    });

    // Ask MangaBot to reply in this conversation (async). Shows a brief typing
    // shimmer, then posts the bot's answer and re-renders.
    async function maybeBotReply(text) {
      const c = S().getConversation(convId);
      if (!c) return;
      // Bot replies in ANY conversation it's a member of. In a 1:1 DM with the
      // bot, EVERY message gets a reply; in groups it must be triggered
      // (a slash command or an @bot / @mangabot mention).
      if (!(c.members || []).includes(S().botId())) return;
      const isBotDM = S().isBotDM(c);
      if (!isBotDM && !S()._botTriggered(text)) return;
      // show the bot "typing" briefly for a natural feel
      const el = $("#dmTyping");
      if (el) { el.hidden = false; el.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span> MangaBot is typing…`; }
      try {
        const reply = await S()._botReply(text);
        S()._botSay(convId, reply);
      } catch (e) { S()._botSay(convId, "🤖 Sorry, I hit an error. Try /help."); }
      if (el) { el.hidden = true; el.innerHTML = ""; }
      renderThread();
      refreshNotifBadge();
    }

    $("#dmComposer").addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = $("#dmInput");
      const text = inp.value.trim();
      if (!text && !pendingMedia) return;
      try {
        S().setTyping(convId, false);
        S().sendMessage(convId, { text, media: pendingMedia, replyTo: replyingTo });
        inp.value = ""; pendingMedia = null; replyingTo = null;
        renderReplyBar();
        renderThread();
        refreshNotifBadge();
        // let the bot answer if this message triggers it
        maybeBotReply(text);
      } catch (ex) { toast(ex.message || "Couldn't send.", "error"); }
    });

    if ($("#grpInfoBtn")) $("#grpInfoBtn").addEventListener("click", () => openGroupMembers(conv));
    if ($("#grpAddBtn")) $("#grpAddBtn").addEventListener("click", () => openAddToGroup(conv, renderThread));

    // live update if a message arrives for this conversation (e.g. another
    // tab / account action) — poll lightly + listen to notif events.
    const onNotif = () => renderThread();
    window.addEventListener("mv:notif", onNotif);
    const poll = setInterval(() => { renderThread(); renderTyping(); }, 3000);
    renderTyping();
    if (DM_CLEANUP) DM_CLEANUP();
    DM_CLEANUP = () => { window.removeEventListener("mv:notif", onNotif); clearInterval(poll); if (typingTimer) clearTimeout(typingTimer); S().setTyping(convId, false); };
    window.addEventListener("hashchange", function h() { if (DM_CLEANUP) DM_CLEANUP(); window.removeEventListener("hashchange", h); });
  }

  function openGroupMembers(conv) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay open";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <button class="modal-close" id="gmClose"><i data-lucide="x"></i></button>
        <h2>${esc(conv.name || "Group")} · members</h2>
        <div class="nc-list">
          ${(conv.members || []).map(id => { const u = S().resolveAuthor(id); return `
            <a class="nc-row" href="#/u/${encodeURIComponent(u.username)}" data-link>
              ${avatarImg(u)}<div class="nc-id"><strong>${esc(u.displayName || u.username)}</strong><span>@${esc(u.username)}${conv.owner === id ? " · owner" : ""}</span></div>
            </a>`; }).join("")}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    icons();
    const close = () => overlay.remove();
    $("#gmClose").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelectorAll("[data-link]").forEach(a => a.addEventListener("click", close));
  }

  function openAddToGroup(conv, after) {
    const me = Auth.current();
    const candidates = Auth.allUsers().filter(u => !(conv.members || []).includes(u.id));
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay open";
    overlay.innerHTML = `
      <div class="modal newchat-card" role="dialog" aria-modal="true">
        <button class="modal-close" id="agClose"><i data-lucide="x"></i></button>
        <h2>Add members</h2>
        <div class="nc-list" id="agList">
          ${candidates.length ? candidates.map(u => `
            <label class="nc-row"><input type="checkbox" class="ag-pick" value="${esc(u.id)}" />
              ${avatarImg(u)}<div class="nc-id"><strong>${esc(u.displayName || u.username)}</strong><span>@${esc(u.username)}</span></div></label>`).join("") :
            `<p class="muted">Everyone's already in this group.</p>`}
        </div>
        <button class="btn btn-primary btn-block" id="agAdd"><i data-lucide="user-plus"></i> Add to group</button>
      </div>`;
    document.body.appendChild(overlay);
    icons();
    const close = () => overlay.remove();
    $("#agClose").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    $("#agAdd").addEventListener("click", () => {
      const ids = $$(".ag-pick").filter(c => c.checked).map(c => c.value);
      if (!ids.length) { close(); return; }
      try { S().addToGroup(conv.id, ids); toast("Members added.", "success"); close(); if (after) { conv.members = S().getConversation(conv.id).members; after(); } }
      catch (ex) { toast(ex.message || "Couldn't add.", "error"); }
    });
  }

  /* ---------------- PROFILE ---------------- */
  function viewProfile(nameOrNull) {
    const me = Auth.current();
    let user;
    if (nameOrNull) {
      // MangaBot has its own profile (it isn't in the Auth user store).
      const bp = S().botProfile();
      if (nameOrNull === bp.username || nameOrNull === bp.id) user = bp;
      else user = Auth.getUser(nameOrNull);
    } else {
      if (!requireAuth("Sign in to view your profile.")) { viewHome(); return; }
      user = me;
    }
    if (!user) {
      app.innerHTML = `<section class="page"><div class="empty-state"><i data-lucide="user-x"></i><h3>User not found</h3><p>This account doesn't exist on this device.</p><a class="btn btn-primary" href="#/feed" data-link>Back to feed</a></div></section>`;
      afterRender();
      return;
    }
    const isMe = me && user.id === me.id;
    const posts = S().postsBy(user.id);
    const following = ((me && me.following) || []);
    const isFollowing = me && following.includes(user.id);
    const joined = user.createdAt ? new Date(user.createdAt).toLocaleDateString([], { month: "long", year: "numeric" }) : "recently";
    const strength = isMe ? profileStrength(user) : null;

    app.innerHTML = `
      <section class="page profile-page">
        <div class="profile-cover"></div>
        <div class="profile-card">
          <div class="profile-top">
            <div class="profile-av-wrap">${avatarImg(user, "profile")}${isMe ? `<button class="av-edit" id="avEdit" title="Change photo"><i data-lucide="camera"></i></button><input type="file" id="avFile" accept="image/*" hidden />` : ""}</div>
          </div>
          <div class="profile-id">
            <h1>${esc(user.displayName || user.username)}${verifiedTick(user)}</h1>
            <div class="profile-handle">@${esc(user.username)}${user.role ? `<span class="role-badge">${esc(user.role)}</span>` : ""}</div>
            <p class="profile-bio">${esc(user.bio || "No bio yet.")}</p>
            <div class="profile-meta">
              ${user.location ? `<span><i data-lucide="map-pin"></i> ${esc(user.location)}</span>` : ""}
              <span><i data-lucide="calendar"></i> Joined ${esc(joined)}</span>
              <span class="online-dot" title="Online"></span>
            </div>
          </div>
          <div class="profile-stats">
            <div><strong>${(user.followersCount || 0)}</strong><span>Followers</span></div>
            <div><strong>${(user.following || []).length}</strong><span>Following</span></div>
            <div><strong>${posts.length}</strong><span>Posts</span></div>
            <div><strong>${(user.skills || []).length}</strong><span>Skills</span></div>
          </div>
          <div class="profile-actions">
            ${isMe
              ? `<button class="btn btn-ghost profile-btn" id="editProfileBtn"><i data-lucide="pencil"></i> Edit Profile</button>
                 <button class="btn btn-primary profile-btn" id="shareProfileBtn"><i data-lucide="share-2"></i> Share</button>${Auth.isAdmin() ? `
                 <button class="btn btn-ghost profile-btn" id="selfBoostProfileBtn"><i data-lucide="trending-up"></i> Boost my followers</button>` : ""}`
              : (user.bot
                ? `<button class="btn btn-primary profile-btn" id="msgBtn"><i data-lucide="message-circle"></i> Message MangaBot</button>`
                : `<button class="btn btn-primary profile-btn" id="followBtn"><i data-lucide="user-plus"></i> ${isFollowing ? "Following" : "Follow"}</button>
                 <button class="btn btn-ghost profile-btn" id="msgBtn"><i data-lucide="message-circle"></i> Message</button>`)}
          </div>
          ${strength !== null ? `<div class="profile-strength"><div class="ps-top"><span>Profile strength</span><span>${strength}%</span></div><div class="ps-track"><div class="ps-fill" style="width:${strength}%"></div></div></div>` : ""}
        </div>

        ${(user.skills && user.skills.length) ? `
        <div class="profile-card skills-card">
          <h2>Skills</h2>
          <div class="skill-cloud">${user.skills.map(s => `<span class="skill-pill">${esc(s)}</span>`).join("")}</div>
        </div>` : (isMe ? `
        <div class="profile-card skills-card">
          <h2>Skills</h2>
          <p class="muted">Add your skills in Edit Profile.</p>
        </div>` : "")}

        <div class="profile-card posts-card">
          <h2>${isMe ? "Your Posts" : "Posts"}</h2>
          <div class="feed-list" id="profFeed">
            ${posts.length ? posts.map(postCard).join("") : `<p class="muted">No posts yet.</p>`}
          </div>
        </div>
      </section>`;
    afterRender();
    wireProfile(user, isMe);
  }

  function profileStrength(u) {
    let s = 20;
    if (u.avatar) s += 25;
    if (u.bio) s += 20;
    if (u.role) s += 15;
    if (u.location) s += 10;
    if ((u.skills || []).length) s += 10;
    return Math.min(100, s);
  }

  function wireProfile(user, isMe) {
    if (isMe) {
      // Camera button opens the full picker (upload / bitmoji / manga gallery)
      if ($("#avEdit")) $("#avEdit").addEventListener("click", () => openAvatarPicker((url) => {
        Auth.setAvatar(url);
        toast("Profile photo updated.", "success");
        viewProfile(null);
      }));
      if ($("#editProfileBtn")) $("#editProfileBtn").addEventListener("click", () => openEditProfile(user));
      if ($("#selfBoostProfileBtn")) $("#selfBoostProfileBtn").addEventListener("click", () => openBoostModal(user.id));
      if ($("#shareProfileBtn")) $("#shareProfileBtn").addEventListener("click", () => {
        const url = location.origin + location.pathname + "#/u/" + encodeURIComponent(user.username);
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast("Profile link copied.", "success"), () => toast(url, "info"));
        else toast(url, "info");
      });
    } else {
      if ($("#followBtn")) $("#followBtn").addEventListener("click", () => {
        if (!requireAuth("Sign in to follow.")) return;
        const now = Auth.toggleFollow(user.id);
        const b = $("#followBtn");
        b.innerHTML = `<i data-lucide="user-plus"></i> ${now ? "Following" : "Follow"}`;
        icons();
      });
      if ($("#msgBtn")) $("#msgBtn").addEventListener("click", () => {
        if (!requireAuth("Sign in to message.")) return;
        try {
          const conv = S().openConversation(user.id);
          location.hash = "#/dm/" + encodeURIComponent(conv.id);
        } catch (ex) { toast(ex.message || "Couldn't open chat.", "error"); }
      });
    }
    // delegated like/comment inside profile feed
    const pf = $("#profFeed");
    if (pf) wireFeed(pf);
  }

  /* ---------------- Edit Profile modal ---------------- */
  function openEditProfile(user) {
    let overlay = document.getElementById("editProfileModal");
    if (overlay) overlay.remove();
    overlay = document.createElement("div");
    overlay.className = "modal-overlay open";
    overlay.id = "editProfileModal";
    overlay.innerHTML = `
      <div class="modal edit-card" role="dialog" aria-modal="true">
        <button class="modal-close" id="epClose"><i data-lucide="x"></i></button>
        <h2>Edit profile</h2>
        <div class="ep-avatar">${avatarImg(user, "profile")}<button type="button" class="btn btn-ghost btn-sm" id="epAvatarBtn"><i data-lucide="image-plus"></i> Change avatar</button></div>
        <label>Display name<input type="text" id="epName" value="${esc(user.displayName || user.username)}" maxlength="40" /></label>
        <label>Role / title<input type="text" id="epRole" value="${esc(user.role || "")}" placeholder="e.g. Full Stack" maxlength="40" /></label>
        <label>Location<input type="text" id="epLoc" value="${esc(user.location || "")}" placeholder="e.g. Lagos, Nigeria" maxlength="60" /></label>
        <label>Bio<textarea id="epBio" maxlength="280" placeholder="Tell people about yourself">${esc(user.bio || "")}</textarea></label>
        <label>Skills (comma separated)<input type="text" id="epSkills" value="${esc((user.skills || []).join(", "))}" placeholder="JavaScript, React, Node.js" /></label>
        <div class="form-error" id="epError"></div>
        <button class="btn btn-primary btn-block" id="epSave"><i data-lucide="save"></i> Save changes</button>
      </div>`;
    document.body.appendChild(overlay);
    icons();
    const close = () => overlay.remove();
    $("#epClose").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    let newAvatar = null;
    $("#epAvatarBtn").addEventListener("click", () => openAvatarPicker((url) => {
      newAvatar = url;
      overlay.querySelector(".ep-avatar .avatar-img").src = url;
    }));
    $("#epSave").addEventListener("click", () => {
      try {
        const skills = $("#epSkills").value.split(",").map(s => s.trim()).filter(Boolean);
        const fields = {
          displayName: $("#epName").value, role: $("#epRole").value,
          location: $("#epLoc").value, bio: $("#epBio").value, skills
        };
        if (newAvatar) fields.avatar = newAvatar;
        Auth.updateProfile(fields);
        toast("Profile updated.", "success");
        close();
        viewProfile(null);
      } catch (ex) { $("#epError").textContent = ex.message || "Couldn't save."; }
    });
  }

  /* ============================================================
     VIEW: NOTIFICATIONS
     ============================================================ */
  function viewNotifications() {
    if (!requireAuth("Sign in to see notifications.")) { viewHome(); return; }
    const items = S().notifications();
    app.innerHTML = `
      <section class="page notif-page">
        <div class="page-head"><h1><i data-lucide="bell"></i> Notifications</h1>
          ${items.length ? `<button class="btn btn-ghost btn-sm" id="markAllRead"><i data-lucide="check-check"></i> Mark all read</button>` : ""}</div>
        <div class="notif-list">
          ${items.length ? items.map(notifRow).join("") :
            `<div class="empty-state"><i data-lucide="bell-off"></i><h3>No notifications yet</h3><p>Likes, comments, reactions, follows and messages will show up here.</p></div>`}
        </div>
      </section>`;
    afterRender();
    if ($("#markAllRead")) $("#markAllRead").addEventListener("click", () => { S().markNotifsRead(); viewNotifications(); });
    // opening the page marks everything read (after a tick so the badge shows first)
    setTimeout(() => { S().markNotifsRead(); }, 800);
  }
  function notifRow(n) {
    const from = S().resolveAuthor(n.fromId);
    const map = {
      like: { icon: "heart", text: "liked your post" },
      reaction: { icon: "smile-plus", text: "reacted " + (S().reactionMeta(n.reaction).emoji) + " to your post" },
      comment: { icon: "message-square", text: "commented: " + (n.text || "") },
      follow: { icon: "user-plus", text: "started following you" },
      message: { icon: "message-circle", text: (n.group ? ("messaged " + n.group + ": ") : "sent you a message: ") + (n.text || "") },
      group: { icon: "users", text: "added you to " + (n.text || "a group") }
    };
    const m = map[n.type] || { icon: "bell", text: "did something" };
    let href = "#/notifications";
    if (n.type === "message" || n.type === "group") href = "#/dm/" + encodeURIComponent(n.convId || "");
    else if (n.postId) href = "#/feed";
    else if (n.type === "follow") href = "#/u/" + encodeURIComponent(from.username);
    return `<a class="notif-row ${n.read ? "" : "unread"}" href="${href}" data-link>
      <span class="notif-ic"><i data-lucide="${m.icon}"></i></span>
      ${avatarImg(from, "sm")}
      <div class="notif-body"><span><strong>${esc(from.displayName || from.username)}</strong> ${esc(m.text)}</span><span class="notif-time">${timeAgo(n.at)}</span></div>
      ${n.read ? "" : `<span class="notif-dot"></span>`}
    </a>`;
  }

  /* ============================================================
     VIEW: SEARCH (users + posts + manga)
     ============================================================ */
  async function viewSearch(params) {
    const q0 = (params && params.q) || "";
    app.innerHTML = `
      <section class="page search-page">
        <div class="page-head"><h1><i data-lucide="search"></i> Search</h1></div>
        <div class="search-bar-lg"><i data-lucide="search"></i><input type="text" id="searchInput" placeholder="Search people, posts, manga…" value="${esc(q0)}" autocomplete="off" /></div>
        <div class="search-tabs">
          <button class="stab active" data-stab="users"><i data-lucide="users"></i> People</button>
          <button class="stab" data-stab="posts"><i data-lucide="rss"></i> Posts</button>
          <button class="stab" data-stab="manga"><i data-lucide="book-open"></i> Manga</button>
        </div>
        <div class="search-results" id="searchResults"></div>
      </section>`;
    afterRender();
    const input = $("#searchInput");
    let tab = "users";
    let mangaCache = null;

    function renderUsers(q) {
      const bot = S().botProfile();
      const users = [bot].concat(Auth.allUsers().filter(u => u.id !== bot.id)).filter(u => {
        const s = ((u.displayName || "") + " " + u.username + " " + (u.role || "")).toLowerCase();
        return !q || s.includes(q);
      });
      return users.length ? `<div class="search-users">${users.map(u => `
        <a class="nc-row" href="#/u/${encodeURIComponent(u.username)}" data-link>
          ${avatarImg(u)}<div class="nc-id"><strong>${esc(u.displayName || u.username)}</strong><span>@${esc(u.username)}${u.role ? " · " + esc(u.role) : ""}</span></div>
        </a>`).join("")}</div>` : `<p class="muted">No people match “${esc(q)}”.</p>`;
    }
    function renderPosts(q) {
      const posts = S().posts().filter(p => {
        const a = S().resolveAuthor(p.author);
        const s = ((p.text || "") + " " + (a.displayName || "") + " " + (a.username || "")).toLowerCase();
        return !q || s.includes(q);
      });
      return posts.length ? `<div class="feed-list" id="searchFeed">${posts.map(postCard).join("")}</div>` : `<p class="muted">No posts match “${esc(q)}”.</p>`;
    }
    async function renderManga(q) {
      const res = $("#searchResults");
      res.innerHTML = `<div class="reader-loading"><i data-lucide="loader"></i> Searching manga…</div>`; icons();
      let list = [];
      try { list = q ? await window.MangaSource.search(q) : await window.MangaSource.list({ limit: 18 }); } catch (e) { list = []; }
      res.innerHTML = list.length
        ? `<div class="grid">${list.map(mangaCard).join("")}</div>`
        : `<p class="muted">No manga found for “${esc(q)}”.</p>`;
      afterRender(res);
    }
    async function run() {
      const q = input.value.trim().toLowerCase();
      const res = $("#searchResults");
      if (tab === "users") { res.innerHTML = renderUsers(q); afterRender(res); }
      else if (tab === "posts") { res.innerHTML = renderPosts(q); afterRender(res); const sf = $("#searchFeed"); if (sf) wireFeed(sf); }
      else { await renderManga(q); }
    }
    input.addEventListener("input", () => { if (tab !== "manga") run(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && tab === "manga") run(); });
    $$(".stab").forEach(b => b.addEventListener("click", () => {
      $$(".stab").forEach(x => x.classList.remove("active"));
      b.classList.add("active"); tab = b.getAttribute("data-stab"); run();
    }));
    run();
  }

  /* ============================================================
     VIEW: SETTINGS (live-data proxy / Worker URL)
     ============================================================ */
  function viewSettings() {
    const cur = window.MangaSource.workerUrl ? window.MangaSource.workerUrl() : "";
    app.innerHTML = `
      <section class="page settings-page">
        <div class="page-head"><h1><i data-lucide="settings"></i> Settings</h1><p>Configure MangaVerse.</p></div>

        <div class="settings-card">
          <h2><i data-lucide="bell-ring"></i> Background notifications</h2>
          <p class="muted">Get a browser notification for new messages and reactions <strong>even when this tab is in the background</strong>. Clicking a notification opens the relevant chat. You can turn this off any time in your browser's site settings.</p>
          <div class="settings-actions">
            <button class="btn btn-primary" id="notifEnable"><i data-lucide="bell"></i> Enable background notifications</button>
          </div>
          <p class="settings-status" id="notifStatus"></p>
        </div>

        <div class="settings-card">
          <h2><i data-lucide="cloud"></i> Live-data proxy (Cloudflare Worker)</h2>
          <p class="muted">By default MangaVerse fetches live manga through free public CORS proxies, which can be rate-limited. Deploy your own tiny Cloudflare Worker (see the <a href="#/docs" data-link>Docs</a>) and paste its URL here to make it the <strong>primary</strong> proxy — live data then rarely falls back to the sample set.</p>
          <label>Worker URL
            <input type="text" id="workerUrl" placeholder="https://mangaverse-proxy.yourname.workers.dev" value="${esc(cur)}" />
          </label>
          <div class="settings-actions">
            <button class="btn btn-primary" id="saveWorker"><i data-lucide="save"></i> Save proxy</button>
            <button class="btn btn-ghost" id="clearWorker"><i data-lucide="trash-2"></i> Use public proxies</button>
          </div>
          <p class="settings-status" id="workerStatus">${cur ? "✅ Using your Worker as the primary proxy." : "Using the public proxy chain."}</p>
          <details class="worker-code">
            <summary>Deploy your own proxy (1-click &amp; manual)</summary>
            <p class="muted"><a class="deploy-btn" href="https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/worker-template" target="_blank" rel="noopener"><i data-lucide="external-link"></i> Deploy to Cloudflare Workers</a> — then paste your <code>worker.js</code> code and copy the resulting <code>*.workers.dev</code> URL above.</p>
            <p class="muted">Manual: 1. Free Cloudflare account → Workers &amp; Pages → Create Worker. 2. Paste the code from <a href="worker.js" target="_blank">worker.js</a>. 3. Deploy, copy the <code>*.workers.dev</code> URL, paste it above.</p>
            <p class="muted">Or with Wrangler: <code>npm i -g wrangler</code> → <code>wrangler init</code> → replace <code>src/index.js</code> with <code>worker.js</code> → <code>wrangler deploy</code>.</p>
          </details>
        </div>

        <div class="settings-card">
          <h2><i data-lucide="database"></i> Cross-device sync (Supabase backend)</h2>
          <p class="muted">By default MangaVerse stores your accounts, posts, chats, groups and profiles <strong>locally in this browser</strong>. Connect your own free <a href="https://supabase.com" target="_blank" rel="noopener">Supabase</a> project to sync them <strong>in realtime across devices and real users</strong> — and, with Supabase Auth (email + password) enabled, the app's <strong>signup/login use Supabase accounts</strong> so the same login works on any device. localStorage stays as an offline cache/fallback.</p>
          <p class="muted"><i data-lucide="info"></i> For Auth: in Supabase go to <strong>Authentication → Providers → Email</strong> and turn it on (for a demo you can disable "Confirm email"). Then signup/login here route through Supabase automatically. Without keys the app runs fully local.</p>
          <ol class="muted setup-steps">
            <li>Create a free project at <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>.</li>
            <li>Open <strong>SQL Editor</strong> and run the schema below (creates tables + RLS + realtime).</li>
            <li>Go to <strong>Project Settings → API</strong>, copy the <strong>Project URL</strong> and <strong>anon public key</strong>, paste them here, and hit Connect.</li>
          </ol>
          <label>Supabase Project URL
            <input type="text" id="sbUrl" placeholder="https://xxxxxxxx.supabase.co" value="${esc(window.Cloud ? Cloud.getUrl() : "")}" />
          </label>
          <label>Supabase anon (public) key
            <input type="password" id="sbKey" placeholder="eyJhbGciOi…" value="${esc(window.Cloud ? Cloud.getKey() : "")}" />
          </label>
          <div class="settings-actions">
            <button class="btn btn-primary" id="sbConnect"><i data-lucide="plug"></i> Save &amp; connect</button>
            <button class="btn btn-ghost" id="sbDisconnect"><i data-lucide="unplug"></i> Disconnect (local only)</button>
          </div>
          <p class="cloud-status ${window.Cloud && Cloud.isReady() ? "on" : ""}" id="sbStatus">${window.Cloud && Cloud.isReady() ? "✅ Connected — syncing across devices." : (window.Cloud && Cloud.configured() ? "Keys saved — connecting…" : "Not connected — running fully local (offline).")}</p>
          <details class="worker-code">
            <summary>Show SQL schema (run once in Supabase → SQL Editor)</summary>
            <div class="sb-sql-wrap"><button class="btn btn-ghost btn-sm copy-sql"><i data-lucide="copy"></i> Copy SQL</button><pre class="sql-box"><code id="sbSql">${esc(window.Cloud ? Cloud.SCHEMA_SQL : "")}</code></pre></div>
          </details>
        </div>
      </section>`;
    afterRender();

    // ---- background push notifications ----
    const notifStatusEl = $("#notifStatus");
    const refreshNotifStatus = () => {
      if (!notifStatusEl) return;
      const p = Push.permission();
      const map = {
        granted: "✅ Background notifications are ON.",
        denied: "⚠️ Blocked in your browser — enable notifications for this site in your browser settings.",
        default: "Not enabled yet — click the button above.",
        unsupported: "Your browser doesn't support notifications."
      };
      notifStatusEl.textContent = map[p] || "";
      const btn = $("#notifEnable");
      if (btn) btn.disabled = (p === "granted" || p === "unsupported");
    };
    refreshNotifStatus();
    if ($("#notifEnable")) $("#notifEnable").addEventListener("click", async () => {
      await Push.request();
      refreshNotifStatus();
    });

    $("#saveWorker").addEventListener("click", () => {
      const u = $("#workerUrl").value.trim();
      if (u && !/^https?:\/\//.test(u)) { toast("Enter a full https:// URL.", "error"); return; }
      window.MangaSource.setWorkerUrl(u);
      $("#workerStatus").textContent = u ? "✅ Using your Worker as the primary proxy." : "Using the public proxy chain.";
      toast(u ? "Worker proxy saved." : "Cleared — using public proxies.", "success");
    });
    $("#clearWorker").addEventListener("click", () => {
      window.MangaSource.setWorkerUrl(""); $("#workerUrl").value = "";
      $("#workerStatus").textContent = "Using the public proxy chain.";
      toast("Using public proxies.", "info");
    });

    // ---- Supabase connect / disconnect ----
    if ($("#sbConnect")) $("#sbConnect").addEventListener("click", async () => {
      const url = $("#sbUrl").value.trim(), key = $("#sbKey").value.trim();
      if (!url || !key) { toast("Enter both the URL and the anon key.", "error"); return; }
      if (!window.Cloud) { toast("Cloud module not loaded.", "error"); return; }
      Cloud.setConfig(url, key);
      const st = $("#sbStatus"); st.textContent = "Connecting…"; st.classList.remove("on");
      try {
        await Cloud.connect();
        st.textContent = "✅ Connected — syncing across devices."; st.classList.add("on");
        toast("Supabase connected — data now syncs across devices.", "success");
      } catch (ex) {
        st.textContent = "⚠️ " + (ex.message || "Couldn't connect."); st.classList.remove("on");
        toast(ex.message || "Couldn't connect to Supabase.", "error");
      }
    });
    if ($("#sbDisconnect")) $("#sbDisconnect").addEventListener("click", () => {
      if (window.Cloud) Cloud.setConfig("", "");
      $("#sbUrl").value = ""; $("#sbKey").value = "";
      const st = $("#sbStatus"); st.textContent = "Not connected — running fully local (offline)."; st.classList.remove("on");
      toast("Disconnected — using local storage only.", "info");
    });
    $$(".copy-sql").forEach(b => b.addEventListener("click", () => {
      const sql = $("#sbSql").textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(sql).then(() => toast("SQL copied.", "success"));
    }));
  }

  /* ============================================================
     VIEW: ADMIN DASHBOARD (admin only)
     ============================================================ */
  function viewAdmin() {
    if (!requireAuth("Sign in as admin.")) { viewHome(); return; }
    if (!Auth.isAdmin()) { toast("Admins only.", "error"); viewHome(); return; }
    const me = Auth.current();
    const users = Auth.allUsers();
    const posts = S().posts();
    const convos = Object.keys(S()._chats()).length;
    const f = Auth.features();
    const verifiedCount = users.filter(u => u.verified).length;

    const featureRow = (key, label, icon) => `
      <label class="admin-toggle">
        <span class="at-label"><i data-lucide="${icon}"></i> ${label}</span>
        <span class="switch"><input type="checkbox" class="feat-toggle" data-feat="${key}" ${f[key] !== false ? "checked" : ""} /><span class="slider"></span></span>
      </label>`;

    app.innerHTML = `
      <section class="page admin-page">
        <div class="page-head"><h1><i data-lucide="shield"></i> Admin Dashboard</h1><p>Manage MangaVerse users, content and features.</p></div>
        <div class="admin-stats">
          <div class="admin-stat"><span class="as-num">${users.length}</span><span class="as-lbl"><i data-lucide="users"></i> Users</span></div>
          <div class="admin-stat"><span class="as-num">${posts.length}</span><span class="as-lbl"><i data-lucide="rss"></i> Posts</span></div>
          <div class="admin-stat"><span class="as-num">${convos}</span><span class="as-lbl"><i data-lucide="message-circle"></i> Chats</span></div>
          <div class="admin-stat"><span class="as-num">${verifiedCount}</span><span class="as-lbl"><i data-lucide="badge-check"></i> Verified</span></div>
        </div>

        <div class="admin-card">
          <div class="admin-card-head"><h2><i data-lucide="bar-chart-3"></i> Analytics</h2>
            <div class="admin-card-tools">
              <div class="range-picker" id="rangePicker" role="tablist" aria-label="Date range">
                <button class="range-btn" data-range="7">7d</button>
                <button class="range-btn active" data-range="30">30d</button>
                <button class="range-btn" data-range="90">90d</button>
              </div>
              <div class="quick-boost"><i data-lucide="trending-up"></i> <span>Boost my followers:</span>
                <input type="number" id="selfBoostAmt" min="0" value="1000" />
                <button class="btn btn-primary btn-sm" id="selfBoostBtn">Boost me</button>
              </div>
              <button class="btn btn-ghost btn-sm" id="csvExportBtn" title="Download analytics as CSV"><i data-lucide="download"></i> Export CSV</button>
            </div>
          </div>
          <div class="analytics-grid" id="analyticsGrid"><!-- rendered by renderAnalytics() --></div>
        </div>

        <div class="admin-card">
          <h2><i data-lucide="sliders-horizontal"></i> Feature settings &amp; moderation</h2>
          <p class="muted">Toggle app features on or off for everyone on this device.</p>
          <div class="admin-toggles">
            ${featureRow("feed", "Feed &amp; posts", "rss")}
            ${featureRow("chat", "Chat &amp; groups", "message-circle")}
            ${featureRow("adult", "18+ section", "flame")}
            ${featureRow("signups", "Allow new sign-ups", "user-plus")}
            ${featureRow("api", "Developer API page", "code-2")}
          </div>
        </div>

        <div class="admin-card">
          <div class="admin-card-head"><h2><i data-lucide="users"></i> User management</h2>
            <div class="admin-usearch"><i data-lucide="search"></i><input type="text" id="adminUserSearch" placeholder="Search users…" /></div>
          </div>
          <div class="admin-table" id="adminUsers">
            ${users.map(adminUserRow).join("")}
          </div>
        </div>

        <div class="admin-card">
          <h2><i data-lucide="rss"></i> Recent posts</h2>
          <div class="admin-table" id="adminPosts">
            ${posts.length ? posts.slice(0, 20).map(p => { const a = S().resolveAuthor(p.author); return `<div class="admin-row" data-pid="${esc(p.id)}">
              ${avatarImg(a, "sm")}
              <div class="admin-uinfo"><strong>${esc(a.displayName || a.username)}</strong><span>${esc((p.text || "🖼️ media").slice(0, 80))}</span></div>
              <button class="btn btn-ghost btn-sm admin-del-post" data-pid="${esc(p.id)}"><i data-lucide="trash-2"></i></button>
            </div>`; }).join("") : `<p class="muted">No posts yet.</p>`}
          </div>
        </div>
      </section>`;
    afterRender();

    // Render the analytics charts for a given day-range (7/30/90). Called on
    // first paint and whenever the range picker changes.
    function renderAnalytics(range) {
      range = parseInt(range, 10) || 30;
      const grid = $("#analyticsGrid");
      if (!grid) return;
      const sub = `last ${range} days`;
      const lb = S().mostFollowed(8); const lbMax = Math.max(1, ...lb.map(u => u.followersCount || 0));
      grid.innerHTML = `
        <div class="chart-box">
          <h3><i data-lucide="activity"></i> Daily Active Users <span class="chart-sub">${sub}</span></h3>
          ${lineChart(S().dauSeries(range), "#00e5ff")}
        </div>
        <div class="chart-box">
          <h3><i data-lucide="rss"></i> Posts per day <span class="chart-sub">${sub}</span></h3>
          ${barChart(S().postsPerDay(range), "#00ffa3")}
        </div>
        <div class="chart-box">
          <h3><i data-lucide="user-plus"></i> Retention · new vs returning <span class="chart-sub">${sub}</span></h3>
          ${stackedBarChart(S().retentionSeries(range), "#00e5ff", "#00ffa3")}
        </div>
        <div class="chart-box heatmap-box">
          <h3><i data-lucide="grid-3x3"></i> Retention cohort heatmap <span class="chart-sub">% of each signup-day cohort active on day N</span></h3>
          ${cohortHeatmap(S().retentionCohorts(range))}
        </div>
        <div class="chart-box leaderboard-box">
          <h3><i data-lucide="crown"></i> Most-followed users</h3>
          <div class="leaderboard">
            ${lb.length ? lb.map((u, i) => `<div class="lb-row">
              <span class="lb-rank">${i + 1}</span>
              ${avatarImg(u, "sm")}
              <div class="lb-info"><strong>${esc(u.displayName || u.username)}${u.verified ? ` <span class="verified inline"><i data-lucide="badge-check"></i></span>` : ""}</strong>
                <div class="lb-bar"><span style="width:${Math.round((u.followersCount || 0) / lbMax * 100)}%"></span></div>
              </div>
              <span class="lb-count">${(u.followersCount || 0).toLocaleString()}</span>
            </div>`).join("") : `<p class="muted">No users yet.</p>`}
          </div>
        </div>`;
      icons();
    }
    renderAnalytics(30);
    // date-range picker: re-render all charts for the selected window
    $$("#rangePicker .range-btn").forEach(b => b.addEventListener("click", () => {
      $$("#rangePicker .range-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      renderAnalytics(b.getAttribute("data-range"));
    }));

    // CSV export: download the current analytics for the active range window.
    if ($("#csvExportBtn")) $("#csvExportBtn").addEventListener("click", () => {
      const activeBtn = $("#rangePicker .range-btn.active");
      const range = activeBtn ? parseInt(activeBtn.getAttribute("data-range"), 10) : 30;
      const csv = S().analyticsCSV(range);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mangaverse-analytics-" + range + "d-" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Analytics CSV downloaded.", "success");
    });

    // self quick-boost: admin boosts their OWN follower count from the dashboard
    if ($("#selfBoostBtn")) $("#selfBoostBtn").addEventListener("click", () => {
      const amt = $("#selfBoostAmt").value;
      Auth.adminBoostFollowers(me.id, amt, "add");
      toast("Boosted your followers by " + (parseInt(amt, 10) || 0) + ".", "success");
      viewAdmin();
    });

    // feature toggles
    $$(".feat-toggle").forEach(t => t.addEventListener("change", () => {
      Auth.adminSetFeature(t.getAttribute("data-feat"), t.checked);
      buildMobileMenu(); renderAccount();
      toast("Feature setting saved.", "success");
    }));

    // live user search
    const us = $("#adminUserSearch");
    if (us) us.addEventListener("input", () => {
      const q = us.value.toLowerCase();
      $$("#adminUsers .admin-row").forEach(r => {
        r.style.display = (r.getAttribute("data-name") || "").includes(q) ? "" : "none";
      });
    });

    wireAdminUsers();
    $$(".admin-del-post").forEach(b => b.addEventListener("click", () => {
      if (S().deletePost(b.getAttribute("data-pid"))) { toast("Post deleted.", "info"); viewAdmin(); }
    }));
  }

  // A single admin user row with verify / boost / edit / ban / delete actions.
  function adminUserRow(u) {
    return `<div class="admin-row admin-urow" data-uid="${esc(u.id)}" data-name="${esc(((u.displayName || "") + " " + u.username + " " + (u.email || "")).toLowerCase())}">
      ${avatarImg(u, "sm")}
      <div class="admin-uinfo">
        <strong>${esc(u.displayName || u.username)}${u.verified ? ` <span class="verified inline"><i data-lucide="badge-check"></i></span>` : ""}</strong>
        <span>@${esc(u.username)} · ${(u.followersCount || 0)} followers${u.isAdmin ? " · <b class='admin-flag'>admin</b>" : ""}${u.banned ? " · <b class='admin-flag banned'>banned</b>" : ""}</span>
      </div>
      <div class="admin-actions">
        <button class="btn btn-ghost btn-sm admin-verify" data-uid="${esc(u.id)}" title="${u.verified ? "Remove verified" : "Verify user"}"><i data-lucide="badge-check"></i></button>
        <button class="btn btn-ghost btn-sm admin-boost" data-uid="${esc(u.id)}" title="Boost followers"><i data-lucide="trending-up"></i></button>
        <button class="btn btn-ghost btn-sm admin-edit" data-uid="${esc(u.id)}" title="Edit user"><i data-lucide="pencil"></i></button>
        <a class="btn btn-ghost btn-sm" href="#/u/${encodeURIComponent(u.username)}" data-link title="View profile"><i data-lucide="external-link"></i></a>
        ${u.isAdmin ? "" : `<button class="btn btn-ghost btn-sm admin-ban" data-uid="${esc(u.id)}" title="${u.banned ? "Unban" : "Ban"}"><i data-lucide="${u.banned ? "user-check" : "ban"}"></i></button>
        <button class="btn btn-ghost btn-sm admin-del-user" data-uid="${esc(u.id)}" title="Delete user"><i data-lucide="user-x"></i></button>`}
      </div>
    </div>`;
  }

  function wireAdminUsers() {
    $$(".admin-verify").forEach(b => b.addEventListener("click", () => {
      const id = b.getAttribute("data-uid");
      const now = Auth.adminSetVerified(id, !(Auth.getUser(id) || {}).verified);
      toast(now ? "User verified ✓" : "Verification removed.", now ? "success" : "info");
      viewAdmin();
    }));
    $$(".admin-boost").forEach(b => b.addEventListener("click", () => openBoostModal(b.getAttribute("data-uid"))));
    $$(".admin-edit").forEach(b => b.addEventListener("click", () => openAdminEdit(b.getAttribute("data-uid"))));
    $$(".admin-ban").forEach(b => b.addEventListener("click", () => {
      const id = b.getAttribute("data-uid");
      const now = Auth.adminSetBanned(id, !(Auth.getUser(id) || {}).banned);
      toast(now ? "User banned." : "User unbanned.", now ? "info" : "success");
      viewAdmin();
    }));
    $$(".admin-del-user").forEach(b => b.addEventListener("click", () => {
      if (Auth.adminDeleteUser(b.getAttribute("data-uid"))) { toast("User deleted.", "info"); viewAdmin(); }
    }));
  }

  // Boost-followers modal (set absolute or add).
  function openBoostModal(userId) {
    const u = Auth.getUser(userId);
    if (!u) return;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay open";
    overlay.innerHTML = `
      <div class="modal boost-card" role="dialog" aria-modal="true">
        <button class="modal-close" id="bstClose"><i data-lucide="x"></i></button>
        <h2><i data-lucide="trending-up"></i> Boost followers</h2>
        <p class="auth-sub">${esc(u.displayName || u.username)} currently shows <strong>${u.followersCount || 0}</strong> followers (${u.followersBoost || 0} boosted).</p>
        <label>Amount<input type="number" id="bstAmount" min="0" value="1000" /></label>
        <div class="settings-actions">
          <button class="btn btn-primary" id="bstSet"><i data-lucide="check"></i> Set to this</button>
          <button class="btn btn-ghost" id="bstAdd"><i data-lucide="plus"></i> Add this many</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    icons();
    const close = () => overlay.remove();
    $("#bstClose").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    $("#bstSet").addEventListener("click", () => {
      Auth.adminBoostFollowers(userId, $("#bstAmount").value, "set");
      toast("Followers updated.", "success"); close(); router();
    });
    $("#bstAdd").addEventListener("click", () => {
      Auth.adminBoostFollowers(userId, $("#bstAmount").value, "add");
      toast("Followers boosted.", "success"); close(); router();
    });
  }

  // Admin edit-user modal (display name + role).
  function openAdminEdit(userId) {
    const u = Auth.getUser(userId);
    if (!u) return;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay open";
    overlay.innerHTML = `
      <div class="modal edit-card" role="dialog" aria-modal="true">
        <button class="modal-close" id="aeClose"><i data-lucide="x"></i></button>
        <h2>Edit @${esc(u.username)}</h2>
        <label>Display name<input type="text" id="aeName" value="${esc(u.displayName || "")}" maxlength="40" /></label>
        <label>Role / title<input type="text" id="aeRole" value="${esc(u.role || "")}" maxlength="40" /></label>
        <button class="btn btn-primary btn-block" id="aeSave"><i data-lucide="save"></i> Save changes</button>
      </div>`;
    document.body.appendChild(overlay);
    icons();
    const close = () => overlay.remove();
    $("#aeClose").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    $("#aeSave").addEventListener("click", () => {
      Auth.adminEditUser(userId, { displayName: $("#aeName").value, role: $("#aeRole").value });
      toast("User updated.", "success"); close(); viewAdmin();
    });
  }

  /* ============================================================
     VIEW: DOCS
     ============================================================ */
  function viewDocs() {
    app.innerHTML = `
      <section class="page docs-page">
        <div class="page-head"><h1><i data-lucide="book-open"></i> MangaVerse Docs</h1><p>Everything the app can do, in one place.</p></div>
        <div class="docs-grid">
          <div class="docs-card"><h2><i data-lucide="book-open"></i> Reader &amp; Sources</h2><p>Browse a huge live library aggregated from multiple free sources (MangaDex primary, Comick/Consumet when reachable, with a built-in offline sample fallback). Read chapters in a clean vertical reader with progress tracking, keyboard nav and per-image proxy retry. Pick a <strong>chapter language</strong> to load translated chapters, and a <strong>site language</strong> to translate titles &amp; synopses. The Home page shows a personalized <strong>"For You"</strong> shelf that recommends titles from your bookmarks &amp; reading history (falling back to popular picks for new readers).</p></div>
          <div class="docs-card"><h2><i data-lucide="flame"></i> 18+ Section</h2><p>An age-gated area for mature titles (erotica &amp; hentai) using MangaDex content-rating filters. The main library stays SFW; explicit content lives behind a one-time 18+ confirmation stored on your device.</p></div>
          <div class="docs-card"><h2><i data-lucide="user"></i> Accounts &amp; Profile</h2><p>Sign up / log in with a local account (stored in your browser), or connect Supabase to sign in with the <strong>same account across devices</strong> (Supabase Auth). Customise your profile: display name, role, bio, location, skills, and an avatar — upload a photo or pick a bitmoji-style / manga-character avatar.</p></div>
          <div class="docs-card"><h2><i data-lucide="rss"></i> Feed &amp; Posts</h2><p>Share posts with text and images/video. Like, add emoji <strong>reactions</strong>, and comment (including <strong>image comments</strong>). Your feed shows real posts from registered users, newest first.</p></div>
          <div class="docs-card"><h2><i data-lucide="message-circle"></i> Chat &amp; Groups</h2><p>Direct-message other registered users and create <strong>group chats</strong>. Send text, images and video, see <strong>typing indicators</strong>, <strong>read receipts</strong> (sent/delivered/read) and add <strong>emoji reactions</strong> to individual messages. <strong>Reply to a specific message</strong> with a quoted preview (tap the quote to jump to it), and <strong>search within a conversation</strong> to filter &amp; highlight matches. <strong>Edit or delete your own messages</strong>, and see <strong>"seen by" avatars</strong> under your latest message in <strong>both DMs and groups</strong> — tap them for a full read-receipt list. View anyone's profile from a chat.</p></div>
          <div class="docs-card"><h2><i data-lucide="bot"></i> MangaBot</h2><p><strong>MangaBot</strong> has its <strong>own account</strong> (with a verified badge). It's automatically a member of <strong>every group chat</strong> — trigger it there with a slash command or by tagging <code>@bot</code> / <code>@mangabot</code>. You can also <strong>DM MangaBot directly</strong> (find it in New chat, Search &rarr; People, or its profile): in a 1:1 chat it replies to <em>every</em> message. Commands: <code>/help</code>, <code>/recommend</code>, <code>/trending</code>, <code>/search &lt;title&gt;</code>, <code>/info &lt;title&gt;</code>. Replies include <strong>inline cover thumbnails</strong> with a tappable <strong>Open</strong> button that jumps straight to the manga's detail page.</p></div>
          <div class="docs-card"><h2><i data-lucide="database"></i> Cross-device sync &amp; Auth (Supabase)</h2><p>Optionally connect your own free Supabase project in <a href="#/settings" data-link>Settings</a> to sync posts, chats, groups and profiles <strong>in realtime across devices and real users</strong>, and to use <strong>Supabase Auth</strong> (email + password) so the same login works everywhere. Without it, everything stays local to this browser. The full SQL schema (incl. auth-profile linking) is provided in Settings.</p></div>
          <div class="docs-card"><h2><i data-lucide="bell"></i> Notifications &amp; Search</h2><p>Get notified about likes, reactions, comments, follows, group invites and messages, with an unread badge. Enable <strong>background browser notifications</strong> in Settings to be alerted about new messages/reactions even when the tab is hidden. Search across people, posts and manga from one page.</p></div>
          <div class="docs-card"><h2><i data-lucide="shield"></i> Admin</h2><p>Admins get a dashboard with an <strong>Analytics</strong> section featuring a <strong>date-range picker (7 / 30 / 90 days)</strong> that re-renders daily active users, posts-per-day, a <strong>new-vs-returning retention chart</strong>, a <strong>retention cohort heatmap</strong> (day-N retention by signup cohort) and the most-followed leaderboard, plus an <strong>Export CSV</strong> button that downloads the whole analytics for the selected range. Also user/post/chat stats, feature toggles &amp; moderation. Admins can <strong>verify users</strong>, <strong>boost followers</strong> (including a self-boost), edit, ban or remove users, and delete posts. Anyone signing in with the owner email is automatically an admin. Access <a href="#/admin" data-link>/admin</a>.</p></div>
          <div class="docs-card"><h2><i data-lucide="cloud"></i> Live-data Proxy</h2><p>Deploy the included Cloudflare <code>worker.js</code> and paste its URL in <a href="#/settings" data-link>Settings</a> to make live manga data rock-solid (no more falling back to sample). Free tier is plenty.</p></div>
          <div class="docs-card"><h2><i data-lucide="code-2"></i> Developer API</h2><p>Use MangaVerse data in your own site via the exposed JS API / SDK. See the <a href="#/api" data-link>API page</a> for endpoints and copyable examples.</p></div>
        </div>
      </section>`;
    afterRender();
  }

  /* ============================================================
     VIEW: API (embeddable JS SDK + examples)
     ============================================================ */
  function viewApi() {
    const ex1 = `// MangaVerse exposes a JS API on window.MangaSource.\n// Include the site's api.js (+ data.js) on your page, or load\n// MangaVerse in an iframe and call these from the same origin.\n\n// 1) Popular / list\nconst popular = await MangaSource.list({ limit: 12, content: 'sfw' });\nconsole.log(popular[0]); // { id, title, cover, genres, status, rating, source }`;
    const ex2 = `// 2) Search\nconst results = await MangaSource.search('chainsaw man');\n\n// 3) Manga detail (with chapters)\nconst manga = await MangaSource.detail(results[0].id);\nconsole.log(manga.title, manga.synopsis, manga.genres);\n\n// 4) Chapters (optionally by language)\nconst chapters = await MangaSource.chapters(manga.id, 'sfw', 'en');\n\n// 5) Chapter page images\nconst pages = await MangaSource.pages(chapters[0], manga);\npages.forEach(url => { /* <img src=proxiedImage(url)> */ });`;
    const ex3 = `<!-- Embed the whole reader as a widget -->\n<iframe\n  src="${location.origin}${location.pathname}#/library"\n  style="width:100%;height:80vh;border:0;border-radius:16px"\n  title="MangaVerse"\n></iframe>`;
    const ex4 = `// Fetch MangaDex directly through MangaVerse's resilient proxy chain\n// (handles CORS + retries for you):\nconst data = await MangaNet.fetchJSON(\n  'https://api.mangadex.org/manga?limit=5&order[followedCount]=desc',\n  (d) => d && d.data,   // validator\n  2                     // passes\n);\nconsole.log(data.data.length);`;
    app.innerHTML = `
      <section class="page api-page">
        <div class="page-head"><h1><i data-lucide="code-2"></i> MangaVerse API</h1><p>Treat MangaVerse as an API and embed its data in your own website.</p></div>
        <div class="api-note"><i data-lucide="info"></i> MangaVerse is a client-side app, so the API is a <strong>JavaScript SDK</strong> exposed on <code>window.MangaSource</code> (and <code>window.MangaNet</code> for raw proxied fetches) — plus an embeddable iframe widget. No API key required.</div>
        <div class="api-methods">
          <h2>Methods (window.MangaSource)</h2>
          <table class="api-table">
            <tr><th>Method</th><th>Returns</th></tr>
            <tr><td><code>list({limit, offset, content})</code></td><td>Array of manga</td></tr>
            <tr><td><code>search(query, {content})</code></td><td>Array of manga</td></tr>
            <tr><td><code>detail(id)</code></td><td>Manga (with <code>.chapters</code>)</td></tr>
            <tr><td><code>chapters(id, content, lang)</code></td><td>Array of chapters</td></tr>
            <tr><td><code>pages(chapter, manga)</code></td><td>Array of image URLs</td></tr>
            <tr><td><code>proxiedImage(url, attempt)</code></td><td>Proxied image URL</td></tr>
          </table>
        </div>
        ${apiCodeBlock("Get popular manga", ex1)}
        ${apiCodeBlock("Search, detail, chapters & pages", ex2)}
        ${apiCodeBlock("Raw proxied fetch (window.MangaNet)", ex4)}
        ${apiCodeBlock("Embed as an iframe widget", ex3)}
      </section>`;
    afterRender();
    $$(".copy-code").forEach(b => b.addEventListener("click", () => {
      const code = b.closest(".api-block").querySelector("code").textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => toast("Copied to clipboard.", "success"));
    }));
  }
  function apiCodeBlock(title, code) {
    return `<div class="api-block">
      <div class="api-block-head"><h3>${esc(title)}</h3><button class="btn btn-ghost btn-sm copy-code"><i data-lucide="copy"></i> Copy</button></div>
      <pre class="api-code"><code>${esc(code)}</code></pre>
    </div>`;
  }

  /* ============================================================
     Avatar picker (upload OR bitmoji OR manga gallery)
     ============================================================ */
  function openAvatarPicker(onPick) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay open";
    overlay.id = "avatarPicker";
    const bitmoji = Auth.avatarGallery("bitmoji", 12);
    const manga = Auth.avatarGallery("manga", 12);
    overlay.innerHTML = `
      <div class="modal avatar-picker-card" role="dialog" aria-modal="true">
        <button class="modal-close" id="apClose"><i data-lucide="x"></i></button>
        <h2>Choose an avatar</h2>
        <div class="ap-tabs">
          <button class="ap-tab active" data-aptab="upload"><i data-lucide="upload"></i> Upload</button>
          <button class="ap-tab" data-aptab="bitmoji"><i data-lucide="smile"></i> Bitmoji</button>
          <button class="ap-tab" data-aptab="manga"><i data-lucide="sparkles"></i> Manga</button>
        </div>
        <div class="ap-panel" data-appanel="upload">
          <label class="ap-upload"><i data-lucide="image-plus"></i><span>Click to upload a photo</span><input type="file" id="apFile" accept="image/*" hidden /></label>
          <p class="muted">Your photo is compressed and stored locally on your device.</p>
        </div>
        <div class="ap-panel" data-appanel="bitmoji" hidden>
          <div class="ap-gallery">${bitmoji.map(u => `<button class="ap-av" data-av="${esc(u)}"><img src="${esc(u)}" alt="avatar" /></button>`).join("")}</div>
        </div>
        <div class="ap-panel" data-appanel="manga" hidden>
          <div class="ap-gallery">${manga.map(u => `<button class="ap-av" data-av="${esc(u)}"><img src="${esc(u)}" alt="avatar" /></button>`).join("")}</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    icons();
    const close = () => overlay.remove();
    $("#apClose").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    $$(".ap-tab").forEach(t => t.addEventListener("click", () => {
      $$(".ap-tab").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      const which = t.getAttribute("data-aptab");
      $$(".ap-panel").forEach(p => p.hidden = p.getAttribute("data-appanel") !== which);
    }));
    $("#apFile").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const url = await S().processAvatar(f); onPick(url); close(); }
      catch (ex) { toast(ex.message || "Couldn't process image.", "error"); }
    });
    overlay.addEventListener("click", (e) => {
      const b = e.target.closest(".ap-av");
      if (b) { onPick(b.getAttribute("data-av")); close(); }
    });
  }

  /* ---------------- boot ---------------- */
  // Ensure the pre-configured admin account exists (idempotent).
  if (window.Auth) window.Auth.ensureAdmin("akewusholaabdulbakri101@gmail.com", "brokenvzn", "akewushola_admin");
  // Record real daily-active-user activity for the analytics dashboard.
  if (window.Social && window.Social.markActiveToday) {
    window.Social.markActiveToday();
    Auth.onChange(() => { try { window.Social.markActiveToday(); } catch (e) {} });
  }
  // Make sure MangaBot is a member of every existing group chat.
  if (window.Social && window.Social.ensureBotEverywhere) {
    try { window.Social.ensureBotEverywhere(); } catch (e) {}
  }
  window.addEventListener("hashchange", router);
  buildLangSelectors();
  renderAccount();
  buildMobileMenu();
  refreshNotifBadge();
  router();

  // Supabase Auth session restore: if the owner has connected Supabase, restore
  // any persisted cross-device session (JWT) and auto-login. Falls back to the
  // localStorage session when not connected / no session. Re-render on change.
  if (window.Auth && window.Auth.restoreSession) {
    const before = (Auth.current() || {}).id || null;
    Auth.restoreSession().then((u) => {
      const after = (u && u.id) || null;
      if (after !== before) {
        renderAccount(); buildMobileMenu(); refreshNotifBadge(); router();
        if (after) toast("Signed in across devices via Supabase.", "success");
      }
    }).catch(() => {});
  }
})();