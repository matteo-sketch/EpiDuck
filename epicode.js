(function () {
    'use strict';

    // ---------- Global enable/disable ----------
    // Listener live: se l'utente cambia il toggle nel popup, ricarica la pagina per
    // attivare/disattivare l'estensione senza dover ricaricare manualmente.
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.epiduckEnabled) {
                location.reload();
            }
        });
    } catch (_) {}

    // Gate iniziale: se disabilitata, esci subito (nessuna UI, nessun intervallo).
    let _epiduckBootstrap = null;
    try {
        _epiduckBootstrap = new Promise((res) => {
            chrome.storage.local.get(['epiduckEnabled'], (r) => res(r.epiduckEnabled !== false));
        });
    } catch (_) { _epiduckBootstrap = Promise.resolve(true); }

    _epiduckBootstrap.then((enabled) => {
        if (!enabled) {
            console.log('[EpicodeFlow] estensione disabilitata da popup');
            return;
        }
        bootEpiDuck();
    });

    function bootEpiDuck() {

    const MAX_MINUTES   = 600;
    const QUALITIES = ['240p', '360p', '540p', '720p', '1080p', 'auto'];
    const SPEEDS = [1, 1.25, 1.5, 2, 4, 8, 16];

    const QUALITY_KEY = `epicode_quality_${location.hostname}`;
    const SPEED_KEY   = `epicode_speed_${location.hostname}`;

    let currentSpeed   = parseFloat(localStorage.getItem(SPEED_KEY) || localStorage.getItem('epicode_speed') || '1');
    let currentQuality = localStorage.getItem(QUALITY_KEY) || '360p';

    const startTime = Date.now();
    let scriptActive   = true;
    let autoMode       = true;
    let lastIframeSrc  = null;
    let qualityApplied = false;
    let forcedSkipDeadline = 0;

    const videoState = {
        duration: 0,
        currentTime: 0,
        paused: true,
        ended: false,
        playbackRate: 0,
        lastUpdate: 0
    };
    let autoSkipArmed = true;

    let measuredRate    = 0;
    let lastWallTs      = 0;
    let lastVideoTs     = 0;

    const NO_VIDEO_WAIT_SECS = 10;
    let noVideoDeadline = 0;
    let isExtracting = false;

    // ---------- Auto error capture + bug report ----------
    const ERROR_BUFFER_KEY = 'epicode_error_buffer';
    const MAX_ERRORS = 50;
    const REPO_ISSUES_URL = 'https://github.com/matteo-sketch/EpiDuck/issues/new';

    function bufferError(payload) {
        try {
            chrome.storage.local.get([ERROR_BUFFER_KEY], (r) => {
                const buf = (r[ERROR_BUFFER_KEY] || []);
                buf.push({ ts: Date.now(), ...payload });
                while (buf.length > MAX_ERRORS) buf.shift();
                chrome.storage.local.set({ [ERROR_BUFFER_KEY]: buf });
            });
        } catch (_) {}
    }

    function isOwnError(filename, msg) {
        const s = `${filename || ''} ${msg || ''}`;
        return /epicduck|epiduck|epicode\.js|vimeo\.js|vimeo-main\.js|EpicodeFlow/i.test(s);
    }

    window.addEventListener('error', (e) => {
        const msg = (e.message || '').slice(0, 200);
        if (!isOwnError(e.filename, msg)) return;
        bufferError({
            type: 'error',
            msg,
            file: (e.filename || '').slice(-100),
            line: e.lineno,
            col: e.colno,
            stack: (e.error && e.error.stack ? e.error.stack.slice(0, 500) : null)
        });
    });

    window.addEventListener('unhandledrejection', (e) => {
        const r = e.reason || {};
        const msg = (r.message || String(r) || '').slice(0, 200);
        const stack = (r.stack || '').slice(0, 500);
        if (!isOwnError(stack, msg)) return;
        bufferError({ type: 'promise', msg, stack });
    });

    function sanitizeUrl(u) {
        try {
            const url = new URL(u);
            return `${url.origin}${url.pathname}`;
        } catch (_) { return '[invalid]'; }
    }

    function openBugReport() {
        chrome.storage.local.get([ERROR_BUFFER_KEY], (r) => {
            const errors = (r[ERROR_BUFFER_KEY] || []).slice(-10);
            let v = '';
            try { v = chrome.runtime.getManifest().version; } catch (_) {}
            const ua = navigator.userAgent;
            const url = sanitizeUrl(location.href);
            const courseId = getCourseId() || 'n/a';
            const lessonId = getLessonId() || 'n/a';
            const status = document.getElementById('m-status')?.innerText || 'n/a';
            const vidTime = document.getElementById('m-vid-time')?.innerText || 'n/a';
            const skip = document.getElementById('m-vid-skip')?.innerText || 'n/a';
            const debug = document.getElementById('m-debug')?.innerText || 'n/a';
            const errLines = errors.length
                ? errors.map(e => `- [${new Date(e.ts).toISOString().slice(11,19)}] ${e.type}: ${e.msg}${e.file ? ` (${e.file}:${e.line})` : ''}`).join('\n')
                : '_nessun errore catturato_';
            const body = `## Descrizione bug
<!-- Descrivi cosa è successo e cosa ti aspettavi -->


## Context (auto-generato)
- **EpiDuck**: v${v}
- **URL**: ${url}
- **Course**: ${courseId} — **Lesson**: ${lessonId}
- **Status box**: ${status}
- **Skip**: ${skip}
- **Video time**: ${vidTime}
- **Debug**: ${debug}
- **Speed user**: ${currentSpeed}x — **Quality**: ${currentQuality}
- **UA**: ${ua}

## Errori catturati (ultimi 10)
${errLines}
`;
            const issueUrl = `${REPO_ISSUES_URL}?labels=bug&body=${encodeURIComponent(body)}`;
            window.open(issueUrl, '_blank');
        });
    }

    // ---------- Auto-quality drop a velocità alte ----------
    const AUTO_QUALITY_SPEED_THRESHOLD = 8;
    const AUTO_QUALITY_DROP = '360p';
    let autoQualityActive = false;
    let lastSpeedForQualityCheck = currentSpeed;

    // ---------- Hold-to-speed (keyboard) ----------
    const HOLD_KEY = 'Shift';
    const HOLD_MULTIPLIER = 2;
    let holdActive = false;

    function isTypingTarget(el) {
        if (!el) return false;
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (el.isContentEditable) return true;
        return false;
    }

    function sendSpeedDirect(speed) {
        const iframe = document.querySelector('iframe[src*="vimeo.com"]');
        if (iframe) {
            try { iframe.contentWindow.postMessage({ __epicodeFlow: true, type: 'set-speed', speed }, '*'); } catch (_) {}
        }
        const v = (typeof findMeetingVideo === 'function') ? findMeetingVideo() : null;
        if (v) { try { v.playbackRate = speed; } catch (_) {} }
    }

    document.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.key !== HOLD_KEY) return;
        if (isTypingTarget(e.target)) return;
        if (holdActive) return;
        holdActive = true;
        const boost = Math.max(0.25, Math.min(16, currentSpeed * HOLD_MULTIPLIER));
        sendSpeedDirect(boost);
        const status = document.getElementById('m-status');
        if (status) { status.innerText = `⚡ HOLD ${boost}x`; status.style.color = '#facc15'; }
    }, true);

    document.addEventListener('keyup', (e) => {
        if (e.key !== HOLD_KEY) return;
        if (!holdActive) return;
        holdActive = false;
        // Ripristina effective (rispetta cap se tracked)
        if (typeof ensureEffectiveSpeed === 'function') {
            lastEffectiveSpeed = null;
            ensureEffectiveSpeed();
        } else {
            sendSpeedDirect(currentSpeed);
        }
    }, true);

    // Window blur: rilascia hold (evita stuck quando alt-tab con tasto premuto)
    window.addEventListener('blur', () => {
        if (holdActive) {
            holdActive = false;
            if (typeof ensureEffectiveSpeed === 'function') {
                lastEffectiveSpeed = null;
                ensureEffectiveSpeed();
            }
        }
    });

    // ---------- Widget completamento Epicode (in alto a destra) ----------
    // Cache: l'elemento è lo stesso fra tick, validare prima di ri-cercare nel DOM
    let _cachedPctEl = null;

    function _validatePctEl(el) {
        if (!el || !el.isConnected) return false;
        const txt = (el.innerText || '').trim();
        if (!/^\d{1,3}(?:\.\d+)?%$/.test(txt)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function _searchPctEl() {
        const W = window.innerWidth;
        const ps = document.querySelectorAll('p');
        for (const p of ps) {
            const txt = (p.innerText || '').trim();
            if (!/^\d{1,3}(?:\.\d+)?%$/.test(txt)) continue;
            const r = p.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            // Tolleranza posizione: in viewport, parte alta-destra ma non rigida
            if (r.y > 600) continue;
            if (r.x < W * 0.3) continue;
            const parent = p.parentElement;
            if (!parent) continue;
            // Parent ha progress bar (div annidato) o icona/elemento accanto
            const hasProgressBar = !!parent.querySelector('div > div');
            const siblingsCount = parent.children.length;
            if (hasProgressBar || siblingsCount >= 2) return p;
        }
        return null;
    }

    function findEpicodeCompletionPctEl() {
        if (_validatePctEl(_cachedPctEl)) return _cachedPctEl;
        _cachedPctEl = _searchPctEl();
        return _cachedPctEl;
    }

    function invalidatePctElCache() { _cachedPctEl = null; }

    function readEpicodeCompletionPct() {
        const el = findEpicodeCompletionPctEl();
        if (!el) return null;
        const m = (el.innerText || '').match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : null;
    }

    // Restituisce {server, own, effective} — server da DOM Epicode, own da videoState/Video.js, effective = max.
    function getCurrentCompletionPct() {
        const server = readEpicodeCompletionPct();
        let own = null;
        if (videoState.duration > 0) {
            own = (videoState.currentTime / videoState.duration) * 100;
        } else {
            const v = findMeetingVideo();
            if (v && isFinite(v.duration) && v.duration > 0) own = (v.currentTime / v.duration) * 100;
        }
        const effective = Math.max(server ?? 0, own ?? 0);
        return { server, own, effective: isFinite(effective) ? effective : null };
    }

    // Cap velocità quando tracker server-side presente (altrimenti server non sta dietro)
    const MAX_SPEED_TRACKED = 4;
    const MAX_SPEED_TRACKED_STUCK = 1.5; // throttle estremo quando server stagna
    const SERVER_STUCK_MS = 8000;
    let lastEffectiveSpeed = null;
    let pageEntryServerPct = null;   // % server al caricamento pagina (per evitare skip immediato)
    let pageLoadTs = Date.now();
    let serverWatchdog = { lastPct: -1, lastChangeTs: 0 };

    function tickServerWatchdog() {
        if (!isTrackedLesson()) {
            serverWatchdog.lastPct = -1;
            serverWatchdog.lastChangeTs = 0;
            return;
        }
        const pct = readEpicodeCompletionPct();
        if (pct == null) return;
        if (serverWatchdog.lastPct < 0) {
            serverWatchdog.lastPct = pct;
            serverWatchdog.lastChangeTs = Date.now();
            return;
        }
        if (pct > serverWatchdog.lastPct) {
            serverWatchdog.lastPct = pct;
            serverWatchdog.lastChangeTs = Date.now();
        }
    }

    function isServerStuck() {
        if (!isTrackedLesson()) return false;
        if (serverWatchdog.lastChangeTs === 0) return false;
        return (Date.now() - serverWatchdog.lastChangeTs) > SERVER_STUCK_MS;
    }

    function isTrackedLesson() {
        return !!findEpicodeCompletionPctEl();
    }

    function getEffectiveSpeed() {
        if (!isTrackedLesson()) return currentSpeed;
        const cap = isServerStuck() ? MAX_SPEED_TRACKED_STUCK : MAX_SPEED_TRACKED;
        return Math.min(currentSpeed, cap);
    }

    function ensureEffectiveSpeed() {
        const eff = getEffectiveSpeed();
        if (eff !== lastEffectiveSpeed) {
            lastEffectiveSpeed = eff;
            sendSpeedToIframe(eff);
            const v = findMeetingVideo();
            if (v) { try { v.playbackRate = eff; } catch (_) {} }
        }
    }

    // Soglia completamento: 100% sia per tracker server-side sia per own
    const COMPLETION_THRESHOLD = 100;

    function tickEpicodeCompletion() {
        if (!autoMode || !scriptActive || !autoSkipArmed) return;
        ensureEffectiveSpeed();
        const { server, own } = getCurrentCompletionPct();
        const threshold = COMPLETION_THRESHOLD;
        const tracked = isTrackedLesson();

        if (!tracked) {
            // Senza tracker server → usa own (comportamento precedente)
            if (own != null && own >= threshold) {
                autoSkipArmed = false;
                markVideoCompleted();
                const skipEl = document.getElementById('m-vid-skip');
                if (skipEl) { skipEl.innerText = `Skip: ${own.toFixed(1)}% (own) → vado`; skipEl.style.color = '#2ecc71'; }
                setTimeout(forzaNavigazione, 300);
            }
            return;
        }

        // Con tracker server: SOLO server può triggerare skip
        if (server == null) return;

        const onPageMs = Date.now() - pageLoadTs;
        const ENTRY_GRACE_MS = 5000;
        const alreadyCompleted = pageEntryServerPct != null && pageEntryServerPct >= threshold;

        // Grace period 5s sia per "già completata all'arrivo" sia per skip normale appena caricato
        if (server >= threshold && onPageMs < ENTRY_GRACE_MS) {
            const remain = Math.ceil((ENTRY_GRACE_MS - onPageMs) / 1000);
            const status = document.getElementById('m-status');
            const skipEl = document.getElementById('m-vid-skip');
            const label = alreadyCompleted ? 'Già completata' : 'Completata';
            if (status) {
                status.innerText = `${label} (${server}%) — skip in ${remain}s`;
                status.style.color = '#f59e0b';
            }
            if (skipEl) {
                skipEl.innerText = `Skip auto in ${remain}s`;
                skipEl.style.color = '#f59e0b';
            }
            return;
        }

        if (server >= threshold) {
            autoSkipArmed = false;
            markVideoCompleted();
            const skipEl = document.getElementById('m-vid-skip');
            if (skipEl) { skipEl.innerText = `Skip: server ${server}% ≥ ${threshold}% → vado`; skipEl.style.color = '#2ecc71'; }
            const status = document.getElementById('m-status');
            if (status) { status.innerText = `Server ${server}% ≥ ${threshold}% → skip`; status.style.color = '#4ade80'; }
            setTimeout(forzaNavigazione, 300);
            return;
        }

        // Server indietro: se own ha già superato server di molto, mostra stato attesa
        if (own != null && own - server > 15) {
            const status = document.getElementById('m-status');
            if (status) {
                const stuck = isServerStuck();
                const ageS = Math.floor((Date.now() - serverWatchdog.lastChangeTs) / 1000);
                if (stuck) {
                    status.innerText = `⚠ Server fermo da ${ageS}s — speed ridotta a ${MAX_SPEED_TRACKED_STUCK}x`;
                    status.style.color = '#ef4444';
                } else {
                    status.innerText = `⏳ Aspetto server: ${server}% / ${threshold}% (own ${own.toFixed(0)}%)`;
                    status.style.color = '#f59e0b';
                }
            }
        }
    }

    // ---------- Lezioni meeting (Video.js Epicode recording) ----------
    let meetingDetailCache = { lessonId: null, detail: null, inflight: null };
    let meetingAutoPlayed = false;
    let meetingLastLessonId = null;

    function findMeetingVideo() {
        // Strategie multiple: video.js classico, video-js custom element, video con src Epicode CDN
        const candidates = [
            ...document.querySelectorAll('.video-js video, video-js video'),
            ...document.querySelectorAll('video[src*="cdn.epicode.com"], video[src*="lms/recordings"]')
        ];
        for (const v of candidates) {
            const src = v.currentSrc || v.src || '';
            if (!src) continue;
            if (src.includes('vimeo.com')) continue;
            return v;
        }
        return null;
    }

    // Trova content-next-button con fallback (testid → aria-label → text match)
    function findContentNextButton() {
        let btn = findContentNextButton();
        if (btn) return btn;
        const buttons = [...document.querySelectorAll('button, [role="button"]')];
        btn = buttons.find(b => {
            const lbl = (b.getAttribute('aria-label') || b.textContent || '').trim().toLowerCase();
            return lbl === 'next' || lbl === 'successivo' || lbl === 'prossimo';
        });
        return btn || null;
    }

    async function ensureMeetingDetail() {
        const id = parseInt(getLessonId() || '', 10);
        if (!id) return null;
        if (meetingDetailCache.lessonId === id && meetingDetailCache.detail) return meetingDetailCache.detail;
        if (meetingDetailCache.inflight && meetingDetailCache.lessonId === id) return meetingDetailCache.inflight;
        meetingDetailCache.lessonId = id;
        meetingDetailCache.inflight = (async () => {
            try {
                const d = await fetchContentDetail(id);
                meetingDetailCache.detail = d;
                return d;
            } catch (e) {
                console.warn('[EpicodeFlow] meeting detail err', e.message);
                return null;
            } finally { meetingDetailCache.inflight = null; }
        })();
        return meetingDetailCache.inflight;
    }

    function handleMeetingVideo(v) {
        if (!v) return;
        const lessonId = getLessonId();
        if (meetingLastLessonId !== lessonId) {
            meetingLastLessonId = lessonId;
            meetingAutoPlayed = false;
            autoSkipArmed = true;
            ensureMeetingDetail();
        }
        // Forza playback rate
        try { v.playbackRate = currentSpeed; } catch (_) {}
        // Auto-play (utente potrebbe aver disabilitato autoplay con suono)
        if (autoMode && scriptActive && v.paused && !meetingAutoPlayed) {
            meetingAutoPlayed = true;
            try { v.muted = true; v.play().catch(() => {}); } catch (_) {}
            const btn = document.querySelector('.vjs-big-play-button');
            if (btn && v.paused) try { btn.click(); } catch (_) {}
        }

        // Tracking completion
        const dur = isFinite(v.duration) ? v.duration : 0;
        const cur = v.currentTime || 0;
        if (dur <= 0) return;
        const detail = meetingDetailCache.detail;
        const threshold = COMPLETION_THRESHOLD;
        const pct = (cur / dur) * 100;

        // Update UI
        const status = document.getElementById('m-status');
        const tEl   = document.getElementById('m-vid-time');
        const rEl   = document.getElementById('m-vid-remain');
        const skEl  = document.getElementById('m-vid-skip');
        if (tEl) tEl.innerText = `Recording: ${fmt(cur)} / ${fmt(dur)} (${v.playbackRate.toFixed(2)}x)`;
        if (rEl) rEl.innerText = `Completamento: ${pct.toFixed(1)}% / ${threshold}%`;
        if (skEl) {
            if (pct >= threshold) { skEl.innerText = `Skip: PRONTO (${pct.toFixed(1)}%)`; skEl.style.color = '#4ade80'; }
            else                  { skEl.innerText = `Skip: a ${threshold}% (${(threshold - pct).toFixed(1)}% rim.)`; skEl.style.color = '#a78bfa'; }
        }
        if (status) {
            status.innerText = `MEETING ${pct.toFixed(1)}% / ${threshold}%`;
            status.style.color = pct >= threshold ? '#4ade80' : '#a78bfa';
        }

        // Auto-skip se >= threshold
        if (autoMode && scriptActive && autoSkipArmed && pct >= threshold) {
            autoSkipArmed = false;
            markVideoCompleted();
            if (skEl) { skEl.innerText = 'Skip: MEETING completato → vado'; skEl.style.color = '#2ecc71'; }
            setTimeout(forzaNavigazione, 300);
        }
    }

    function updateStateIcon() {
        const el = document.getElementById('m-state-icon');
        if (!el) return;
        if (isExtracting) { el.textContent = '📥'; el.title = 'Estrazione corso in corso'; return; }
        if (!scriptActive) { el.textContent = '⏹'; el.title = 'Sessione finita'; return; }
        const iframe = document.querySelector('iframe[src*="vimeo.com"]');
        const meetVid = !iframe ? findMeetingVideo() : null;
        if (!iframe && !meetVid) {
            if (!autoMode) { el.textContent = '💤'; el.title = 'Non-video, auto OFF'; return; }
            const remain = noVideoDeadline > 0 ? Math.max(0, Math.ceil((noVideoDeadline - Date.now()) / 1000)) : NO_VIDEO_WAIT_SECS;
            el.textContent = '⏳';
            el.title = `Skip non-video in ${remain}s`;
            return;
        }
        if (meetVid) {
            if (!autoMode) { el.textContent = '⏸'; el.title = 'Meeting, auto OFF'; return; }
            if (meetVid.paused) { el.textContent = '⏸'; el.title = 'Meeting in pausa'; return; }
            const pct = meetVid.duration > 0 ? (meetVid.currentTime / meetVid.duration * 100).toFixed(1) : '0';
            el.textContent = '▶';
            el.title = `Meeting ${pct}%`;
            return;
        }
        if (!autoMode) { el.textContent = '⏸'; el.title = 'Auto OFF'; return; }
        if (videoState.paused) { el.textContent = '⏸'; el.title = 'In pausa'; return; }
        el.textContent = '▶';
        el.title = videoState.duration > 0 ? `In riproduzione ${Math.round((videoState.currentTime/videoState.duration)*100)}%` : 'In riproduzione';
    }

    // ---------- Transcript ----------
    const transcriptCues = [];
    let notionSettings = { apiKey: '', pageId: '' };

    chrome.storage.local.get(['notionApiKey', 'notionPageId'], (result) => {
        notionSettings.apiKey = result.notionApiKey || '';
        notionSettings.pageId = result.notionPageId || '';
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.notionApiKey) notionSettings.apiKey = changes.notionApiKey.newValue || '';
        if (changes.notionPageId) notionSettings.pageId = changes.notionPageId.newValue || '';
        // Cross-tab sync: anthropicApiKey usato in runExtract via extractGetSettings (read on demand)
        // extractionState scritto da una tab visibile alle altre alla prossima azione
    });

    // ---------- Controllo velocità ----------
    function sendSpeedToIframe(speed) {
        const iframe = document.querySelector('iframe[src*="vimeo.com"]');
        if (!iframe) return;
        try { iframe.contentWindow.postMessage({ __epicodeFlow: true, type: 'set-speed', speed }, '*'); } catch (_) {}
    }

    function renderSpeedButtons() {
        const row = document.getElementById('m-speed-row');
        if (!row) return;
        const capped = typeof isTrackedLesson === 'function' && isTrackedLesson();
        row.innerHTML = `<span style="font-size:10px;color:${capped ? '#f59e0b' : '#a78bfa'};white-space:nowrap;" title="${capped ? 'Tracking server attivo: cap a 4x' : 'Velocità'}">${capped ? 'Vel*:' : 'Vel:'}</span>`;
        for (const s of SPEEDS) {
            const btn = document.createElement('button');
            btn.textContent = `${s}x`;
            const active = s === currentSpeed;
            const willCap = capped && s > MAX_SPEED_TRACKED;
            btn.style.cssText = [
                'flex:1', 'border:none', 'padding:4px 1px', 'border-radius:3px',
                'cursor:pointer', 'font-weight:bold', 'font-size:10px',
                `background:${active ? '#7c3aed' : '#2a1054'}`,
                `color:${active ? 'white' : (willCap ? '#6b7280' : '#a78bfa')}`,
                willCap ? 'text-decoration:line-through' : ''
            ].filter(Boolean).join(';');
            btn.title = willCap ? 'Velocità limitata a 4x (tracking server)' : '';
            btn.onclick = () => setSpeed(s);
            row.appendChild(btn);
        }
    }

    function setSpeed(speed) {
        currentSpeed = speed;
        localStorage.setItem(SPEED_KEY, String(speed));
        localStorage.setItem('epicode_speed', String(speed));
        renderSpeedButtons();
        lastEffectiveSpeed = null;
        ensureEffectiveSpeed();
        checkAutoQualityDrop();
    }

    function renderQualityButtons() {
        const row = document.getElementById('m-quality-row');
        if (!row) return;
        row.innerHTML = '<span style="font-size:10px;color:#a78bfa;white-space:nowrap;">Q:</span>';
        for (const q of QUALITIES) {
            const btn = document.createElement('button');
            btn.textContent = q;
            const active = q === currentQuality;
            btn.style.cssText = [
                'flex:1', 'border:none', 'padding:4px 1px', 'border-radius:3px',
                'cursor:pointer', 'font-weight:bold', 'font-size:10px',
                `background:${active ? '#0891b2' : '#164e63'}`,
                `color:${active ? 'white' : '#67e8f9'}`
            ].join(';');
            btn.onclick = () => setQuality(q);
            row.appendChild(btn);
        }
    }

    function setQuality(q) {
        currentQuality = q;
        localStorage.setItem(QUALITY_KEY, q);
        qualityApplied = false;
        autoQualityActive = false; // utente sceglie esplicitamente → disattiva auto-drop
        renderQualityButtons();
        const iframe = document.querySelector('iframe[src*="vimeo.com"]');
        if (iframe) {
            vimeoCmd(iframe, 'setQuality', q);
            qualityApplied = true;
            updateVinfo();
        }
    }

    function getLessonTitle() {
        const h = document.querySelector('h1, h2, [class*="lesson-title"], [class*="LessonTitle"]');
        if (h) return h.innerText.trim().slice(0, 120);
        return document.title.split('|')[0].trim().slice(0, 120) || 'Transcript';
    }

    function fmtTime(s) {
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    }

    function buildTranscriptMarkdown() {
        const title = getLessonTitle();
        const lines = [`# ${title}`, '', `*Trascrizione — ${new Date().toLocaleString('it-IT')}*`, ''];
        for (const c of transcriptCues) {
            lines.push(`**${fmtTime(c.startTime)}** ${c.text}`);
        }
        return lines.join('\n');
    }

    function buildPlainTranscriptText() {
        // Solo testo pulito, senza timestamp. Una frase per riga, normalizzata.
        const parts = transcriptCues
            .map(c => (c.text || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean);
        // Deduplica consecutivi identici (Vimeo a volte ripete cue)
        const out = [];
        for (const p of parts) {
            if (out[out.length - 1] !== p) out.push(p);
        }
        return out.join(' ');
    }

    function buildNotionBlocks() {
        const lines = transcriptCues.map(c => `[${fmtTime(c.startTime)}] ${c.text}`);
        const fullText = lines.join('\n');
        const blocks = [];
        for (let i = 0; i < fullText.length && blocks.length < 100; i += 1900) {
            blocks.push({
                object: 'block',
                type: 'paragraph',
                paragraph: {
                    rich_text: [{ type: 'text', text: { content: fullText.slice(i, i + 1900) } }]
                }
            });
        }
        return blocks;
    }

    function showSaveStatus(msg, color) {
        const el = document.getElementById('m-save-status');
        if (el) { el.innerText = msg; el.style.color = color || '#888'; }
    }

    function updateTranscriptCount() {
        const el = document.getElementById('m-transcript-count');
        if (el) el.innerText = `Transcript: ${transcriptCues.length} cue${transcriptCues.length !== 1 ? 's' : ''}`;
    }

    async function copyTranscriptToClipboard() {
        if (transcriptCues.length === 0) { showSaveStatus('Nessun cue ricevuto', '#f97316'); return; }
        try {
            await navigator.clipboard.writeText(buildPlainTranscriptText());
            showSaveStatus('Testo pulito copiato ✓', '#4ade80');
        } catch (e) {
            showSaveStatus('Errore copia: ' + e.message, '#ef4444');
        }
    }

    function saveTranscriptAsFile() {
        if (transcriptCues.length === 0) { showSaveStatus('Nessun cue ricevuto', '#e67e22'); return; }
        const md = buildTranscriptMarkdown();
        const slug = getLessonTitle().replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 60);
        const blob = new Blob([md], { type: 'text/markdown; charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${slug}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showSaveStatus(`Scaricato: ${slug}.md`, '#2ecc71');
    }

    async function saveTranscriptToNotion() {
        if (!notionSettings.apiKey || !notionSettings.pageId) {
            showSaveStatus('Configura API key e Page ID nel popup', '#e67e22');
            return;
        }
        if (transcriptCues.length === 0) { showSaveStatus('Nessun cue ricevuto', '#e67e22'); return; }

        showSaveStatus('Invio a Notion...', '#888');
        const title = getLessonTitle();
        const blocks = buildNotionBlocks();

        try {
            const res = await fetch('https://api.notion.com/v1/pages', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${notionSettings.apiKey}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                },
                body: JSON.stringify({
                    parent: { page_id: notionSettings.pageId },
                    properties: {
                        title: { title: [{ type: 'text', text: { content: title } }] }
                    },
                    children: blocks
                })
            });
            if (res.ok) {
                showSaveStatus(`Salvato su Notion ✓ (${blocks.length} blocchi)`, '#2ecc71');
            } else {
                const err = await res.json().catch(() => ({}));
                showSaveStatus(`Errore Notion: ${err.message || res.status}`, '#e74c3c');
            }
        } catch (e) {
            showSaveStatus(`Errore rete: ${e.message}`, '#e74c3c');
        }
    }

    // ---------- UI ----------
    const old = document.getElementById('m-box-main');
    if (old) old.remove();

    const box = document.createElement('div');
    box.id = 'm-box-main';
    box.style.cssText = [
        'position:fixed', 'top:10px', 'right:10px',
        'z-index:2147483647', 'background:#0f0620', 'color:#ede9fe',
        'padding:14px', 'border:2px solid #6d28d9',
        'font-family:sans-serif', 'font-weight:bold',
        'border-radius:10px', 'box-shadow:0 4px 24px rgba(109,40,217,0.5)',
        'min-width:230px', 'font-size:12px'
    ].join(';');

    const DUCK_SVG_INLINE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="22" height="22"><rect width="128" height="128" rx="22" fill="#0EA5E9"/><ellipse cx="60" cy="92" rx="40" ry="26" fill="#FDE047"/><path d="M 28 88 Q 36 68 56 72 Q 60 86 44 96 Z" fill="#FACC15"/><circle cx="86" cy="54" r="24" fill="#FDE047"/><circle cx="93" cy="48" r="4.5" fill="#1F2937"/><circle cx="94.5" cy="46.5" r="1.5" fill="#FFFFFF"/><path d="M 106 54 L 122 58 L 122 64 L 106 60 Z" fill="#F97316"/><path d="M 106 60 L 122 64 L 122 68 L 106 66 Z" fill="#EA580C"/><ellipse cx="68" cy="118" rx="6" ry="3" fill="#F97316"/><ellipse cx="84" cy="118" rx="6" ry="3" fill="#F97316"/></svg>';
    box.innerHTML = `
        <div id="m-header" style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span id="m-duck" style="flex-shrink:0;display:inline-flex;align-items:center;">${DUCK_SVG_INLINE}</span>
            <span id="m-state-icon" style="font-size:14px;flex-shrink:0;">⏳</span>
            <div id="m-status" style="color:#a78bfa;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;">ANALISI...</div>
            <button id="m-settings" title="Impostazioni" style="background:none;border:none;cursor:pointer;color:#67e8f9;font-size:14px;padding:0 4px;line-height:1;flex-shrink:0;">⚙</button>
            <button id="m-toggle" title="Minimizza/espandi" style="background:none;border:none;cursor:pointer;color:#7c3aed;font-size:17px;font-weight:bold;padding:0 0 0 4px;line-height:1;flex-shrink:0;">▾</button>
        </div>
        <div id="m-body">
            <div id="m-timer"  style="font-size:11px;color:#6b57a0;margin-bottom:3px;">Sessione: 0m / ${MAX_MINUTES}m</div>
            <div id="m-vinfo"  style="font-size:10px;color:#6b57a0;margin-bottom:4px;">speed ⏳ | ${currentQuality} ⏳</div>
            <div id="m-speed-row" style="display:flex;gap:3px;margin-bottom:4px;align-items:center;"></div>
            <div id="m-quality-row" style="display:flex;gap:3px;margin-bottom:6px;align-items:center;"></div>
            <div id="m-vid-time"   style="font-size:11px;color:#ede9fe;margin-bottom:2px;">Video: --:-- / --:--</div>
            <div id="m-vid-remain" style="font-size:11px;color:#ede9fe;margin-bottom:2px;">Restante (reale): --</div>
            <div id="m-vid-skip"   style="font-size:11px;color:#6b57a0;margin-bottom:2px;">Skip: in attesa</div>
            <div id="m-vid-force-skip" style="font-size:11px;color:#ef4444;margin-bottom:8px;">Skip Forzato: in attesa dati...</div>
            <div id="m-debug"  style="font-size:10px;color:#3d2b6e;margin-bottom:10px;">ID: ---</div>
            <button id="m-skip" style="width:100%;background:linear-gradient(135deg,#7c3aed,#5b21b6);color:white;border:none;padding:9px;border-radius:6px;cursor:pointer;font-weight:bold;margin-bottom:6px;letter-spacing:0.5px;">
                ⏭ SKIP PROSSIMO
            </button>
            <div style="display:flex;gap:6px;margin-bottom:8px;">
                <button id="m-playpause" style="flex:1;background:#2a1054;color:#ede9fe;border:none;padding:8px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;">
                    ⏸ PAUSA VIDEO
                </button>
                <button id="m-auto" style="flex:1;background:#166534;color:white;border:none;padding:8px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;">
                    ⏹ BLOCCA AUTO
                </button>
            </div>
            <div style="border-top:1px solid #2a1054;padding-top:8px;">
                <div id="m-transcript-count" style="font-size:10px;color:#6b57a0;margin-bottom:5px;">Transcript: 0 cues</div>
                <div style="display:flex;gap:6px;margin-bottom:5px;">
                    <button id="m-save-file" style="flex:1;background:#1e3a5f;color:#93c5fd;border:none;padding:7px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;">
                        💾 .md
                    </button>
                    <button id="m-save-notion" style="flex:1;background:#3b1f6e;color:#c4b5fd;border:none;padding:7px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;">
                        📝 Notion
                    </button>
                </div>
                <button id="m-copy-transcript" style="width:100%;background:#1e2a1e;color:#4ade80;border:1px solid #166534;padding:7px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;margin-bottom:5px;">
                    📋 Copia Transcript
                </button>
                <div id="m-save-status" style="font-size:10px;color:#6b57a0;min-height:14px;"></div>
            </div>
        </div>
    `;
    document.body.appendChild(box);

    // ---------- Drag-to-move ----------
    (function makeDraggable() {
        const header = document.getElementById('m-header');
        if (!header) return;
        header.style.cursor = 'move';
        let dragging = false, offX = 0, offY = 0, moved = false;
        const POS_KEY = `epicode_box_pos_${location.hostname}`;
        try {
            const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
            if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
                box.style.left = Math.max(0, Math.min(window.innerWidth - 80, saved.left)) + 'px';
                box.style.top  = Math.max(0, Math.min(window.innerHeight - 30, saved.top))  + 'px';
                box.style.right = 'auto';
            }
        } catch (e) {}
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            const rect = box.getBoundingClientRect();
            offX = e.clientX - rect.left;
            offY = e.clientY - rect.top;
            box.style.right = 'auto';
            box.style.left  = rect.left + 'px';
            box.style.top   = rect.top  + 'px';
            dragging = true; moved = false;
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            moved = true;
            const x = Math.max(0, Math.min(window.innerWidth  - 40, e.clientX - offX));
            const y = Math.max(0, Math.min(window.innerHeight - 30, e.clientY - offY));
            box.style.left = x + 'px';
            box.style.top  = y + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            document.body.style.userSelect = '';
            if (moved) {
                try {
                    const rect = box.getBoundingClientRect();
                    localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
                } catch (e) {}
            }
        });
    })();

    document.getElementById('m-skip').onclick = manualSkip;
    document.getElementById('m-playpause').onclick = togglePlayPause;
    document.getElementById('m-auto').onclick = toggleAutoMode;
    document.getElementById('m-save-file').onclick = saveTranscriptAsFile;
    document.getElementById('m-save-notion').onclick = saveTranscriptToNotion;
    document.getElementById('m-copy-transcript').onclick = copyTranscriptToClipboard;
    document.getElementById('m-settings').onclick = () => {
        try { window.open(chrome.runtime.getURL('popup.html'), '_blank'); } catch (e) { console.warn('openSettings', e); }
    };
    renderSpeedButtons();
    renderQualityButtons();

    // ---------- Collassa / espandi ----------
    let boxCollapsed = localStorage.getItem('epicode_collapsed') === '1';

    function applyCollapsed() {
        const body = document.getElementById('m-body');
        const btn  = document.getElementById('m-toggle');
        const status = document.getElementById('m-status');
        const settings = document.getElementById('m-settings');
        if (!body || !btn) return;
        if (boxCollapsed) {
            body.style.display = 'none';
            btn.textContent    = '▸';
            if (status) status.style.display = 'none';
            if (settings) settings.style.display = 'none';
            box.style.minWidth = '0';
            box.style.padding = '6px 10px';
        } else {
            body.style.display = 'block';
            btn.textContent    = '▾';
            if (status) status.style.display = 'block';
            if (settings) settings.style.display = 'inline-block';
            box.style.minWidth = '230px';
            box.style.padding = '14px';
        }
    }

    document.getElementById('m-toggle').onclick = () => {
        boxCollapsed = !boxCollapsed;
        localStorage.setItem('epicode_collapsed', boxCollapsed ? '1' : '0');
        applyCollapsed();
    };

    applyCollapsed();

    function manualSkip() {
        const wasActive = scriptActive;
        scriptActive = true;
        forzaNavigazione();
        scriptActive = wasActive;
    }

    function togglePlayPause() {
        const iframe = document.querySelector('iframe[src*="vimeo.com"]');
        if (!iframe) return;
        const btn = document.getElementById('m-playpause');
        if (videoState.paused) {
            vimeoCmd(iframe, 'play');
            btn.innerText = '⏸ PAUSA VIDEO';
            btn.style.background = '#2a1054';
        } else {
            vimeoCmd(iframe, 'pause');
            btn.innerText = '▶ RIPRENDI';
            btn.style.background = '#f97316';
        }
    }

    function toggleAutoMode() {
        autoMode = !autoMode;
        const btn = document.getElementById('m-auto');
        if (autoMode) {
            btn.innerText = '⏹ BLOCCA AUTO';
            btn.style.background = '#166534';
        } else {
            btn.innerText = '▶ RIPRENDI AUTO';
            btn.style.background = '#7f1d1d';
        }
    }

    function fmt(s) {
        if (!isFinite(s) || s < 0) return '--:--';
        s = Math.floor(s);
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
    }

    // ---------- Salvataggio Video Completati ----------
    let currentWatchedId = null;

    function markVideoStarted() {
        const urlId = window.location.href.split('/').pop().split('?')[0];
        if (!urlId) return;
        let started = [];
        try { started = JSON.parse(localStorage.getItem('epicode_started_videos') || '[]'); } catch(e){}
        if (!started.includes(urlId)) {
            started.push(urlId);
            localStorage.setItem('epicode_started_videos', JSON.stringify(started));
        }
    }

    function markVideoCompleted() {
        const urlId = window.location.href.split('/').pop().split('?')[0];
        if (!urlId) return;
        let completed = [];
        try { completed = JSON.parse(localStorage.getItem('epicode_completed_videos') || '[]'); } catch(e){}
        if (!completed.includes(urlId)) {
            completed.push(urlId);
            localStorage.setItem('epicode_completed_videos', JSON.stringify(completed));
        }
    }

    function getCourseId() {
        const m = window.location.href.match(/\/course[s]?\/(\d+)/);
        return m ? m[1] : null;
    }

    function getLessonId() {
        const m = window.location.href.match(/\/curriculum\/(\d+)/);
        return m ? m[1] : null;
    }

    function getSidebarNodes() {
        const courseId = getCourseId();
        const anchors = Array.from(document.querySelectorAll('a[href*="/curriculum/"]'));
        const filtered = courseId
            ? anchors.filter(a => new RegExp(`/course/${courseId}/curriculum/\\d+`).test(a.getAttribute('href') || a.href))
            : anchors;
        // Deduplica per lessonId (stesso link può comparire più volte)
        const seen = new Set();
        const out = [];
        for (const a of filtered) {
            const id = getNodeId(a);
            if (id && !seen.has(id)) { seen.add(id); out.push(a); }
        }
        return out;
    }

    function getNodeId(el) {
        const href = el.getAttribute('href') || el.href || '';
        const m = href.match(/\/curriculum\/(\d+)/);
        return m ? m[1] : null;
    }

    function getNextNodeEl() {
        const lessonId = getLessonId();
        if (!lessonId) return null;
        const nodes = getSidebarNodes();
        const idx = nodes.findIndex(el => getNodeId(el) === lessonId);
        if (idx === -1 || idx >= nodes.length - 1) return null;
        return nodes[idx + 1];
    }

    function getCurriculumLinks() { return getSidebarNodes(); }

    // ---------- API curriculum (cms.epicode.com) ----------
    const LEAF_TYPES = new Set(['embed','meeting','article','markdown','project','openEnded','quiz','nps','course_nps','activity']);
    const CURRICULUM_TTL_MS = 10 * 60 * 1000; // 10 min
    let curriculumCache = { courseId: null, ordered: [], fetchedAt: 0, inflight: null };

    function curriculumCacheFresh() {
        return curriculumCache.ordered.length > 0
            && curriculumCache.fetchedAt > 0
            && (Date.now() - curriculumCache.fetchedAt) < CURRICULUM_TTL_MS;
    }

    async function fetchCurriculum(courseId) {
        const tok = localStorage.getItem('auth_token');
        if (!tok) throw new Error('no auth_token');
        const url = `https://cms.epicode.com/items/content?filter%5Bcourses%5D%5Bcourse%5D%5B_eq%5D=${courseId}&fields=id,parent,sort,type,title&limit=-1`;
        const r = await fetch(url, { credentials: 'include', headers: { Authorization: `Bearer ${tok}` } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        const all = j.data || [];
        const childrenByParent = new Map();
        for (const c of all) {
            const k = c.parent ?? null;
            if (!childrenByParent.has(k)) childrenByParent.set(k, []);
            childrenByParent.get(k).push(c);
        }
        for (const arr of childrenByParent.values()) arr.sort((a, b) => (a.sort || 0) - (b.sort || 0));
        const ordered = [];
        const walk = (p) => {
            const kids = childrenByParent.get(p) || [];
            for (const k of kids) { ordered.push(k); walk(k.id); }
        };
        walk(null);
        return ordered;
    }

    async function ensureCurriculum() {
        const courseId = getCourseId();
        if (!courseId) return [];
        if (curriculumCache.courseId === courseId && curriculumCacheFresh()) return curriculumCache.ordered;
        if (curriculumCache.inflight && curriculumCache.courseId === courseId) return curriculumCache.inflight;
        // Cache scaduta o nuovo corso: invalida e re-fetcha
        if (curriculumCache.courseId !== courseId) {
            curriculumCache.ordered = [];
            curriculumCache.fetchedAt = 0;
        }
        curriculumCache.courseId = courseId;
        curriculumCache.inflight = (async () => {
            try {
                const ordered = await fetchCurriculum(courseId);
                curriculumCache.ordered = ordered;
                curriculumCache.fetchedAt = Date.now();
                console.log('[EpicodeFlow] curriculum cache popolata', { courseId, items: ordered.length, ttlMin: CURRICULUM_TTL_MS / 60000 });
                return ordered;
            } catch (e) {
                console.error('[EpicodeFlow] fetchCurriculum errore', e);
                curriculumCache.ordered = [];
                curriculumCache.fetchedAt = 0;
                return [];
            } finally {
                curriculumCache.inflight = null;
            }
        })();
        return curriculumCache.inflight;
    }

    function getNextLessonFromCache() {
        const lessonId = parseInt(getLessonId() || '', 10);
        if (!lessonId) return null;
        const ordered = curriculumCache.ordered;
        const idx = ordered.findIndex(o => o.id === lessonId);
        if (idx === -1) return null;
        for (let i = idx + 1; i < ordered.length; i++) {
            if (LEAF_TYPES.has(ordered[i].type)) return ordered[i];
        }
        return null;
    }

    function getNextLessonUrl() {
        const next = getNextLessonFromCache();
        const courseId = getCourseId();
        if (!next || !courseId) return null;
        return `${window.location.origin}/course/${courseId}/curriculum/${next.id}`;
    }

    // Bootstrap fetch
    ensureCurriculum();

    function renderCompletedDots() {
        let completed = [];
        let started = [];
        try { completed = JSON.parse(localStorage.getItem('epicode_completed_videos') || '[]'); } catch(e){}
        try { started = JSON.parse(localStorage.getItem('epicode_started_videos') || '[]'); } catch(e){}

        getSidebarNodes().forEach(node => {
            const id = getNodeId(node);
            if (!id) return;

            let dot = node.querySelector('.epicode-flow-dot');
            if (!dot) {
                dot = document.createElement('span');
                dot.className = 'epicode-flow-dot';
                dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;flex-shrink:0;vertical-align:middle;pointer-events:none;';
                node.insertBefore(dot, node.firstChild);
            }

            if (completed.includes(id)) {
                dot.style.backgroundColor = '#2ecc71';
                dot.title = 'Visto tutto';
            } else if (started.includes(id)) {
                dot.style.backgroundColor = '#f39c12';
                dot.title = 'Da finire';
            } else {
                dot.style.backgroundColor = '#3d2b6e';
                dot.title = 'Non visto';
            }
        });
    }

    // ---------- Listener da iframe Vimeo ----------
    window.addEventListener('message', (e) => {
        const d = e.data;
        if (!d || typeof d !== 'object' || !d.__epicodeFlow) return;

        if (d.type === 'transcript-cue') {
            const isDup = transcriptCues.some(c => c.startTime === d.startTime && c.text === d.text);
            if (!isDup) {
                transcriptCues.push({ text: d.text, startTime: d.startTime, endTime: d.endTime, lang: d.lang });
                transcriptCues.sort((a, b) => a.startTime - b.startTime);
                updateTranscriptCount();
            }
            return;
        }

        if (d.type !== 'video-info') return;

        videoState.duration     = d.duration || 0;
        videoState.currentTime  = d.currentTime || 0;
        videoState.paused       = !!d.paused;
        videoState.ended        = !!d.ended;
        videoState.playbackRate = d.playbackRate || 0;
        const now = Date.now();
        videoState.lastUpdate   = now;

        if (lastWallTs > 0 && !videoState.paused && !videoState.ended) {
            const dtWall  = (now - lastWallTs) / 1000;
            const dtVideo = videoState.currentTime - lastVideoTs;
            if (dtWall >= 0.3 && dtVideo > 0 && dtVideo < dtWall * 20) {
                const sample = dtVideo / dtWall;
                measuredRate = measuredRate > 0 ? (measuredRate * 0.6 + sample * 0.4) : sample;
            }
        }
        lastWallTs  = now;
        lastVideoTs = videoState.currentTime;

        if (d.event === 'ended') {
            markVideoCompleted();
            renderCompletedDots();
        }

        if (d.event === 'ended' && autoSkipArmed && scriptActive && autoMode) {
            autoSkipArmed = false;
            const skipEl = document.getElementById('m-vid-skip');
            if (skipEl) { skipEl.innerText = 'Skip: VIDEO FINITO → vado'; skipEl.style.color = '#2ecc71'; }
            setTimeout(forzaNavigazione, 300);
        } else if (d.event === 'ended' && !autoMode) {
            const skipEl = document.getElementById('m-vid-skip');
            if (skipEl) { skipEl.innerText = 'Skip: video finito (auto OFF)'; skipEl.style.color = '#c0392b'; }
        }
    });

    // ---------- NAVIGAZIONE ----------
    function getNextHref() {
        const courseId = getCourseId();
        const nextEl   = getNextNodeEl();
        if (!courseId || !nextEl) return null;
        const nextId = getNodeId(nextEl);
        if (!nextId) return null;
        return `${window.location.origin}/course/${courseId}/curriculum/${nextId}`;
    }

    function forzaNavigazione() {
        if (!scriptActive) return;
        const status = document.getElementById('m-status');

        // 0. API CMS: precomputed next lesson URL (preferred path)
        const apiUrl = getNextLessonUrl();
        if (apiUrl) {
            if (status) status.innerText = 'NAVIGAZIONE → (API)';
            console.log('[EpicodeFlow] forzaNavigazione via API →', apiUrl);
            window.location.href = apiUrl;
            return;
        }

        // 1. Clicca nodo nella sidebar (React Router gestisce transizione)
        const nextEl = getNextNodeEl();
        if (nextEl) {
            if (status) status.innerText = 'NAVIGAZIONE → (sidebar)';
            const beforeUrl = window.location.href;
            console.log('[EpicodeFlow] forzaNavigazione: nextEl=', nextEl, 'tag=', nextEl.tagName, 'id=', getNodeId(nextEl));
            try {
                // Prova prima <a> o [role=link]/[role=button] all'interno
                const clickable = nextEl.querySelector('a[href], [role="link"], [role="button"], button') || nextEl;
                if (typeof clickable.click === 'function') {
                    clickable.click();
                } else {
                    clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                }
            } catch (err) {
                console.error('[EpicodeFlow] click error', err);
            }
            setTimeout(() => {
                if (window.location.href === beforeUrl) {
                    const href = getNextHref();
                    if (href) { if (status) status.innerText = 'NAVIGAZIONE → (URL)'; window.location.href = href; }
                }
            }, 1500);
            return;
        }

        // 2. Pulsante Next: forza-abilita (rimuove disabled + Mui-disabled) e clicca
        const btn = findContentNextButton();
        if (btn) {
            btn.disabled = false;
            btn.removeAttribute('disabled');
            btn.classList.remove('Mui-disabled');
            btn.style.pointerEvents = 'auto';
            btn.click();
            if (status) status.innerText = 'NAVIGAZIONE → (next forzato)';
            return;
        }

        // 3. Nessuna opzione → re-arm e retry dopo 3s (PATCH)
        const nodes = getSidebarNodes();
        const lessonId = getLessonId();
        if (status) {
            if (nodes.length === 0)   status.innerText = 'NAV: sidebar non trovata (retry 3s)';
            else if (!lessonId)       status.innerText = 'NAV: ID non in URL (retry 3s)';
            else                      status.innerText = 'NAV: nessun next (retry 3s)';
        }
        autoSkipArmed = true;
        setTimeout(() => { if (scriptActive && autoMode) forzaNavigazione(); }, 3000);
    }

    // ---------- Vimeo postMessage helper ----------
    function vimeoCmd(iframe, method, value) {
        const data = { method };
        if (value !== undefined) data.value = value;
        try { iframe.contentWindow.postMessage(JSON.stringify(data), '*'); } catch (_) {}
    }

    function applyQuality(iframe) {
        if (qualityApplied) return;
        const targetQuality = autoQualityActive ? AUTO_QUALITY_DROP : currentQuality;
        vimeoCmd(iframe, 'setQuality', targetQuality);
        qualityApplied = true;
        updateVinfo();
    }

    function checkAutoQualityDrop() {
        const iframe = document.querySelector('iframe[src*="vimeo.com"]');
        // Basato su user-selected speed (non effective): evita oscillazioni quando watchdog throttle
        const shouldDrop = currentSpeed >= AUTO_QUALITY_SPEED_THRESHOLD && currentQuality !== AUTO_QUALITY_DROP && currentQuality !== '240p';
        if (shouldDrop && !autoQualityActive) {
            autoQualityActive = true;
            if (iframe) { vimeoCmd(iframe, 'setQuality', AUTO_QUALITY_DROP); qualityApplied = true; }
            updateVinfo();
        } else if (!shouldDrop && autoQualityActive) {
            autoQualityActive = false;
            if (iframe) { vimeoCmd(iframe, 'setQuality', currentQuality); qualityApplied = true; }
            updateVinfo();
        }
        lastSpeedForQualityCheck = currentSpeed;
    }

    function updateVinfo() {
        const vinfo = document.getElementById('m-vinfo');
        if (!vinfo) return;
        const eff = getEffectiveSpeed();
        const speedOk = videoState.playbackRate >= eff * 0.8;
        const speedLbl = speedOk ? `${currentSpeed}x ✓` : `${currentSpeed}x ⏳`;
        const qLabel = autoQualityActive
            ? `${AUTO_QUALITY_DROP} (auto)`
            : (qualityApplied ? `${currentQuality} ✓` : `${currentQuality} ⏳`);
        vinfo.style.color = (speedOk && qualityApplied) ? '#4ade80' : '#f97316';
        vinfo.innerText = `${speedLbl} | ${qLabel}`;
    }

    function tickNoVideoCountdown() {
        if (noVideoDeadline === 0) return;
        const status = document.getElementById('m-status');
        const remain = Math.max(0, Math.ceil((noVideoDeadline - Date.now()) / 1000));
        if (status) {
            status.innerText = `NON VIDEO — skip in ${remain}s`;
            status.style.color = remain <= 3 ? '#ef4444' : '#f59e0b';
        }
        if (remain === 0 && scriptActive && autoMode) {
            noVideoDeadline = 0;
            markVideoCompleted();
            forzaNavigazione();
        }
    }

    function tickVideoEnd() {
        if (!autoMode || !scriptActive || !autoSkipArmed) return;
        if (videoState.duration <= 0) return;
        const fresh = videoState.lastUpdate > 0 && (Date.now() - videoState.lastUpdate) < 6000;
        if (!fresh) return;
        // Su lezioni tracciate, NON skippare a fine-video: aspetta il tracker server (gestito da tickEpicodeCompletion)
        if (isTrackedLesson()) return;
        const remain = videoState.duration - videoState.currentTime;
        if (videoState.ended || (remain >= 0 && remain < 1.5)) {
            autoSkipArmed = false;
            markVideoCompleted();
            const skipEl = document.getElementById('m-vid-skip');
            if (skipEl) { skipEl.innerText = 'Skip: FINITO → vado'; skipEl.style.color = '#2ecc71'; }
            setTimeout(forzaNavigazione, 200);
        }
    }

    let lastTrackedState = null;
    function updateVideoUI() {
        tickNoVideoCountdown();
        tickVideoEnd();
        const meetVid = findMeetingVideo();
        if (meetVid) handleMeetingVideo(meetVid);
        tickServerWatchdog();
        tickEpicodeCompletion();
        const tracked = isTrackedLesson();
        if (tracked !== lastTrackedState) {
            lastTrackedState = tracked;
            renderSpeedButtons();
        }
        updateStateIcon();
        const tEl   = document.getElementById('m-vid-time');
        const rEl   = document.getElementById('m-vid-remain');
        const skEl  = document.getElementById('m-vid-skip');
        const ppBtn = document.getElementById('m-playpause');
        if (!tEl) return;

        if (ppBtn) {
            if (videoState.paused) {
                ppBtn.innerText = '▶ RIPRENDI';
                ppBtn.style.background = '#f97316';
            } else {
                ppBtn.innerText = '⏸ PAUSA VIDEO';
                ppBtn.style.background = '#2a1054';
            }
        }

        const fresh = (Date.now() - videoState.lastUpdate) < 4000;
        if (!fresh || videoState.duration <= 0) {
            tEl.innerText = 'Video: --:-- / --:--';
            rEl.innerText = 'Restante (reale): --';
            skEl.innerText = 'Skip: in attesa';
            skEl.style.color = '#888';
            return;
        }

        const dur = videoState.duration;
        const cur = videoState.currentTime;
        const remainVideo = Math.max(0, dur - cur);
        const rate = (measuredRate > 0.1) ? measuredRate : (videoState.playbackRate || 1);
        const remainReal = remainVideo / rate;

        const rateLbl = rate.toFixed(2);
        tEl.innerText = `Video: ${fmt(cur)} / ${fmt(dur)} (${rateLbl}x)`;
        rEl.innerText = `Restante (reale): ${fmt(remainReal)}`;

        const compl = getCurrentCompletionPct();
        const epThreshold = COMPLETION_THRESHOLD;
        if (videoState.ended) {
            skEl.innerText = 'Skip: PRONTO (finito)';
            skEl.style.color = '#4ade80';
        } else if (compl.effective != null) {
            const eff = compl.effective.toFixed(1);
            const srv = compl.server != null ? compl.server.toFixed(0) + '%' : '-';
            if (compl.effective >= epThreshold) { skEl.innerText = `Skip: ${eff}% ≥ ${epThreshold}%`; skEl.style.color = '#4ade80'; }
            else                                  { skEl.innerText = `Compl: ${eff}% / ${epThreshold}% (srv ${srv})`; skEl.style.color = '#a78bfa'; }
        } else if (remainVideo < 5) {
            skEl.innerText = `Skip: imminente (${Math.ceil(remainReal)}s)`;
            skEl.style.color = '#f97316';
        } else {
            skEl.innerText = `Skip: tra ${fmt(remainReal)}`;
            skEl.style.color = '#a78bfa';
        }

        const forceEl = document.getElementById('m-vid-force-skip');
        if (forceEl) forceEl.style.display = 'none';
    }

    // ---------- LOOP PRINCIPALE ----------
    let lastProgress = -1;
    let stasiCount   = 0;

    setInterval(() => {
        const elapsedMinutes = Math.floor((Date.now() - startTime) / 60000);
        const timerDisplay   = document.getElementById('m-timer');
        const status         = document.getElementById('m-status');
        const debug          = document.getElementById('m-debug');

        if (timerDisplay) timerDisplay.innerText = `Sessione: ${elapsedMinutes}m / ${MAX_MINUTES}m`;

        if (elapsedMinutes >= MAX_MINUTES) {
            scriptActive = false;
            if (status) { status.innerText = 'SESSIONE FINITA (STOP)'; status.style.color = '#ef4444'; }
            return;
        }

        const iframe    = document.querySelector('iframe[src*="vimeo.com"]');
        const currentId = getLessonId() || '?';
        const nodeCount = getSidebarNodes().length;
        const nextEl    = getNextNodeEl();
        const btnEl     = findContentNextButton();
        if (debug) debug.innerText =
            `ID:${currentId} | nodi:${nodeCount} | next:${nextEl ? getNodeId(nextEl) : '✗'} | btn:${btnEl ? (btnEl.disabled ? 'dis' : 'OK') : '✗'}`;

        if (currentId !== currentWatchedId) {
            currentWatchedId = currentId;
            if (currentId !== '?') markVideoStarted();
        }

        if (iframe) {
            noVideoDeadline = 0;
            if (iframe.src !== lastIframeSrc) {
                lastIframeSrc  = iframe.src;
                qualityApplied = false;
                autoSkipArmed  = true;
                forcedSkipDeadline = 0;
                videoState.duration = 0;
                videoState.currentTime = 0;
                videoState.ended = false;
                videoState.lastUpdate = 0;
                measuredRate  = 0;
                lastWallTs    = 0;
                lastVideoTs   = 0;
                transcriptCues.length = 0;
                updateTranscriptCount();
                showSaveStatus('');
                lastEffectiveSpeed = null;
                pageEntryServerPct = null;
                pageLoadTs = Date.now();
                serverWatchdog = { lastPct: -1, lastChangeTs: 0 };
                autoQualityActive = false;
                invalidatePctElCache();
                setTimeout(checkAutoQualityDrop, 1500);
                ensureCurriculum();
                meetingDetailCache = { lessonId: null, detail: null, inflight: null };
                ensureMeetingDetail();
                // Cattura % server iniziale dopo qualche secondo (page deve renderizzarlo)
                setTimeout(() => {
                    const p = readEpicodeCompletionPct();
                    if (p != null && pageEntryServerPct == null) pageEntryServerPct = p;
                }, 2500);
                setTimeout(() => {
                    const p = readEpicodeCompletionPct();
                    if (p != null && pageEntryServerPct == null) pageEntryServerPct = p;
                }, 5000);
                // Speed effective applicato in tickEpicodeCompletion (rileva tracker post-load)
                setTimeout(ensureEffectiveSpeed, 1500);
            }

            // Near-end skip gestito in tickVideoEnd() ogni 500ms (reazione veloce).

            status.innerText = autoMode ? 'VIDEO RILEVATO' : 'VIDEO (AUTO OFF)';
            if (autoMode && videoState.paused !== false) vimeoCmd(iframe, 'play');
            applyQuality(iframe);
            updateVinfo();
            updateVideoUI();

            const fresh = videoState.lastUpdate > 0 && (Date.now() - videoState.lastUpdate) < 6000;
            const realTime = fresh ? videoState.currentTime : -1;

            if (autoMode && fresh && !videoState.paused && realTime >= 0 && Math.abs(realTime - lastProgress) < 0.05) {
                stasiCount++;
                status.innerText = `VIDEO FERMO (${stasiCount}/15)`;
                if (stasiCount >= 15) {
                    stasiCount = 0;
                    forzaNavigazione();
                }
            } else {
                stasiCount   = 0;
                lastProgress = realTime;
                status.innerText = videoState.duration > 0
                    ? `IN RIPRODUZIONE: ${fmt(videoState.currentTime)} / ${fmt(videoState.duration)}`
                    : 'IN RIPRODUZIONE...';
            }

        } else {
            // Nessuna iframe Vimeo. Verifica se c'è un Video.js Epicode recording (meeting).
            const meetVid = findMeetingVideo();
            if (meetVid) {
                noVideoDeadline = 0;
                handleMeetingVideo(meetVid);
            } else {
                // Niente video: countdown 10s auto-skip
                updateVideoUI();
                ensureCurriculum();
                const apiHasNext = !!getNextLessonFromCache();
                if (!apiHasNext) {
                    status.innerText = 'NON VIDEO — fine sezione';
                    status.style.color = '#f59e0b';
                    noVideoDeadline = 0;
                } else if (!autoMode) {
                    status.innerText = 'NON VIDEO — AUTO OFF, premi SKIP';
                    status.style.color = '#f59e0b';
                    noVideoDeadline = 0;
                } else if (noVideoDeadline === 0) {
                    noVideoDeadline = Date.now() + NO_VIDEO_WAIT_SECS * 1000;
                }
            }
        }

    }, 4000);

    setInterval(updateVideoUI, 500);
    setInterval(renderCompletedDots, 2000);
    renderCompletedDots();

    // ============================================================
    // ESTRAI CORSO — MD + Notion + AI rework + incremental update
    // ============================================================
    const EXTRACT_STATE_KEY = 'epicode_extract_state';
    const NOTION_TEXT_CHUNK = 1900;

    function extractGetSettings() {
        return new Promise(res => {
            chrome.storage.local.get(['notionApiKey', 'notionPageId', 'anthropicApiKey', EXTRACT_STATE_KEY], (r) => {
                res({
                    notionKey: r.notionApiKey || '',
                    notionParent: r.notionPageId || '',
                    anthropicKey: r.anthropicApiKey || '',
                    state: r[EXTRACT_STATE_KEY] || {}
                });
            });
        });
    }

    function extractSaveState(state) {
        return new Promise(res => {
            chrome.storage.local.set({ [EXTRACT_STATE_KEY]: state }, res);
        });
    }

    function hashStr(s) {
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
        return h.toString(36);
    }

    async function fetchContentDetail(id) {
        const tok = localStorage.getItem('auth_token');
        const r = await fetch(`https://cms.epicode.com/items/content/${id}?fields=id,title,type,parent,sort,is_translated,summary,markdown,body,url,video_duration,embed_type`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${tok}` }
        });
        if (!r.ok) throw new Error(`content/${id} HTTP ${r.status}`);
        return (await r.json()).data;
    }

    function renderEditorJsToMd(body) {
        if (!body || !Array.isArray(body.blocks)) return '';
        const out = [];
        for (const b of body.blocks) {
            const d = b.data || {};
            switch (b.type) {
                case 'header':       out.push(`${'#'.repeat(d.level || 2)} ${d.text || ''}`); break;
                case 'paragraph':    out.push(d.text || ''); break;
                case 'list': {
                    const items = (d.items || []).map(it => `${d.style === 'ordered' ? '1.' : '-'} ${typeof it === 'string' ? it : (it.content || '')}`);
                    out.push(items.join('\n'));
                    break;
                }
                case 'quote':        out.push(`> ${d.text || ''}`); break;
                case 'code':         out.push('```\n' + (d.code || '') + '\n```'); break;
                case 'delimiter':    out.push('---'); break;
                case 'image':        out.push(d.file?.url ? `![${d.caption || ''}](${d.file.url})` : ''); break;
                default:             if (d.text) out.push(d.text);
            }
        }
        return out.filter(Boolean).join('\n\n').replace(/<[^>]+>/g, '');
    }

    function lessonTextFor(detail, lang) {
        // Restituisce { en: string, it: string } in base ai dati disponibili
        const out = { en: '', it: '' };
        if (detail.type === 'embed') {
            if (detail.is_translated && detail.summary) {
                out.en = detail.summary.en || '';
                out.it = detail.summary.it || '';
            }
        } else if (detail.type === 'markdown') {
            out.en = detail.markdown || '';
            out.it = detail.markdown || '';
        } else if (detail.type === 'article') {
            const md = renderEditorJsToMd(detail.body);
            out.en = md; out.it = md;
        } else {
            // meeting/quiz/project/etc: solo titolo
            const placeholder = `*[${detail.type}]* ${detail.title || ''}`;
            out.en = placeholder; out.it = placeholder;
        }
        return out;
    }

    async function aiRework(text, lang, anthropicKey, model = 'claude-sonnet-4-6') {
        if (!anthropicKey || !text) return text;
        const langName = lang === 'it' ? 'italiano' : 'english';
        const prompt = `Riassumi e riorganizza i seguenti appunti di lezione universitaria in ${langName}, mantenendo la struttura markdown (titoli, elenchi, code blocks). Sii esaustivo ma compatto. Mantieni i termini tecnici originali. Restituisci solo il markdown.\n\n---\n\n${text}`;
        try {
            const r = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': anthropicKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] })
            });
            if (!r.ok) { console.warn('[EpicodeFlow] AI HTTP', r.status); return text; }
            const j = await r.json();
            return j.content?.[0]?.text || text;
        } catch (e) { console.warn('[EpicodeFlow] AI err', e); return text; }
    }

    function langsArrayFromOpt(opt) {
        if (opt === 'it') return ['it'];
        if (opt === 'en') return ['en'];
        return ['it', 'en'];
    }

    function indentForType(type) {
        if (type === 'unit') return 1;
        if (type === 'module') return 2;
        if (type === 'activity') return 3;
        return 4;
    }

    function buildCourseMarkdown(courseTitle, ordered, langs, byId, textByLang) {
        const lines = [`# ${courseTitle}`, '', `*Estratto: ${new Date().toLocaleString('it-IT')}*`, ''];
        const hashHeader = n => '#'.repeat(Math.min(6, Math.max(1, n)));
        for (const item of ordered) {
            const lvl = indentForType(item.type);
            if (item.type === 'unit' || item.type === 'module' || item.type === 'activity') {
                lines.push('', `${hashHeader(lvl + 1)} ${item.title || ''}`, '');
                continue;
            }
            lines.push('', `${hashHeader(lvl + 1)} ${item.title || ''}  *(${item.type})*`, '');
            const texts = textByLang[item.id];
            if (!texts) {
                lines.push(`> _[Contenuto non ancora disponibile]_`, '');
                continue;
            }
            for (const lang of langs) {
                const t = (texts[lang] || '').trim();
                if (!t) continue;
                if (langs.length > 1) lines.push(`**[${lang.toUpperCase()}]**`, '');
                lines.push(t, '');
            }
        }
        return lines.join('\n');
    }

    function downloadFile(filename, content) {
        const blob = new Blob([content], { type: 'text/markdown; charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ---------- Notion ----------
    async function notionFetch(path, opts = {}, notionKey) {
        const r = await fetch(`https://api.notion.com/v1${path}`, {
            ...opts,
            headers: {
                'Authorization': `Bearer ${notionKey}`,
                'Content-Type': 'application/json',
                'Notion-Version': '2022-06-28',
                ...(opts.headers || {})
            }
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(`Notion ${path}: ${j.message || r.status}`);
        return j;
    }

    function paragraphBlock(content) {
        return { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } };
    }

    function headingBlock(level, content) {
        const lv = Math.min(3, Math.max(1, level));
        const type = `heading_${lv}`;
        return { object: 'block', type, [type]: { rich_text: [{ type: 'text', text: { content } }] } };
    }

    function lessonBlocksFromText(text) {
        // Spezza markdown in chunk Notion-friendly (max 1900 chars). Mantieni headings semplici.
        const chunks = [];
        for (let i = 0; i < text.length; i += NOTION_TEXT_CHUNK) chunks.push(text.slice(i, i + NOTION_TEXT_CHUNK));
        return chunks.map(c => paragraphBlock(c));
    }

    function buildLessonNotionBlocks(item, texts, langs) {
        const blocks = [];
        if (!texts) {
            blocks.push(paragraphBlock(`⏳ Lezione non ancora disponibile (verrà aggiunta in seguito)`));
            return blocks;
        }
        for (const lang of langs) {
            const t = (texts[lang] || '').trim();
            if (!t) continue;
            if (langs.length > 1) blocks.push(headingBlock(3, `[${lang.toUpperCase()}]`));
            blocks.push(...lessonBlocksFromText(t));
        }
        return blocks;
    }

    async function notionPushCourse({ notionKey, parentPageId, courseTitle, ordered, textByLang, langs, onProgress }) {
        // Crea pagina root sotto parent
        const root = await notionFetch('/pages', {
            method: 'POST',
            body: JSON.stringify({
                parent: { page_id: parentPageId },
                properties: { title: { title: [{ type: 'text', text: { content: courseTitle } }] } }
            })
        }, notionKey);
        const rootId = root.id;

        // Per ogni item ordinato, appendi blocks con batching
        const lessonPageMap = {};
        let batch = [];
        let count = 0;
        const flush = async () => {
            if (batch.length === 0) return;
            await notionFetch(`/blocks/${rootId}/children`, { method: 'PATCH', body: JSON.stringify({ children: batch }) }, notionKey);
            batch = [];
        };
        for (const item of ordered) {
            count++;
            onProgress && onProgress(count, ordered.length, item.title);

            const lvl = indentForType(item.type);
            if (item.type === 'unit' || item.type === 'module' || item.type === 'activity') {
                batch.push(headingBlock(Math.min(3, lvl), item.title || ''));
                if (batch.length >= 90) await flush();
                continue;
            }

            // Lesson: heading + content blocks
            batch.push(headingBlock(3, `${item.title || ''} (${item.type})`));
            const texts = textByLang[item.id];
            const lessonBlocks = buildLessonNotionBlocks(item, texts, langs);
            for (const b of lessonBlocks) {
                batch.push(b);
                if (batch.length >= 90) await flush();
            }
            lessonPageMap[item.id] = { hash: texts ? hashStr(JSON.stringify(texts)) : null, present: !!texts };
        }
        await flush();
        return { rootPageId: rootId, lessonMap: lessonPageMap };
    }

    async function notionAppendMissingLessons({ notionKey, rootPageId, missingItems, textByLang, langs, onProgress }) {
        let batch = [];
        const flush = async () => {
            if (batch.length === 0) return;
            await notionFetch(`/blocks/${rootPageId}/children`, { method: 'PATCH', body: JSON.stringify({ children: batch }) }, notionKey);
            batch = [];
        };
        let count = 0;
        if (missingItems.length === 0) return { appended: 0 };
        batch.push(headingBlock(2, `🆕 Lezioni aggiunte (${new Date().toLocaleString('it-IT')})`));
        for (const item of missingItems) {
            count++;
            onProgress && onProgress(count, missingItems.length, item.title);
            batch.push(headingBlock(3, `${item.title || ''} (${item.type})`));
            const texts = textByLang[item.id];
            for (const b of buildLessonNotionBlocks(item, texts, langs)) {
                batch.push(b);
                if (batch.length >= 90) await flush();
            }
        }
        await flush();
        return { appended: missingItems.length };
    }

    // ---------- Pipeline ----------
    async function buildCourseDataset({ langs, anthropicKey, aiRewrite, onProgress }) {
        const ordered = await ensureCurriculum();
        const courseId = getCourseId();
        // Get course title from any unit or fetch course meta
        let courseTitle = `Corso ${courseId}`;
        try {
            const tok = localStorage.getItem('auth_token');
            const r = await fetch(`https://cms.epicode.com/items/courses/${courseId}?fields=id,title`, { headers: { Authorization: `Bearer ${tok}` } });
            const j = await r.json();
            if (j.data?.title) courseTitle = j.data.title;
        } catch (_) {}

        const textByLang = {};
        const leafTypes = new Set(['embed', 'markdown', 'article', 'meeting', 'quiz', 'project', 'openEnded', 'nps', 'course_nps']);
        const leaves = ordered.filter(o => leafTypes.has(o.type));
        let i = 0;
        for (const item of leaves) {
            i++;
            onProgress && onProgress(i, leaves.length, `Fetch: ${item.title || item.id}`);
            try {
                const detail = await fetchContentDetail(item.id);
                const t = lessonTextFor(detail, 'both');
                if (!t.en && !t.it) {
                    // contenuto mancante: salta — sarà aggiungibile dopo
                    continue;
                }
                if (aiRewrite && anthropicKey) {
                    for (const lang of langs) {
                        if (t[lang]) t[lang] = await aiRework(t[lang], lang, anthropicKey);
                    }
                }
                textByLang[item.id] = t;
            } catch (e) {
                console.warn('[EpicodeFlow] fetch detail err', item.id, e.message);
            }
        }
        return { courseId, courseTitle, ordered, textByLang };
    }

    function showExtractStatus(msg, color) {
        const el = document.getElementById('m-extract-status');
        if (el) { el.innerText = msg; el.style.color = color || '#888'; }
    }

    async function runExtract({ mode }) {
        isExtracting = true;
        updateStateIcon();
        try {
            return await runExtractInner({ mode });
        } finally {
            isExtracting = false;
            updateStateIcon();
        }
    }

    async function runExtractInner({ mode }) {
        const settings = await extractGetSettings();
        const lang = document.querySelector('input[name="m-lang"]:checked')?.value || 'both';
        const wantMd = document.getElementById('m-out-md')?.checked;
        const wantNotion = document.getElementById('m-out-notion')?.checked;
        const wantAi = document.getElementById('m-out-ai')?.checked;
        const langs = langsArrayFromOpt(lang);

        if (wantNotion && !settings.notionKey) { showExtractStatus('Manca Notion key (popup)', '#ef4444'); return; }
        if (wantNotion && !settings.notionParent) { showExtractStatus('Manca Parent Page Notion', '#ef4444'); return; }
        if (wantAi && !settings.anthropicKey) { showExtractStatus('Manca Anthropic key (popup)', '#ef4444'); return; }

        showExtractStatus('Costruisco dataset...', '#a78bfa');
        const dataset = await buildCourseDataset({
            langs,
            anthropicKey: settings.anthropicKey,
            aiRewrite: wantAi,
            onProgress: (n, tot, lbl) => showExtractStatus(`Dataset ${n}/${tot}: ${lbl.slice(0,30)}`, '#a78bfa')
        });

        const courseState = settings.state[dataset.courseId] || { rootPageId: null, lessonMap: {}, langs: langs.join(','), lastRun: 0 };

        if (wantMd) {
            const md = buildCourseMarkdown(dataset.courseTitle, dataset.ordered, langs, null, dataset.textByLang);
            const slug = dataset.courseTitle.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 60);
            downloadFile(`${slug}_${langs.join('-')}.md`, md);
            showExtractStatus('MD scaricato ✓', '#4ade80');
        }

        if (wantNotion) {
            const isUpdate = mode === 'update' && courseState.rootPageId;
            if (!isUpdate) {
                showExtractStatus('Notion: creo pagina...', '#a78bfa');
                const res = await notionPushCourse({
                    notionKey: settings.notionKey,
                    parentPageId: settings.notionParent,
                    courseTitle: `${dataset.courseTitle} (${new Date().toISOString().slice(0,10)})`,
                    ordered: dataset.ordered,
                    textByLang: dataset.textByLang,
                    langs,
                    onProgress: (n, tot, lbl) => showExtractStatus(`Notion ${n}/${tot}: ${(lbl||'').slice(0,28)}`, '#a78bfa')
                });
                courseState.rootPageId = res.rootPageId;
                courseState.lessonMap = res.lessonMap;
                showExtractStatus(`Notion creata ✓ (${Object.keys(res.lessonMap).length} lezioni)`, '#4ade80');
            } else {
                // Update: trova lezioni newly available
                const missing = dataset.ordered.filter(item => {
                    const prev = courseState.lessonMap[item.id];
                    const now = dataset.textByLang[item.id];
                    if (!now) return false; // ancora non disponibile
                    if (!prev || !prev.present) return true; // era mancante o non c'era
                    const newHash = hashStr(JSON.stringify(now));
                    if (prev.hash !== newHash) return true;
                    return false;
                });
                if (missing.length === 0) { showExtractStatus('Nessuna nuova lezione', '#4ade80'); }
                else {
                    showExtractStatus(`Notion: aggiungo ${missing.length} lezioni...`, '#a78bfa');
                    await notionAppendMissingLessons({
                        notionKey: settings.notionKey,
                        rootPageId: courseState.rootPageId,
                        missingItems: missing,
                        textByLang: dataset.textByLang,
                        langs,
                        onProgress: (n, tot, lbl) => showExtractStatus(`Notion +${n}/${tot}: ${(lbl||'').slice(0,28)}`, '#a78bfa')
                    });
                    for (const it of missing) {
                        const t = dataset.textByLang[it.id];
                        if (t) courseState.lessonMap[it.id] = { hash: hashStr(JSON.stringify(t)), present: true };
                    }
                    showExtractStatus(`Notion aggiornato (+${missing.length}) ✓`, '#4ade80');
                }
            }
        }

        courseState.lastRun = Date.now();
        settings.state[dataset.courseId] = courseState;
        await extractSaveState(settings.state);
    }

    // ---------- UI modal ----------
    function buildExtractPanel() {
        if (document.getElementById('m-extract-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'm-extract-panel';
        panel.style.cssText = 'border-top:1px solid #2a1054;padding-top:8px;margin-top:8px;';
        panel.innerHTML = `
            <div id="m-extract-header" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;font-size:11px;color:#a78bfa;font-weight:bold;margin-bottom:6px;user-select:none;">
                <span>📥 Estrai corso</span>
                <span id="m-extract-toggle" style="font-size:14px;">▾</span>
            </div>
            <div id="m-extract-body">
                <div style="font-size:10px;color:#ede9fe;margin-bottom:4px;">Lingue:</div>
                <div style="display:flex;gap:6px;margin-bottom:6px;font-size:10px;color:#ede9fe;">
                    <label><input type="radio" name="m-lang" value="it"> IT</label>
                    <label><input type="radio" name="m-lang" value="en"> EN</label>
                    <label><input type="radio" name="m-lang" value="both" checked> Entrambe</label>
                </div>
                <div style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:#ede9fe;margin-bottom:6px;">
                    <label><input type="checkbox" id="m-out-md" checked> Scarica .md</label>
                    <label><input type="checkbox" id="m-out-notion"> Push su Notion</label>
                    <label><input type="checkbox" id="m-out-ai"> AI rework (Sonnet 4.6)</label>
                </div>
                <div style="display:flex;gap:6px;margin-bottom:6px;">
                    <button id="m-extract-new" style="flex:1;background:#7c3aed;color:white;border:none;padding:7px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;">Estrai (nuovo)</button>
                    <button id="m-extract-update" style="flex:1;background:#0891b2;color:white;border:none;padding:7px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;">Aggiorna esistente</button>
                </div>
                <div id="m-extract-status" style="font-size:10px;color:#6b57a0;min-height:14px;"></div>
            </div>
        `;
        const body = document.getElementById('m-body');
        if (body) body.appendChild(panel);
        document.getElementById('m-extract-new').onclick = () => runExtract({ mode: 'new' }).catch(e => showExtractStatus('Errore: ' + e.message, '#ef4444'));
        document.getElementById('m-extract-update').onclick = () => runExtract({ mode: 'update' }).catch(e => showExtractStatus('Errore: ' + e.message, '#ef4444'));

        // Toggle collapse, persisted. Default: chiuso.
        const EXTRACT_COLLAPSE_KEY = 'epicode_extract_collapsed';
        const stored = localStorage.getItem(EXTRACT_COLLAPSE_KEY);
        let extractCollapsed = stored === null ? true : stored === '1';
        const applyExtractCollapsed = () => {
            const ebody = document.getElementById('m-extract-body');
            const tog = document.getElementById('m-extract-toggle');
            if (!ebody || !tog) return;
            ebody.style.display = extractCollapsed ? 'none' : 'block';
            tog.textContent = extractCollapsed ? '▸' : '▾';
        };
        document.getElementById('m-extract-header').onclick = () => {
            extractCollapsed = !extractCollapsed;
            localStorage.setItem(EXTRACT_COLLAPSE_KEY, extractCollapsed ? '1' : '0');
            applyExtractCollapsed();
        };
        applyExtractCollapsed();
    }
    buildExtractPanel();

    // ---------- Version footer + Bug report in box ----------
    (function addVersionFooter() {
        const body = document.getElementById('m-body');
        if (!body || document.getElementById('m-version-footer')) return;
        const v = document.createElement('div');
        v.id = 'm-version-footer';
        let ver = '';
        try { ver = chrome.runtime.getManifest().version; } catch (_) {}
        v.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:6px;padding-top:4px;border-top:1px dashed #2a1054;font-family:monospace;';
        v.innerHTML = `
            <button id="m-bug" title="Segnala bug" style="background:none;border:none;color:#ef4444;font-size:11px;cursor:pointer;padding:0;font-family:monospace;">🐛 Segnala bug</button>
            <span style="font-size:9px;color:#3d2b6e;">EpiDuck v${ver}</span>
        `;
        body.appendChild(v);
        const bug = document.getElementById('m-bug');
        if (bug) bug.onclick = openBugReport;
    })();
    } // end bootEpiDuck
})();
