# TRX Flow Atlas

A separate, static, read-only visualizer for the orchestrator's original 1 TRX stakes. No database, backend, wallet connection, private keys, Telegram token or TRON API key is required. The supplied dataset is a clearly labelled 17-wallet **demonstration**, not your live game.

## Use your own game

1. Upgrade the orchestrator to release 30 while retaining its existing `.env`, `config/wallets.json`, Compose project and database volume. This adds a read-only export; it does not change the engine or restart a plan.
2. At the top of the dashboard, click **Скачать все потоки · JSON**. It exports all saved plans, their confirmed and remaining steps, selected next-plan previews and optional legacy attribution in one coherent snapshot.
3. Open the visualizer and click **Import your data**, or drop the JSON file onto it. The import stays in that browser tab; it is not uploaded. Reloading returns to the snapshot shipped with the site.
4. The **CSV всех участников** download also contains all stakes and their starting allocations in one file. You can import it instead of JSON. A transfer carrying several owners appears in multiple CSV rows but is counted only once in the visualizer.
5. Existing personal report CSVs can be selected together. They are deduplicated by period and sequence. They are labelled **partial** because omitted files/movements cannot prove a complete ledger. Conflicting versions are rejected; export files from the same snapshot. JSON is the recommended exact format.

The export excludes CANCELLED future steps, secrets, signed transaction payloads, admin settings, personal extra Sun and the teacher's unrelated balance. It includes public addresses, transaction IDs, saved ownership allocations, amounts and dates. Reading it never signs, approves, sends, reschedules or resumes anything.

## Read the canvas

- **Everyone together:** one colour per original owner. Circle numbers are wallets; the ring shows whose shares are held there. A 1.25 TRX holder can contain several owners. Choose a transfer to see exact integer-Sun packet composition.
- **Individual stake:** choose the original owner on the left. The highlighted routes include transfers between other wallets carrying that person's share, not just transfers to/from their address.
- **Network:** drag wallets freely; their positions are retained while you play, scrub and filter. Drag empty space to pan. Scroll or use +/− to zoom. Fit and Reset layout are separate actions. Fullscreen provides a larger canvas.
- **Journey timeline:** each wallet has a lane; time runs left to right. Circles and arrows replace the previous rectangle-based ownership DAG. Drag and zoom to inspect intersections. Click an arrow for its transfer or a circle for the holding wallet.
- **Playback:** choose one day or one transfer per step and a duration of 1, 1.5, 2 or 4 seconds. All visible transfers in a day light up during that frame. When following one stake in single-transfer mode, Play/Next skip unrelated transfers; balances still replay the complete included ledger. Pause or scrub to inspect balances after it. Arrow keys step; Space plays/pauses. Fullscreen retains the playback controls; browsers that block the fullscreen API get an expanded in-page canvas instead, with Esc to return. Reduced-motion preference disables moving particles; paused canvases redraw only when something changes.
- **Calendar day · MSK:** groups by actual block/recorded date for confirmed transfers, and current forecast date for pending steps. The range contains days with recorded/planned activity; it does not add empty calendar days. **Algorithm round** uses the saved campaign day instead. Neither mode changes the actual plan.
- **Confirmed only / History + forecast:** confirmed paths are solid; future paths are dashed and explicitly labelled FORECAST. A mixed day is labelled FORECAST when it contains any pending step. Exported forecast times can become stale.
- **Plan scope:** show all plans or one selected period. Earlier plans and a selected next-plan DRAFT are separate chapters. Starting allocations reset at explicit accounting boundaries; the same 1 TRX is reused, not added again per plan. A boundary is never animated as a native transfer.
- **Before the plans:** optional RANDOM/LIST history uses the orchestrator's existing FIFO accounting convention. That assumes a 1 TRX starting stake per configured wallet and is clearly labelled. It is not proof that particular Sun belong to somebody. Missing ownership or a deficit stops reconstruction of that period instead of inventing funds. The network can still show the recorded native transfer.
- **Image export:** the down-arrow canvas control downloads the current canvas as PNG. Existing orchestrator CSV/SVG report exports remain available.

The coloured ownership ledger is an application accounting model. TRON native balances do not carry original-owner labels. Replay checks conservation of every included stake; it is not a live audit of the entire account balance.

## Share publicly / Vercel

Two independent choices:

1. **Share the empty tool/demo:** deploy it as supplied. Visitors import their own public reports locally. Their imports are never sent to the host. A copied view link contains filters and frame position, not the imported file.
2. **Give every visitor the same game:** download your public JSON export, replace **`dist/dataset.json`** with it, then deploy/redeploy. Keep the filename exactly `dataset.json`. Every visitor can then follow that shared snapshot immediately. `dist/demo.json` remains a separate demonstration. A download named `dataset.json` is also available inside the visualizer under Save public snapshot. To update the public history, replace the file and redeploy; it does not poll your server.

For Vercel:

1. Put this folder in a separate Git repository and import that repository into Vercel. Do not use the orchestrator server's repository root as the deployment root.
2. Framework preset: **Other**. Build command: **`npm run build`**. Output directory: **`dist`**. No environment variables or runtime services are needed. The included `vercel.json` declares these settings.
3. Deploy and share the resulting HTTPS URL. The small build checks syntax, the UI controls and dataset validity; it does not contact TRON or upload local browser imports.

Any ordinary static host can serve the contents of `dist/` at its root. `index.html` and relative assets also work under a subdirectory. Serve through HTTP(S), not `file://`, because the app loads ES modules and a local JSON file.

The code has no third-party fonts, analytics, CDN scripts, signing library or external API calls. The optional TRONSCAN link is an ordinary link opened only when a visitor clicks it.

## Development and tests

Node.js 22 or newer, no npm dependencies:

```bash
npm test
npm run build
```

For local viewing on your own computer:

```bash
python3 -m http.server 8090 --directory dist
```

Open `http://localhost:8090`. `node scripts/demo.mjs` regenerates the bundled demonstration and **overwrites `dist/dataset.json`** as well as `dist/demo.json`; do not run it after replacing the hosted game snapshot.

Files: `dist/model.js` validates imports, deduplicates CSV and replays integer-Sun ownership; `dist/canvas.js` renders and handles camera/dragging; `dist/app.js` controls playback, imports and inspection. Tests cover single-Sun conservation, multi-owner packets, peer-to-peer personal tracing, multiple plans, backwards scrubbing, unknown history, CSV quoting/deduplication/conflicts, validation, and the complete 17-wallet example.

The orchestrator exposes `GET /api/flow/export?format=json|csv&includeLegacy=0|1`. Default is JSON with legacy included. This endpoint returns an attachment and does not mutate the game. Re-export from the server to refresh a local/public snapshot.
