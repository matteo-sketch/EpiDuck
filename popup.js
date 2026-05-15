(function () {
    'use strict';

    const keyInput      = document.getElementById('notion-key');
    const pageInput     = document.getElementById('notion-page');
    const anthropicInput = document.getElementById('anthropic-key');
    const saveBtn       = document.getElementById('save-btn');
    const statusEl      = document.getElementById('status');

    const versionEl = document.getElementById('version');
    if (versionEl) {
        const manifest = chrome.runtime.getManifest();
        versionEl.textContent = `v${manifest.version}`;
    }

    const enabledToggle = document.getElementById('enabled-toggle');
    const enabledState  = document.getElementById('enabled-state');
    const powerBtn      = document.getElementById('power-btn');

    function reflectEnabled(enabled) {
        enabledToggle.checked = enabled;
        enabledState.textContent = enabled
            ? 'Attiva su learn.epicode.edu.mt'
            : 'Spenta globalmente';
        enabledState.style.color = enabled ? '#10b981' : '#ef4444';
        if (powerBtn) {
            powerBtn.classList.toggle('is-on', enabled);
            powerBtn.classList.toggle('is-off', !enabled);
            powerBtn.title = enabled ? 'Spegni EpiDuck globalmente' : 'Accendi EpiDuck';
            powerBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        }
    }

    chrome.storage.local.get(['epiduckEnabled'], (r) => {
        const en = r.epiduckEnabled !== false; // default true
        reflectEnabled(en);
    });

    function togglePower() {
        const next = !enabledToggle.checked;
        enabledToggle.checked = next;
        chrome.storage.local.set({ epiduckEnabled: next }, () => reflectEnabled(next));
    }

    if (powerBtn) powerBtn.addEventListener('click', togglePower);
    enabledToggle.addEventListener('change', () => {
        const en = enabledToggle.checked;
        chrome.storage.local.set({ epiduckEnabled: en }, () => reflectEnabled(en));
    });

    chrome.storage.local.get(['notionApiKey', 'notionPageId', 'anthropicApiKey'], (result) => {
        if (result.notionApiKey)    keyInput.value      = result.notionApiKey;
        if (result.notionPageId)    pageInput.value     = result.notionPageId;
        if (result.anthropicApiKey) anthropicInput.value = result.anthropicApiKey;
    });

    saveBtn.addEventListener('click', () => {
        const apiKey       = keyInput.value.trim();
        const pageId       = pageInput.value.trim().replace(/-/g, '');
        const anthropicKey = anthropicInput.value.trim();

        if (apiKey && !apiKey.startsWith('secret_') && !apiKey.startsWith('ntn_')) {
            statusEl.style.color = '#e74c3c';
            statusEl.innerText = 'Notion key deve iniziare con secret_ o ntn_';
            return;
        }
        if (pageId && pageId.length !== 32) {
            statusEl.style.color = '#e74c3c';
            statusEl.innerText = 'Page ID deve essere 32 hex';
            return;
        }
        if (anthropicKey && !anthropicKey.startsWith('sk-ant-')) {
            statusEl.style.color = '#e74c3c';
            statusEl.innerText = 'Anthropic key deve iniziare con sk-ant-';
            return;
        }

        chrome.storage.local.set({
            notionApiKey: apiKey,
            notionPageId: pageId,
            anthropicApiKey: anthropicKey
        }, () => {
            statusEl.style.color = '#2ecc71';
            statusEl.innerText = 'Salvato ✓';
            setTimeout(() => { statusEl.innerText = ''; }, 2000);
        });
    });
})();
