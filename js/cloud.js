/* ============================================================
   MangaVerse — Cloud sync (Supabase) [OPTIONAL]
   ------------------------------------------------------------
   Turns the localStorage-only social layer into a shared,
   cross-device backend when the site owner pastes their own
   Supabase project URL + anon key in Settings.

   Design goals:
     • ZERO config out of the box — with no keys the app behaves
       exactly as before (pure localStorage, offline).
     • When keys are present we mirror the SAME localStorage keys
       (mv_posts / mv_chats / mv_users public profiles) up to
       Supabase and subscribe to realtime changes, so different
       real users on different devices see each other's posts,
       profiles, DMs and group chats.
     • localStorage always stays as the offline cache/fallback,
       so the UI never blocks on the network.

   Honest note: this is a client-side integration. It needs the
   OWNER's Supabase URL + anon key (entered in Settings) and the
   SQL schema (in Cloud.SCHEMA_SQL, also shown in Settings/Docs)
   to be run once in the Supabase SQL editor. Without keys the
   app runs fully local.
   ============================================================ */
(function () {
  "use strict";

  const URL_KEY = "mv_supabase_url";
  const KEY_KEY = "mv_supabase_key";
  const SDK = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";

  function cfgUrl() { try { return (localStorage.getItem(URL_KEY) || "").trim().replace(/\/+$/, ""); } catch (e) { return ""; } }
  function cfgKey() { try { return (localStorage.getItem(KEY_KEY) || "").trim(); } catch (e) { return ""; } }
  function configured() { return /^https?:\/\//.test(cfgUrl()) && cfgKey().length > 20; }

  let client = null;
  let ready = false;
  let loading = null;

  function loadSDK() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SDK; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Couldn't load the Supabase SDK (offline?)."));
      document.head.appendChild(s);
    });
    return loading;
  }

  // Full SQL schema + RLS the owner runs once in Supabase → SQL editor.
  const SCHEMA_SQL = `-- ===== MangaVerse Supabase schema =====
-- Run once in Supabase → SQL Editor. Enables cross-device sync of
-- profiles, posts, and chats. (Demo-grade RLS: readable by all,
-- writable by anyone with the anon key — tighten for production.)

create table if not exists profiles (
  id text primary key,          -- mirrors auth.users.id when Supabase Auth is used
  auth_id uuid,                 -- link to auth.users (null for local-only accounts)
  username text unique,
  email text,
  display_name text,
  avatar text,
  role text,
  bio text,
  verified boolean default false,
  is_admin boolean default false,
  followers_boost int default 0,
  data jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists posts (
  id text primary key,
  author jsonb,
  text text,
  media jsonb,
  likes int default 0,
  liked_by jsonb default '[]'::jsonb,
  reactions jsonb default '{}'::jsonb,
  comments jsonb default '[]'::jsonb,
  at bigint,
  created_at timestamptz default now()
);

create table if not exists chats (
  id text primary key,
  kind text,
  name text,
  members jsonb default '[]'::jsonb,
  owner text,
  messages jsonb default '[]'::jsonb,
  at bigint,
  updated_at timestamptz default now()
);

-- Enable row level security
alter table profiles enable row level security;
alter table posts    enable row level security;
alter table chats    enable row level security;

-- Demo policies: allow read + write with the anon key.
-- (For production, restrict writes to auth.uid() = id, etc.)
create policy "read all profiles"  on profiles for select using (true);
create policy "write all profiles" on profiles for insert with check (true);
create policy "update all profiles" on profiles for update using (true);

create policy "read all posts"  on posts for select using (true);
create policy "write all posts" on posts for insert with check (true);
create policy "update all posts" on posts for update using (true);
create policy "delete all posts" on posts for delete using (true);

create policy "read all chats"  on chats for select using (true);
create policy "write all chats" on chats for insert with check (true);
create policy "update all chats" on chats for update using (true);

-- Realtime: add the tables to the supabase_realtime publication
alter publication supabase_realtime add table profiles, posts, chats;

-- ===== Supabase Auth (email + password) =====
-- With Supabase Auth enabled (Authentication -> Providers -> Email = ON,
-- and for a friction-free demo you may disable "Confirm email"), the app's
-- signup/login route through auth.users so the SAME account works across
-- devices. On first login the app upserts a matching row into profiles with
-- id = auth.users.id (and auth_id = same). No extra SQL is strictly required
-- beyond the profiles table above, but this optional trigger auto-creates a
-- profile row the moment a user signs up:

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, auth_id, email, username, display_name)
  values (new.id::text, new.id, new.email, split_part(new.email,'@',1), split_part(new.email,'@',1))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();`;

  function lsRead(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
  function lsWrite(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  const Cloud = {
    SCHEMA_SQL,
    URL_KEY, KEY_KEY,
    configured,
    isReady() { return ready; },
    getUrl: cfgUrl,
    getKey: cfgKey,

    setConfig(url, key) {
      url = (url || "").trim().replace(/\/+$/, "");
      key = (key || "").trim();
      if (url) localStorage.setItem(URL_KEY, url); else localStorage.removeItem(URL_KEY);
      if (key) localStorage.setItem(KEY_KEY, key); else localStorage.removeItem(KEY_KEY);
      client = null; ready = false;
    },

    // Connect + do an initial two-way sync + subscribe to realtime.
    async connect() {
      if (!configured()) throw new Error("Enter your Supabase URL and anon key first.");
      await loadSDK();
      // persistSession + autoRefreshToken keep the JWT in localStorage so the
      // user stays logged in across reloads and devices (session restore).
      client = window.supabase.createClient(cfgUrl(), cfgKey(), {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "mv_sb_auth" }
      });
      // sanity check: a trivial select
      const { error } = await client.from("posts").select("id").limit(1);
      if (error) throw new Error(error.message + " — did you run the SQL schema?");
      ready = true;
      await this.pullAll();
      this.pushAll();          // mirror anything created offline
      this.subscribe();
      window.dispatchEvent(new CustomEvent("mv:cloud", { detail: { status: "connected" } }));
      return true;
    },

    // Pull cloud → localStorage (merging, newest wins by timestamp).
    async pullAll() {
      if (!ready) return;
      try {
        const [{ data: posts }, { data: chats }, { data: profiles }] = await Promise.all([
          client.from("posts").select("*"),
          client.from("chats").select("*"),
          client.from("profiles").select("*")
        ]);
        if (posts) {
          const local = lsRead("mv_posts", []);
          const map = {}; local.forEach(p => map[p.id] = p);
          posts.forEach(r => {
            map[r.id] = { id: r.id, author: r.author, text: r.text, media: r.media,
              likes: r.likes, likedBy: r.liked_by, reactions: r.reactions, comments: r.comments, at: r.at };
          });
          lsWrite("mv_posts", Object.values(map));
        }
        if (chats) {
          const local = lsRead("mv_chats", {});
          chats.forEach(r => {
            local[r.id] = { id: r.id, kind: r.kind, name: r.name, members: r.members,
              owner: r.owner, messages: r.messages || [], at: r.at, typing: (local[r.id] || {}).typing || {} };
          });
          lsWrite("mv_chats", local);
        }
        if (profiles) {
          // merge public profile fields into local mv_users where present
          const users = lsRead("mv_users", []);
          const byId = {}; users.forEach(u => byId[u.id] = u);
          profiles.forEach(pr => {
            if (byId[pr.id]) {
              const u = byId[pr.id];
              u.displayName = pr.display_name || u.displayName;
              u.avatar = pr.avatar || u.avatar;
              u.role = pr.role || u.role; u.bio = pr.bio || u.bio;
              u.verified = pr.verified; u.followersBoost = pr.followers_boost || 0;
            }
          });
          lsWrite("mv_users", users);
        }
        window.dispatchEvent(new CustomEvent("mv:notif", { detail: { to: null } }));
      } catch (e) { console.warn("Cloud pullAll failed:", e); }
    },

    // Push localStorage → cloud (upsert everything). Safe to call anytime.
    async pushAll() {
      if (!ready) return;
      try {
        const posts = lsRead("mv_posts", []).map(p => ({
          id: p.id, author: p.author, text: p.text, media: p.media, likes: p.likes || 0,
          liked_by: p.likedBy || [], reactions: p.reactions || {}, comments: p.comments || [], at: p.at
        }));
        if (posts.length) await client.from("posts").upsert(posts);
        const chatsObj = lsRead("mv_chats", {});
        const chats = Object.values(chatsObj).map(c => ({
          id: c.id, kind: c.kind, name: c.name || null, members: c.members || [],
          owner: c.owner || null, messages: c.messages || [], at: c.at
        }));
        if (chats.length) await client.from("chats").upsert(chats);
        const users = lsRead("mv_users", []);
        const profiles = users.map(u => ({
          id: u.id, username: u.username, display_name: u.displayName || u.username,
          avatar: u.avatar || "", role: u.role || "", bio: u.bio || "",
          verified: !!u.verified, followers_boost: u.followersBoost || 0,
          data: { following: (u.data && u.data.following) || [] }
        }));
        if (profiles.length) await client.from("profiles").upsert(profiles);
      } catch (e) { console.warn("Cloud pushAll failed:", e); }
    },

    // Upsert a single record type (called by social.js after local writes).
    async syncPost(post) {
      if (!ready) return;
      try {
        await client.from("posts").upsert({
          id: post.id, author: post.author, text: post.text, media: post.media,
          likes: post.likes || 0, liked_by: post.likedBy || [], reactions: post.reactions || {},
          comments: post.comments || [], at: post.at
        });
      } catch (e) { console.warn("syncPost failed", e); }
    },
    async deletePostRemote(id) { if (ready) { try { await client.from("posts").delete().eq("id", id); } catch (e) {} } },
    async syncChat(conv) {
      if (!ready) return;
      try {
        await client.from("chats").upsert({
          id: conv.id, kind: conv.kind, name: conv.name || null, members: conv.members || [],
          owner: conv.owner || null, messages: conv.messages || [], at: conv.at
        });
      } catch (e) { console.warn("syncChat failed", e); }
    },
    async syncProfile(u) {
      if (!ready || !u) return;
      try {
        await client.from("profiles").upsert({
          id: u.id, username: u.username, display_name: u.displayName || u.username,
          avatar: u.avatar || "", role: u.role || "", bio: u.bio || "",
          verified: !!u.verified, followers_boost: u.followersBoost || 0,
          data: { following: (u.data && u.data.following) || [] }
        });
      } catch (e) { console.warn("syncProfile failed", e); }
    },

    /* ---------- Supabase Auth (email + password) ----------
       When connected, signup/login route through auth.users so the SAME
       account works across devices. Returns a normalized {id,email} on
       success. auth.js falls back to localStorage when not connected. */
    hasAuth() { return ready && client && client.auth; },
    async authSignUp(email, password) {
      if (!this.hasAuth()) throw new Error("Supabase not connected.");
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw new Error(error.message);
      // If email confirmation is on, session may be null until confirmed.
      const user = (data && data.user) || null;
      return user ? { id: user.id, email: user.email, needsConfirm: !data.session } : null;
    },
    async authSignIn(email, password) {
      if (!this.hasAuth()) throw new Error("Supabase not connected.");
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      const user = (data && data.user) || null;
      return user ? { id: user.id, email: user.email } : null;
    },
    async authSignOut() { if (this.hasAuth()) { try { await client.auth.signOut(); } catch (e) {} } },
    async authCurrent() {
      if (!this.hasAuth()) return null;
      try { const { data } = await client.auth.getUser(); return data && data.user ? { id: data.user.id, email: data.user.email } : null; }
      catch (e) { return null; }
    },
    // Restore the persisted Supabase session (JWT) on page load. Returns the
    // normalized {id,email} of the signed-in user, or null if no valid session.
    async getSession() {
      if (!this.hasAuth()) return null;
      try {
        const { data } = await client.auth.getSession();
        const u = data && data.session && data.session.user;
        return u ? { id: u.id, email: u.email } : null;
      } catch (e) { return null; }
    },
    // Subscribe to Supabase auth state changes (SIGNED_IN / SIGNED_OUT /
    // TOKEN_REFRESHED). cb receives (event, {id,email}|null). auth.js uses this
    // to keep the app session in lock-step with the Supabase session.
    onAuthStateChange(cb) {
      if (!this.hasAuth()) return () => {};
      try {
        const { data } = client.auth.onAuthStateChange((event, session) => {
          const u = session && session.user ? { id: session.user.id, email: session.user.email } : null;
          try { cb(event, u); } catch (e) {}
        });
        return () => { try { data.subscription.unsubscribe(); } catch (e) {} };
      } catch (e) { return () => {}; }
    },
    // Upsert a profile row keyed by the auth user id (called after auth login).
    async syncAuthProfile(u, authId) {
      if (!ready || !u) return;
      try {
        await client.from("profiles").upsert({
          id: u.id, auth_id: authId || null, username: u.username, email: u.email || "",
          display_name: u.displayName || u.username, avatar: u.avatar || "", role: u.role || "",
          bio: u.bio || "", verified: !!u.verified, is_admin: !!u.isAdmin,
          followers_boost: u.followersBoost || 0, data: { following: (u.data && u.data.following) || [] }
        });
      } catch (e) { console.warn("syncAuthProfile failed", e); }
    },

    // Realtime: refresh local caches when cloud rows change.
    subscribe() {
      if (!ready || this._sub) return;
      this._sub = client.channel("mv-realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, () => this.pullAll())
        .on("postgres_changes", { event: "*", schema: "public", table: "chats" }, () => this.pullAll())
        .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => this.pullAll())
        .subscribe();
    }
  };

  window.Cloud = Cloud;

  // Auto-connect on boot if the owner has already saved keys.
  if (configured()) {
    // give the rest of the app a tick to init, then connect quietly.
    setTimeout(() => { Cloud.connect().catch(e => console.warn("Cloud auto-connect:", e.message)); }, 400);
  }
})();
