# Tello Drone Simulator

Mobile-first 3D drone simulator — Three.js (WebGPU with WebGL2 fallback) + Rapier physics, on Next.js.

```bash
npm install
npm run dev        # http://localhost:5173 (also served on your LAN IP for phone testing)
npm run build
npm run preview    # http://localhost:4173, serves the production build
```

## File structure

```
├── app/
│   ├── layout.js              # document shell, viewport, global styles
│   ├── page.js                # the only route
│   └── Simulator.jsx          # canvas host + touch overlay markup, boots src/main.js
├── style.css                  # overlay/HUD styling, safe-area aware
├── next.config.mjs            # three -> three/webgpu alias, COOP/COEP headers
├── public/
│   ├── dji_tello.glb          # the drone
│   └── chicken_gun_fruzer_village/   # the village scene
├── src/
│   ├── main.js                # bootstrap + render loop + disposal
│   ├── Scene.js               # renderer, lighting, landing pad, orbit cam
│   ├── Environment.js         # loads the kit, lays out the island, emits colliders
│   ├── Physics.js             # Rapier world, fixed 60 Hz step, interpolation
│   ├── DroneController.js     # flight model, state machine, model binding
│   ├── UIManager.js           # button wiring, enable/disable, HUD
│   ├── Loaders.js             # GLTF + Draco + KTX2/Basis + Meshopt
│   └── config.js              # drone presets (pure data, no imports)
└── tests/
    ├── flight-model.mjs       # headless physics/state-machine test (npm test)
    └── browser-smoke.mjs      # real-browser E2E (npm run test:browser)
```

## Controls

| Action | Touch | Keyboard |
| --- | --- | --- |
| Takeoff / Land | Takeoff, Land | `T` / `L` |
| Move | left pad | `W A S D` / arrows |
| Altitude | right pad ▲▼ | `Space` / `Shift` |
| Yaw | right pad ↺↻ | `Q` / `E` |
| Flip | Flip L, Flip R | `Z` / `X` |
| Orbit camera | drag anywhere on the scene | — |
| Zoom | pinch, wheel, or the top slider | — |
| Auto camera | **Auto Cam** toggle | — |

Button availability is driven entirely by flight state: **Takeoff** only when landed, **Land** only in
steady flight, and every movement/flip button is locked during takeoff, landing and flips.

The camera always keeps the drone dead centre — dragging only moves the viewpoint around it. With
**Auto Cam** on, the view eases back behind the drone 3 seconds after you stop adjusting; with it off,
it stays exactly where you left it. Zoom is clamped to a range where the airframe stays readable
(roughly 2× to 14× its own span).

## Swapping in a different drone

Add an entry to `DRONE_PRESETS` in [`src/config.js`](src/config.js) and load it with `?drone=<id>`.
No physics code changes:

- the mesh is uniformly scaled to `targetSpan` and recentred on its own bounding box, so authoring
  units don't matter;
- the collider half-extents are **derived from that box** at runtime;
- the yaw torque controller is scaled by the resulting moment of inertia, so response is identical
  across airframes;
- the chase camera and landing pad are sized from the measured span;
- `modelYawOffsetDeg` corrects models whose nose doesn't face `-Z`.

Re-run `npm test` after a swap — it asserts the tilt signs, travel directions and state transitions.

## The environment

A low-poly nature kit in `public/3D-Environment/` — 11 separate props, not a pre-built scene, so
[`src/Environment.js`](src/Environment.js) assembles the island in code. Everything below was
measured off the assets rather than assumed:

- **2,278 triangles across all 11 files** — 1/25th of the drone alone (56k). The assembled scene is
  19k triangles in 11 draw calls, roughly half the cost of the procedural arena it replaced.
- **Every file embeds the same 453×503 atlas** (identical MD5). They are collapsed onto one texture
  and one material, so the GPU holds one image instead of eleven.
- **Kit units are tiny** — a "tree" is 0.51 units. `ENVIRONMENT.scale` (12) puts trees at 6.1 m and
  the tile at 24 m square, which reads correctly next to an 18 cm drone. Drop it to ~3 for a
  tabletop-diorama look.
- **Land border heights span −0.27..0.37**, so the tile cannot repeat seamlessly. One tile is used,
  sized up, and `WORLD.arenaRadius` keeps the drone over it.
- **Prop origins are wherever the artist left them** (the trees sit entirely below theirs, off to one
  side). Geometry is recentred on its own footprint with the base at y=0 before instancing.
- **A water channel cuts a hole through the land mesh**, so scatter points can miss it entirely.
  Placement raycasts down and retries, and rejects faces steeper than `maxSlopeNormalY`.
- **The spawn height is raycast off the mesh**, not assumed — being a few centimetres out buries the
  drone in the hillside.

Scattering is seeded (`ENVIRONMENT.seed`), so the layout and the colliders it emits are produced by
the same deterministic pass and can never disagree.

To swap the environment, drop a GLB in and add it to `ENVIRONMENT.props` in
[`src/config.js`](src/config.js). Nothing downstream needs to know — the scene is consumed purely as
`environment.group` plus `environment.colliders`.

## Design notes

**Flight model.** The rigid body's rotation is locked to the Y axis. Yaw is genuinely simulated via
`addTorque` with a rate controller. Pitch and roll are a *commanded attitude* rather than free
rotation — which is how an attitude-stabilised multirotor actually behaves — and that attitude does
real work: the thrust vector is rotated by it, so leaning 15° forward produces a horizontal force of
`thrust · sin(15°)`. **The visual tilt and the force driving the body are the same quantity**, not a
cosmetic overlay. Top speed falls out of the physics as `g·tan(maxTilt)/damping` (~2.6 m/s) rather
than being clamped by hand, and the drone can't be tumbled by a collision.

This is a deliberate departure from applying free torques on all three axes: free pitch/roll torque
needs a full attitude PID to stay upright, is much harder to tune, and lets a bad input flip a
self-levelling toy drone upside down.

**Auto-brake.** With the sticks centred the drone leans against its residual velocity. Linear damping
alone decays exponentially and leaves it drifting for several seconds; this stops it in about one.

**Flips** are not an animation played on the spot. A rolling box sweeps a taller envelope than it
occupies at rest — `hy` below its centre when level, `hx` on edge — so the manoeuvre rides an arc
lifted by exactly that difference, which *guarantees* no part of the airframe passes below its entry
height (`npm test` measures the margin: 0.0 mm). A single arc peaking when inverted, rather than the
raw clearance curve, which returns to zero at 180° and reads as two hops with a stall between them.
Roll is blended toward constant rate (`flipEaseBlend`) so it is one continuous motion, and a decaying
lateral force through the tail of the rotation hands off to auto-brake with no step change. It
travels ~4 airframe widths, most of it *during* the roll. `npm test` prints every figure.

**Collisions.** The terrain is an exact Rapier trimesh, so the drone's downward ground probe reports
real hill heights and it can set down anywhere on them — including on rocks and tree canopies. Props
carry cylinder or box colliders emitted by the same pass that places them, so what you see and what
you hit cannot drift apart, and all of it shares one fixed body (Rapier handles many colliders on one
body far more cheaply than many bodies).

**Altitude is absolute, not above-ground.** Terrain-relative hold would make the drone climb every
time it crossed a hill. The minimum height *is* measured against whatever is underneath, though —
referenced to the arena floor instead, holding DOWN over a raised surface would wind the command
metres below the drone while it physically rested on the surface, and a later UP would spend seconds
just unwinding it.

**Camera.** A spherical rig centred on the drone: drag changes azimuth/elevation, pinch/wheel/slider
change radius, and the subject never leaves the centre of frame. Azimuth is a *world* angle — while
auto-follow is settled it tracks the drone's heading (a chase cam), but once you drag it holds still
in world space, so yawing the drone doesn't drag your view around with it. The 3-second idle timer
uses wall-clock rather than accumulated render `dt`: `dt` is clamped to protect the physics loop, so
on a slow device a "3 second" timer built from it would never actually elapse.

**Fixed timestep.** `PhysicsWorld.update(frameDelta)` accumulates real time and runs whole 60 Hz
steps, exposing `alpha` to interpolate visuals between the last two states. Behaviour is identical at
30, 60 or 144 FPS. Catch-up is capped at 5 substeps per frame, so a stall degrades to slow motion
instead of a spiral of death.

**Renderer.** One `WebGPURenderer` serves both paths — when `navigator.gpu` is absent or init throws,
it is recreated with `forceWebGL: true` (same node-material pipeline over WebGL2). Importing the
legacy `WebGLRenderer` as a fallback would ship a second copy of Three. For the same reason
`next.config.mjs` aliases `three` → `three/webgpu`, so the addons resolve against the same build;
without that, cross-build `instanceof` checks silently fail.

**Mobile budget.** Device pixel ratio capped at 1.5 (the single biggest lever — a 3× DPR phone
renders ~9× the fragments for no perceptible gain), antialiasing off, 512² shadow map on a tight
frustum, instanced props (one draw call per prop type), a single shared material and texture across
the whole environment, and HUD text repainted at 10 Hz while button lockout tracks every frame.

**Texture compression.** KTX2/Basis, Draco and Meshopt are all wired into the GLTF loader.
`KTX2Loader.detectSupport(renderer)` picks the best format the GPU exposes (ASTC/ETC2/BC). Since
r185 the transcoders resolve through the bundler via `new URL(…, import.meta.url)` — no CDN and no
manual copying — and are only *fetched* when a model actually declares the matching extension, so
they cost nothing for the uncompressed stock Tello.

**Disposal.** `dispose()` walks the scene graph freeing geometries, materials and their textures,
frees the Rapier world and removes every listener. It is wired to `pagehide`/`beforeunload`, and
exported so `Simulator.jsx` can call it when the component unmounts.

## Known trade-offs

- **`@dimforge/rapier3d-compat` instead of `@dimforge/rapier3d`.** The raw package needs extra WASM
  build wiring; compat inlines the WASM and exposes `RAPIER.init()`. Cost: the vendor chunk is
  ~840 kB gzipped. If that matters more than build simplicity, switch to the raw package — the API
  is identical.
- **The build emits the Draco/Basis transcoders (~1.9 MB) even though the stock Tello uses neither.**
  They're emitted by static analysis but never downloaded at runtime. Dropping `setDRACOLoader` /
  `setKTX2Loader` from `Loaders.js` removes them if you know your models are uncompressed.
- The GLB is 4 MB and untextured (56k triangles, 5 materials). Running it through
  `gltf-transform optimize` with Draco + KTX2 would cut it substantially — the loader is already
  wired for both.

## Tests

`npm test` runs the flight model headless in Node — no WebGL — covering the state machine, tilt
signs, travel directions, flip roll/drift/pivot, collisions with static props, yaw rate, touchdown
and disposal.

`npm run test:browser` drives a locally installed Chrome/Edge via `puppeteer-core` (downloads no
browser; set `CHROME_PATH` to override) against `npm run preview`, and writes screenshots.
