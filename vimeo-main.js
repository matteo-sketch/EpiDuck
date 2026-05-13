(function () {
    'use strict';

    if (window.__epicodeFlowMainInstalled) return;
    window.__epicodeFlowMainInstalled = true;

    let TARGET = 1.0;
    let active = false;
    let overrideInstalled = false;
    const TAG = '[EpicodeFlow/main]';
    const seen = new WeakSet();
    const origRate = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
    const origDefault = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'defaultPlaybackRate');

    // Override solo dopo segnale enable dal content script (rispetta toggle popup)
    function installOverride() {
        if (overrideInstalled) return;
        overrideInstalled = true;
        Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
            get: function () { return origRate.get.call(this); },
            set: function (value) {
                if (!active) { origRate.set.call(this, value); return; }
                origRate.set.call(this, TARGET);
            },
            configurable: true
        });
        if (origDefault) {
            Object.defineProperty(HTMLMediaElement.prototype, 'defaultPlaybackRate', {
                get: function () { return origDefault.get.call(this); },
                set: function (value) {
                    if (!active) { origDefault.set.call(this, value); return; }
                    origDefault.set.call(this, TARGET);
                },
                configurable: true
            });
        }
        // MutationObserver + scan iniziale
        if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true });
        scan(document);
        document.addEventListener('DOMContentLoaded', () => scan(document), true);
        setInterval(() => scan(document), 500);
    }

    function force(v) {
        try { origRate.set.call(v, TARGET); } catch (_) {}
    }

    function attach(v) {
        if (seen.has(v)) return;
        seen.add(v);
        if (active) force(v);
        const reapply = () => { if (active) force(v); };
        ['ratechange','play','playing','loadedmetadata','canplay','seeked','timeupdate']
            .forEach(ev => v.addEventListener(ev, reapply, true));
    }

    function scan(root) {
        if (!root || !root.querySelectorAll) return;
        root.querySelectorAll('video').forEach(attach);
    }

    const mo = new MutationObserver(muts => {
        for (const m of muts) for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.tagName === 'VIDEO') attach(n); else scan(n);
        }
    });

    document.addEventListener('__epicodeflow-enable', () => {
        active = true;
        installOverride();
        updateBanner();
        document.querySelectorAll('video').forEach(force);
    });

    document.addEventListener('__epicodeflow-disable', () => {
        active = false;
        if (banner) banner.style.display = 'none';
    });

    document.addEventListener('__epicodeflow-speed', (e) => {
        TARGET = e.detail;
        updateBanner();
        if (active) document.querySelectorAll('video').forEach(force);
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

    console.log(TAG, 'installato (dormant, in attesa di enable)');
})();
