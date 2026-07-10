/* ============================================================
   MangaVerse — localStorage account system
   - signup / login / logout / persisted session
   - input validation with friendly errors
   - password obfuscation (salted hash, NOT real security —
     this is a client-only demo, clearly noted in the UI)
   - per-user data: bookmarks, history, last-read (continue reading)
   ============================================================ */
(function () {
  "use strict";

  const USERS_KEY = "mv_users";
  const SESSION_KEY = "mv_session";
  // Any account created/logged-in with THIS email is automatically an app
  // admin (verified too), no matter how it was created (localStorage or
  // Supabase Auth). The pre-seeded admin uses the same email.
  const ADMIN_EMAIL = "akewusholaabdulbakri101@gmail.com";
  function isAdminEmail(e) { return (e || "").trim().toLowerCase() === ADMIN_EMAIL; }

  function read(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function write(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  // Lightweight salted hash (djb2-based). NOT cryptographically secure —
  // purely to avoid storing raw plaintext passwords in localStorage.
  function hashPassword(pw, salt) {
    const str = salt + "::" + pw + "::mangaverse";
    let h1 = 5381, h2 = 52711;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = ((h1 << 5) + h1 + c) >>> 0;
      h2 = ((h2 << 5) + h2 + c * 31) >>> 0;
    }
    return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0"));
  }
  function makeSalt() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* ---------- Avatars ----------
     Real image avatars were fetched from a remote source before and broke.
     Now every account gets a guaranteed-working avatar: an inline SVG
     "initials" avatar (rendered as a data-URI, never a network request),
     with the option for the user to upload their own picture (compressed to
     base64 and saved in localStorage against their account). */
  const AVATAR_PALETTE = [
    ["#00e5ff", "#0077b6"], ["#00ffa3", "#009e60"], ["#ff5db1", "#7b2ff7"],
    ["#ffb703", "#fb8500"], ["#4cc9f0", "#4361ee"], ["#f72585", "#b5179e"],
    ["#43e97b", "#38f9d7"], ["#fa709a", "#fee140"], ["#30cfd0", "#330867"],
    ["#f857a6", "#ff5858"], ["#08aeea", "#2af598"], ["#ff9966", "#ff5e62"]
  ];
  function initialsFor(name) {
    const s = (name || "?").trim();
    if (!s) return "?";
    const parts = s.split(/[\s_.-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return s.slice(0, 2).toUpperCase();
  }
  function hashCode(str) {
    let h = 0; for (let i = 0; i < (str || "").length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }
  /* ---------- Preset avatar galleries ----------
     Two galleries of ready-to-pick avatars, generated as inline-SVG
     data-URIs so they ALWAYS render (no network, never 404):
       • "bitmoji" — friendly flat face avatars (varied skin/hair)
       • "manga"   — anime/manga-style character faces
     The user can pick one instead of uploading a photo. */
  // Robustly turn an SVG string into a data URI. We base64-encode the whole
  // SVG (via a UTF-8-safe btoa) so raw '#' in fill colors (e.g. fill='#06121a')
  // can never be mis-read as a URL fragment and truncate the image. This is
  // the reliable, universally-supported form for inline SVG avatars.
  function svgToDataUri(svg) {
    try {
      const b64 = btoa(unescape(encodeURIComponent(svg)));
      return "data:image/svg+xml;base64," + b64;
    } catch (e) {
      // Ultra-defensive fallback: percent-encode (# is encoded by
      // encodeURIComponent to %23, so this is still safe).
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    }
  }
  function svgDataUri(inner, size) {
    size = size || 120;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 120 120'>${inner}</svg>`;
    return svgToDataUri(svg);
  }
  const SKINS = ["#ffdbac", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffe0bd"];
  const HAIRS = ["#2b2b2b", "#4a2c14", "#7b3f00", "#111", "#5a189a", "#00b4d8", "#e63946", "#ff9e00", "#2a9d8f", "#adb5bd"];
  const BGS = [["#00e5ff", "#0077b6"], ["#00ffa3", "#009e60"], ["#ff5db1", "#7b2ff7"], ["#ffb703", "#fb8500"], ["#4cc9f0", "#4361ee"], ["#f72585", "#b5179e"], ["#43e97b", "#38f9d7"], ["#fa709a", "#fee140"]];

  // Bitmoji-style friendly flat face
  function bitmojiAvatar(i) {
    const skin = SKINS[i % SKINS.length];
    const hair = HAIRS[(i * 3) % HAIRS.length];
    const bg = BGS[i % BGS.length];
    const smile = i % 2 === 0
      ? `<path d='M46 74 Q60 88 74 74' stroke='#5a2d0c' stroke-width='4' fill='none' stroke-linecap='round'/>`
      : `<ellipse cx='60' cy='78' rx='9' ry='6' fill='#5a2d0c'/>`;
    const inner =
      `<defs><linearGradient id='b${i}' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${bg[0]}'/><stop offset='1' stop-color='${bg[1]}'/></linearGradient></defs>` +
      `<rect width='120' height='120' rx='60' fill='url(#b${i})'/>` +
      `<path d='M30 40 Q60 8 90 40 L90 52 Q60 40 30 52 Z' fill='${hair}'/>` +   // hair top
      `<circle cx='60' cy='62' r='30' fill='${skin}'/>` +
      `<path d='M30 44 Q60 30 90 44 L90 40 Q60 14 30 40 Z' fill='${hair}'/>` +
      `<circle cx='50' cy='58' r='4.5' fill='#22303a'/><circle cx='70' cy='58' r='4.5' fill='#22303a'/>` +
      smile +
      `<circle cx='44' cy='70' r='4' fill='#ff8fa3' opacity='.5'/><circle cx='76' cy='70' r='4' fill='#ff8fa3' opacity='.5'/>`;
    return svgDataUri(inner);
  }
  // Manga/anime-style character face (big eyes, sharp hair)
  function mangaAvatar(i) {
    const skin = ["#ffe7d0", "#ffdfc4", "#f6d2b0"][i % 3];
    const hair = ["#1b1b2f", "#e63946", "#00b4d8", "#8338ec", "#ff9e00", "#2a9d8f", "#f72585", "#3a86ff", "#fb5607", "#06d6a0"][i % 10];
    const bg = BGS[(i + 2) % BGS.length];
    const eyeColor = ["#7b2ff7", "#00b4d8", "#e63946", "#2a9d8f", "#ff9e00"][i % 5];
    const inner =
      `<defs><linearGradient id='m${i}' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${bg[0]}'/><stop offset='1' stop-color='${bg[1]}'/></linearGradient></defs>` +
      `<rect width='120' height='120' rx='60' fill='url(#m${i})'/>` +
      `<path d='M28 58 Q30 26 60 22 Q90 26 92 58 L84 58 Q80 40 60 38 Q40 40 36 58 Z' fill='${hair}'/>` + // back hair
      `<ellipse cx='60' cy='64' rx='26' ry='30' fill='${skin}'/>` +
      `<path d='M32 52 Q42 24 60 24 Q78 24 88 52 Q74 34 60 34 Q46 34 32 52 Z' fill='${hair}'/>` + // fringe
      `<path d='M60 24 L52 44 L62 40 Z' fill='${hair}'/>` +
      // big anime eyes
      `<ellipse cx='49' cy='66' rx='6.5' ry='9' fill='#fff'/><ellipse cx='71' cy='66' rx='6.5' ry='9' fill='#fff'/>` +
      `<circle cx='49' cy='67' r='4.5' fill='${eyeColor}'/><circle cx='71' cy='67' r='4.5' fill='${eyeColor}'/>` +
      `<circle cx='50.5' cy='65' r='1.5' fill='#fff'/><circle cx='72.5' cy='65' r='1.5' fill='#fff'/>` +
      `<path d='M42 56 Q49 52 56 56' stroke='${hair}' stroke-width='2' fill='none' stroke-linecap='round'/>` +
      `<path d='M64 56 Q71 52 78 56' stroke='${hair}' stroke-width='2' fill='none' stroke-linecap='round'/>` +
      `<path d='M55 80 Q60 84 65 80' stroke='#c96b5b' stroke-width='2.5' fill='none' stroke-linecap='round'/>`;
    return svgDataUri(inner);
  }
  function avatarGallery(kind, count) {
    count = count || 12;
    const gen = kind === "manga" ? mangaAvatar : bitmojiAvatar;
    const out = [];
    for (let i = 0; i < count; i++) out.push(gen(i));
    return out;
  }

  // Deterministic inline-SVG initials avatar as a data-URI. Always renders,
  // never 404s. Used as the default and as a fallback if an upload is missing.
  function initialsAvatar(name, seed) {
    const pair = AVATAR_PALETTE[hashCode(seed || name || "x") % AVATAR_PALETTE.length];
    const initials = initialsFor(name);
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'>` +
      `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
      `<stop offset='0' stop-color='${pair[0]}'/><stop offset='1' stop-color='${pair[1]}'/>` +
      `</linearGradient></defs>` +
      `<rect width='120' height='120' rx='60' fill='url(#g)'/>` +
      `<text x='50%' y='50%' dy='.35em' text-anchor='middle' ` +
      `font-family='Outfit,Segoe UI,Arial,sans-serif' font-size='48' font-weight='700' ` +
      `fill='#06121a'>${initials}</text></svg>`;
    return svgToDataUri(svg);
  }

  const Auth = {
    initialsAvatar,
    avatarGallery,          // (kind='bitmoji'|'manga', count) -> [dataUri]
    // Avatar URL for ANY user object (or the current user). Priority:
    // uploaded/selected avatar → generated initials avatar (always works).
    avatarFor(user) {
      if (!user) return initialsAvatar("?", "guest");
      if (user.avatar) return user.avatar;
      return initialsAvatar(user.displayName || user.username, user.id || user.username);
    },
    // Avatar for an arbitrary username string (used for seeded/demo identities).
    avatarForName(name) { return initialsAvatar(name, name); },
    listeners: [],
    onChange(fn) { this.listeners.push(fn); },
    _emit() { this.listeners.forEach(fn => { try { fn(this.current()); } catch (e) {} }); },

    users() { return read(USERS_KEY, []); },

    _pub(u) {
      if (!u) return null;
      return {
        id: u.id, username: u.username, email: u.email,
        displayName: u.displayName || u.username,
        bio: u.bio || "", avatar: u.avatar || "",
        location: u.location || "", role: u.role || "",
        skills: u.skills || [], createdAt: u.createdAt,
        isAdmin: !!u.isAdmin,
        verified: !!u.verified,
        banned: !!u.banned,
        // admin-boostable follower count. Real follows add on top of the boost.
        followersCount: (u.followersBoost || 0) + this._realFollowers(u.id),
        followersBoost: u.followersBoost || 0,
        following: (u.data && u.data.following) || []
      };
    },

    // How many OTHER accounts on this device actually follow `userId`.
    _realFollowers(userId) {
      let n = 0;
      this.users().forEach(x => {
        if (x.id === userId) return;
        if (x.data && Array.isArray(x.data.following) && x.data.following.includes(userId)) n++;
      });
      return n;
    },

    current() {
      const s = read(SESSION_KEY, null);
      if (!s) return null;
      const u = this.users().find(x => x.id === s.id);
      if (!u) return null;
      return this._pub(u);
    },

    // Public profile of ANY user by id or username (for other people's pages).
    getUser(idOrName) {
      const key = (idOrName || "").toLowerCase();
      const u = this.users().find(x =>
        x.id === idOrName || x.username.toLowerCase() === key);
      return this._pub(u);
    },
    allUsers() { return this.users().map(u => this._pub(u)); },

    isLoggedIn() { return !!this.current(); },

    signup({ username, email, password, confirm }) {
      username = (username || "").trim();
      email = (email || "").trim().toLowerCase();

      if (username.length < 3) throw new Error("Username must be at least 3 characters.");
      if (!/^[a-zA-Z0-9_]+$/.test(username)) throw new Error("Username can only contain letters, numbers and underscores.");
      if (!EMAIL_RE.test(email)) throw new Error("Please enter a valid email address.");
      if ((password || "").length < 6) throw new Error("Password must be at least 6 characters.");
      if (password !== confirm) throw new Error("Passwords do not match.");

      const users = this.users();
      if (users.some(u => u.username.toLowerCase() === username.toLowerCase()))
        throw new Error("That username is already taken.");
      if (users.some(u => u.email === email))
        throw new Error("An account with that email already exists.");

      const salt = makeSalt();
      const admin = isAdminEmail(email);
      const user = {
        id: "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        username, email, salt,
        hash: hashPassword(password, salt),
        displayName: username,
        bio: "", avatar: "", location: "", role: admin ? "Admin" : "",
        skills: [],
        // Any account on the admin email is auto-admin + verified.
        isAdmin: admin, verified: admin,
        createdAt: new Date().toISOString(),
        data: { bookmarks: [], history: [], lastRead: {}, following: [] }
      };
      users.push(user);
      write(USERS_KEY, users);
      write(SESSION_KEY, { id: user.id, at: Date.now() });
      if (window.Cloud && window.Cloud.isReady()) window.Cloud.syncProfile(user);
      this._emit();
      return this.current();
    },

    login({ identifier, password }) {
      identifier = (identifier || "").trim().toLowerCase();
      if (!identifier) throw new Error("Enter your email or username.");
      if (!password) throw new Error("Enter your password.");

      const users = this.users();
      const u = users.find(x =>
        x.email === identifier || x.username.toLowerCase() === identifier);
      if (!u) throw new Error("No account found with those details.");
      if (hashPassword(password, u.salt) !== u.hash)
        throw new Error("Incorrect password. Please try again.");
      if (u.banned) throw new Error("This account has been suspended by an administrator.");

      // Auto-promote: anyone logging in with the admin email becomes admin.
      if (isAdminEmail(u.email) && (!u.isAdmin || !u.verified)) {
        u.isAdmin = true; u.verified = true; write(USERS_KEY, users);
      }

      write(SESSION_KEY, { id: u.id, at: Date.now() });
      this._emit();
      return this.current();
    },

    logout() {
      localStorage.removeItem(SESSION_KEY);
      if (window.Cloud && window.Cloud.hasAuth && window.Cloud.hasAuth()) { try { window.Cloud.authSignOut(); } catch (e) {} }
      this._emit();
    },

    ADMIN_EMAIL, isAdminEmail,

    // Ensure a LOCAL mirror account exists for a Supabase-authenticated user,
    // so all per-user data (bookmarks, posts authorship, chats) keeps working
    // offline and the session model stays identical. Keyed by the auth id.
    _ensureLocalForAuth(authUser) {
      const email = (authUser.email || "").toLowerCase();
      const users = this.users();
      let u = users.find(x => x.authId === authUser.id) || users.find(x => x.email === email);
      const admin = isAdminEmail(email);
      if (!u) {
        const base = (email.split("@")[0] || "user").replace(/[^a-zA-Z0-9_]/g, "") || "user";
        let username = base, n = 1;
        while (users.some(x => x.username.toLowerCase() === username.toLowerCase())) username = base + (++n);
        u = {
          id: "u_sb_" + authUser.id.slice(0, 10), authId: authUser.id,
          username, email, salt: "", hash: "",
          displayName: username, bio: "", avatar: "", location: "", role: admin ? "Admin" : "",
          skills: [], isAdmin: admin, verified: admin,
          createdAt: new Date().toISOString(),
          data: { bookmarks: [], history: [], lastRead: {}, following: [] }
        };
        users.push(u);
      } else {
        u.authId = authUser.id;
        if (admin) { u.isAdmin = true; u.verified = true; if (!u.role) u.role = "Admin"; }
      }
      write(USERS_KEY, users);
      write(SESSION_KEY, { id: u.id, at: Date.now() });
      if (window.Cloud && window.Cloud.isReady()) window.Cloud.syncAuthProfile(this._pub(u), authUser.id);
      this._emit();
      return this.current();
    },

    // Cloud-aware signup: uses Supabase Auth when connected, else localStorage.
    async signupSmart({ username, email, password, confirm }) {
      const cloudReady = window.Cloud && window.Cloud.hasAuth && window.Cloud.hasAuth();
      if (cloudReady) {
        if (password !== confirm) throw new Error("Passwords do not match.");
        const res = await window.Cloud.authSignUp((email || "").trim().toLowerCase(), password);
        // also create a local account (so it works offline + username is kept)
        try { this.signup({ username, email, password, confirm }); } catch (e) { /* email may already exist locally */ }
        if (res && res.id) this._ensureLocalForAuth(res);
        if (res && res.needsConfirm) return { needsConfirm: true };
        return this.current();
      }
      return this.signup({ username, email, password, confirm });
    },

    // Cloud-aware login: tries Supabase Auth (by email) when connected, then
    // falls back to the localStorage login (by email OR username).
    async loginSmart({ identifier, password }) {
      const cloudReady = window.Cloud && window.Cloud.hasAuth && window.Cloud.hasAuth();
      const looksEmail = /@/.test(identifier || "");
      if (cloudReady && looksEmail) {
        try {
          const res = await window.Cloud.authSignIn((identifier || "").trim().toLowerCase(), password);
          if (res && res.id) return this._ensureLocalForAuth(res);
        } catch (e) {
          // fall through to local login (account may be local-only)
        }
      }
      return this.login({ identifier, password });
    },

    /* ---------- Supabase Auth session restore (cross-device identity) ----------
       On page load, if Supabase is connected, restore the persisted Supabase
       session (JWT) and auto-login the matching local mirror account. This means
       logging in on one device keeps you logged in on reload AND the same
       account works on another device (once that device is connected with the
       same keys). Falls back to the localStorage session when Supabase isn't
       connected or there's no valid session. The auto-admin email rule is kept
       (isAdminEmail) so a restored owner session still gets admin + verified.

       Because Cloud auto-connects a tick after boot, we briefly wait for it to
       become ready before asking for the session. */
    async restoreSession() {
      // If Supabase isn't even configured, nothing to restore beyond local.
      if (!(window.Cloud && window.Cloud.configured && window.Cloud.configured())) {
        return this.current();
      }
      // Wait (max ~3s) for Cloud auth to be ready (SDK loaded + client built).
      const ready = await this._waitForCloudAuth(3000);
      if (!ready) return this.current(); // offline / connect failed -> local fallback

      // Keep the app session in lock-step with Supabase auth events.
      if (!this._authSub) {
        this._authSub = window.Cloud.onAuthStateChange((event, u) => {
          if (event === "SIGNED_OUT") {
            localStorage.removeItem(SESSION_KEY); this._emit();
          } else if (u && u.id) {
            this._ensureLocalForAuth(u);
          }
        });
      }

      try {
        const u = await window.Cloud.getSession();
        if (u && u.id) {
          const restored = this._ensureLocalForAuth(u);   // creates/links local mirror + session
          return restored;
        }
      } catch (e) { /* fall through to local */ }
      return this.current();
    },
    // Resolve once window.Cloud.hasAuth() is true, or after `ms` timeout.
    _waitForCloudAuth(ms) {
      return new Promise(resolve => {
        const t0 = Date.now();
        const tick = () => {
          if (window.Cloud && window.Cloud.hasAuth && window.Cloud.hasAuth()) return resolve(true);
          if (Date.now() - t0 > (ms || 3000)) return resolve(false);
          setTimeout(tick, 150);
        };
        tick();
      });
    },

    /* ---------- profile editing ---------- */
    updateProfile(fields) {
      const cur = this.current();
      if (!cur) throw new Error("Not signed in.");
      const users = this.users();
      const u = users.find(x => x.id === cur.id);
      if (!u) throw new Error("Account not found.");
      if (typeof fields.displayName === "string") {
        const dn = fields.displayName.trim();
        u.displayName = dn || u.username;
      }
      if (typeof fields.bio === "string") u.bio = fields.bio.slice(0, 280);
      if (typeof fields.location === "string") u.location = fields.location.slice(0, 60);
      if (typeof fields.role === "string") u.role = fields.role.slice(0, 40);
      if (typeof fields.avatar === "string") u.avatar = fields.avatar; // "" clears → initials
      if (Array.isArray(fields.skills)) u.skills = fields.skills.slice(0, 24);
      write(USERS_KEY, users);
      if (window.Cloud && window.Cloud.isReady()) window.Cloud.syncProfile(u);
      this._emit();
      return this._pub(u);
    },
    setAvatar(dataUrl) { return this.updateProfile({ avatar: dataUrl || "" }); },

    /* ---------- follows ---------- */
    isFollowing(userId) {
      const d = this.getData();
      return (d.following || []).includes(userId);
    },
    toggleFollow(userId) {
      return this._withUser(data => {
        if (!data.following) data.following = [];
        const i = data.following.indexOf(userId);
        if (i >= 0) { data.following.splice(i, 1); return false; }
        data.following.push(userId); return true;
      });
    },

    /* ---------- per-user data ---------- */
    _withUser(mutator) {
      const cur = this.current();
      if (!cur) return null;
      const users = this.users();
      const u = users.find(x => x.id === cur.id);
      if (!u) return null;
      if (!u.data) u.data = { bookmarks: [], history: [], lastRead: {} };
      const result = mutator(u.data, u);
      write(USERS_KEY, users);
      return result;
    },

    getData() {
      const cur = this.current();
      if (!cur) return { bookmarks: [], history: [], lastRead: {}, following: [] };
      const u = this.users().find(x => x.id === cur.id);
      const d = (u && u.data) || { bookmarks: [], history: [], lastRead: {}, following: [] };
      if (!d.following) d.following = [];
      return d;
    },

    isBookmarked(mangaId) {
      return this.getData().bookmarks.some(b => b.id === mangaId);
    },

    toggleBookmark(manga) {
      return this._withUser(data => {
        const idx = data.bookmarks.findIndex(b => b.id === manga.id);
        if (idx >= 0) { data.bookmarks.splice(idx, 1); return false; }
        data.bookmarks.unshift({
          id: manga.id, title: manga.title, cover: manga.cover,
          genres: manga.genres, status: manga.status, rating: manga.rating,
          source: manga.source, addedAt: Date.now()
        });
        return true;
      });
    },

    // Record a chapter read into history + set continue-reading pointer
    recordRead(manga, chapter) {
      this._withUser(data => {
        data.lastRead[manga.id] = {
          mangaId: manga.id, title: manga.title, cover: manga.cover,
          source: manga.source, chapterId: chapter.id,
          chapterNumber: chapter.number, chapterTitle: chapter.title,
          at: Date.now()
        };
        // history = de-duplicated by manga+chapter, newest first, cap 60
        data.history = data.history.filter(h => !(h.mangaId === manga.id && h.chapterId === chapter.id));
        data.history.unshift({
          mangaId: manga.id, title: manga.title, cover: manga.cover,
          source: manga.source, chapterId: chapter.id,
          chapterNumber: chapter.number, chapterTitle: chapter.title,
          at: Date.now()
        });
        if (data.history.length > 60) data.history.length = 60;
      });
    },

    lastReadFor(mangaId) { return this.getData().lastRead[mangaId] || null; },
    continueReading() {
      const lr = this.getData().lastRead;
      return Object.values(lr).sort((a, b) => b.at - a.at);
    },
    history() { return this.getData().history.slice(); },
    bookmarks() { return this.getData().bookmarks.slice(); },

    clearHistory() { this._withUser(data => { data.history = []; }); },

    /* ---------- admin ---------- */
    isAdmin() { const c = this.current(); return !!(c && c.isAdmin); },
    // Ensure the pre-configured admin account exists (idempotent). Runs once
    // at boot. Credentials are provided by the site owner. If the account
    // already exists we RESET its password to the supplied one and make sure
    // it's flagged admin + verified (so credential rotations take effect).
    ensureAdmin(email, password, username) {
      email = (email || "").toLowerCase();
      const users = this.users();
      let u = users.find(x => x.email === email);
      if (!u) {
        const salt = makeSalt();
        u = {
          id: "u_admin_" + Math.random().toString(36).slice(2, 8),
          username: username || "admin", email, salt,
          hash: hashPassword(password, salt),
          displayName: username || "Admin",
          bio: "MangaVerse administrator.", avatar: "", location: "", role: "Admin",
          skills: [], isAdmin: true, verified: true,
          createdAt: new Date().toISOString(),
          data: { bookmarks: [], history: [], lastRead: {}, following: [] }
        };
        users.push(u);
        write(USERS_KEY, users);
      } else {
        // Keep the admin's credentials in sync with the configured password
        // (so a rotated password like brokenvzn always works) and ensure flags.
        u.isAdmin = true; u.verified = true;
        if (!u.salt) u.salt = makeSalt();
        u.hash = hashPassword(password, u.salt);
        write(USERS_KEY, users);
      }
    },
    // admin-only: delete a user (and cascade is left to caller). Returns bool.
    adminDeleteUser(userId) {
      if (!this.isAdmin()) return false;
      const me = this.current();
      if (userId === me.id) return false; // don't delete yourself
      let users = this.users();
      users = users.filter(x => x.id !== userId);
      write(USERS_KEY, users);
      this._emit();
      return true;
    },
    // admin-only: grant / revoke the verified badge. Reflects app-wide because
    // _pub() surfaces `verified` and the UI renders the tick only when true.
    adminSetVerified(userId, val) {
      if (!this.isAdmin()) return false;
      const users = this.users();
      const u = users.find(x => x.id === userId);
      if (!u) return false;
      u.verified = !!val;
      write(USERS_KEY, users);
      this._emit();
      return u.verified;
    },
    // admin-only: set/increase a user's follower boost. `followersCount` in
    // _pub() = boost + real follows, so this shows everywhere the count shows.
    adminBoostFollowers(userId, amount, mode) {
      if (!this.isAdmin()) return false;
      const users = this.users();
      const u = users.find(x => x.id === userId);
      if (!u) return false;
      amount = parseInt(amount, 10) || 0;
      if (mode === "add") u.followersBoost = Math.max(0, (u.followersBoost || 0) + amount);
      else u.followersBoost = Math.max(0, amount); // set absolute boost
      write(USERS_KEY, users);
      this._emit();
      return u.followersBoost;
    },
    // admin-only: ban / unban a user (blocks login; flagged in admin table).
    adminSetBanned(userId, val) {
      if (!this.isAdmin()) return false;
      const me = this.current();
      if (userId === me.id) return false;
      const users = this.users();
      const u = users.find(x => x.id === userId);
      if (!u) return false;
      u.banned = !!val;
      write(USERS_KEY, users);
      this._emit();
      return u.banned;
    },
    // admin-only: edit a user's display name / role from the panel.
    adminEditUser(userId, fields) {
      if (!this.isAdmin()) return false;
      const users = this.users();
      const u = users.find(x => x.id === userId);
      if (!u) return false;
      if (typeof fields.displayName === "string" && fields.displayName.trim()) u.displayName = fields.displayName.trim().slice(0, 40);
      if (typeof fields.role === "string") u.role = fields.role.slice(0, 40);
      write(USERS_KEY, users);
      this._emit();
      return true;
    },

    /* ---------- admin feature flags (moderation / app toggles) ---------- */
    features() {
      const def = { feed: true, chat: true, adult: true, signups: true, api: true };
      const f = read("mv_features", {});
      return Object.assign(def, f);
    },
    featureOn(key) { const f = this.features(); return f[key] !== false; },
    adminSetFeature(key, val) {
      if (!this.isAdmin()) return false;
      const f = this.features();
      f[key] = !!val;
      write("mv_features", f);
      this._emit();
      return f[key];
    }
  };

  window.Auth = Auth;
})();
