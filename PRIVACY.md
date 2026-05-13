# Privacy Policy — EpiDuck

**Ultimo aggiornamento:** 12 maggio 2026
**Estensione:** EpiDuck (Chrome / Chromium)
**Sviluppatore:** Matteo Postella
**Contatto:** matteo@postella.it

---

## 1. Premessa

EpiDuck è un'estensione Chrome di terze parti che migliora l'esperienza d'uso della piattaforma e-learning Epicode (`learn.epicode.edu.mt`). L'estensione **non è affiliata, sponsorizzata o approvata da Epicode**.

Questa policy spiega quali dati l'estensione tratta, dove vengono memorizzati e a chi vengono trasmessi.

## 2. Riassunto in una riga

EpiDuck non raccoglie, non invia, non rivende e non condivide i tuoi dati. Tutto resta sul tuo browser. Le uniche chiamate di rete esterne avvengono verso servizi terzi che tu configuri esplicitamente (Notion, Anthropic, CMS Epicode già autenticato), usando le tue stesse credenziali.

## 3. Dati trattati

### 3.1 Dati memorizzati localmente (`chrome.storage.local`)

I seguenti dati restano sul tuo dispositivo. Lo sviluppatore di EpiDuck non vi ha accesso.

| Dato | Scopo | Origine |
|---|---|---|
| `notionApiKey` | Push trascrizioni e corsi sul tuo workspace Notion | Inserito dall'utente nel popup |
| `notionPageId` | Pagina parent dove creare i corsi estratti | Inserito dall'utente |
| `anthropicApiKey` | Rielaborazione AI dei testi con Claude (facoltativo) | Inserito dall'utente |
| `epicode_extract_state` | Stato delle estrazioni (ID pagina Notion, hash lezioni) per consentire aggiornamenti incrementali | Generato durante l'uso |
| `epicode_speed_*`, `epicode_quality_*` | Velocità e qualità preferite per dominio | Generato durante l'uso |
| `epicode_started_videos`, `epicode_completed_videos` | Liste locali per evidenziare le lezioni viste | Generato durante l'uso |
| `epicode_box_pos_*` | Posizione del pannello UI nella pagina | Generato durante l'uso |
| `epicode_collapsed`, `epicode_extract_collapsed` | Stato espanso/collassato del pannello | Generato durante l'uso |

### 3.2 Dati letti dal sito Epicode

Quando l'utente apre una pagina su `learn.epicode.edu.mt`, EpiDuck legge:

- Il **token di autenticazione** (`auth_token`) che il sito stesso ha salvato in `localStorage`. Viene utilizzato esclusivamente come header `Authorization: Bearer` per chiamare l'API ufficiale `cms.epicode.com`, allo stesso modo in cui lo fa il sito.
- L'**URL corrente** (per riconoscere corso e lezione)
- Il **DOM della pagina** (per posizionare l'UI e leggere il contatore di completamento mostrato da Epicode)
- I **sottotitoli del player Vimeo** (per la funzione "Trascrizione")

Questi dati non lasciano mai il browser dell'utente se non vengono trasmessi a un servizio terzo che l'utente ha configurato (vedi §4).

### 3.3 Dati NON trattati

EpiDuck **non** raccoglie né tratta:

- Identità personale (nome, email, indirizzo)
- Cookie di tracciamento o fingerprint del browser
- Cronologia di navigazione al di fuori delle pagine Epicode
- Dati di analytics o telemetria di EpiDuck verso lo sviluppatore
- Pagamenti o dati finanziari
- Audio, video o riprese della webcam

## 4. Trasmissione a servizi terzi

Le uniche richieste di rete che EpiDuck effettua sono dirette agli endpoint elencati di seguito. Tutte avvengono **solo se l'utente attiva esplicitamente la funzione corrispondente** e **solo con le credenziali fornite dall'utente**.

| Endpoint | Quando | Dati inviati | Titolare |
|---|---|---|---|
| `cms.epicode.com` | All'apertura di una pagina lezione | `auth_token` dell'utente (già presente sul sito), filtro per corso | Epicode |
| `api.notion.com` | L'utente clicca "Push su Notion" o "Estrai corso" con Notion attivo | Notion API key dell'utente, ID pagina parent, testo di trascrizioni/riassunti | Notion Labs Inc. |
| `api.anthropic.com` | L'utente clicca "AI rework" durante l'estrazione corso | Anthropic API key dell'utente, testo della lezione da rielaborare | Anthropic PBC |

Lo sviluppatore di EpiDuck **non ha alcun server proprio** e non riceve nessuna copia di queste richieste.

## 5. Gestione e cancellazione dei dati

- I dati in `chrome.storage.local` possono essere eliminati in qualsiasi momento da Chrome: `chrome://extensions` → EpiDuck → "Dettagli" → "Pulisci dati".
- Disinstallando l'estensione, Chrome rimuove automaticamente tutti i dati associati.
- Per revocare l'accesso ai servizi terzi, l'utente può eliminare le proprie API key dalle rispettive console:
  - Notion: <https://www.notion.so/my-integrations>
  - Anthropic: <https://console.anthropic.com/settings/keys>

## 6. Cookie e tracciamento

EpiDuck **non installa cookie propri** e **non utilizza pixel di tracciamento, analytics o SDK pubblicitari**.

## 7. Minori

EpiDuck non è destinato a minori di 16 anni. Non raccoglie consapevolmente dati di minori.

## 8. Modifiche alla policy

Eventuali aggiornamenti verranno pubblicati su questa pagina con la nuova data in cima. Cambiamenti rilevanti saranno comunicati nelle note di rilascio dell'estensione sul Chrome Web Store.

## 9. Reclami e contatti

Per qualsiasi domanda, richiesta di chiarimento, o per esercitare i diritti previsti dal GDPR (accesso, rettifica, cancellazione, opposizione):

**Email:** matteo@postella.it

L'utente ha inoltre diritto di proporre reclamo al Garante per la Protezione dei Dati Personali (<https://www.garanteprivacy.it/>).

## 10. Base legale (GDPR)

Il trattamento dei dati locali avviene esclusivamente nel browser dell'utente, su sua esplicita iniziativa di installazione e configurazione. La base giuridica è il **consenso** dell'utente (art. 6(1)(a) GDPR), revocabile in qualsiasi momento disinstallando l'estensione.

I trasferimenti a Notion e Anthropic, quando attivati dall'utente, sono regolati dalle policy dei rispettivi titolari:

- Notion: <https://www.notion.so/privacy>
- Anthropic: <https://www.anthropic.com/legal/privacy>
