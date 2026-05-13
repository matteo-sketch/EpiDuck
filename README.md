# 🦆 EpiDuck

Estensione Chrome per Epicode (`learn.epicode.edu.mt`): auto-play, controllo velocità fino a 16x, navigazione automatica, trascrizioni live, estrazione corso → Markdown / Notion.

---

## Installazione

1. Scarica/clona la cartella `epicduck`
2. Chrome → `chrome://extensions`
3. Attiva **Modalità sviluppatore** (toggle in alto a destra)
4. Click **Carica estensione non pacchettizzata** → seleziona cartella `epicduck`
5. Paperella 🦆 compare nella toolbar

## Configurazione

Click sull'icona 🦆 nella toolbar (oppure click ⚙ nel box):

| Campo | A cosa serve | Dove ottenerlo |
|---|---|---|
| **Notion API Key** | Push trascrizioni e corsi su Notion | [notion.so/my-integrations](https://www.notion.so/my-integrations) → crea integration → copia "Internal Integration Token" |
| **Page ID parent** | Pagina Notion sotto cui creare i corsi estratti | URL Notion → ultimi 32 caratteri hex |
| **Anthropic API Key** | (Opzionale) AI rework con Claude Sonnet 4.6 | [console.anthropic.com](https://console.anthropic.com/) |

Salva. La pagina Notion deve essere **condivisa con l'integration** (Share → seleziona integration creata).

## Uso quotidiano

Apri una lezione su `learn.epicode.edu.mt`. Box paperella appare in alto a destra (trascinabile).

### Auto-play

- Box mostra `▶`: video in riproduzione
- Velocità: click su `1x` ... `16x`
- Qualità: click su `240p` ... `1080p` o `auto`
- Entrambi memorizzati per dominio

### Auto-avanzamento

- A fine video → skip automatico alla lezione successiva
- Pagine non-video (quiz, articoli, markdown) → countdown 10s visibile, poi skip automatico
- `⏹ BLOCCA AUTO` per disattivare → diventa `▶ RIPRENDI AUTO`
- `⏭ SKIP PROSSIMO` per saltare manualmente

### Trascrizioni live

Durante il video la paperella cattura i sottotitoli Vimeo:
- `📋 Copia Transcript` → testo pulito senza timestamp negli appunti
- `💾 .md` → scarica file markdown della trascrizione
- `📝 Notion` → push trascrizione singola su Notion

### Estrai corso

Click ▾ sotto "📥 Estrai corso" per aprire:

1. **Lingua**: `IT` / `EN` / `Entrambe`
2. **Output**: 
   - ☑ Scarica .md (singolo file con tutto il corso)
   - ☑ Push su Notion (crea nuova pagina sotto Parent Page)
   - ☑ AI rework (riassume ogni lezione con Sonnet 4.6, richiede Anthropic key)
3. Click `Estrai (nuovo)` → estrae tutto il corso ordinato

**Aggiorna esistente**: quando nuove lezioni vengono rilasciate, click `Aggiorna esistente` → aggiunge solo quelle nuove alla pagina Notion già creata.

## Box collassato

Click `▾` → box minimizzato mostra solo:
- 🦆 paperella
- icona stato (`▶` `⏸` `⏳` `📥` `⏹`)

Click `▸` per riaprire. Posizione e stato memorizzati.

## Troubleshooting

| Problema | Soluzione |
|---|---|
| Box non appare | Verifica URL `learn.epicode.edu.mt/*`, ricarica estensione |
| Navigazione non funziona | Console DevTools → cerca `[EpicodeFlow]`, verifica `auth_token` in localStorage |
| Notion errore 401 | Integration non condivisa con la pagina parent |
| Notion errore 404 | Page ID errato (32 hex senza trattini) |
| AI rework lento | Normale: ~5s per lezione × ~150 lezioni |

## Privacy

- Tutte le chiavi API restano in `chrome.storage.local` del browser
- Nessun dato inviato a server esterni se non Notion / Anthropic (con tue key)
- `auth_token` Epicode usato solo per chiamare `cms.epicode.com` (stesso uso del sito stesso)
