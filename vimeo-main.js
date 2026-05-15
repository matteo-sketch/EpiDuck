(function () {
    'use strict';

    if (window.__epicodeFlowMainInstalled) return;
    window.__epicodeFlowMainInstalled = true;

    let TARGET = 1.0;
    let active = false;
    let preservesPitch = true; // mantieni tonalità (smoother audio)
    const TAG = '[EpicodeFlow/main]';
    const seen = new WeakSet();

    // --- Rate limiter (max 1000 set / 20s, ban dopo 3 violazioni) ---
    const RATE_LIMIT_PERIOD = 20000;
    const RATE_LIMIT = 1000;
    const RATE_LIMIT_MAX_VIOLATIONS = 3;

    function checkLimited(elem) {
        if (!elem || elem._epDuckBanned) return true;
        const now = Date.now();
        const bucket = Math.floor(now / RATE_LIMIT_PERIOD);
        const c = elem._epDuckRateCounter;
        if (c && c.bucket === bucket) {
            c.count++;
            if (c.count > RATE_LIMIT) {
                elem._epDuckViolations = (elem._epDuckViolations || 0) + 1;
                if (elem._epDuckViolations >= RATE_LIMIT_MAX_VIOLATIONS) {
                    elem._epDuckBanned = true;
                    console.warn(TAG, 'elemento bannato per rate limit', elem);
                }
                elem._epDuckRateCounter = null;
                return true;
            }
        } else {
            elem._epDuckRateCounter = { bucket, count: 1 };
        }
        return false;
    }

    // --- Set rate per-elemento (no prototype override, no-op check, preservesPitch) ---
    function setRateSafe(elem, value) {
        if (!elem) return;
        if (checkLimited(elem)) return;
        const v = Math.max(0.0625, Math.min(16, +value || 1));
        try {
            if (elem.playbackRate.toFixed(3) !== v.toFixed(3)) {
                elem.playbackRate = v;
            }
        } catch (_) {}
        try {
            if (elem.defaultPlaybackRate.toFixed(3) !== v.toFixed(3)) {
                elem.defaultPlaybackRate = v;
            }
        } catch (_) {}
        try { elem.preservesPitch = preservesPitch; } catch (_) {}
        try { elem.mozPreservesPitch = preservesPitch; } catch (_) {}
        try { elem.webkitPreservesPitch = preservesPitch; } catch (_) {}
    }

    function attach(v) {
        if (seen.has(v)) return;
        seen.add(v);
        if (active) setRateSafe(v, TARGET);
        const reapply = () => { if (active) setRateSafe(v, TARGET); };
        // Eventi RILEVANTI per perdita di playbackRate: niente timeupdate (troppo frequente)
        ['ratechange', 'play', 'playing', 'loadedmetadata', 'canplay', 'seeked']
            .forEach(ev => v.addEventListener(ev, reapply, { capture: true, passive: true }));
    }

    function scan(root) {
        if (!root || !root.querySelectorAll) return;
        root.querySelectorAll('video').forEach(attach);
    }

    const mo = new MutationObserver((muts) => {
        for (const m of muts) for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.tagName === 'VIDEO') attach(n); else scan(n);
        }
    });

    let _scanIntervalId = null;
    function startScanners() {
        if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true });
        scan(document);
        document.addEventListener('DOMContentLoaded', () => scan(document), true);
        // Polling raro: 1s invece di 500ms, e solo per cogliere player tardivi
        if (!_scanIntervalId) _scanIntervalId = setInterval(() => scan(document), 1000);
    }

    document.addEventListener('__epicodeflow-enable', () => {
        if (!active) {
            active = true;
            startScanners();
        }
        updateBanner();
        document.querySelectorAll('video').forEach(v => setRateSafe(v, TARGET));
    });

    document.addEventListener('__epicodeflow-disable', () => {
        active = false;
        if (banner) banner.style.display = 'none';
        if (_scanIntervalId) { clearInterval(_scanIntervalId); _scanIntervalId = null; }
        try { mo.disconnect(); } catch (_) {}
    });

    document.addEventListener('__epicodeflow-speed', (e) => {
        TARGET = +e.detail || 1;
        updateBanner();
        if (active) document.querySelectorAll('video').forEach(v => setRateSafe(v, TARGET));
    });

    document.addEventListener('__epicodeflow-pitch', (e) => {
        preservesPitch = !!e.detail;
        if (active) document.querySelectorAll('video').forEach(v => setRateSafe(v, TARGET));
    });

    let banner = null;
    function updateBanner() {
        if (!active) return;
        if (banner) {
            banner.textContent = `▶ ${TARGET}x`;
            banner.style.display = 'block';
        } else {
            showBanner();
        }
    }
    function showBanner() {
        if (!active) return;
        if (document.getElementById('epicodeflow-banner')) return;
        if (!document.body) return;
        const b = document.createElement('div');
        b.id = 'epicodeflow-banner';
        b.textContent = `▶ ${TARGET}x`;
        b.style.cssText = [
            'position:fixed','top:6px','left:6px','z-index:2147483647',
            'background:#2ecc71','color:#000','font:bold 11px sans-serif',
            'padding:3px 7px','border-radius:4px','pointer-events:none',
            'box-shadow:0 1px 4px rgba(0,0,0,.4)'
        ].join(';');
        document.body.appendChild(b);
        banner = b;
    }

    console.log(TAG, 'installato (dormant, per-element setter + rate-limit)');
})();
