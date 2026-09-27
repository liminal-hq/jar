// The crawl gait's "accordion" perturbation of where along its own spine a
// snail samples each foot bone — the compression wave that makes the body
// visibly bunch and spread as a pedal wave passes through it, rather than
// merely pulsing in speed.
//
// Split out of `Snail.tsx` because the interesting parts are arithmetic
// invariants rather than component wiring, and both are load-bearing on
// something a controller can't assert about itself:
//
//   - the perturbation must never *reorder* two bones. `Snail.tsx`'s
//     `computeBoneFrames` sorts the offsets it is handed and derives each
//     sample's `forward` from a central difference of its neighbours in that
//     sorted run, so a wave steep enough to swap two bones would have them
//     read each other's tangents.
//   - the spine must hold enough recorded trail to answer the *deepest*
//     offset the wave can ask for, not just the body's own length —
//     `sampleSpine` clamps a query past its oldest crumb, so a spine sized to
//     the body alone silently pins the tail-most bone in place for part of
//     every cycle.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

/** Accordion amplitude, as a multiple of the spine's own crumb spacing —
 * never asking `sampleSpine` for finer detail than the trail actually
 * records, and scaling with the body rather than being a fixed world-unit
 * magic number (the same reasoning behind `Snail.tsx`'s
 * `CRUMB_SAMPLES_PER_BODY`). Tune by eye, but see
 * `accordionKeepsBonesOrdered` before raising it: past
 * `1 / (2π × ACCORDION_WAVELENGTH_BODY_FRACTION × CRUMB_SAMPLES_PER_BODY /
 * bodyLength)` the wave starts reordering bones. */
export const ACCORDION_AMPLITUDE_CRUMB_MULTIPLE = 1.5;

/** Wavelength as a fraction of the body's own length — half a body per cycle
 * reads as one clear compression travelling through, not a busy ripple. */
export const ACCORDION_WAVELENGTH_BODY_FRACTION = 0.5;

/** The accordion wave's amplitude in world units, for a spine of this crumb
 * spacing. */
export function accordionAmplitude(crumbSpacing: number): number {
  return crumbSpacing * ACCORDION_AMPLITUDE_CRUMB_MULTIPLE;
}

/** The accordion wave's angular wavenumber (radians per world unit along the
 * body), for a body of this length. */
export function accordionWavenumber(bodyLength: number): number {
  return (2 * Math.PI) / (bodyLength * ACCORDION_WAVELENGTH_BODY_FRACTION);
}

/** Nudges one spine-sampling offset along the body by an amount that
 * oscillates with the shared gait phase. Purely a query-time perturbation of
 * which arc length gets sampled — nothing about the body's own dimensions
 * changes. */
export function withAccordionWave(
  offset: number,
  phase: number,
  k: number,
  amplitude: number,
): number {
  return offset + amplitude * Math.sin(offset * k - phase);
}

/** Every bone's sampling offset for one frame of the gait — the single call
 * site `Snail.tsx` uses wherever it needs this frame's bone frames.
 *
 * The shell's seat gets no term of its own: it rides the bones
 * (`rootTransformFromFoot`), which carries it along with whatever compression
 * they are under. That's both simpler than a fourth sampling point and the
 * only version that can't slide the shell along a bunching foot. */
export function gaitBoneOffsets(
  boneOffsets: number[],
  phase: number,
  k: number,
  amplitude: number,
): number[] {
  return boneOffsets.map((offset) => withAccordionWave(offset, phase, k, amplitude));
}

/** Whether the wave is gentle enough that no two offsets can ever swap order,
 * for any phase — true exactly when `d/d(offset)` of `withAccordionWave` stays
 * positive, i.e. `amplitude × k < 1`. Exported so a test can pin the live
 * constants against it rather than leaving the bound as a comment nobody
 * rechecks after a retune. */
export function accordionKeepsBonesOrdered(k: number, amplitude: number): boolean {
  return amplitude * k < 1;
}

/** How much trail the spine has to hold, given a body of `bodyLength` sampled
 * through the accordion wave.
 *
 * `sampleSpine` clamps any query past its oldest recorded crumb rather than
 * throwing, which is the right contract but makes under-provisioning silent:
 * the tail-most bone simply stops responding while its perturbed offset sits
 * beyond the trail, flattening the compression wave at exactly the end where
 * it is most visible, and collapsing that bone's own central-difference
 * tangent toward its neighbour's. Sizing the spine to the deepest offset the
 * wave can ask for — the body plus one amplitude — removes the case rather
 * than tuning around it.
 *
 * This is the spine's `bodyLength`, not the body's: it's what `createSpine`
 * back-traces to seed, what `advanceSpine` trims to, and what `resizeSpine`
 * re-dimensions against. `crumbSpacing` stays derived from the *real* body
 * length, so the trail's resolution per body length is unchanged. */
export function sampledBodyLength(bodyLength: number, crumbSpacing: number): number {
  return bodyLength + accordionAmplitude(crumbSpacing);
}
