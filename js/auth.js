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

  const Auth = {
    listeners: [],
    onChange(fn) { this.listeners.push(fn); },
    _emit() { this.listeners.forEach(fn => { try { fn(this.current()); } catch (e) {} }); },

    users() { return read(USERS_KEY, []); },

    current() {
      const s = read(SESSION_KEY, null);
      if (!s) return null;
      const u = this.users().find(x => x.id === s.id);
      if (!u) return null;
      return { id: u.id, username: u.username, email: u.email };
    },

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
      const user = {
        id: "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        username, email, salt,
        hash: hashPassword(password, salt),
        createdAt: new Date().toISOString(),
        data: { bookmarks: [], history: [], lastRead: {} }
      };
      users.push(user);
      write(USERS_KEY, users);
      write(SESSION_KEY, { id: user.id, at: Date.now() });
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

      write(SESSION_KEY, { id: u.id, at: Date.now() });
      this._emit();
      return this.current();
    },

    logout() { localStorage.removeItem(SESSION_KEY); this._emit(); },

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
      if (!cur) return { bookmarks: [], history: [], lastRead: {} };
      const u = this.users().find(x => x.id === cur.id);
      return (u && u.data) || { bookmarks: [], history: [], lastRead: {} };
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

    clearHistory() { this._withUser(data => { data.history = []; }); }
  };

  window.Auth = Auth;
})();
