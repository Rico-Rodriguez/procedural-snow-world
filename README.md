# Siltlands — Procedural Snow Laboratory

A focused browser vertical slice for a systemic snow world. The laboratory proves the project's highest-risk ideas before open-world production: deterministic generation, fixed-step material simulation, validated operations, volume accounting, deformation, snow objects, weather, persistence, and graceful GPU fallback.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite. Production output is created with `npm run build`; invariant tests run with `npm test`.

WebGPU is selected when supported. Append `?renderer=webgl` to exercise the fallback renderer.

## Controls

- `WASD` moves; `Shift` runs.
- Click the world to capture the pointer, then move the mouse to look.
- Hold the primary mouse button to use the selected snow operation.
- `1` dig, `2` pack, `3` deposit, `4` smooth, `5` roll.
- `E` grabs or places a nearby snowball. Click while holding one to throw it.
- Stack three placed snowballs to trigger construction recognition and finish a snowman.
- `Esc` releases the pointer so the weather, diagnostics, save, and guide controls can be used.

## Implemented systems

- Seeded, namespaced terrain and feature generation with domain warping, ridges, exposure, deterministic tree/rock placement, and a stable generator seed.
- A 129 × 129 snow field containing depth, density, wetness, hardness, temperature, disturbance, and exposure.
- Fixed 30 Hz simulation order independent from rendering speed.
- Validated, bounded and idempotent snow commands.
- Digging that transfers field mass into a carried reserve; depositing that returns it.
- Packing that changes density and volume while retaining mass.
- Conservative smoothing and two-phase wind transport.
- Weather deposition, thawing, refreezing, and state-driven procedural audio.
- Persistent pressure footprints with speed and surface response.
- Snowballs that gather real field mass, grow, roll, can be grabbed/thrown, and return fractured mass on impact.
- IndexedDB snapshots containing snow channels, weather, player position, and snow objects.
- Live mass ledger, checksum, revision, tick, render backend, and performance diagnostics.
- WebGPU-first Babylon.js rendering with an explicit WebGL 2 fallback.

## Code layout

```text
src/
├── audio/          Procedural Web Audio snow and wind
├── platform/       IndexedDB persistence
├── presentation/   Babylon.js scene, player view and snow objects
├── simulation/     Fixed-step snow material and commands
├── world/          Seed hashing and procedural generation
├── main.ts         Application/gameplay orchestration
└── styles.css      Interface and responsive presentation
```

The simulation never knows about particles, meshes, sound, or interface elements. Gameplay submits commands; the view and audio translate simulation results independently. This is the same boundary needed for later server authority and reconciliation.

## Phase boundary

This repository implements the Phase 1 Snow Laboratory vertical slice, not the later multiplayer/open-world phases. Chunk streaming, sparse voxel promotion, Rapier rigid bodies, authoritative servers, construction graphs, and procedural creature locomotion remain later milestones after the surface material model is profiled and hardened.
