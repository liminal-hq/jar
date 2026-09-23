// The tank's "light" drawer control, given a real fixture: a hood-mounted
// LED strip along the tank's top interior — matching §8.1's own "surface
// highlight / soft light-shaft effect... toggled by the light boolean",
// but as a real fish-tank fixture rather than a bare additive plane, and
// as a genuine light source (`rectAreaLight`, the physically-correct
// primitive for a rectangular light-emitting strip) rather than a purely
// cosmetic sprite. `RectAreaLightUniformsLib.init()` is required once for
// `rectAreaLight` to render at all — three.js ships it as an opt-in
// addon, unlike every other light type — so it runs at module load here,
// the same "do it once, not per-mount" rationale `svgExtrude.ts`'s shared
// `svgLoader` already follows.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

import type { LightColour } from '../../domain/protocol/generated/LightColour';
import { TANK_INNER_BOUNDS, TANK_WIDTH } from '../physics/coordinates';

RectAreaLightUniformsLib.init();

const HOUSING_COLOUR = '#3a3d42';

const STRIP_Y = TANK_INNER_BOUNDS.y - 0.05;
const STRIP_WIDTH = TANK_WIDTH * 0.85;
const HOUSING_HEIGHT = 0.08;

/** One entry per `LightColour` — real aquarium LED fixtures ship variants
 * named just like these (crisp daylight/warm white as the everyday pair,
 * moonlight blue and reef purple as popular night/marine looks, a
 * planted-tank green, a sunset amber), plus `Party`'s own just-for-fun RGB
 * cycle. `ground` tints the tank's ambient floor of the `hemisphereLight`
 * wash to match the mood (a cold night-blue floor for Moonlight, a deep
 * violet for Reef) rather than leaving every preset sitting on the same
 * sandy bounce colour. `Party`'s own `light`/`ground` here are only the
 * pre-animation paint — `useFrame` below overrides them continuously once
 * mounted, the same "declarative first paint, imperative per-frame after"
 * split `FishModel.tsx`'s tail bend already uses. Deliberately distinct
 * from every other preset's `light` value: two presets sharing a colour
 * string would mean switching between them (with `Party`'s own per-frame
 * mutation in between) leaves the old imperative colour stuck, since R3F
 * only re-applies a colour prop when its string actually changes between
 * renders. */
const LIGHT_COLOUR_PRESETS: Record<LightColour, { light: string; ground: string }> = {
  Daylight: { light: '#eaf6ff', ground: '#8a7860' },
  Warm: { light: '#ffd8a3', ground: '#8a7860' },
  Moonlight: { light: '#6f8fef', ground: '#25304a' },
  Reef: { light: '#b46dff', ground: '#3a2450' },
  Jungle: { light: '#7be08f', ground: '#33502c' },
  Sunset: { light: '#ff8c52', ground: '#5c2f22' },
  Party: { light: '#ffffff', ground: '#3a3d42' },
};

/** One full hue rotation every 20s — fast enough to read as "party lights",
 * slow enough not to be seizure-inducing or distracting from the fish
 * themselves. */
const PARTY_HUE_CYCLES_PER_SEC = 1 / 20;

/** Visible only while `lightOn` — same gate `AquariumEnvironment.tsx`
 * already applies to the surface-highlight plane this fixture sits
 * alongside. The actual LEDs live inside a real fixture body, not bare —
 * a bright strip of exposed bulbs would read as blinding rather than as
 * tank lighting. Only a soft, evenly-glowing diffuser panel on the
 * housing's underside shows, the same "frosted cover" a real aquarium
 * hood light has; the `rectAreaLight` doing the actual illumination is
 * mounted flush with that panel, facing straight down (`rotation-x
 * -π/2`, a rect area light's own emitting face is its local +z), so it
 * genuinely lights the castle/fish below rather than just the water
 * surface. */
export function LedLightStrip({ colour }: { colour: LightColour }) {
  const preset = LIGHT_COLOUR_PRESETS[colour];
  const diffuserRef = useRef<THREE.MeshStandardMaterial>(null);
  const rectLightRef = useRef<THREE.RectAreaLight>(null);

  useFrame((state) => {
    if (colour !== 'Party') return;
    const hue = (state.clock.elapsedTime * PARTY_HUE_CYCLES_PER_SEC) % 1;
    const cycled = new THREE.Color().setHSL(hue, 0.75, 0.6);
    diffuserRef.current?.color.copy(cycled);
    diffuserRef.current?.emissive.copy(cycled);
    rectLightRef.current?.color.copy(cycled);
  });

  return (
    <group position={[0, STRIP_Y, 0]}>
      {/* Opaque housing — the LEDs sit sealed inside this, never exposed. */}
      <mesh raycast={() => null}>
        <boxGeometry args={[STRIP_WIDTH, HOUSING_HEIGHT, 0.14]} />
        <meshStandardMaterial color={HOUSING_COLOUR} roughness={0.5} metalness={0.3} />
      </mesh>
      {/* Diffuser: the only part that actually reads as lit, an even glow
          rather than individual bulbs — mounted flush with the housing's
          underside. */}
      <mesh position={[0, -HOUSING_HEIGHT / 2 - 0.002, 0]} raycast={() => null}>
        <boxGeometry args={[STRIP_WIDTH * 0.94, 0.01, 0.11]} />
        <meshStandardMaterial
          ref={diffuserRef}
          color={preset.light}
          emissive={preset.light}
          emissiveIntensity={0.8}
          roughness={0.4}
        />
      </mesh>
      {/* Subtle, not a spotlight blast — a real area light only lights
          surfaces that face it, so at any real intensity it reads as a
          harsh top-only highlight that blows out whatever passes under it
          (a first pass at intensity 24 did exactly that, caught live).
          Water scatters light in every direction a bare area light
          doesn't model; `hemisphereLight` below stands in for that
          scatter — a soft, non-directional wash that's what actually
          reads as "aquarium glow" rather than a stage light. */}
      <rectAreaLight
        ref={rectLightRef}
        position={[0, -HOUSING_HEIGHT / 2 - 0.01, 0]}
        width={STRIP_WIDTH * 0.94}
        height={0.11}
        color={preset.light}
        intensity={4}
        rotation={[-Math.PI / 2, 0, 0]}
      />
      <hemisphereLight color={preset.light} groundColor={preset.ground} intensity={0.5} />
    </group>
  );
}
