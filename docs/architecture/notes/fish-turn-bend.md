# Fish turn bend — design note

**Status: implemented**, per the recommended approach below — see `turnRate.ts`'s `signedTurnRate`, `FishModel.tsx`'s `TURN_BEND_*` constants and `bendRef`, and `swimWave.ts`'s `applySwimWave` `bend` parameter. Kept as a design record: the reasoning, the alternatives considered, and the flagged unknowns below are still the right context for anyone revisiting this. Research toward making a fish's body visibly _bend_ through a turn (a C-curve toward the turn's inside, like a real fish's lateral spine flex) instead of the whole model rigidly yawing to its new heading.

## What's rigid today, and exactly why

The turning motion is a rigid-body rotation, but the situation is more nuanced than "the fish is a stiff mesh":

- **Heading is one quaternion slerped onto the whole `RigidBody`.** `render/steering/heading.ts` derives a yaw+clamped-pitch, roll-free target quaternion from velocity (`computeTargetHeading`); `render/steering/SteeringSystem.tsx` slerps `fish.currentHeading` toward it with a ~0.17 s time constant (`HEADING_SLERP_RATE = 6`) and calls `body.setRotation(...)`. Every vertex of the fish rotates together — this is the "rigid yaw" the user perceives.
- **The body is not actually stiff — it already flexes every frame.** `render/models/swimWave.ts` runs a continuous per-vertex travelling wave across the body, dorsal fin, and tail (`docs/architecture/3d-engine.md` §6.6): each vertex rotates about the mesh's local Y axis by `amplitude * env(u) * sin(phase - lag * u)`, applied from snapshotted rest positions each frame (`applySwimWave`, called three times per fish from `FishModel.tsx`'s `useFrame`). There is no bone rig (§6.2 is explicit); this per-vertex deformer is the _only_ body-deformation mechanism, and it is exactly the mechanism a turn bend should reuse.
- **A turn-rate signal already exists — but it's unsigned, so it can't curve anything.** `render/models/turnRate.ts`'s `computeTurnRate` measures `prevDirection.angleTo(direction)` between consecutive velocity-direction samples (rad/s, always ≥ 0, gated to zero below `MIN_TURN_RATE_SPEED`). `FishModel.tsx` feeds it into the swim wave as a symmetric _amplitude boost_ plus a frequency damp (`TURN_RATE_AMPLITUDE_SCALE`, `TURN_RATE_FREQUENCY_DAMP_SCALE` — the documented "sharper turn → bigger S-curve", §6.6). Because the wave's sine is symmetric about zero, a turn today makes the fish _wag wider_, never _lean into the arc_. The missing ingredient is a **signed** turn direction and a **DC (non-oscillating) bend term** in the wave.

So the fix is not a new deformation system — it's one new signed signal plus one additive term in an existing, well-tested formula.

## Recommended approach: signed turn rate → DC bend offset in the swim wave

The general technique is a **procedural spine curve driven by angular velocity** (games have long faked lateral flex this way — a static C-bend blended in proportional to yaw rate, blended out as the turn completes; the cheap cousin of trailing-segment/"follow-the-leader" chains). Concretely, in three small pieces:

### 1. Make the turn rate signed (`turnRate.ts`)

Extend `computeTurnRate` to also report direction: the sign of `cross(prevDirection, direction).y` says which way the heading is rotating about world Y (yaw here is `atan2(vx, vz)`, `heading.ts`). Return e.g. `signedTurnRate = turnRate * Math.sign(crossY)` alongside the existing unsigned `turnRate` so the two current consumers (amplitude boost, frequency damp) are untouched. Keep the existing low-speed gate exactly as is — it exists because low-speed direction samples are noise (`MIN_TURN_RATE_SPEED`'s doc comment recounts the "stuttering at night settle/wake" bug), and a _signed_ noisy value flapping between +/− would be worse than the unsigned one ever was. `turnRate.test.ts` already covers the gate; add cases for sign in both turn directions and sign stability across the gate.

Alternative signal source considered: per-frame delta of `extractYaw(fish.currentHeading)` in `SteeringSystem.tsx`, plumbed to `FishModel` via a new getter on `RegisteredFish`. It's arguably cleaner (it measures the _rendered_ rotation, slerp smoothing included, and would also work for a piloted fish turning in place — see Unknowns), but it needs new wiring across the steering/model boundary and an angle-wrap-around handler, whereas the cross-product sign is a two-line change in a file `FishModel.tsx` already calls. Start with the cross product; switch sources later without touching the deformation side if needed.

### 2. Smooth and clamp a bend value (`FishModel.tsx`)

In the existing `useFrame`, derive a target bend from the signed turn rate and low-pass it in a ref (same `1 - Math.exp(-rate * delta)` framerate-independent blend the file already uses for rest blending and accel smoothing):

- `targetBend = clamp(signedTurnRate, -CAP, +CAP) * TURN_BEND_SCALE` — a fresh constant pair next to `TURN_RATE_AMPLITUDE_SCALE`. Starting guess: cap the _resulting_ tip angle around 0.25–0.4 rad; tune by eye per the file's established convention.
- Smooth with a ~0.15–0.25 s time constant: fast enough that the bend visibly leads the slerp through a sharp turn (slerp constant is ~0.17 s), slow enough that per-frame turn-rate jitter doesn't shimmy the spine. This smoothing also gives the ease-out for free — as the turn completes, turn rate → 0 and the bend decays back to straight.
- Force the target to 0 while `isRestingRef.current` is set, so a resting fish never holds a residual curve.

### 3. Add the bend as a DC term in the wave application (`swimWave.ts` + call sites)

Add a `bend` parameter to `applySwimWave` (default 0) and fold it into the per-vertex angle: `angle = swimWaveAngle(env, u, phase, amplitude) + bend * u` — i.e. the bend ramps linearly from zero at `SWIM_WAVE_ONSET_X` to full at the tail tip, using the _already precomputed_ per-vertex `u` table. Everything downstream is automatic:

- **Seam stays closed.** Body, dorsal, and tail all share the same `u` parameterization and the same rotation pivot (`rotationOffsetX` machinery), so an identical `bend * u` term on all three meshes is continuous across the body/tail seam by construction — the exact property `applySwimWave`'s pivot-offset comment exists to protect.
- **Spots ride along.** `FishModel.tsx` rotates each spot group by `swimWaveAngle(env, u, ...)` at the spot's own `u`; add the same `+ bend * u` there.
- **Rigid head stays rigid.** Eyes (x=68), mouth hinge (x=90), pectoral hinges (x=52), and gills all sit forward of `SWIM_WAVE_ONSET_X = 45`, where `u = 0` — no bend, nothing new to handle.
- **Normals, bounding sphere, raycasting** are already recomputed per frame in `applySwimWave`; a DC offset changes nothing structurally.

Use `u` (linear), not `env`, for the bend envelope at first: `env` includes `FIN_SWIM_TIP_GAIN` (up to 3× at a Veil tip), and the codebase's own tuning history (`FIN_SWIM_TIP_GAIN`'s comment) shows tip-heavy motion reads as "whippy" fast. If a pure `u` ramp reads too stiff, a mild tip gain can be layered in later.

**Sign convention must be verified live, not derived on paper.** The chain is long: velocity-space yaw (`atan2(vx, vz)`, +Z forward) → cross-product Y sign → model-local Y rotation in `applySwimWave` (whose rotation matrix is written tail-space-handed, and the model is authored facing +X with a correction rotation in `Fish.tsx`). The correct look: the head leads into the turn and the tail _lags toward the outside_ of the arc, so the body curves concave toward the turn's inside. The manual pilot (`KeyA`/`KeyD`) gives a deterministic turn direction on demand, and the fish monitor window shows live yaw/turn-rate — a one-minute live check beats an afternoon of handedness algebra. If the curve goes the wrong way, negate one constant.

### Docs and tests

- `docs/architecture/3d-engine.md` §6.6: extend the swim-wave section (the "sharper turn → bigger S-curve" and "roll into a turn" language is the established vocabulary — describe this as the _signed_ companion to the existing unsigned turn boost).
- `swimWave.test.ts`: bend continuity at the seam, zero bend forward of onset, bend additivity with the wave. `turnRate.test.ts`: sign cases as above.

## Feasibility and cost

**Low.** This is the cheap path and it genuinely piggybacks on what exists:

- Touches three files meaningfully (`turnRate.ts`, `swimWave.ts`, `FishModel.tsx`) plus two test files and one docs section. No steering, heading, physics, or Rust changes — `SteeringSystem.tsx` and `heading.ts` stay untouched because the needed signal is derivable from `vehicle.velocity`, which `FishModel` already reads every frame.
- No new geometry or rigging. No per-frame cost beyond one multiply-add per vertex inside a loop that already does a sin/cos and a rotation per vertex.
- Purely visual: the Rapier collider, chase-catch radii, and the fish-eye pose channel all key off the `RigidBody`, which is untouched.

## Unknowns and risks (real ones, not covered above)

- **Piloted turn-in-place gets no bend.** A fish turning in place under `KeyA`/`KeyD` has near-zero velocity, so the velocity-derived signed turn rate is gated to zero — the driven yaw advances but the body won't curve. Acceptable for v1 (the same gate already zeroes the _existing_ turn-amplitude boost there); fixing it properly means the `currentHeading`-delta signal source from step 1's alternative.
- **Combined-angle overshoot.** At max bend plus excited amplitude plus Veil tip gain, the summed per-vertex angle at the tip could over-rotate (self-intersection or a >90° tail). The cap in step 2 should be chosen against the _worst-case sum_, checked by eye with a Veil-tailed fish in a chase.
- **Interaction with the existing turn-amplitude boost.** A turn will now both widen the wag _and_ curve the spine; the widening constants (`TURN_RATE_AMPLITUDE_SCALE`) were tuned without a bend present and may want reducing once the bend carries the "I'm turning" read. Budget a live tuning pass, not just constant-picking.
- **Bend axis vs. pitch.** The bend rotates about model-local Y while the `RigidBody` may be pitched up to ~25° (`MAX_PITCH`); the curve plane tilts with the fish. Almost certainly fine (the swim wave has the same property and nobody notices), flagged only because no one has looked.

## Alternatives considered and not recommended

- **Yaw-history "follow-the-leader" spine** (ring buffer of the head's recent yaw; each vertex takes the heading from `t − k·u`, so the body literally traces the path the head swam — trailing-segment lag, the technique snakes/eels use in games). More faithful, handles S-shaped recovery naturally, and would subsume the DC bend. Rejected for v1: per-fish mutable history state, a resampling scheme, and a rest/teleport flush policy, for a payoff mostly visible in sustained tight turns the steering rarely produces. Reasonable v2 if the DC bend reads too "posed"; it drops into the same `applySwimWave` angle slot.
- **A segmented/bone-chain rig.** There is deliberately no skeleton (§6.2/§6.6 — the SVG-extrusion pipeline replaced the rigged-GLTF plan); introducing one would be a second deformation mechanism alongside the swim wave, the exact thing `swimWave.ts`'s header warns against, and a far bigger change than the problem warrants.
- **Bending at the heading/scene-graph layer** (e.g. splitting the model into nested groups counter-rotated during slerp). Fights the architecture: the `RigidBody` owns the world transform and must stay rigid for physics; group-level counter-rotation would reintroduce the per-piece hinges the unified wave was built to eliminate, and the body/tail seam would reopen.
