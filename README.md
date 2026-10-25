# TRX Flow Atlas · release 33

A separate public visualizer for the original 1 TRX stakes. Visitors can explore the shared history and download CSV without signing in. Publishing a replacement JSON snapshot requires a dedicated password, checked by the server on every upload.

The visualizer never connects to a wallet, signs a transaction, approves a transfer, queries TRON, or changes the orchestrator's plan. The supplied dataset is marked **DEMO** and contains synthetic wallets. No real game data has been uploaded for you.

## Independent analytics · release 33

Flow and the mixer are separate deployments. The only handoff is a public JSON file that you download from the mixer and upload manually into Flow. Flow does not need the mixer's URL, API, database, keys or credentials. It does not poll the mixer, send it requests or control transactions. One Flow deployment also does not use another Flow deployment as its backend.

The former optional Vercel proxy was removed. The error “Set FLOW_API_ORIGIN…” meant that old proxy had no destination configured. That variable was an address of a different Flow backend, not the mixer. It is no longer used. Delete it from your Vercel environment to avoid confusion.

Each Flow instance has its own published snapshot, storage and publishing password. Uploading into one instance does not update another instance. All participants visiting the same instance see its saved snapshot and can download their personal or combined CSV.

## Choose where to run Flow

- **Your Vercel project:** the included API runs in that same project and uses a private Blob store attached to that Flow project. Follow the Vercel steps below.
- **Your VPS / Docker:** the included Node server serves both the page and API, and stores snapshots on its own persistent disk. No Blob token is required.
- **The separately hosted copy supplied in this conversation:** it has its own storage and publishing configuration already. It remains an independent copy; no other deployment reads its API.

## Publish your game

1. In the mixer, download **Скачать все потоки · JSON**. This includes every recorded confirmed transfer, pre-plan RANDOM/LIST/REBALANCE, previous campaigns and remaining steps. The mixer export is read-only and needs no Flow URL.
2. Open **your own Flow website** and click **Admin upload**. Select the public flow JSON, enter that Flow instance's publishing password, review the counts and click **Publish for everyone**.
3. Once the server confirms persistence, the uploaded history appears immediately. Other visitors see it on Refresh. The published snapshot survives restarts and redeployments of that same Flow instance.
4. Repeat the manual export/upload whenever you want a newer public snapshot. This is not a live connection to the mixer.

A temporary read error is retried at most three times. An unconfirmed write is checked by reading the same instance; uploads are never automatically repeated. Incorrect passwords, invalid files and stale revisions do not replace its current data. Previous revisions are retained in its own storage.

The publishing password is independent of the mixer's ADMIN_PASSWORD. Use the private **flow-atlas-admin.txt** for this Flow instance; it contains the password and its server verifier. Keep that file, .env and storage tokens out of Git and public directories. Upload a public flow export, **never config/wallets.json**. Schema/ledger validation strips unapproved fields and rejects wallet configuration files.

An instance without configured storage shows the explicitly labelled demonstration and a setup message. It cannot publish until its own storage and publishing verifier are configured. A configured store that becomes unavailable returns an error and retains the current view.

## Read the vertical graph

- **Day-by-day tree** is the default: fixed wallet columns, repeated wallet rows, time and arrows running **downward**. The starting row is the recorded initial allocation, normally 1 TRX each. Holding lines show shares staying at a wallet; arrows show recorded or forecast native transfers. Tiny checkpoints preserve order when funds move several times within a day.
- Each circle shows the **wallet number, final three address characters, tracked balance and stake breakdown**. The short breakdown uses `owner number: amount`; click for full addresses and composition. Personal extra Sun is excluded.
- Scroll in the canvas to move through days; **Shift + scroll** pans horizontally; **Ctrl/Command + scroll** zooms. Drag empty space to pan. Use zoom out or fullscreen for more columns. The canvas keeps a readable scale instead of squeezing forty days into one screen; off-screen wallets remain in the graph.
- Select a participant on the left to follow **their original 1 TRX**, including fragments moving between other wallets. The camera brings their holders/routes into view. The right panel contains the complete journey with **Confirmed / All steps** filters. Click a history entry to jump to its day and packet composition.
- Click a wallet circle on a day to see its holdings then and its complete incoming/outgoing history. Physical wallet history and the original owner's stake journey are different views.
- **Before the plans** is enabled by default. Earlier RANDOM/LIST/REBALANCE appears in brown in the shared view. The coverage line counts confirmed and pre-plan transfers. If an export excluded earlier history, the page requests a new export with `includeLegacy=1`.
- **Everyone together** shows all intersections. **Network** remains an alternative layout; dragged wallet positions survive playback. **Fit** restores the readable camera instead of cramming the vertical graph into one screen.
- **Play**, Previous/Next, the slider and Space/arrow keys control replay: one active day or one transfer per step, at 1, 1.5, 2 or 4 seconds. Confirmed paths are solid; pending paths are dashed and labelled **FORECAST**. Reduced-motion preference disables travelling particles.
- **Calendar day · MSK** uses actual recorded confirmation dates and current forecasts; **Algorithm round** uses saved campaign rounds. Rows represent days with included activity and explicit accounting boundaries. Future timestamps may change in the orchestrator after export.
- Each new plan starts its recorded ownership chapter. The same 1 TRX is reused, not added again. A boundary is never a transfer. Filter one plan or see every chapter together.
- The canvas down-arrow downloads the visible canvas as PNG. **Save public snapshot** downloads the public JSON. No password is needed for downloads.

TRON does not label individual Sun with original owners. SMART colours use saved application allocations. Earlier history uses the orchestrator's FIFO accounting convention, assuming a starting 1 TRX per configured wallet. If a legacy journal cannot prove a later allocation, native transfers remain visible as unknown and later balances in that chapter are not inferred. The app does not invent ownership or fetch omitted transactions from the blockchain. Export the complete recorded journal for the best coverage.

## Download personal CSV or everyone's CSV

Both buttons are in Flow Atlas so participants can obtain their reports from the public site:

- Select your participant, then **My 1 TRX · CSV**: your starting stake and every recorded/forecast movement carrying part of it through any holder, across all available chapters. This is not limited to transfers from your own address. Unknown legacy attribution stays explicitly unknown.
- **Everyone · CSV**: all participants and chapters. Multi-owner packets have one row per contribution linked to one physical transfer. Importers must deduplicate transfers instead of adding their full amount once per owner.

Both exports include pre-plan history present in the snapshot, regardless of the canvas day or selected plan. **Confirmed only** excludes future steps; **History + forecast** includes them. The legacy canvas checkbox controls drawing and does not silently remove earlier CSV chapters.

CSV is UTF-8 with BOM and standard quoting. It includes full addresses, UTC dates, exact integer Sun, six-decimal TRX, txIDs, original owner, owner contribution, packet composition and attribution basis. Bandwidth is for the **whole native transaction**, not an owner's fraction. `WALLET` rows preserve numbers/labels, `BASELINE` defines starting allocations and `TRANSFER` defines movements. Personal CSV tracks the selected stake and retains whole packet amounts/composition for context. The files can drive another visualizer using `public/model.js`'s `datasetFromCsv()` and replay helpers. The shared publishing endpoint accepts JSON only.

## Deploy a standalone Vercel instance

1. Deploy **only this Flow folder** in its own Vercel project. Framework: **Other**; build: **npm run build:static**; output: **public**. Retain api/, server/, worker/, package.json and package-lock.json. The API is deployed with the page; it is not a proxy.
2. In **this Flow project's Storage tab**, create/connect a **Private Vercel Blob store**. Vercel adds **BLOB_READ_WRITE_TOKEN** to the selected deployment environments. Keep this server token private. The storage belongs to Flow and has no relationship to the mixer.
3. Add server environment variable **FLOW_PUBLISH_AUTH** with the verifier from your private flow-atlas-admin.txt. Do not paste the actual password into this variable. You can reuse the verifier supplied earlier, or generate separate credentials locally using the command below.
4. Redeploy after changing environment variables. Open your Vercel URL, then Admin upload. The page, API, snapshot and storage now all belong to this instance. Each other independent Flow instance requires its own setup and upload.

If you already deployed the former proxy version, replace its source with this release, remove the obsolete FLOW_API_ORIGIN variable, connect the private store, set FLOW_PUBLISH_AUTH and redeploy. This does not change the mixer. A token from a **public** Blob store will not work with this private-store implementation.

[Vercel Functions have a 4.5 MB request/response limit](https://vercel.com/docs/functions/limitations). This app therefore accepts up to **4,000,000 bytes of normalized JSON** per upload on Vercel. Pretty-printed input can be larger if its normalized public payload fits. Node and native Worker copies allow up to 12 MiB. Vercel uses the pinned official @vercel/blob SDK; reads bypass the Blob CDN cache so Refresh sees the latest saved snapshot. Conditional writes reject competing uploads instead of silently overwriting them.

I have not provisioned storage or deployed into your Vercel account. Those are the project-specific steps above; the supplied project and adapter tests are ready for them.

## Generate this Flow instance's credentials

Node.js 22 or newer:

```bash
node scripts/create-admin.mjs flow-atlas-admin.txt
```

The file is created privately and is not overwritten if it exists. It contains the password you enter on the website and a **server verifier**. Copy only the verifier into FLOW_PUBLISH_AUTH on this Flow host. The command prints that verifier, not the password. Keep the private file outside public/ and out of any shared archive. Existing hosted credentials do not change when the source is upgraded.

## Standalone Node / VPS

```bash
npm ci
npm test
cp .env.example .env
```

Set FLOW_PUBLISH_AUTH in .env as described above, then:

```bash
node --env-file=.env scripts/serve.mjs
```

Open http://localhost:8090. One Node process serves the page and API and stores snapshots under FLOW_DATA_DIR (default .data). Preserve and back up that directory. For public HTTPS hosting, add a reverse proxy to this Node process and set FLOW_PUBLIC_ORIGIN to **this Flow site's own public origin**. It is not an API destination and must never be the mixer's address. BLOB_READ_WRITE_TOKEN is unused by this deployment. The Node runtime uses the filesystem adapter and does not call another server.

## Standalone Docker Compose

```bash
cp .env.example .env
```

Set FLOW_PUBLISH_AUTH. Then, from this Flow folder:

```bash
docker compose up -d --build
docker compose logs --tail=80 flow
```

Default address: http://localhost:8090, bound to loopback. An SSH tunnel may expose that local port to your own browser. For HTTPS reverse proxy use FLOW_PUBLIC_ORIGIN=https://your-flow.example. The named volume **flow-data** contains Flow snapshots and retained revisions. Preserve it across upgrades; do not use down -v. This Compose project has one Flow service and no mixer service, shared database or connection to a mixer network. To inspect it remotely, use your own SSH tunnel or reverse proxy. If changing the published port, set FLOW_PUBLIC_ORIGIN to the exact browser origin too.

The image uses only the built-in Node filesystem server at runtime. Docker is not available in this build workspace, so the image itself was not executed here; the same Node handler and disk restart persistence are tested.

## Static read-only use

Serve public/ over HTTP(S) for a bundled read-only snapshot; Admin upload is disabled when the API is absent. Replace public/dataset.json and redeploy to update that static copy. Password-protected uploads visible to all visitors require the Node, Vercel or native Worker deployment with its own persistent storage.

## Source and verification

`public/model.js` validates and replays integer Sun allocations; `exports.js` creates CSV; `tree-layout.js` fixes columns/day spacing; `canvas.js` renders; `app.js` controls history, playback and publishing. `worker/index.js` provides public reads and authenticated conditional writes. `scripts/build-worker.mjs` embeds assets in an ESM Worker; native hosting provisions `BUCKET`. `scripts/file-bucket.mjs` is the single-process disk adapter. `server/vercel-app.js` runs the same application API inside Vercel; `server/vercel-bucket.js` connects only to that instance's private Blob store.

Tests cover exact conservation, earlier history, personal peer-to-peer tracing, CSV round trips, fixed columns, password validation, rejected uploads, concurrent conflicts, previous-version retention and persistence across server handlers. Tests use synthetic data and never contact TRON.

`node scripts/demo.mjs` regenerates and **overwrites public/dataset.json and public/demo.json**. It does not overwrite a published server snapshot. Refresh real game data through the orchestrator export instead.
