# MangaVerse

A modern, dark-themed manga reader SPA — works entirely in the browser with no backend required.

**Live demo:** https://manga-web-production-788f.up.railway.app/

---

## Features

- **Live manga** — fetches real manga from MangaDex (primary), Comick (secondary), MangaPlus (Shueisha catalogue)
- **No backend required** — pure static site, works from any file server or CDN
- **Offline fallback** — built-in sample manga with generated SVG covers/pages when live APIs are unreachable
- **Accounts** — localStorage-based with salted password hashing; optional Supabase sync for cross-device
- **Bookmarks & history** — save titles and track reading progress per-account
- **Continue reading** — pick up where you left off
- **Social layer** — posts, DMs, group chats, reactions, comments, MangaBot assistant
- **18+ section** — age-gated adult content browsing
- **UI translation** — one-click translate the interface to 15+ languages via Google Translate
- **Reader settings** — brightness slider, dark/sepia/light themes, scroll mode
- **Mobile-first** — slide-in drawer, bottom navigation bar, touch-friendly reader

---

## Quick Start

### Deploy to Railway (easiest)

1. Clone or download this repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from repo
3. Or drag-and-drop the `Manga-web--main` folder onto Railway's dashboard
4. Railway detects it's a static site and serves it automatically

### Deploy anywhere else

Just serve the `Manga-web--main` folder with any static file server:

```bash
cd Manga-web--main
python3 -m http.server 8080
# or
npx serve .
# or
npx http-server .
```

---

## Deploy the Cloudflare Worker (recommended for faster API)

The app includes `worker.js` — a tiny CORS proxy that improves MangaDex API reliability by bypassing public CORS proxies.

### One-click deploy

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_USERNAME/MangaVerse)

### Manual deploy

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → Create application
2. Create a Worker, paste the contents of `worker.js`
3. Click **Save and Deploy**
4. Copy your worker URL (e.g., `https://mangaverse-proxy.your-username.workers.dev`)

### Configure in MangaVerse

Open the app, go to Settings, paste your worker URL in the **"Live data proxy"** field and save.

Or set it via browser console:

```js
localStorage.setItem('mv_worker_url', 'https://mangaverse-proxy.your-username.workers.dev')
```

Once configured, all API calls route through your worker — faster, no rate limits, and no fallback to sample data.

---

## Architecture

```
Manga-web--main/
├── index.html              # Main SPA shell + auth modal
├── worker.js               # Cloudflare Worker CORS proxy
├── css/
│   ├── styles.css          # Desktop/global styles + components
│   └── mobile-redesign.css # Mobile-specific overrides (<720px)
└── js/
    ├── api.js              # Multi-source data layer (MangaDex, Comick, AniList, MangaPlus)
    ├── app.js              # SPA router, views, UI logic
    ├── auth.js             # localStorage account system
    ├── social.js           # Posts, chat, notifications (localStorage)
    ├── translate.js        # Client-side UI translation (Google Translate)
    ├── cloud.js            # Optional Supabase sync layer
    └── data.js             # Offline sample dataset (SVG covers/pages)
```

### Data flow

```
Browser → MangaDex API (direct CORS) → [Cloudflare Worker] → [Public CORS proxies] → Sample fallback
```

The app tries the fastest path first:
1. **Direct** — calls MangaDex API directly (sends CORS headers natively)
2. **Your Worker** — if configured, used as the primary proxy
3. **Public proxies** — corsproxy.io, allorigins.win as fallbacks
4. **Sample data** — built-in fallback when all live sources fail

---

## Adding Supabase Sync (optional)

For cross-device accounts/social features:

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Run the SQL schema (shown in Settings → Docs in the app)
3. Paste your Supabase URL and anon key in Settings

---

## Customization

- **Theme colors** — edit CSS variables in `:root` in `css/styles.css`
- **Sample data** — edit `js/data.js` to add/remove offline manga
- **Language list** — edit `LANGUAGES` array in `js/api.js`
- **UI labels** — translate strings in the HTML and `js/translate.js`

---

## Tech Stack

- Vanilla JS (ES modules pattern via IIFE, no framework)
- CSS custom properties + flexbox/grid layout
- MangaDex API (primary data source)
- Cloudflare Workers (optional CORS proxy)
- Supabase (optional cross-device sync)
- Google Translate API (client-side UI translation)
- Lucide icons

---

## License

MIT — use it, modify it, ship it.
