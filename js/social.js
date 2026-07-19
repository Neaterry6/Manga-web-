/* ============================================================
   MangaVerse / DevzConn — Social layer (localStorage)
   ------------------------------------------------------------
   REAL, client-side social features between the ACTUAL registered
   accounts on this browser/device (no seeded/fake users or bots):
     - Posts (feed): create, like, REACTIONS (emoji pills),
       comments incl. IMAGE comments, delete, persist
     - Chat: 1:1 DMs + GROUP chats between real registered users
     - Notifications: likes / comments / reactions / follows /
       messages, generated from real actions, with unread count
     - Media: images/videos read from a file input, compressed to
       a base64 data-URL and stored in localStorage (no backend)
     - Avatar upload / gallery helper (reuses the compressor)
   Honest note: "real users" = real accounts registered in THIS
   browser (localStorage is per-device). A shared backend
   (Supabase) would be needed for true cross-device sync.
   ============================================================ */
(function () {
  "use strict";

  const POSTS_KEY = "mv_posts";
  const CHATS_KEY = "mv_chats";   // { convId: { id, kind:'dm'|'group', name?, members:[uid], messages:[...] } }
  const NOTIF_KEY = "mv_notifs";  // { userId: [ {id,type,fromId,...,read,at} ] }
  const DAU_KEY   = "mv_dau";     // { "YYYY-MM-DD": [userId, ...] }  — real daily-active tracking

  // MangaBot — a fixed assistant "user" auto-added to every group chat.
  const BOT_ID = "bot_mangabot";
  // Agnes AI config for image generation (MangaBot)
  const AGNES_KEY = "sk-xXnSB786FgMbtOCXG79ykGyc8rAoLn5UKq32v6xZTF4ebjQi";
  const AGNES_URL = "https://apihub.agnes-ai.com/v1/images/generations";
  // Generate image via Agnes AI
  async function agnesGenerate(prompt) {
    try {
      const r = await fetch(AGNES_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + AGNES_KEY },
        body: JSON.stringify({ model: "agnes-image-2.0-flash", prompt: prompt, size: "1024x1024" })
      });
      const d = await r.json();
      if (d.data && d.data.length && d.data[0].url) return d.data[0].url;
      if (d.data && d.data.length && d.data[0].b64_json) return "data:image/png;base64," + d.data[0].b64_json;
      return null;
    } catch (e) { console.warn("Agnes AI failed:", e); return null; }
  }

  // Inline-SVG avatar (data URI) so it can never 404 — a friendly cyan robot.
  const BOT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%230b1220'/%3E%3Crect x='26' y='30' width='48' height='38' rx='11' fill='%2300e5ff'/%3E%3Ccircle cx='40' cy='49' r='6' fill='%230b1220'/%3E%3Ccircle cx='60' cy='49' r='6' fill='%230b1220'/%3E%3Crect x='44' y='60' width='12' height='4' rx='2' fill='%230b1220'/%3E%3Cline x1='50' y1='20' x2='50' y2='30' stroke='%2300e5ff' stroke-width='3'/%3E%3Ccircle cx='50' cy='18' r='4' fill='%2300ffa3'/%3E%3C/svg%3E";

  function read(key, fb) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; }
    catch (e) { return fb; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { console.warn("localStorage write failed for", key, e); return false; }
  }
  const uid = (p) => (p || "id_") + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // Fire-and-forget cloud mirror (no-op when Supabase isn't configured).
  function cloudPost(p) { if (window.Cloud && window.Cloud.isReady()) window.Cloud.syncPost(p); }
  function cloudChat(c) { if (window.Cloud && window.Cloud.isReady()) window.Cloud.syncChat(c); }
  function cloudDelPost(id) { if (window.Cloud && window.Cloud.isReady()) window.Cloud.deletePostRemote(id); }

  /* ---------- media: compress a File to a base64 data URL ---------- */
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  function compressImage(file, maxEdge, quality) {
    maxEdge = maxEdge || 1000; quality = quality || 0.82;
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > h && w > maxEdge) { h = Math.round(h * maxEdge / w); w = maxEdge; }
        else if (h >= w && h > maxEdge) { w = Math.round(w * maxEdge / h); h = maxEdge; }
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        try { resolve(c.toDataURL("image/jpeg", quality)); }
        catch (e) { reject(e); }
      };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }
  async function processMedia(file, opts) {
    opts = opts || {};
    if (!file) return null;
    if (file.type.startsWith("image/")) {
      var imgResult = await compressImage(file, { maxW: opts.maxEdge || 800, maxH: opts.maxEdge || 800, quality: opts.quality || 0.7 });
      return { type: "image", url: imgResult.dataUrl || imgResult };
    }
    if (file.type.startsWith("video/")) {
      if (file.size > 6 * 1024 * 1024)
        throw new Error("Video is too large for local storage (max ~6MB).");
      const url = await fileToDataURL(file);
      return { type: "video", url };
    }
    if (file.type.startsWith("audio/")) {
      if (file.size > 4 * 1024 * 1024)
        throw new Error("Audio is too large for local storage (max ~4MB).");
      const url = await fileToDataURL(file);
      return { type: "audio", url };
    }
    throw new Error("Unsupported file type.");
  }
  async function processAvatar(file) {
    if (!file || !file.type.startsWith("image/")) throw new Error("Please choose an image file.");
    return compressImage(file, 320, 0.85);
  }
  // Small image (for image comments) — compact to protect storage quota.
  async function processCommentImage(file) {
    if (!file || !file.type.startsWith("image/")) throw new Error("Please choose an image file.");
    return compressImage(file, 700, 0.8);
  }

  /* ---------- authorship / user helpers ---------- */
  function meId() { const u = window.Auth && window.Auth.current(); return u ? u.id : null; }
  function meAsAuthor() {
    const u = (window.Auth && window.Auth.current());
    if (!u) return null;
    return { id: u.id, username: u.username, displayName: u.displayName || u.username, role: u.role || "", avatar: u.avatar || "" };
  }
  // Resolve the freshest profile for an author/member object or id.
  function resolveAuthor(a) {
    if (!a) return { username: "unknown", displayName: "unknown", avatar: "" };
    const id = typeof a === "string" ? a : a.id;
    if (id === BOT_ID) return { id: BOT_ID, username: "mangabot", displayName: "MangaBot", role: "Assistant", bot: true, verified: true, avatar: BOT_AVATAR };
    if (window.Auth) {
      const live = window.Auth.getUser(id) || (a.username && window.Auth.getUser(a.username));
      if (live) return live;
    }
    return typeof a === "string" ? { id: a, username: a, displayName: a, avatar: "" } : a;
  }
  function avatarUrl(author) {
    const a = resolveAuthor(author);
    if (window.Auth) return window.Auth.avatarFor(a);
    return "";
  }

  /* ---------- REACTIONS available on posts ---------- */
  const REACTIONS = [
    { key: "like",  emoji: "👍", label: "Like" },
    { key: "love",  emoji: "❤️", label: "Love" },
    { key: "fire",  emoji: "🔥", label: "Fire" },
    { key: "laugh", emoji: "😂", label: "Haha" },
    { key: "wow",   emoji: "😮", label: "Wow" },
    { key: "sad",   emoji: "😢", label: "Sad" }
  ];

  /* ---------- NOTIFICATIONS ---------- */
  function pushNotif(toUserId, notif) {
    if (!toUserId || toUserId === meId()) return; // never notify yourself
    const all = read(NOTIF_KEY, {});
    if (!all[toUserId]) all[toUserId] = [];
    const rec = Object.assign({ id: uid("n_"), read: false, at: Date.now() }, notif);
    all[toUserId].unshift(rec);
    if (all[toUserId].length > 80) all[toUserId].length = 80;
    write(NOTIF_KEY, all);
    // detail carries the notif payload so app.js can raise a background
    // browser push notification (for message/reaction types) when the tab
    // is hidden. `to` = recipient user id (matches the current user here,
    // since this is a single-device demo).
    window.dispatchEvent(new CustomEvent("mv:notif", { detail: { to: toUserId, notif: rec } }));
  }

  const Social = {
    processMedia, processAvatar, processCommentImage, avatarUrl, resolveAuthor, meAsAuthor,
    REACTIONS,
    reactionMeta(key) { return REACTIONS.find(r => r.key === key) || REACTIONS[0]; },

    /* ----- posts / feed (REAL posts only — no seeds) ----- */
    posts() {
      return read(POSTS_KEY, []).slice().sort((a, b) => b.at - a.at);
    },
    postsBy(userId) {
      return this.posts().filter(p => p.author && (p.author.id === userId));
    },
    getPost(id) { return read(POSTS_KEY, []).find(p => p.id === id) || null; },

    createPost({ text, media }) {
      const author = meAsAuthor();
      if (!author) throw new Error("Please sign in to post.");
      text = (text || "").trim();
      if (!text && !media) throw new Error("Write something or add media to post.");
      const posts = read(POSTS_KEY, []);
      const post = {
        id: uid("p_"), author, text, media: media || null,
        likes: 0, likedBy: [], reactions: {}, comments: [], at: Date.now()
      };
      posts.push(post);
      if (!write(POSTS_KEY, posts))
        throw new Error("Couldn't save — storage full. Try a smaller image/video.");
      cloudPost(post);
      return post;
    },

    deletePost(id) {
      const me = window.Auth && window.Auth.current();
      if (!me) return false;
      let posts = read(POSTS_KEY, []);
      const p = posts.find(x => x.id === id);
      // owner OR admin can delete
      if (!p || !p.author || (p.author.id !== me.id && !me.isAdmin)) return false;
      posts = posts.filter(x => x.id !== id);
      write(POSTS_KEY, posts);
      cloudDelPost(id);
      return true;
    },

    toggleLike(id) {
      const me = window.Auth && window.Auth.current();
      if (!me) throw new Error("Sign in to like posts.");
      const posts = read(POSTS_KEY, []);
      const p = posts.find(x => x.id === id);
      if (!p) return null;
      if (!p.likedBy) p.likedBy = [];
      const i = p.likedBy.indexOf(me.id);
      let liked;
      if (i >= 0) { p.likedBy.splice(i, 1); p.likes = Math.max(0, (p.likes || 0) - 1); liked = false; }
      else {
        p.likedBy.push(me.id); p.likes = (p.likes || 0) + 1; liked = true;
        if (p.author) pushNotif(p.author.id, { type: "like", fromId: me.id, postId: p.id, text: p.text || "" });
      }
      write(POSTS_KEY, posts);
      cloudPost(p);
      return { liked, likes: p.likes };
    },
    hasLiked(post) {
      const me = window.Auth && window.Auth.current();
      return !!(me && post && post.likedBy && post.likedBy.includes(me.id));
    },

    // Toggle an emoji reaction. reactions = { key: [userId,...] }
    toggleReaction(id, key) {
      const me = window.Auth && window.Auth.current();
      if (!me) throw new Error("Sign in to react.");
      const posts = read(POSTS_KEY, []);
      const p = posts.find(x => x.id === id);
      if (!p) return null;
      if (!p.reactions) p.reactions = {};
      if (!p.reactions[key]) p.reactions[key] = [];
      const arr = p.reactions[key];
      const i = arr.indexOf(me.id);
      let on;
      if (i >= 0) { arr.splice(i, 1); on = false; }
      else {
        arr.push(me.id); on = true;
        if (p.author) pushNotif(p.author.id, { type: "reaction", fromId: me.id, postId: p.id, reaction: key, text: p.text || "" });
      }
      if (!arr.length) delete p.reactions[key];
      write(POSTS_KEY, posts);
      cloudPost(p);
      return { on, counts: this.reactionCounts(p), mine: this.myReactions(p) };
    },
    reactionCounts(post) {
      const out = {};
      const r = (post && post.reactions) || {};
      Object.keys(r).forEach(k => { if (r[k] && r[k].length) out[k] = r[k].length; });
      return out;
    },
    myReactions(post) {
      const me = window.Auth && window.Auth.current();
      if (!me) return [];
      const r = (post && post.reactions) || {};
      return Object.keys(r).filter(k => r[k] && r[k].includes(me.id));
    },

    addComment(id, text, media) {
      const author = meAsAuthor();
      if (!author) throw new Error("Sign in to comment.");
      text = (text || "").trim();
      if (!text && !media) return null;
      const posts = read(POSTS_KEY, []);
      const p = posts.find(x => x.id === id);
      if (!p) return null;
      if (!p.comments) p.comments = [];
      const c = { id: uid("c_"), author, text, media: media || null, at: Date.now() };
      p.comments.push(c);
      write(POSTS_KEY, posts);
      cloudPost(p);
      if (p.author) pushNotif(p.author.id, { type: "comment", fromId: author.id, postId: p.id, text: text || "🖼️ image" });
      return c;
    },

    /* ----- chat: 1:1 DMs + GROUP chats (real users only) ----- */
    _chats() { return read(CHATS_KEY, {}); },
    _saveChats(c) { return write(CHATS_KEY, c); },

    // conversations the current user is a member of, newest activity first
    conversations() {
      const me = meId();
      if (!me) return [];
      const chats = this._chats();
      return Object.values(chats)
        .filter(c => (c.members || []).includes(me))
        .sort((a, b) => {
          const la = a.messages.length ? a.messages[a.messages.length - 1].at : a.at || 0;
          const lb = b.messages.length ? b.messages[b.messages.length - 1].at : b.at || 0;
          return lb - la;
        });
    },
    getConversation(id) {
      const c = this._chats()[id] || null;
      const me = meId();
      if (c && me && !(c.members || []).includes(me)) return null;
      return c;
    },

    // start (or fetch) a 1:1 conversation with another real user id
    openConversation(peerId) {
      const me = meId();
      if (!me) throw new Error("Sign in to chat.");
      if (!peerId || peerId === me) throw new Error("Pick someone to chat with.");
      const chats = this._chats();
      let conv = Object.values(chats).find(c =>
        c.kind === "dm" && (c.members || []).length === 2 &&
        c.members.includes(me) && c.members.includes(peerId));
      if (!conv) {
        const id = "dm_" + uid("");
        conv = { id, kind: "dm", members: [me, peerId], messages: [], at: Date.now() };
        // If this is a direct chat with MangaBot, greet the user right away so
        // the DM never opens empty and it's clear how to use the bot.
        if (peerId === BOT_ID) {
          conv.messages.push({ id: uid("m_"), from: BOT_ID, text: "👋 Hi! I'm MangaBot. Ask me anything about manga — try /recommend, /trending, /search <title>, /info <title>, or just say what you're in the mood for. Type /help for the full list.", media: null, at: Date.now(), readBy: [], reactions: {}, bot: true });
        }
        chats[id] = conv;
        this._saveChats(chats);
      }
      return conv;
    },

    createGroup(name, memberIds) {
      const me = meId();
      if (!me) throw new Error("Sign in to create a group.");
      name = (name || "").trim();
      if (!name) throw new Error("Give your group a name.");
      const members = Array.from(new Set([me, ...(memberIds || [])])).filter(Boolean);
      if (members.length < 2) throw new Error("Add at least one other member.");
      // MangaBot is auto-added to every new group as a member.
      if (!members.includes(BOT_ID)) members.push(BOT_ID);
      const chats = this._chats();
      const id = "grp_" + uid("");
      const conv = { id, kind: "group", name, members, owner: me, messages: [], at: Date.now() };
      // MangaBot greets the group so it's visibly present from the start.
      conv.messages.push({ id: uid("m_"), from: BOT_ID, text: "👋 Hi everyone, I'm MangaBot! Type /help to see what I can do — /recommend, /trending, /search <title>, /info <title>.", media: null, at: Date.now(), readBy: [], reactions: {}, bot: true });
      chats[id] = conv;
      this._saveChats(chats);
      cloudChat(conv);
      // notify invited members (never the bot)
      members.forEach(mId => { if (mId !== me && mId !== BOT_ID) pushNotif(mId, { type: "group", fromId: me, convId: id, text: name }); });
      return conv;
    },

    addToGroup(convId, memberIds) {
      const me = meId();
      const chats = this._chats();
      const c = chats[convId];
      if (!c || c.kind !== "group") throw new Error("Group not found.");
      if (!(c.members || []).includes(me)) throw new Error("You're not in this group.");
      (memberIds || []).forEach(mId => {
        if (mId && !c.members.includes(mId)) { c.members.push(mId); pushNotif(mId, { type: "group", fromId: me, convId, text: c.name }); }
      });
      this._saveChats(chats);
      cloudChat(c);
      return c;
    },

    sendMessage(convId, { text, media, replyTo }) {
      const me = window.Auth && window.Auth.current();
      if (!me) throw new Error("Sign in to send messages.");
      const chats = this._chats();
      const conv = chats[convId];
      if (!conv) throw new Error("Conversation not found.");
      if (!(conv.members || []).includes(me.id)) throw new Error("You're not in this conversation.");
      const msg = {
        id: uid("m_"), from: me.id, text: (text || "").trim(),
        media: media || null, at: Date.now(),
        // read receipts: who has read this message (besides the sender).
        readBy: [], reactions: {}
      };
      // reply-to: store a lightweight snapshot of the quoted message so the
      // UI can render a preview even if the original is later edited/deleted.
      if (replyTo) {
        const orig = (conv.messages || []).find(x => x.id === replyTo);
        if (orig) {
          const author = resolveAuthor(orig.from);
          msg.replyTo = {
            id: orig.id,
            from: orig.from,
            name: author.displayName || author.username,
            text: orig.deleted ? "message deleted" : (orig.text || (orig.media ? "📎 Attachment" : "")),
          };
        }
      }
      conv.messages.push(msg);
      // sending a message clears my typing flag for this conversation.
      if (conv.typing && conv.typing[me.id]) delete conv.typing[me.id];
      if (!this._saveChats(chats))
        throw new Error("Couldn't send — storage full. Try a smaller attachment.");
      cloudChat(conv);
      // notify OTHER real members (never the bot) of the new message
      (conv.members || []).forEach(mId => {
        if (mId !== me.id && mId !== BOT_ID) pushNotif(mId, {
          type: "message", fromId: me.id, convId,
          text: msg.text || (msg.media ? "📎 Attachment" : ""),
          group: conv.kind === "group" ? conv.name : null
        });
      });
      return msg;
    },

    /* In-thread message search: returns the ids of messages in a conversation
       whose text matches the query (case-insensitive). Used to filter/highlight. */
    searchMessages(convId, query) {
      const q = (query || "").trim().toLowerCase();
      if (!q) return null; // null = no active search
      const conv = this._chats()[convId];
      if (!conv) return [];
      return (conv.messages || [])
        .filter(m => !m.deleted && (m.text || "").toLowerCase().includes(q))
        .map(m => m.id);
    },

    /* ----- chat: typing indicator -----
       Typing state is stored on the conversation as { userId: timestamp }.
       A user is "typing" if their timestamp is within the last 4 seconds.
       Because this is a single-device demo, typing set by ME is what a peer
       would see; the reader treats OTHER members' fresh timestamps as an
       active "… is typing" indicator. */
    setTyping(convId, isTyping) {
      const me = meId(); if (!me) return;
      const chats = this._chats();
      const conv = chats[convId];
      if (!conv) return;
      if (!conv.typing) conv.typing = {};
      if (isTyping) conv.typing[me.id] = Date.now();
      else delete conv.typing[me.id];
      this._saveChats(chats);
    },
    // Which OTHER members are currently typing (fresh within 4s).
    typingMembers(convId) {
      const me = meId();
      const conv = this._chats()[convId];
      if (!conv || !conv.typing) return [];
      const now = Date.now();
      return Object.keys(conv.typing)
        .filter(id => id !== me && (now - conv.typing[id]) < 4000)
        .map(id => resolveAuthor(id));
    },

    /* ----- chat: read receipts -----
       Mark every message in a conversation NOT sent by me as read-by-me.
       Returns true if anything changed (so the UI can refresh). */
    markConversationRead(convId) {
      const me = meId(); if (!me) return false;
      const chats = this._chats();
      const conv = chats[convId];
      if (!conv) return false;
      let changed = false;
      (conv.messages || []).forEach(m => {
        if (m.from === me) return;
        if (!m.readBy) m.readBy = [];
        if (!m.readBy.includes(me)) { m.readBy.push(me); changed = true; }
      });
      if (changed) this._saveChats(chats);
      return changed;
    },
    // Status of one of MY messages: 'sent' | 'delivered' | 'read'.
    // delivered = at least one other member exists; read = at least one
    // other member has it in readBy.
    messageStatus(conv, m) {
      const me = meId();
      if (!conv || !m || m.from !== me) return null;
      // the bot is a member but never "reads" — exclude it from receipt math.
      const others = (conv.members || []).filter(x => x !== me && x !== BOT_ID);
      if (!others.length) return "sent";
      const readers = (m.readBy || []).filter(x => others.includes(x));
      if (readers.length) return "read";
      return "delivered";
    },

    /* ----- chat: per-message emoji reactions ----- */
    toggleMessageReaction(convId, msgId, emoji) {
      const me = meId(); if (!me) throw new Error("Sign in to react.");
      const chats = this._chats();
      const conv = chats[convId];
      if (!conv) return null;
      const m = (conv.messages || []).find(x => x.id === msgId);
      if (!m) return null;
      if (!m.reactions) m.reactions = {};
      if (!m.reactions[emoji]) m.reactions[emoji] = [];
      const arr = m.reactions[emoji];
      const i = arr.indexOf(me);
      let added = false;
      if (i >= 0) arr.splice(i, 1); else { arr.push(me); added = true; }
      if (!arr.length) delete m.reactions[emoji];
      this._saveChats(chats);
      cloudChat(conv);
      // notify the message's author when someone ELSE reacts to their message
      if (added && m.from && m.from !== me) {
        pushNotif(m.from, { type: "reaction", fromId: me, convId, text: emoji + " on your message", group: conv.kind === "group" ? conv.name : null });
      }
      return m.reactions;
    },
    messageReactionCounts(m) {
      const out = [];
      const r = (m && m.reactions) || {};
      Object.keys(r).forEach(k => { if (r[k] && r[k].length) out.push({ emoji: k, count: r[k].length, mine: r[k].includes(meId()) }); });
      return out;
    },

    /* ----- chat: edit / delete your own messages -----
       A user can edit or delete ONLY their own sent messages. Editing keeps the
       message but sets `edited:true` (UI shows an "edited" label). Deleting is a
       soft-delete: text/media are cleared and `deleted:true` is set so the
       bubble shows "message deleted" (history stays intact, reactions cleared). */
    editMessage(convId, msgId, newText) {
      const me = meId(); if (!me) throw new Error("Sign in first.");
      const chats = this._chats();
      const conv = chats[convId];
      if (!conv) return null;
      const m = (conv.messages || []).find(x => x.id === msgId);
      if (!m) return null;
      if (m.from !== me) throw new Error("You can only edit your own messages.");
      if (m.deleted) return null;
      const t = (newText || "").trim();
      if (!t && !m.media) throw new Error("Message can't be empty.");
      m.text = t; m.edited = true; m.editedAt = Date.now();
      this._saveChats(chats);
      cloudChat(conv);
      return m;
    },
    deleteMessage(convId, msgId) {
      const me = meId(); if (!me) throw new Error("Sign in first.");
      const chats = this._chats();
      const conv = chats[convId];
      if (!conv) return false;
      const m = (conv.messages || []).find(x => x.id === msgId);
      if (!m) return false;
      if (m.from !== me) throw new Error("You can only delete your own messages.");
      m.deleted = true; m.text = ""; m.media = null; m.reactions = {};
      this._saveChats(chats);
      cloudChat(conv);
      return true;
    },

    /* ----- chat: 'seen by' avatars (group threads) -----
       Returns the list of OTHER members (as author objects) who have read the
       given message (present in readBy). Used to show small stacked avatars
       under the latest messages in a group thread. */
    seenByForMessage(conv, m) {
      const me = meId();
      if (!conv || !m) return [];
      const others = (conv.members || []).filter(x => x !== me && x !== m.from && x !== BOT_ID);
      const readers = (m.readBy || []).filter(x => others.includes(x));
      return readers.map(id => resolveAuthor(id));
    },
    // Full read-receipt roster for a message: every OTHER member (excl. bot)
    // with a read flag. Used by the tap-to-open receipt list (DMs + groups).
    readReceipts(conv, m) {
      const me = meId();
      if (!conv || !m) return [];
      const others = (conv.members || []).filter(x => x !== m.from && x !== BOT_ID);
      return others.map(id => ({
        user: resolveAuthor(id),
        read: (m.readBy || []).includes(id),
        isMe: id === me
      }));
    },
    // The id of the LAST message I sent in this conversation (so the UI can
    // anchor the 'seen by' row to just my most recent message).
    lastOwnMessageId(conv) {
      const me = meId();
      if (!conv) return null;
      for (let i = (conv.messages || []).length - 1; i >= 0; i--) {
        if (conv.messages[i].from === me && !conv.messages[i].deleted) return conv.messages[i].id;
      }
      return null;
    },

    // display title + the "peer" (for a DM) for a conversation, from my POV
    convDisplay(conv) {
      const me = meId();
      if (!conv) return { title: "Chat", peer: null, group: false };
      if (conv.kind === "group") {
        return { title: conv.name || "Group", peer: null, group: true, members: conv.members || [] };
      }
      const peerId = (conv.members || []).find(x => x !== me) || (conv.members || [])[0];
      const peer = resolveAuthor(peerId);
      return { title: peer.displayName || peer.username, peer, group: false };
    },

    /* ----- notifications ----- */
    notifications() {
      const me = meId(); if (!me) return [];
      return (read(NOTIF_KEY, {})[me] || []).slice();
    },
    unreadCount() { return this.notifications().filter(n => !n.read).length; },
    markNotifsRead() {
      const me = meId(); if (!me) return;
      const all = read(NOTIF_KEY, {});
      (all[me] || []).forEach(n => n.read = true);
      write(NOTIF_KEY, all);
      window.dispatchEvent(new CustomEvent("mv:notif", { detail: { to: me } }));
    },

    /* ----- analytics (real activity data) -----
       DAU is tracked by recording the current user's id under today's date
       whenever the app boots / they act. Charts are computed from real
       localStorage data (posts, users, DAU log) — no fabricated numbers. */
    _dayKey(ts) {
      const d = new Date(ts || Date.now());
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    },
    markActiveToday() {
      const me = meId(); if (!me) return;
      const log = read(DAU_KEY, {});
      const k = this._dayKey();
      if (!log[k]) log[k] = [];
      if (!log[k].includes(me)) { log[k].push(me); write(DAU_KEY, log); }
    },
    // Distinct active users per day for the last `days` days (oldest→newest).
    dauSeries(days) {
      days = days || 14;
      const log = read(DAU_KEY, {});
      const out = [];
      const now = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const k = this._dayKey(d);
        out.push({ day: k, label: (d.getMonth() + 1) + "/" + d.getDate(), value: (log[k] || []).length });
      }
      return out;
    },
    // Posts created per day for the last `days` days (oldest→newest), from real post timestamps.
    postsPerDay(days) {
      days = days || 14;
      const posts = read(POSTS_KEY, []);
      const counts = {};
      posts.forEach(p => { const k = this._dayKey(p.at); counts[k] = (counts[k] || 0) + 1; });
      const out = [];
      const now = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const k = this._dayKey(d);
        out.push({ day: k, label: (d.getMonth() + 1) + "/" + d.getDate(), value: counts[k] || 0 });
      }
      return out;
    },
    // Retention: new vs returning users per day for the last `days` days.
    // "returning" = active on this day AND also active on some EARLIER day
    // (per the real DAU log). "new" = first-ever-seen on this day.
    // Computed across the WHOLE log history (not just the window) so first-seen
    // dates are accurate even for a short window.
    retentionSeries(days) {
      days = days || 14;
      const log = read(DAU_KEY, {});
      // firstSeen[userId] = earliest YYYY-MM-DD they were active.
      const firstSeen = {};
      Object.keys(log).sort().forEach(day => {
        (log[day] || []).forEach(uid => { if (!firstSeen[uid]) firstSeen[uid] = day; });
      });
      const out = [];
      const now = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const k = this._dayKey(d);
        const active = log[k] || [];
        let nu = 0, ret = 0;
        active.forEach(uid => { if (firstSeen[uid] === k) nu++; else ret++; });
        out.push({ day: k, label: (d.getMonth() + 1) + "/" + d.getDate(), newUsers: nu, returning: ret, value: active.length });
      }
      return out;
    },

    // Leaderboard of most-followed users (boost + real follows), top N.
    mostFollowed(limit) {
      limit = limit || 8;
      const users = (window.Auth ? window.Auth.allUsers() : []);
      return users
        .slice()
        .sort((a, b) => (b.followersCount || 0) - (a.followersCount || 0))
        .slice(0, limit);
    },

    /* ----- analytics: retention cohort (day-N retention) -----
       Groups users by their signup/first-seen DAY (cohort). For each cohort,
       computes the % of that cohort that was active on day 0, 1, 2, ... N
       (relative to the cohort's start day), from the real DAU log.
       Returns { cohorts:[{day,label,size,cells:[{n,active,pct}]}], maxN }.
       Only cohorts within the last `days` window are returned (most recent first). */
    retentionCohorts(days) {
      days = days || 30;
      const log = read(DAU_KEY, {});
      // firstSeen[uid] = earliest active day (their cohort day).
      const firstSeen = {};
      const activeDays = {}; // uid -> Set of "YYYY-MM-DD"
      Object.keys(log).sort().forEach(day => {
        (log[day] || []).forEach(u => {
          if (!firstSeen[u]) firstSeen[u] = day;
          (activeDays[u] || (activeDays[u] = new Set())).add(day);
        });
      });
      // cohort -> [uids]
      const cohortMembers = {};
      Object.keys(firstSeen).forEach(u => {
        (cohortMembers[firstSeen[u]] || (cohortMembers[firstSeen[u]] = [])).push(u);
      });
      const dayMs = 86400000;
      const parse = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
      const fmt = dt => (dt.getMonth() + 1) + "/" + dt.getDate();
      // window: cohorts whose start day is within the last `days` days
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const cutoff = new Date(now.getTime() - (days - 1) * dayMs);
      const cohortDays = Object.keys(cohortMembers)
        .filter(k => parse(k) >= cutoff)
        .sort().reverse();
      // maxN = how many day columns to show (bounded so the grid stays readable)
      let maxN = 0;
      cohortDays.forEach(k => {
        const span = Math.round((now - parse(k)) / dayMs);
        if (span > maxN) maxN = span;
      });
      maxN = Math.min(maxN, days - 1, 13); // cap at 14 columns (day 0..13)
      const cohorts = cohortDays.map(k => {
        const members = cohortMembers[k];
        const start = parse(k);
        const cells = [];
        for (let n = 0; n <= maxN; n++) {
          const target = this._dayKey(new Date(start.getTime() + n * dayMs));
          // don't show future days
          if (parse(target) > now) { cells.push({ n, active: null, pct: null }); continue; }
          let active = 0;
          members.forEach(u => { if (activeDays[u] && activeDays[u].has(target)) active++; });
          cells.push({ n, active, pct: members.length ? Math.round(active / members.length * 100) : 0 });
        }
        return { day: k, label: fmt(start), size: members.length, cells };
      });
      return { cohorts, maxN };
    },

    /* ----- analytics: CSV export -----
       Builds a single CSV string bundling DAU, posts-per-day, retention
       (new vs returning) and the most-followed leaderboard for the given
       range. Returned as text for a client-side Blob download. */
    analyticsCSV(days) {
      days = days || 30;
      const esc = v => {
        v = (v == null ? "" : String(v));
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      };
      const rows = [];
      rows.push("MangaVerse analytics export");
      rows.push("Range," + days + " days");
      rows.push("Generated," + new Date().toISOString());
      rows.push("");
      rows.push("Daily Active Users");
      rows.push("date,active_users");
      this.dauSeries(days).forEach(d => rows.push(esc(d.day) + "," + d.value));
      rows.push("");
      rows.push("Posts per day");
      rows.push("date,posts");
      this.postsPerDay(days).forEach(d => rows.push(esc(d.day) + "," + d.value));
      rows.push("");
      rows.push("Retention (new vs returning)");
      rows.push("date,new_users,returning_users,total_active");
      this.retentionSeries(days).forEach(d => rows.push(esc(d.day) + "," + (d.newUsers || 0) + "," + (d.returning || 0) + "," + (d.value || 0)));
      rows.push("");
      rows.push("Most-followed users");
      rows.push("rank,username,display_name,followers,verified");
      this.mostFollowed(20).forEach((u, i) => rows.push([i + 1, esc(u.username), esc(u.displayName || u.username), u.followersCount || 0, u.verified ? "yes" : "no"].join(",")));
      return rows.join("\r\n");
    },

    /* ===================================================================
       MangaBot — an in-app assistant that lives in every group chat and
       replies to commands / @mentions using the existing manga data API
       (window.MangaSource). It's a real member (id BOT_ID) so membership,
       read-receipts and seen-by logic all keep working unchanged.
       =================================================================== */
    botId() { return BOT_ID; },
    botProfile() {
      return {
        id: BOT_ID, username: "mangabot", displayName: "MangaBot",
        role: "Assistant", bot: true, verified: true,
        avatar: BOT_AVATAR, bio: "Your in-chat manga guide. Type /help in any group."
      };
    },
    // ensure the bot is a member of a conversation (used for every group)
    ensureBotInGroup(conv) {
      if (!conv || conv.kind !== "group") return conv;
      if (!conv.members) conv.members = [];
      if (!conv.members.includes(BOT_ID)) conv.members.push(BOT_ID);
      return conv;
    },
    // add the bot to ALL existing groups (called once on boot)
    ensureBotEverywhere() {
      const chats = this._chats();
      let changed = false;
      Object.values(chats).forEach(c => {
        if (c.kind === "group" && !(c.members || []).includes(BOT_ID)) {
          (c.members || (c.members = [])).push(BOT_ID); changed = true;
        }
      });
      if (changed) this._saveChats(chats);
    },
    // Post a bot message into a conversation (bypasses the "must be signed in"
    // guard; the bot authors it). Marks it read-by nobody yet.
    _botSay(convId, payload) {
      const chats = this._chats();
      const conv = chats[convId];
      if (!conv) return null;
      // payload may be a plain string (legacy) OR { text, refs:[{id,title,cover}] }.
      const text = (payload && typeof payload === "object") ? (payload.text || "") : (payload || "");
      const refs = (payload && typeof payload === "object" && Array.isArray(payload.refs)) ? payload.refs.slice(0, 4) : [];
      const msg = { id: uid("m_"), from: BOT_ID, text: text, refs: refs, media: null, at: Date.now(), readBy: [], reactions: {}, bot: true };
      conv.messages.push(msg);
      this._saveChats(chats);
      cloudChat(conv);
      return msg;
    },
    // Should this message trigger the bot? (a slash command, or @mangabot).
    _botTriggered(text) {
      const t = (text || "").trim().toLowerCase();
      if (!t) return false;
      if (t[0] === "/") return true;
      // @bot / @mangabot mention, or a bare mention of the bot by name
      if (/(^|\s)@(bot|mangabot)\b/.test(t)) return true;
      if (t.includes("@mangabot") || t.includes("mangabot")) return true;
      return false;
    },
    // Is this conversation a direct 1:1 chat with the bot? In a bot DM EVERY
    // user message should get a reply (no @mention needed).
    isBotDM(conv) {
      if (!conv || conv.kind !== "dm") return false;
      return (conv.members || []).includes(BOT_ID);
    },
    // Parse + answer a triggering message. Returns a reply string (async).
    async _botReply(rawText) {
      let t = (rawText || "").trim();
      // strip @bot / @mangabot mentions before parsing the command
      t = t.replace(/@bot\b/ig, "").replace(/@mangabot/ig, "").trim();
      let cmd = "", arg = "";
      if (t[0] === "/") {
        const sp = t.indexOf(" ");
        cmd = (sp === -1 ? t.slice(1) : t.slice(1, sp)).toLowerCase();
        arg = sp === -1 ? "" : t.slice(sp + 1).trim();
      } else {
        // natural language fallback
        const low = t.toLowerCase();
        if (/help|command/.test(low)) cmd = "help";
        else if (/trend|popular|hot/.test(low)) cmd = "trending";
        else if (/recommend|suggest|what should i read/.test(low)) cmd = "recommend";
        else if (/search|find|look for/.test(low)) { cmd = "search"; arg = t.replace(/.*?(search|find|look for)/i, "").trim(); }
        else if (/info|about|synopsis|summary/.test(low)) { cmd = "info"; arg = t.replace(/.*?(info|about|synopsis|summary)( on| for| of)?/i, "").trim(); }
        else if (/imagine|generate|draw|create|make/.test(low)) { cmd = "imagine"; arg = t.replace(/.*?(imagine|generate|draw|create|make)( me| a| an| the| of)?/i, "").trim(); }
        else { cmd = "help"; }
      }
      const MS = window.MangaSource;
      const line = m => "• " + m.title + (m.genres && m.genres.length ? " — " + m.genres.slice(0, 2).join(", ") : "") + (m.rating ? " ★" + m.rating : "");
      // Build the structured card refs (id/title/cover) that the chat UI renders
      // as inline cover thumbnails + an "Open" button linking to the detail page.
      const refsOf = list => (list || []).slice(0, 4).map(m => ({
        id: m.id, title: m.title, cover: m.cover || "",
        genres: (m.genres || []).slice(0, 2)
      })).filter(r => r.id);
      try {
        if (cmd === "help" || cmd === "commands" || cmd === "start") {
          return { text: "🤖 MangaBot commands:\n/recommend — a few picks for you\n/trending — what's hot right now\n/search <title> — find manga\n/info <title> — synopsis & details\n/imagine <prompt> — generate an image\n/help — this message\n(You can also just say \"recommend something\" or \"@mangabot search dragon\".)", refs: [] };
        }
        if (cmd === "trending" || cmd === "popular") {
          const list = MS ? await MS.list({ limit: 5 }) : [];
          if (!list.length) return { text: "🤖 I couldn't reach the library just now — try again in a sec.", refs: [] };
          return { text: "🔥 Trending right now:\n" + list.slice(0, 5).map(line).join("\n"), refs: refsOf(list) };
        }
        if (cmd === "recommend" || cmd === "suggest" || cmd === "rec") {
          let list = MS ? await MS.list({ limit: 18 }) : [];
          // shuffle a little so recs vary
          list = list.slice().sort(() => Math.random() - 0.5).slice(0, 4);
          if (!list.length) return { text: "🤖 I couldn't reach the library just now — try again in a sec.", refs: [] };
          return { text: "✨ You might enjoy:\n" + list.map(line).join("\n") + "\n\nTap Open below, or /info <title> for details.", refs: refsOf(list) };
        }
        if (cmd === "search" || cmd === "find") {
          if (!arg) return { text: "🤖 What should I search for? Try: /search chainsaw man", refs: [] };
          const list = MS ? await MS.search(arg) : [];
          if (!list.length) return { text: "🤖 No matches for \"" + arg + "\". Try a different title.", refs: [] };
          return { text: "🔎 Results for \"" + arg + "\":\n" + list.slice(0, 5).map(line).join("\n"), refs: refsOf(list) };
        }
        if (cmd === "imagine" || cmd === "generate" || cmd === "draw") {
          if (!arg) return { text: "🤖 What should I draw? Try: /imagine epic dragon fighting samurai in manga style", refs: [] };
          try {
            if (typeof agnesGenerate === "function") {
              var imgUrl = await agnesGenerate(arg);
              if (imgUrl) return { text: "🎨 Here's what I generated for:\n\"" + arg + "\"", refs: [], media: { type: "image", url: imgUrl } };
            }
            return { text: "🤖 Image generation is not available right now. Try /search or /recommend instead.", refs: [] };
          } catch (e) { return { text: "🤖 Image generation failed. Try a different prompt.", refs: [] }; }
        }
        if (cmd === "info" || cmd === "about" || cmd === "synopsis") {
          if (!arg) return { text: "🤖 Which title? Try: /info solo leveling", refs: [] };
          const list = MS ? await MS.search(arg) : [];
          if (!list.length) return { text: "🤖 I couldn't find \"" + arg + "\".", refs: [] };
          const m = list[0];
          let desc = m.description || m.synopsis || "";
          if (desc.length > 260) desc = desc.slice(0, 257) + "…";
          const text = "📖 " + m.title + (m.author ? " — " + m.author : "") +
            (m.genres && m.genres.length ? "\nGenres: " + m.genres.join(", ") : "") +
            (m.status ? "\nStatus: " + m.status : "") +
            (m.rating ? "\nRating: ★" + m.rating : "") +
            (desc ? "\n\n" + desc : "");
          return { text: text, refs: refsOf([m]) };
        }
        return { text: "🤖 I didn't catch that. Type /help to see what I can do.", refs: [] };
      } catch (e) {
        return { text: "🤖 Something went wrong reaching the library. Try /help.", refs: [] };
      }
    }
  };

  window.Social = Social;
})();