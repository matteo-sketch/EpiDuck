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

    function reflectEnabled(enabled) {
        enabledToggle.checked = enabled;
        enabledState.textContent = enabled
            ? 'Attiva su learn.epicode.edu.mt'
            : 'Disabilitata globalmente';
        enabledState.style.color = enabled ? '#2ecc71' : '#e74c3c';
    }

    chrome.storage.local.get(['epiduckEnabled'], (r) => {
        const en = r.epiduckEnabled !== false; // default true
        reflectEnabled(en);
    });

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
