# EpiDuck — Project memory per Claude

> Leggi questo file all'inizio di ogni nuova sessione. Compatta tutto il contesto utile.

## 1. Identità progetto

- **Cosa**: Chrome extension (MV3) per `learn.epicode.edu.mt`
- **Funzioni**: auto-play, controllo velocità fino a 16x, auto-skip, trascrizioni live Vimeo, estrai corso → MD/Notion/AI rework (Claude Sonnet 4.6)
- **Versione corrente**: vedi `manifest.json` (`version`)
- **Repo GitHub**: `matteo-sketch/EpiDuck` (public)
- **Working dir locale**: `~/Documents/epicduck/`
- **Branch produzione**: `main`
- **Branch testing**: `dev` (creato + pushato; usa branch dedicati per feature: `feat/*`, `fix/*`)
- **Releases**: GitHub Releases con asset `epiduck-v<X>.zip`
- **Notion EpiDuck page**: `https://www.notion.so/31b3bdcd01e4807fb37bcf727a16c1ea`
- **Notion DB versioni**: data_source_id `35e3bdcd-01e4-807b-9e10-000b51d51374` (props: Name, changelog, Files & media)

## 2. Preferenze utente

- **Caveman mode ACTIVE** sempre. Fragment OK. Drop articles/filler/hedging. Codice resta normale.
- **Lingua**: italiano (utente). Italiano nei commenti UI, status, button labels.
- **Default extension**: speed 16x, quality 240p (per nuovi utenti). Estrai corso panel collassato di default.
- **Brand**: nome "EpiDuck", icona paperella gialla su sfondo blu (`icon.svg`), versione toolbar trasparente (`icon-toolbar.svg`).
- **Buy Me a Coffee URL**: `buymeacoffee.com/79ai4gmnnt`
- **Email contatto**: `matteo@postella.it`
- **Browser MCP**: `Browser 1` (deviceId `2bdc9908-029b-481e-9c38-dbcfde109092`) — macOS local. Tab MCP attivo per debug live.

## 3. File structure

```
epicduck/
├── manifest.json          MV3, host_permissions: notion + anthropic + cms.epicode
├── epicode.js             Content script principale (~2000 righe). UI box, navigazione, estrai corso, speed engine.
├── vimeo.js               Content script iframe Vimeo. Cattura sottotitoli, postMessage al parent.
├── vimeo-main.js          MAIN world iframe Vimeo. Setter playbackRate per-element (no prototype override) + rate limiter + preservesPitch.
├── popup.html / popup.js  Settings popup: Notion API key, Notion parent page ID, Anthropic key, toggle enabled.
├── icon.svg               128x128 con sfondo blu (popup + tile store)
├── icon-toolbar.svg       Senza sfondo (toolbar chrome)
├── icon-16.png / 48 / 128 PNG generati per CWS
├── PRIVACY.md             Policy GDPR-compliant
├── STORE_LISTING.md       Testi pronti per Chrome Web Store
├── README.md              User-facing install + uso
├── CLAUDE.md              QUESTO FILE
└── .gitignore             Esclude .pem, .zip, *.original.md
```

ZIP build CWS: `~/Documents/epiduck-v<X>.zip` (escludi `.git`, `*.md`, `*.pem`).

## 4. API Epicode (scoperte)

- **Base CMS**: `https://cms.epicode.com` (Directus REST)
- **Auth**: `Authorization: Bearer ${localStorage.auth_token}` (l'utente è già autenticato sul sito principale)
- **Curriculum corso**: `GET /items/content?filter[courses][course][_eq]={courseId}&fields=id,parent,sort,type,title&limit=-1`
- **Dettaglio lezione**: `GET /items/content/{id}` (singolare!) → returns `summary.{en,it}`, `markdown`, `body` (Editor.js), `url`, `embed_type`, `is_translated`, `required_proficiency_level`, `parent`, `sort`, `type`
- **Completion server**: `GET /v2/course/eit/student-completion/user/{userId}?contentId={lessonId}`
- **Tipi content**: `unit`/`module` (container), `embed` (vimeo, 176/264 in corso 334), `meeting` (Video.js Epicode CDN), `article` (Editor.js), `markdown`, `activity`, `quiz`, `project`, `openEnded`, `nps`, `course_nps`
- **Ordering**: DFS tree by `parent` + `sort`
- **URL lezione**: `/course/{courseId}/curriculum/{lessonId}`

## 5. Architettura runtime epicode.js (alto livello)

- IIFE wrapper. Gate iniziale via `chrome.storage.local.epiduckEnabled` (default true).
- UI box: `position:fixed`, width fisso 260px aperto / 150px chiuso, max-height 90vh + overflow auto. Trascinabile, posizione persisted per hostname.
- Main loop 4s + tick 500ms (`updateVideoUI`).
- **Detection lezione**: iframe Vimeo → embed; `<video>` in `.video-js` o src `cdn.epicode.com` → meeting; nessuno → non-video.
- **Auto-skip**: a fine video (`videoState.ended` o duration-1.5s). Per lezioni con server tracker (widget `<p>X%</p>` in alto-destra), aspetta server = 100%. Floor 5s grace su entry per evitare skip immediato su lezioni già completate.
- **Adaptive speed**: modalità ⚡ ADATTIVA (default) scala automaticamente. Floor `ADAPTIVE_FLOOR = 2`, ceiling 16. Drop su `serverWatchdog stuck >6s`, ramp-up x1.5 su smooth >8s. Modalità 🔒 FORZATA: nessun auto-adjust. Toggle persistito in `localStorage.epicode_speed_mode_<hostname>`.
- **Quality**: per-domain `localStorage.epicode_quality_<hostname>`. Auto-drop a 360p quando user-speed >= 8x. Default 240p nuovi utenti.
- **Hold-to-speed**: tieni Shift → boost x2 temporaneo (cap 16x). Rilascia → ripristina.
- **Trascrizione**: vimeo.js cattura cue Vimeo via TextTrack → postMessage al parent → buffer `transcriptCues`. Clean text copy (no timestamp).
- **Estrai corso**: fetch curriculum + dettagli. Per ogni leaf: estrai `summary[lang]` (embed), `markdown`, `body→md` (article). Output: file `.md` download OR Notion API push (creazione page sotto parent + append blocks). Incremental update: hash check, diff, append solo nuove.
- **Bug report**: window.error + unhandledrejection → buffer in `chrome.storage.local.epicode_error_buffer` (max 50). Click 🐛 Segnala bug → apre `github.com/matteo-sketch/EpiDuck/issues/new` prefilled.

## 6. Speed engine (vimeo-main.js)

- NO prototype override su `HTMLMediaElement.prototype.playbackRate` (causava infinite loop)
- Setter per-element con no-op check `toFixed(3)`
- Rate limiter: max 1000 set / 20s, ban dopo 3 violazioni
- `preservesPitch` (+ moz/webkit) settato esplicitamente
- Eventi attachati: `ratechange, play, playing, loadedmetadata, canplay, seeked` (NO timeupdate — era 1000+ chiamate/sec a 16x)
- Custom events: `__epicodeflow-enable`, `__epicodeflow-speed`, `__epicodeflow-pitch`

## 7. Lezioni learned + da evitare

- **MAI** `replace_all` su pattern generici come `document.querySelector('[data-testid="X"]')` perché sostituisce anche call site interne a funzioni helper → ricorsione infinita (era issue #1)
- **MAI** css-hash classes (`css-kbtfm3`, `css-1y2ge64`) — cambiano ad ogni build Epicode. Usa pattern strutturali (position + parent shape + text format)
- Server tracker Epicode è inaffidabile a velocità alte (>4x). Watchdog + adaptive throttle necessari.
- Vimeo player applica un cap interno se lo setter playbackRate viene chiamato in loop. Soluzione: skip no-op writes.
- Selettore `[data-testid^="node-"]` per sidebar Epicode RIMOSSO da Epicode. Naviga via API curriculum invece.
- `findEpicodeCompletionPctEl()`: cerca `<p>` con regex `^\d+%$`, position top-right, parent con progress bar.

## 8. Open issues + roadmap

### Urgenti (fix prima della prossima release)

- **Issue #2** OPEN: server stuck >50min su course 330. Fix proposto: timeout fallback a 2min + own >= 95% → skip forzato. Pulizia error buffer cross-version. Branch suggerito: `fix/server-stuck-fallback`.

### Alto valore

- **Chrome Web Store submission** ($5 dev account pagato). ZIP pronto: `~/Documents/epiduck-v63.zip`. Testi in `STORE_LISTING.md`. Privacy URL: `https://github.com/matteo-sketch/EpiDuck/blob/main/PRIVACY.md`.
- **Pluggable sources architecture** (Tachiyomi-style). Core generico + JSON `epicode.json` + repo `matteo-sketch/epiduck-sources` separato. ~25h refactor.
- **Tests Jest** su moduli puri.
- **Live VTT scrape** per 84 video Epicode senza summary precomputed.

### Quality of life

- Keyboard shortcuts (Cmd+Shift+S skip, +/- speed, P pause)
- Sentry/webhook Discord per error reporting automatico (no più "scrivi issue")
- `chrome.storage.sync` multi-device
- Light mode CSS prefers-color-scheme
- PDF export jsPDF

## 9. Workflow release

> ⚠️ **REGOLA NON NEGOZIABILE**: ogni push a `main` richiede SEMPRE step 11 (commit Notion). Senza riga DB versioni la release è incompleta.

1. Modifica codice su branch `feat/*` o `fix/*`
2. Bump `manifest.json` version
3. `git commit -m "<conv commit>"` con Co-Authored-By footer
4. `git push origin <branch>`
5. (Testing utente)
6. `git checkout main && git merge --no-ff <branch>`
7. `git tag -a v<X.Y> -m "Release"`
8. `git push origin main && git push origin v<X.Y>`
9. Build ZIP: `cd ~/Documents && rm -f epiduck-v<X>.zip && zip -rq epiduck-v<X>.zip epicduck -x "epicduck/.git/*" -x "epicduck/.DS_Store" -x "epicduck/*.pem" -x "epicduck/STORE_LISTING.md" -x "epicduck/PRIVACY.md" -x "epicduck/README.md" -x "epicduck/.gitignore"`
10. `gh release create v<X.Y> --title "..." --notes "..." ~/Documents/epiduck-v<X>.zip`
11. **🔴 OBBLIGATORIO**: Notion → crea riga in DB versioni (data_source_id `35e3bdcd-01e4-807b-9e10-000b51d51374`) con `Name` (es. "v64.3"), `changelog` (riassunto), `Files & media` (URL .zip del release GitHub). Senza questo step la release NON è completa.
12. (Se CWS pubblicato) upload ZIP su Chrome Web Store Dashboard

## 10. Risorse esterne

- **Notion EpiDuck page**: vedi sezione 1
- **Versioni DB**: `https://www.notion.so/3593bdcd01e480feaed6edb2ee4532be`
- **GitHub repo**: `https://github.com/matteo-sketch/EpiDuck`
- **Issues**: `https://github.com/matteo-sketch/EpiDuck/issues`
- **Releases**: `https://github.com/matteo-sketch/EpiDuck/releases`
- **Buy Me a Coffee**: `https://buymeacoffee.com/79ai4gmnnt`
- **Privacy policy hosted**: `https://github.com/matteo-sketch/EpiDuck/blob/main/PRIVACY.md`
- **Repo riferimento performance (ispirato)**: `polywock/globalSpeed` (SetPlaybackRate class)
- **Repo riferimento alt**: `Takeda117/Vtt-to-notion-Epicode` (multi-AI fallback, chunking)

## 11. Comando init nuova sessione

> Apri sessione → digita: "leggi `~/Documents/epicduck/CLAUDE.md`"
> Io leggo questo file, riprendo da dove eravamo. Caveman mode già implicito (è nel system).
