// Tests for the foot shader's own injection contract — run against three's
// real `meshphysical`/`depth` vertex sources, so a chunk name that three
// renames out from under us fails here rather than silently leaving a snail's
// foot rigid.
//
// The properties that matter are structural, and none of them is visible from
// the uniform values alone: both displacements have to land ahead of
// `#include <skinning_vertex>` (a `SkinnedMesh` deforms its bind pose, never
// its skinned result), the visible material and its depth twin have to displace
// positions identically (#100's bug class — a shadow of a shape the snail isn't
// in), and the two have to share the very same uniform boxes so one per-frame
// write reaches both.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { footDeformation } from './footDeformation';
import {
  attachFootRippleDepthMaterial,
  attachFootRippleVertexShader,
  setFootRippleUniforms,
  type FootRippleFrameUniforms,
  type FootRippleShaderParams,
} from './footRippleShader';

const PARAMS: FootRippleShaderParams = {
  soleY: -70,
  envelopeHeight: 14,
  wavelength: 60,
  stretchAnchorX: 96,
};

interface FakeShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

function compile(material: THREE.Material, source: string): FakeShader {
  const shader: FakeShader = { uniforms: {}, vertexShader: source, fragmentShader: '' };
  const hook = material.onBeforeCompile as unknown as (s: FakeShader) => void;
  hook(shader);
  return shader;
}

function attachBoth(): {
  uniforms: FootRippleFrameUniforms;
  visible: FakeShader;
  depth: FakeShader;
} {
  const material = new THREE.MeshStandardMaterial();
  const uniforms = attachFootRippleVertexShader(material, PARAMS);
  const depthMaterial = attachFootRippleDepthMaterial(PARAMS, uniforms);
  return {
    uniforms,
    visible: compile(material, THREE.ShaderLib.physical!.vertexShader),
    depth: compile(depthMaterial, THREE.ShaderLib.depth!.vertexShader),
  };
}

/** The girth/length statements, exactly as `DEFORM_POSITION_GLSL` writes
 * them — a rename there should fail here loudly, not quietly stop deforming. */
const DEFORM_STATEMENTS = [
  'transformed.x = FOOT_STRETCH_ANCHOR_X + (transformed.x - FOOT_STRETCH_ANCHOR_X) * uFootLength;',
  'transformed.y = RIPPLE_SOLE_Y + (transformed.y - RIPPLE_SOLE_Y) * uFootGirth;',
  'transformed.z *= uFootGirth;',
];

describe('the foot shader', () => {
  it('declares both deformation uniforms in each material', () => {
    const { visible, depth } = attachBoth();
    for (const source of [visible.vertexShader, depth.vertexShader]) {
      expect(source).toContain('uniform float uFootGirth;');
      expect(source).toContain('uniform float uFootLength;');
      expect(source).toContain(`const float FOOT_STRETCH_ANCHOR_X = ${PARAMS.stretchAnchorX}.0;`);
    }
  });

  it('deforms the bind pose, not the skinned result', () => {
    const { visible, depth } = attachBoth();
    for (const source of [visible.vertexShader, depth.vertexShader]) {
      const skinning = source.indexOf('#include <skinning_vertex>');
      expect(skinning).toBeGreaterThan(-1);
      for (const statement of DEFORM_STATEMENTS) {
        const at = source.indexOf(statement);
        expect(at).toBeGreaterThan(source.indexOf('#include <begin_vertex>'));
        expect(at).toBeLessThan(skinning);
      }
    }
  });

  it('applies the girth/length scale after the ripple, not before it', () => {
    const { visible } = attachBoth();
    expect(visible.vertexShader.indexOf('transformed.y += rippleDisp;')).toBeLessThan(
      visible.vertexShader.indexOf(DEFORM_STATEMENTS[1]!),
    );
  });

  it('displaces positions identically in the visible and depth materials', () => {
    const { visible, depth } = attachBoth();
    // Every position statement, in order, must match between the two — the
    // shadow renders the same shape the snail does or it renders a lie.
    const positionStatements = (source: string) =>
      source
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('transformed.'));
    expect(positionStatements(depth.vertexShader)).toEqual(
      positionStatements(visible.vertexShader),
    );
  });

  it('corrects the normal for the deformation in the visible material only', () => {
    const { visible, depth } = attachBoth();
    expect(visible.vertexShader).toContain('objectNormal.y / uFootGirth');
    expect(visible.vertexShader.indexOf('objectNormal.y / uFootGirth')).toBeLessThan(
      visible.vertexShader.indexOf('#include <begin_vertex>'),
    );
    expect(depth.vertexShader).not.toContain('objectNormal.y / uFootGirth');
  });

  it('shares one set of uniform boxes across both materials', () => {
    const { uniforms, visible, depth } = attachBoth();
    for (const name of ['uFootGirth', 'uFootLength'] as const) {
      expect(visible.uniforms[name]).toBe(uniforms[name]);
      expect(depth.uniforms[name]).toBe(uniforms[name]);
    }

    setFootRippleUniforms(uniforms, 1.5, 6, footDeformation(1, 0));
    expect(visible.uniforms.uFootGirth!.value).toBeCloseTo(0.15, 10);
    expect(depth.uniforms.uFootGirth!.value).toBeCloseTo(0.15, 10);
  });

  it('starts at the rest pose so an unanimated foot renders undeformed', () => {
    const material = new THREE.MeshStandardMaterial();
    const uniforms = attachFootRippleVertexShader(material, PARAMS);
    expect(uniforms.uFootGirth.value).toBe(1);
    expect(uniforms.uFootLength.value).toBe(1);
  });

  it('writes the current frame deformation through', () => {
    const material = new THREE.MeshStandardMaterial();
    const uniforms = attachFootRippleVertexShader(material, PARAMS);
    setFootRippleUniforms(uniforms, 2, 5, footDeformation(0, 0.25));
    expect(uniforms.uRipplePhase.value).toBe(2);
    expect(uniforms.uRippleAmplitude.value).toBe(5);
    expect(uniforms.uFootLength.value).toBeCloseTo(1.25, 10);
    expect(uniforms.uFootGirth.value).toBeCloseTo(1 / 1.25, 10);
  });

  it('keys each distinct anchor to its own compiled program', () => {
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    attachFootRippleVertexShader(a, PARAMS);
    attachFootRippleVertexShader(b, { ...PARAMS, stretchAnchorX: 0 });
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
  });
});
