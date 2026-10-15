# LAST BEACON

Offline-first survival coordination PWA (hackathon prototype).

Day 19 of an outbreak. Aarav and Mira must cross Monaco, from a shelter in Fontvieille to the Larvotto Settlement, before the evacuation beacon shuts down. LAST BEACON plans a risk-aware route on the real street network, recalculates it when threats appear, tracks both survivors' supplies and condition, and shares field intelligence between phones with QR codes, all without internet.

> **What is real and what is simulated.** Streets, buildings, coastline, pharmacies, fountains and food stores come from OpenStreetMap (Monaco, 2016 extract). Survivors, supply quantities, threats, the deadline and every health value are fictional scenario parameters. This is not a medically validated survival system. "Information confidence" is a model-derived measure of how much is known about a route, not a probability of survival. Simulated threats are always labelled SIMULATED. GPS, camera, connectivity and storage status come from the actual device.

---

## Quick start

Requirements: Node 18+ (tested on Node 22) and npm.

```bash
npm install
npm run dev        # development server on http://localhost:5173 (also on your LAN)
npm test           # 43 Vitest tests for routing, threats, resources, sync, stages, persistence
npm run build      # type-check + production build into dist/ (also generates dist/sw.js)
npm run preview    # serve the production build on http://localhost:4173
```

The service worker is only registered in the production build, so test offline behaviour with `npm run build && npm run preview`, or on the deployed site.

---

## Deploy (static hosting, HTTPS)

The app is fully static: no backend, database or API keys. Any HTTPS static host works. Config for both providers below is included in the repo.

### Vercel
1. Push the project to a GitHub repository.
2. On vercel.com: **Add New → Project**, import the repository.
3. Vercel detects Vite from `vercel.json` (build `npm run build`, output `dist`). Click **Deploy**.
4. You get an `https://<name>.vercel.app` URL.

Or from the terminal: `npm i -g vercel && vercel --prod`.

### Netlify
1. Push to GitHub, then on app.netlify.com: **Add new site → Import an existing project**.
2. `netlify.toml` sets build `npm run build` and publish `dist`. Deploy.

Fastest option for a pitch: run `npm run build` locally and drag the `dist/` folder onto https://app.netlify.com/drop.

`sw.js` and `index.html` are served with `Cache-Control: no-cache` so phones pick up new versions. Asset files are content-hashed.

No URL is hard-coded: the app uses relative paths (`base: './'`) and works from any domain or sub-path.

---

## Install as an app and use it offline

1. Open the deployed HTTPS URL once while online and wait about 5 seconds. The service worker caches the app, fonts and the offline map (~1 MB).
2. Install it:
   - **Android (Chrome):** menu → **Install app** / **Add to Home screen**.
   - **iPhone (Safari):** Share → **Add to Home Screen**.
   - **Desktop Chrome/Edge:** install icon in the address bar.
3. Turn on airplane mode and open the app. Routing, threat simulation, supplies, mission stages, saving and QR sync all run locally.

### Offline test checklist
1. Load the deployed site online, then reload once (the page is now controlled by the service worker).
2. Enable airplane mode (or DevTools → Network → Offline).
3. Reload: the top bar shows **OFFLINE**, and the map chip shows **Offline map available**.
4. Simulate a threat: the route recalculates and the change card explains it.
5. Reload again: the threat, route and supplies are restored from IndexedDB.

Hosting on Vercel or Netlify does not by itself make a site work offline. The service worker in this app does, and it has to be loaded online once first.

---

## Two-device demonstration (QR sync)

Camera access requires HTTPS (or `localhost`), so use the deployed URL on both phones.

**Device A (Mira's phone)**
1. Open the app → **Sync** → choose **Carried by Mira**.
2. Create intel: **Threats → Add threat** (pick the location on the map or use GPS), or **SIMULATE THREAT** on the map. Optionally mark an amenity or a discovered path, and write an urgent message in Sync.
3. **Sync → Share updates**: tick the items to share (only selected items travel) → **GENERATE SYNC QR**.

**Device B (Aarav's phone)**
1. Open the same URL and let it load, then turn on airplane mode.
2. **Sync → SCAN QR** → allow camera access → point it at Device A's screen.
3. Review the preview (sender, update types, report count, highest severity, timestamp, resource changes, conflicts) → **Accept and import**.
4. Go to **Home**: the route is recalculated locally and the change card says why.

**If the camera fails:** on Device A, use **Copy code text** or **Save as file** (`.lbsync`). On Device B, open **Manual fallback** and paste the code or open the file. The same validation and preview apply.

QR codes carry a compact delta (up to 12 items per type). A meter shows the code size. Above ~1,100 characters it warns, and above 2,300 it asks you to select fewer reports. It does not attempt large transfers.

---

## Pitch script (about 4 minutes)

1. **Initial state.** Point out Day 19, the beacon countdown and the separate "Travel needed" time, both survivors' health and energy, and the recommended route with its reasons and two alternatives on real Monaco streets. The shortest route goes through unlit road tunnels and is not the recommendation.
2. **Compare route.** COMPARE ROUTE → click points along the harbour tunnels toward the settlement → **Compare**. A side-by-side table shows why the recommendation wins.
3. **Simulate a threat.** SIMULATE THREAT → Zombie horde (level 3) → **Arm** → double-click **Place d'Armes** (the market square at the centre of La Condamine).
4. **Recalculation.** The crossing turns red (blocked), the area around it orange, the old route faint, and the new route draws in. The change card gives the location, severity, effect, previous route, new route, and the new travel time and water.
5. **Resources.** Resources → set water to 0.1 L for both survivors and the pack, and tick Mira **Injured**. Home now recommends a supply stop at a fountain and explains the injury penalty. Treat Mira with Aarav's medkit and watch the pace recover.
6. **Offline.** Airplane mode → simulate another event → reload → state persists.
7. **QR sync.** Second phone, as above.
8. **Completion.** Press **To next checkpoint** repeatedly: stages 1 to 5 complete from the group's measured position and supplies, then the outcome summary lists the decisions. **Reset mission** at the bottom of the panel restores the scenario.

---

## How it works

```
src/
  app/        engine.ts (every action → apply → re-plan → explain → stages → log), store.tsx, warnings.ts, App.tsx
  routing/    graph.ts, dijkstra.ts, cost.ts, uncertainty.ts, planner.ts, compare.ts, paths.ts
  threats/    catalog.ts, effects.ts, placement.ts
  survivors/  rules.ts
  resources/  consumption.ts
  missions/   stages.ts, movement.ts
  sync/       payload.ts (schema, encode, validate), merge.ts, Scanner.tsx
  storage/    db.ts (IndexedDB with localStorage fallback)
  map/        BaseMap.tsx (offline vector map), MapView.tsx, geometry.ts
  pages/      HomePanel, ResourcesPanel, ThreatsPanel, SyncPanel
  data/       graph.json (generated), scenario.ts
  tests/      Vitest suites
scripts/build_map_data.py   builds the offline map and routing graph from an OSM extract
```

Routing, scoring, persistence and QR parsing are pure modules, separate from the UI.

### Map data and offline map
- `scripts/build_map_data.py` reads `scripts/monaco.osm.pbf` (the OSRM project's Monaco test extract, an OpenStreetMap snapshot from March 2016, ODbL). It writes:
  - `public/map/basemap.json`: buildings, land and coastline, parks, roads and street labels, drawn by Leaflet on a canvas. Precached by the service worker, so the map renders with no network.
  - `src/data/graph.json`: the walkable street network, contracted to 1,512 intersections and 2,129 segments, each with its real geometry, length, road class, stairs and tunnel share. Pharmacies, fountains and food stores become supply locations (quantities are fictional).
- Regenerate with `pip install osmium networkx shapely && npm run build-map`.
- **Offline area is limited to Monaco (Fontvieille to Larvotto).** The chip on the map says so.
- **Online tiles** (CARTO dark basemap, OSM data) can be switched on from the map chip. They are never cached by the service worker, because tile providers restrict bulk and offline caching. Check CARTO's basemap terms before any production use.

### Composite cost (routing/cost.ts)
`C(e) = wT·T + wR·R + wS·S + wU·U + wH·H`, each term normalised to a 5-minute / 350 m reference segment:
- **T** travel minutes / 5, at the slowest survivor's pace, with stairs and paths slower.
- **R** threat exposure (threats/effects.ts) × time spent in the zone.
- **S** water and food used, × a scarcity factor when below reserve.
- **U** segment uncertainty × length share × (1 + cognitive penalty).
- **H** mean survivor energy cost × group fatigue.

Default weights are wT 1, wR 4, wS 0.5, wU 1.2, wH 0.8, editable in Resources → Planning settings.

### Threat levels (threats/)
- **L0** no cost.
- **L1** mild penalty; road stays open.
- **L2** substantial penalty; alternatives preferred.
- **L3** blocks only the affected segment or crossing (the hazard core) when the report is impassable and confidence is at least 35%. Nearby roads receive severity minus 1 and are never blocked. Each category has its own core and spill radius.

Reports can be revised (severity, confidence, impassable, resolved), and every change is kept in the report's history.

### Uncertainty (routing/uncertainty.ts)
`U = base (verified 0.05 / known 0.15 / unexplored 0.45) + 0.2 × report age + 0.1 if status unknown + 0.6 × tunnel share + 0.15 × (1 − report trust) + 0.2 if reports conflict`, capped at 1.

Roads the group has walked become verified. Route uncertainty is the distance-weighted mean.

### Planner (routing/planner.ts)
- **Alternatives:** iterative-penalty Dijkstra. Each round penalises the found route by ×1.6 and keeps routes with less than 80% overlap; every route is then scored on its true cost.
- **Feasible** means passable, arrives before the deadline, and supplies and energy last the whole route.
- **Recommendation:** the cheapest feasible route without L2+ hazards, then the cheapest feasible route at all (flagged HIGH RISK), then supply detours.
- If nothing works, there is **no recommendation**, with reasons. The planner never invents a safe route.
- **Supply detours** use two shortest-path trees (from the group and from the settlement) to evaluate every reachable amenity. A stop is recommended only if it fixes a shortage, reserve or medical need without a higher threat level, keeps at least 10 minutes of margin, and costs at most 1.6× the direct route.

### Survivor rules (survivors/rules.ts)
- Injured: pace ×0.75 and energy use ×1.3.
- Energy below 30 or health below 40: pace ×0.85.
- Low energy raises the fatigue factor on long or stair-heavy routes.
- Cognition below 50 multiplies the uncertainty penalty by 1.5; below 30, by 2.

### Mission stages (missions/stages.ts)
Each stage is completed only by measured state, never by a button:
1. The trail reaches the shelter exit node.
2. The trail crosses the Sainte-Dévote transit line (dashed on the map).
3. Supplies cover the remaining route plus reserve, or an exception is recorded (only possible after stage 2 and when no supply stop is available).
4. The group is within 380 m of the settlement.
5. The group is at the settlement before the deadline.

**To next checkpoint** and **Advance ~6 min** move the group along the recommended route. Each segment consumes water, food and energy and advances the mission clock by its simulated travel time.

### QR sync (sync/)
- **Format:** `LB1:<checksum>:<compact JSON>`, schema v1, with a unique update id and per-item ids, timestamps, source, reporter device and confidence.
- **Validation:** checks the header, version, checksum, types and ranges, the map area, item limits and timestamps, and rejects malformed payloads whole.
- **Merge rules:**
  - Duplicate updates and reports are skipped.
  - A newer revision of a known report replaces the old version, and its history is kept.
  - Conflicting reports (2+ levels apart on the same place) are **both kept** and flagged. Routing resolves them by trust (confidence × source reliability × freshness), with a safety bias, not by recency alone.
  - Discovered paths are re-validated locally before they become routable.
  - Survivor status and inventory apply only if explicitly shared and newer.

### Persistence (storage/db.ts)
- Mission state is saved to IndexedDB after every action. If IndexedDB fails, the app falls back to localStorage; if that fails too, it runs in memory, and the Sync tab shows which mode is active.
- The beacon deadline is an absolute timestamp, so the countdown survives reloads.

---

## Verification done

- `npm test`: 43 passing tests, covering every case on the brief's list:
  - Dijkstra correctness
  - feasible choice among alternatives
  - blocked-edge avoidance
  - L1 cost increase, L2 avoidance, L3 blocking (and passable L3)
  - recalculation after simulated events
  - consumption maths and shortage detection, supply detours
  - health penalties
  - deadline feasibility
  - QR validation, deduplication, revisions and conflict handling
  - IndexedDB persistence and restoration
  - stage completion
  - shortest route ≠ recommended route
  - all routes infeasible (blocked, and too late)
  - reset restoring route, resources and threats
  - compare-route matching
- `npm run build` passes with strict TypeScript.
- Browser runs in headless Chromium against the production build:
  - desktop and phone layouts
  - horde simulation and recalculation
  - compare route
  - supply detour and injury
  - all five stages to mission complete
  - offline reload served by the service worker, with the offline map, simulation and persistence while offline
  - **a two-device QR transfer through the real camera pipeline** (Device A's generated QR fed to Device B's camera via Chromium's fake-camera input, with B offline), followed by preview, import and local reroute

## Known limitations

- **Not yet tested on two physical phones.** The camera path was exercised end to end in Chromium with a simulated camera feed. Before the pitch, run the two-device steps above on your actual phones over the deployed HTTPS URL. iPhone needs Safari (or an installed PWA) and camera permission.
- The map data is a 2016 snapshot and has no elevation. Monaco's slopes are only approximated through stairs.
- The offline map covers the Monaco demo area only. A GPS fix outside it is reported but not plotted.
- The group's movement is simulated along the route, not tracked live by GPS.
- QR payloads are deliberately small. Share many reports as several codes, or use the `.lbsync` file fallback.
- The main JavaScript bundle is about 290 KB gzipped (React, Leaflet and the bundled street graph). It is cached after the first load.

## Credits and licences

Map data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright). The Monaco extract is from the Project-OSRM test data. Libraries: React, Leaflet, React Leaflet, qrcode, jsQR, IBM Plex Sans Condensed (SIL OFL).
