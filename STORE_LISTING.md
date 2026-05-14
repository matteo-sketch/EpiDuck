# Chrome Web Store — Compilazione campi EpiDuck

Vai su https://chrome.google.com/webstore/devconsole → "New Item" → carica ZIP della cartella `epicduck` → compila i seguenti campi.

---

## 1. Store listing

### Item name (45 char max)
```
EpiDuck
```

### Summary / Short description (132 char max)
```
Auto-play, controllo velocità, trascrizioni e Estrai Corso per Epicode (learn.epicode.edu.mt). Open source.
```

### Description (16.000 char max)
```
🦆 EpiDuck — Studio efficiente su Epicode

EpiDuck è un'estensione open-source non ufficiale per la piattaforma e-learning learn.epicode.edu.mt. Aiuta a studiare in modo più efficiente offrendo controllo completo sul player Vimeo dei corsi, navigazione automatica fra le lezioni e strumenti per esportare trascrizioni e summary su Notion o file Markdown.


◉ COSA FA

• Velocità riproduzione fino a 16x (bypass del cap Vimeo via override sicuro)
• Qualità configurabile per dominio (240p → 1080p o auto)
• Auto-skip a fine video alla lezione successiva via API curriculum
• Countdown 10s configurabile su pagine non-video (quiz, articoli, markdown)
• Cattura live dei sottotitoli Vimeo durante la visione
• Trascrizione pulita (senza timestamp) copiabile o scaricabile come .md
• Push trascrizioni su Notion via API ufficiale (token tuo, mai condiviso)


◉ ESTRAI CORSO

Esporta l'intero corso in un unico file Markdown o crea automaticamente una struttura di pagine Notion:
• Lingua a scelta: Italiano, Inglese, o Entrambe affiancate
• Usa i summary precomputati di Epicode (per le lezioni che li hanno)
• Aggiornamenti incrementali: aggiunge solo le lezioni nuove rispetto all'ultimo export
• Opzionale: rielaborazione AI dei testi con Claude Sonnet 4.6 (richiede tua API key Anthropic)


◉ UX

• Pannello di controllo trascinabile sulla pagina (posizione memorizzata)
• Modalità minimal (solo paperella + icona stato)
• Hold Shift = boost temporary 2x della velocità
• Auto-quality drop a 360p quando speed ≥ 8x (riduce buffering)
• Watchdog adattivo per tracking server: rallenta automaticamente se Epicode non sta dietro


◉ PRIVACY E SICUREZZA

EpiDuck non raccoglie, non invia e non condivide alcun dato. Tutto resta nel browser dell'utente in chrome.storage.local.

Le uniche chiamate di rete esterne avvengono:
• verso cms.epicode.com con il token dell'utente già autenticato sul sito (stesso uso che il sito fa)
• verso api.notion.com solo se l'utente fornisce volontariamente la propria Notion API key
• verso api.anthropic.com solo se l'utente attiva l'AI rework con propria Anthropic API key

Lo sviluppatore di EpiDuck non ha alcun server. Nessuna telemetria. Nessun cookie. Nessun tracking.

Codice sorgente completo: https://github.com/matteo-sketch/EpiDuck
Privacy policy: https://github.com/matteo-sketch/EpiDuck/blob/main/PRIVACY.md


◉ DISCLAIMER

EpiDuck è un progetto indipendente, non affiliato con Epicode né con Vimeo. È destinato a uso personale di studio. L'utente è responsabile dell'uso che fa dell'estensione e del rispetto dei Terms of Service della piattaforma a cui accede con le proprie credenziali.


◉ SEGNALAZIONI E SUPPORTO

Bug: https://github.com/matteo-sketch/EpiDuck/issues
Sostieni lo sviluppo: https://buymeacoffee.com/79ai4gmnnt
```

### Category
```
Productivity
```

### Language
```
Italian (it)
```


---

## 2. Privacy

### Single Purpose (1000 char max)
```
Migliorare l'esperienza di studio sulla piattaforma e-learning Epicode (learn.epicode.edu.mt) per gli studenti che già vi accedono con il proprio account. EpiDuck offre controllo del player Vimeo, navigazione automatica fra lezioni, cattura sottotitoli e esportazione personale dei contenuti del corso in formato Markdown o sulla pagina Notion dell'utente. Tutte le funzionalità operano esclusivamente sul dispositivo dell'utente e con le sue credenziali.
```

### Permission justifications

**storage**
```
Salva preferenze utente (velocità e qualità video per dominio, posizione del pannello), API key dell'utente per integrazioni opzionali Notion e Anthropic, stato delle estrazioni corso per consentire aggiornamenti incrementali, cache curriculum per ridurre chiamate API. Tutti i dati restano su chrome.storage.local, nessun dato inviato a server di EpiDuck.
```

### Host permission justifications

**`*://*.epicode.edu.mt/*`**
```
Dominio della piattaforma e-learning supportata. Il content script si inietta esclusivamente su questo dominio per: mostrare il pannello di controllo, catturare i sottotitoli del video corrente, leggere il token di autenticazione dell'utente (già presente sul sito) per consultare l'API ufficiale del corso, navigare automaticamente alla lezione successiva al termine della corrente.
```

**`*://player.vimeo.com/*`**
```
La piattaforma serve i video tramite iframe Vimeo. Lo script su questo dominio è necessario per: sincronizzare la velocità di riproduzione scelta dall'utente con il player, catturare i sottotitoli (text tracks) del video per la funzione trascrizione, rilevare l'evento di fine video per il passaggio automatico alla lezione successiva.
```

**`https://api.notion.com/*`**
```
Endpoint dell'API Notion ufficiale. EpiDuck vi accede solo se l'utente fornisce volontariamente la propria Notion API key. Crea pagine sotto la parent indicata e aggiunge blocchi con trascrizioni e summary delle lezioni. Nessuna richiesta a Notion senza configurazione esplicita dell'utente.
```

**`https://api.anthropic.com/*`**
```
Endpoint dell'API Anthropic ufficiale. Utilizzato esclusivamente come opzione facoltativa: se l'utente inserisce la propria Anthropic API key e attiva la funzione "AI rework", EpiDuck invia i testi delle lezioni al modello Claude per generare riassunti rielaborati. L'utente è titolare della chiave e dei costi associati.
```

**`https://cms.epicode.com/*`**
```
Backend CMS della piattaforma e-learning (lo stesso usato dal sito principale per servire i dati delle lezioni). EpiDuck lo interroga in lettura con il token utente già autenticato sul sito per: recuperare la struttura del corso (curriculum, ordine delle lezioni) e abilitare la navigazione automatica, leggere i summary precomputati delle lezioni per la funzione di esportazione corso. Solo letture, nessuna scrittura.
```

### Are you a trader?
```
No (sviluppatore singolo, non commerciale)
```

### Privacy Policy URL
```
https://github.com/matteo-sketch/EpiDuck/blob/main/PRIVACY.md
```


---

## 3. Disclosure (compliance)

### Data usage disclosure

Check NESSUNA delle seguenti opzioni (perché EpiDuck non raccoglie nulla):
- [ ] Personally identifiable information
- [ ] Health information
- [ ] Financial and payment information
- [ ] Authentication information
- [ ] Personal communications
- [ ] Location
- [ ] Web history
- [ ] User activity
- [ ] Website content

Check le seguenti dichiarazioni:
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes


---

## 4. Distribution

### Visibility
```
Public
```

### Visibility regions
```
All regions
```

### Pricing
```
Free
```


---

## 5. Graphic assets

### Icon
128x128 PNG. Vedi sezione separata sotto per generarla.

### Screenshots (1-5, 1280x800 o 640x400 PNG/JPEG)

Già catturati in conversazione: 3 screenshot di EpiDuck in uso. Da convertire/ritagliare a 1280x800.

Comando macOS Preview per resize:
1. Apri immagine in Preview.app
2. Tools → Adjust Size → 1280 x 800 → OK
3. File → Export as PNG

### Promotional images (opzionali ma raccomandati)
- Small tile: 440x280 PNG
- Large tile: 920x680 PNG
- Marquee: 1400x560 PNG

Posso aiutare a generarli con design semplice (paperella su sfondo gradient + tagline).


---

## 6. Note finali

- Submission review: 1-7 giorni (a volte 24h)
- Versione iniziale: usa v62.0 dal ZIP (escludi `.git`, `*.md`, `*.pem`, `node_modules`)
- Build ZIP:
```bash
cd ~/Documents
zip -r epiduck-v62.zip epicduck \
  -x "epicduck/.git/*" \
  -x "epicduck/.DS_Store" \
  -x "epicduck/*.pem" \
  -x "epicduck/STORE_LISTING.md" \
  -x "epicduck/PRIVACY.md" \
  -x "epicduck/README.md" \
  -x "epicduck/.gitignore"
```
- Upload epiduck-v62.zip su CWS Dashboard
