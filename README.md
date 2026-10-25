# TRX Flow Atlas · release 32

A separate public visualizer for the original 1 TRX stakes. Visitors can explore the shared history and download CSV without signing in. Publishing a replacement JSON snapshot requires a dedicated password, checked by the server on every upload.

The visualizer never connects to a wallet, signs a transaction, approves a transfer, queries TRON, or changes the orchestrator's plan. The supplied dataset is marked **DEMO** and contains synthetic wallets. No real game data has been uploaded for you.

## Upload and refresh repair · release 32

Public API reads now retry temporary network/host failures at most three times and do not send visitor login cookies. Publishing uses POST with the same password, origin and revision checks; PUT remains compatible. A host error page produces an HTTP/path diagnostic instead of an Unexpected token error. A selected file containing an error page is identified as a failed download. Download a fresh flow JSON from the orchestrator in that case.

Once the server confirms an upload, its validated data appears immediately. A failed follow-up GET cannot leave the old history displayed. If a write reply is lost, the client only reads to check whether that exact snapshot was saved; it never automatically repeats the upload. Persistent read errors appear in a visible banner and preserve the current view. The publishing password and stored snapshots are retained. Updating the already hosted website does not require an orchestrator restart.

## Publish your game

Website: https://trx-flow-atlas-oct25.purple-rose-4948.chatgpt.site/

1. Upgrade the orchestrator to release 31, retaining its `.env`, wallet config, database volume and Compose project. This update changes the public export and dashboard links; it does not replace the execution engine or regenerate a campaign.
2. Click **Скачать все потоки · JSON** in the orchestrator. The export includes every recorded confirmed transfer, including pre-plan RANDOM/LIST/REBALANCE, saved campaigns and remaining steps. The endpoint is `GET /api/flow/export?format=json&includeLegacy=1`; legacy inclusion is the default.
3. Open Flow Atlas and click **Admin upload**. Select that public flow JSON, enter the publishing password from the separately supplied private **flow-atlas-admin.txt**, review the counts and click **Publish for everyone**.
4. Everyone opening the website sees the saved snapshot. Existing visitors can click **Refresh**. No redeploy is needed. The password is cleared after the request and is never stored in localStorage or the public dataset.
5. Repeat the export/upload to refresh public history and forecasts. This is a published snapshot, not a live connection to your private server.

The publishing password is separate from the game's `ADMIN_PASSWORD`. It only authorizes replacement of this public dataset. Keep the access file private; do not add it to Git, a public ZIP, or `public/`. A successful replacement retains the previous version in server storage. A stale upload returns a conflict; refresh and review before retrying. If a connection drops while publishing, refresh to check which version was saved before uploading again.

Upload an orchestrator flow export, **never config/wallets.json**. The server validates the schema, addresses, integer amounts and complete SMART allocation ledger, then saves only whitelisted public fields. It enforces a 12 MiB limit. Incorrect passwords, invalid data and failed writes do not replace the current snapshot. Hosted data survives a restart and deployment, independently of the orchestrator's database.

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

## Run your own copy

Node.js 22 or newer; no npm runtime dependencies.

```bash
npm test
npm run build
cp .env.example .env
node scripts/create-admin.mjs flow-atlas-admin.txt
```

The last command creates a new private access file and prints its **server verifier**, not the password. Copy that verifier into `.env` as `FLOW_PUBLISH_AUTH`; never use the actual password for this variable. Keep the file outside directories you serve.

```bash
node --env-file=.env scripts/serve.mjs
```

Open `http://localhost:8090`. The single-process Node server binds to `127.0.0.1`, checks publishing passwords and atomically saves data in `FLOW_DATA_DIR` (default `.data`). Restarts retain uploaded data. Back up that directory and preserve it and `.env` during upgrades. For public hosting, add an HTTPS reverse proxy and set `FLOW_PUBLIC_ORIGIN=https://your-host.example` to the exact public origin. Do not run multiple Node instances against the filesystem adapter; the hosted production Worker uses conditional R2 writes for shared storage.

A static read-only copy can serve `public/` over HTTP(S). Without `/api/snapshot`, it uses the bundled snapshot and disables Admin upload. Replacing `public/dataset.json` changes that static copy, but static hosting alone cannot persist password-protected uploads.

## Optional Vercel frontend

The site is already hosted. For an optional Vercel URL, `vercel.json` serves `public/` and `api/[...route].js` proxies only the three Flow Atlas API routes to the persistent server. It never connects to your orchestrator.

1. Deploy **only this visualizer folder** from a separate repository. Exclude wallet config, `.env`, private access files and the orchestrator root.
2. Framework: **Other**; build: **npm run build:static**; output: **public**. Retain `api/` so Vercel deploys the server proxy.
3. Set server environment variable `FLOW_API_ORIGIN` to `https://trx-flow-atlas-oct25.purple-rose-4948.chatgpt.site`. No publishing password goes into frontend configuration. The shared upstream server checks it on upload.
4. Deploy. Both sites read the same persisted snapshot. Admin uploads still require the publishing password. Removing the proxy leaves a static demonstration, not a shared writable store.

[Vercel Functions limit request/response bodies to 4.5 MB](https://vercel.com/docs/functions/limitations). Larger snapshots should use the existing direct website instead of this optional proxy. The main publisher allows 12 MiB. This archive does not provision a Vercel project or vanity domain.

## Source and verification

`public/model.js` validates and replays integer Sun allocations; `exports.js` creates CSV; `tree-layout.js` fixes columns/day spacing; `canvas.js` renders; `app.js` controls history, playback and publishing. `worker/index.js` provides public reads and authenticated conditional writes. `scripts/build-worker.mjs` embeds assets in an ESM Worker; native hosting provisions `BUCKET`. `scripts/file-bucket.mjs` is the separate single-process local adapter.

Tests cover exact conservation, earlier history, personal peer-to-peer tracing, CSV round trips, fixed columns, password validation, rejected uploads, concurrent conflicts, previous-version retention and persistence across server handlers. Tests use synthetic data and never contact TRON.

`node scripts/demo.mjs` regenerates and **overwrites public/dataset.json and public/demo.json**. It does not overwrite a published server snapshot. Refresh real game data through the orchestrator export instead.
