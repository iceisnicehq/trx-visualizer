# TRX Flow Atlas · release 36

## Original-stake restoration batches · release 36

The independent mixer can now queue an ORIGINAL_STAKES restoration using its own confirmed journal, frozen true initial positions, manual approvals and its existing transaction engine. Flow remains an independent read-only analytics app: there is no server connection or live operation endpoint. Export a fresh public JSON from the mixer and upload it manually to Flow.

New mixer exports already contain corrected CONTINUOUS attribution, with original recorded allocations preserved for comparison. Flow also recognizes ownershipMode: ORIGINAL_STAKES when reconstructing an older recorded view: that boundary must match the preceding original-owner composition exactly, and its return allocations select the original owner directly. This prevents a second relabelling of a restored stake. A mismatched frozen baseline is rejected. Confirmed-only exports contain only actual confirmed returns; a history-plus-queue export retains pending statuses and forecast lines.

The restoration preview in Flow still cannot send transactions. To execute returns, use the mixer's protected Restore original stakes action and its approval queue. After confirmation, re-export and upload the updated JSON. Personal and everyone CSV downloads then include those new confirmed routes. The mixer and Flow can remain on separate servers without knowing each other's addresses.

## Original ownership across legacy and plan boundaries · release 35

The former export used independent accounting periods. A native-balance rebalance could leave every wallet holding 1 TRX while its reconstructed original shares belonged to other participants. Starting a plan then relabelled each wallet’s balance as its own stake. That is appropriate for a separate plan ledger, but it breaks the claim that a single diagram follows the original stake through the entire game.

The default **Ownership → Original stakes · continuous** view now bridges that boundary. Legacy transfers consume incoming lots FIFO. At each new plan, the preceding exact original-owner composition is assigned to that plan’s recorded packet labels. Each saved plan transfer retains its native amount, route, sequence and nominal allocation routing; original lots inside each recorded plan share are consumed FIFO. The plan’s graph and CSV therefore follow the actual preceding accounting composition rather than creating a new original 1 TRX at the owner’s address. Every calculation uses integer Sun, including the old fractional amounts.

The boundary is marked **CARRIED**. Hiding “Before the plans” or selecting only one plan does not erase its starting composition. **Recorded plan ledger · compare** preserves the former per-plan view. Saving the public snapshot in continuous mode includes both corrected allocations and the original recorded allocations, so the calculation is reversible and idempotent. CSV includes accounting_mode / accounting_method and the corrected baselines. A personal CSV preserves that one stake, but cannot certify a whole-pool restoration. A continuous CSV alone cannot recreate the original per-plan comparison view; keep the JSON for that comparison.

Confirmed and projected movements are replayed in immutable sequence. If forecast dates go backwards, their calendar grouping respects the preceding step’s effective date; the original timestamps are retained in the transaction details. A missing transfer, partial coverage, an insufficient saved packet or a boundary balance mismatch stops later original-owner attribution. It never invents a replacement starting stake. An unfinished preceding plan cannot be bridged into a confirmed new plan.

**Check original stakes** shows each participant’s confirmed positions and provides an owner-specific restoration **preview only**. It does not send transactions or change the mixer. The direct routes require explicit ownership allocations; executing the list as ordinary unannotated FIFO transfers can give a different ownership result. Ordinary Rebalance restores native wallet totals, and may do nothing when they are already 1 TRX. The preview is blocked by partial data, pending transactions, missing participant stakes or a stake already paid to the teacher. Preserve personal extra Sun and the mixer’s approval and live zero-fee checks before any separately approved transfer.

To audit a complete public export offline:

```bash
node scripts/analyse-provenance.mjs /path/to/public-export.json /path/to/audit-output
```

The script creates a corrected Flow JSON, exact positions and proposed routes, personal/everyone CSV and an optional Flow JSON containing additional **DRAFT** return routes. DRAFT dates are illustrative, not an execution schedule. It reads only the supplied file and never contacts TRON. Keep the audit output outside public/ and do not overwrite the mixer database. Upload only the snapshot you intend all visitors to see. Extra on-chain transfers absent from the export require a new complete journal; original coin identities cannot be recovered from an explorer because TRX is account-based and fungible.

A separate public visualizer for the original 1 TRX stakes. Visitors can explore the shared history and download CSV without signing in. Publishing a replacement JSON snapshot requires a dedicated password, checked by the server on every upload.

The visualizer never connects to a wallet, signs a transaction, approves a transfer, queries TRON, or changes the orchestrator's plan. The supplied dataset is marked **DEMO** and contains synthetic wallets. No real game data has been uploaded for you.

## Publishing route repair · release 34

The Vercel deployment now uses three explicit function files instead of a catch-all:

| Public route | Function file |
| --- | --- |
| GET /api/status | api/status.js |
| GET /api/snapshot | api/snapshot.js |
| POST /api/admin/publish | api/admin/publish.js |

Each function fixes its public route internally, even if Vercel rewrites the incoming request URL. Browser API requests use origin-root paths, so a nested page cannot accidentally send a publish to reports/day/api/admin/publish. Password, origin, payload and revision checks still apply to every upload.

**Upgrade your Vercel copy:**

1. Replace the Flow project source with this release. Remove the old api/[...route].js from your repository; it is replaced by the three files above. Preserve your project environment variables and private Blob store.
2. Set **Root Directory** to the Flow folder containing **package.json, vercel.json and api/**. Do not set Root Directory to public. Framework: **Other**. Build: **npm run build:static**. Output Directory: **public**. Do not upload only the contents of public; that omits the API.
3. Redeploy that Vercel project, then hard-refresh your browser. Verify in the deployment details that all three functions were built. The publishing function must be present alongside status and snapshot. The new archive does not change your publishing password, verifier or storage token.
4. Open **/api/status** and **/api/snapshot** on your own Flow origin: both must return JSON. Open **/api/admin/publish** in the browser: **405 Method Not Allowed** with **Allow: POST, PUT** is the expected read-only result, confirming that the route exists. A 404 means the publishing function has not been deployed at that URL. Admin upload uses POST and must still validate the password and JSON.

If the route still returns 404, check the Root Directory and whether api/admin/publish.js is committed in the deployed revision. Remove an old SPA catch-all rewrite that serves index.html for API paths. The included vercel.json requires no SPA fallback. Test your actual Vercel domain; deploying a separate hosted copy does not update your project.

The route modules and an authenticated upload are tested locally with isolated storage. Your Vercel account/domain is not available in this workspace, so its deployment must still be verified using the steps above.

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

This archive does not provision your Vercel project or storage. Configure the project-specific settings above before publishing.

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
