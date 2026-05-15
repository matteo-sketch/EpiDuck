(function () {
    'use strict';

    const TAG = '[EpicodeFlow/vimeo]';
    let currentSpeed = 1.0;

    console.log(TAG, 'content script caricato in', location.href);

    // Reload tabs on toggle change (parent main page handles full reload via its own listener)
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.epiduckEnabled) location.reload();
        });
    } catch (_) {}

    // Bootstrap gate
    chrome.storage.local.get(['epiduckEnabled'], (r) => {
        if (r.epiduckEnabled === false) {
            console.log(TAG, 'disabilitata da popup');
            return;
        }
        bootVimeoScript();
    });

    function bootVimeoScript() {

    // Signal main-world script to activate (override + banner)
    try { document.dispatchEvent(new CustomEvent('__epicodeflow-enable')); } catch (_) {}

    try {
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL('vimeo-main.js');
        s.onload = () => s.remove();
        (document.head || document.documentElement).appendChild(s);
        console.log(TAG, 'fallback main-world script iniettato');
    } catch (e) {
        console.warn(TAG, 'iniezione fallback fallita:', e);
    }

    let video = null;
    let attached = false;
    const SEEN_CUES_CAP = 10000; // ~3h lezione a 1 cue/sec
    const seenCues = new Set();
    let transcriptBtnClicked = false;

    function sendCue(cue, lang) {
        const key = `${cue.startTime}|${cue.text}`;
        if (seenCues.has(key)) return;
        // Cap memoria: rimuovi entry più vecchia (FIFO via iteration order Set)
        if (seenCues.size >= SEEN_CUES_CAP) {
            const first = seenCues.values().next().value;
            if (first !== undefined) seenCues.delete(first);
        }
        seenCues.add(key);
        const text = cue.text.replace(/<[^>]+>/g, '').trim();
        if (!text) return;
        try {
            window.parent.postMessage({
                __epicodeFlow: true, type: 'transcript-cue',
                text, startTime: cue.startTime, endTime: cue.endTime, lang: lang || ''
            }, '*');
        } catch (_) {}
    }

    function dumpTrack(track) {
        if (!track.cues) return;
        for (const cue of track.cues) sendCue(cue, track.language);
    }

    function enforceTrackModes() {
        if (!video) return;
        for (const track of video.textTracks) {
            if (track.mode === 'disabled') {
                track.mode = 'hidden';
                dumpTrack(track);
            }
        }
    }

    function clickVimeoTranscriptButton() {
        if (transcriptBtnClicked) return true;
        const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
        const btn = allBtns.find(b => {
            const label = (
                b.getAttribute('aria-label') || b.getAttribute('title') ||
                b.getAttribute('data-testid') || b.textContent || ''
            ).toLowerCase();
            return label.includes('transcript') || label.includes('caption') ||
                   label.includes('sottotitol') || label.includes('cc');
        });
        if (!btn) return false;
        const isActive = btn.getAttribute('aria-pressed') === 'true' ||
                         btn.classList.contains('active') ||
                         btn.getAttribute('aria-expanded') === 'true';
        if (!isActive) {
            btn.click();
            console.log(TAG, 'transcript button cliccato automaticamente', btn);
        }
        transcriptBtnClicked = true;
        return true;
    }

    function attachTranscript(v) {
        const activateTrack = (track) => {
            if (track.mode === 'disabled') track.mode = 'hidden';
            dumpTrack(track);
            track.addEventListener('cuechange', () => {
                if (track.activeCues) for (const cue of track.activeCues) sendCue(cue, track.language);
            });
            track.addEventListener('load', () => dumpTrack(track));
        };
        for (const track of v.textTracks) activateTrack(track);
        v.textTracks.addEventListener('addtrack', (e) => activateTrack(e.track));
    }

    function findVideo(root) {
        if (!root) return null;
        const v = root.querySelector && root.querySelector('video');
        if (v) return v;
        const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (const el of all) {
            if (el.shadowRoot) {
                const found = findVideo(el.shadowRoot);
                if (found) return found;
            }
        }
        return null;
    }

    function applySpeedToMainWorld(speed) {
        document.dispatchEvent(new CustomEvent('__epicodeflow-speed', { detail: speed }));
    }

    let lastAppliedSpeed = null;
    function applySpeed(force = false) {
        if (!video) return;
        if (!force && lastAppliedSpeed === currentSpeed) return;
        lastAppliedSpeed = currentSpeed;
        try {
            applySpeedToMainWorld(currentSpeed);
            // Niente write diretto qui: il setRateSafe del MAIN world gestisce no-op check + rate limit
        } catch (e) { console.warn(TAG, 'applySpeed err', e); }
    }

    function postInfo(extra) {
        if (!video) return;
        const msg = {
            __epicodeFlow: true,
            type: 'video-info',
            duration: isFinite(video.duration) ? video.duration : 0,
            currentTime: video.currentTime || 0,
            paused: video.paused,
            ended: video.ended,
            readyState: video.readyState,
            playbackRate: video.playbackRate
        };
        if (extra) Object.assign(msg, extra);
        try { window.parent.postMessage(msg, 'https://learn.epicode.edu.mt'); } catch (_) {}
    }

    function attach(v) {
        if (video === v && attached) return;
        video = v;
        attached = true;
        console.log(TAG, '<video> trovato, durata=', v.duration);
        applySpeed();
        attachTranscript(v);

        v.addEventListener('play',           () => { applySpeed(true); postInfo({ event: 'play' }); }, true);
        v.addEventListener('pause',          () => postInfo({ event: 'pause' }), true);
        v.addEventListener('loadedmetadata', () => { applySpeed(true); postInfo({ event: 'loadedmetadata' }); }, true);
        v.addEventListener('ratechange',     () => { applySpeed(true); postInfo({ event: 'ratechange' }); }, true);
        // timeupdate: solo postInfo per status box, NIENTE re-apply speed (era 4-10 chiamate/sec a velocità alte)
        v.addEventListener('timeupdate',     () => postInfo({ event: 'timeupdate' }), true);
        v.addEventListener('ended',          () => postInfo({ event: 'ended' }), true);

        // PATCH: synthetic ended near end-of-video (Vimeo HLS spesso non emette 'ended')
        v.addEventListener('timeupdate', () => {
            if (v.duration > 0 && !v._epicodeNearEndSent && (v.duration - v.currentTime) < 0.5) {
                v._epicodeNearEndSent = true;
                postInfo({ event: 'ended' });
            }
        }, true);
    }

    window.addEventListener('message', (e) => {
        const d = e.data;
        if (!d || typeof d !== 'object' || !d.__epicodeFlow) return;
        if (d.type === 'set-speed' && typeof d.speed === 'number') {
            currentSpeed = d.speed;
            applySpeed(true); // force: lastAppliedSpeed cambia, va riapplicato
        }
    });

    let _vimeoPollId = setInterval(() => {
        // Re-emit enable in case main-world script loaded after the initial dispatch
        try { document.dispatchEvent(new CustomEvent('__epicodeflow-enable')); } catch (_) {}
        const v = findVideo(document);
        if (v && v !== video) attach(v);
        applySpeed(); // no-op se già applicata (lastAppliedSpeed check)
        postInfo();
        enforceTrackModes();
        if (!transcriptBtnClicked) clickVimeoTranscriptButton();
    }, 800);

    // Cleanup su toggle off / disable event
    document.addEventListener('__epicodeflow-disable', () => {
        if (_vimeoPollId) { clearInterval(_vimeoPollId); _vimeoPollId = null; }
        seenCues.clear();
    }, { once: false });

    } // end bootVimeoScript
})();
