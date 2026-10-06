/**
 * Raised arcs on MapLibre: a custom WebGL layer that draws lines off the ground.
 *
 * MapLibre's own lines lie on the surface, so a `pathsLayer` line with an `arcHeight` drew flat here
 * while Cesium raised it. This is the layer that raises it: each arc is sampled along its great circle
 * with its height at every point (`@we/globe-core`'s `arcPositions`, the same samples Cesium draws),
 * and projected by MapLibre's own projection code, which a custom layer is handed as a shader prelude.
 * So an arc sits exactly where the globe's own drawing puts that place and height, at every zoom and
 * through the turn from globe to flat map.
 *
 * ## Why not deck.gl
 *
 * deck.gl draws arcs and overlays MapLibre, but it is several hundred kilobytes for one kind of line,
 * on the engine that exists to be light. This is a few hundred lines with no dependency.
 *
 * ## Lines with a width
 *
 * WebGL draws a line one pixel wide whatever is asked for, so each segment is two triangles, widened
 * on screen: each corner is projected with the segment's other end, and pushed sideways by half the
 * width in pixels. Segments meet without a join; an arc's segments turn so little that none shows.
 *
 * ## Behind the earth
 *
 * In the globe projection each vertex's depth is MapLibre's own horizon test, applied to the raised
 * point rather than the ground under it, so the part of an arc that has gone over the horizon is
 * clipped and a high arc stays visible a little past it, as it would.
 *
 * ## Pressing one
 *
 * There is no `queryRenderedFeatures` for a custom layer, so a press is answered by drawing the arcs
 * once more into a texture off screen, each in a colour that is its number, slightly wider than shown,
 * and reading the pixel under the pointer.
 */
import type { LonLatHeight, Rgba } from '@we/globe-core';
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';

export interface Arc {
  id: string;
  /** Longitude, latitude and metres above the ground, along the arc. */
  positions: readonly LonLatHeight[];
  color: Rgba;
  /** Pixels. */
  width: number;
}

/** How much wider than drawn an arc is to the pointer, in pixels: a 2-pixel line is hard to hit. */
const PICK_SLOP = 6;

const VERTEX = (prelude: string, define: string) => `#version 300 es
${prelude}
${define}
in vec2 a_pos;
in float a_height;
in vec2 a_other;
in float a_other_height;
in float a_side;
in float a_dir;
in vec4 a_color;
in float a_width;
uniform vec2 u_viewport;
uniform float u_slop;
out vec4 v_color;

vec4 place(vec2 position, float height) {
#ifdef GLOBE
  return projectTileWithElevation(position, height);
#else
  // Flat, past the turn from globe to map: the arc lies on the ground there.
  return projectTile(position);
#endif
}

void main() {
  vec4 here = place(a_pos, a_height);
  vec4 there = place(a_other, a_other_height);
  vec2 a = here.xy / here.w * u_viewport;
  vec2 b = there.xy / there.w * u_viewport;
  vec2 along = (b - a) * a_dir;
  float size = max(length(along), 1e-6);
  vec2 normal = vec2(-along.y, along.x) / size;
  float width = a_width + u_slop;
  vec2 offset = normal * a_side * width / u_viewport;
  gl_Position = here + vec4(offset * here.w, 0.0, 0.0);
  v_color = a_color;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 fragColor;
void main() {
  fragColor = v_color;
}`;

/** The projection uniforms MapLibre's prelude reads, and the field of its projection data each is. */
const PROJECTION_UNIFORMS = [
  ['u_projection_matrix', 'mainMatrix'],
  ['u_projection_fallback_matrix', 'fallbackMatrix'],
  ['u_projection_tile_mercator_coords', 'tileMercatorCoords'],
  ['u_projection_clipping_plane', 'clippingPlane'],
  ['u_projection_transition', 'projectionTransition'],
] as const;

/** Floats per vertex: position 2, height 1, other end 2, its height 1, side 1, direction 1, colour 4, width 1. */
const STRIDE = 13;

function mercator([lon, lat]: readonly [number, number, ...number[]]): [number, number] {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
}

function compile(gl: WebGL2RenderingContext, prelude: string, define: string): WebGLProgram | null {
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[globe] The arc shader did not compile:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vertex = shader(gl.VERTEX_SHADER, VERTEX(prelude, define));
  const fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[globe] The arc shader did not link:', gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

export class ArcLayer implements CustomLayerInterface {
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;
  private map?: MapLibreMap;
  private gl?: WebGL2RenderingContext;
  /** One program per projection variant MapLibre asks for. */
  private readonly programs = new Map<string, WebGLProgram | null>();
  private vertices?: WebGLBuffer;
  private pickVertices?: WebGLBuffer;
  private indices?: WebGLBuffer;
  private count = 0;
  private arcs: readonly Arc[] = [];
  private dirty = true;
  private pickTarget?: { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number };
  private picks: { x: number; y: number; resolve: (id: string | null) => void }[] = [];

  constructor(readonly id: string) {}

  /** Replace what is drawn. */
  set(arcs: readonly Arc[]): void {
    this.arcs = arcs;
    this.dirty = true;
    this.map?.triggerRepaint();
  }

  /** The arc under a point on the map's canvas, in CSS pixels, or null. Answered on the next frame. */
  pick(x: number, y: number): Promise<string | null> {
    if (!this.map || !this.arcs.length) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.picks.push({ x, y, resolve });
      this.map!.triggerRepaint();
    });
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.gl = gl;
    this.vertices = gl.createBuffer()!;
    this.pickVertices = gl.createBuffer()!;
    this.indices = gl.createBuffer()!;
    this.dirty = true;
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
    for (const program of this.programs.values()) if (program) gl.deleteProgram(program);
    this.programs.clear();
    if (this.vertices) gl.deleteBuffer(this.vertices);
    if (this.pickVertices) gl.deleteBuffer(this.pickVertices);
    if (this.indices) gl.deleteBuffer(this.indices);
    if (this.pickTarget) {
      gl.deleteFramebuffer(this.pickTarget.framebuffer);
      gl.deleteTexture(this.pickTarget.texture);
    }
    for (const pick of this.picks.splice(0)) pick.resolve(null);
    this.map = undefined;
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (this.dirty) this.upload(gl);
    if (!this.count) {
      for (const pick of this.picks.splice(0)) pick.resolve(null);
      return;
    }
    const program = this.program(gl, options);
    if (!program) return;
    const viewport = [gl.drawingBufferWidth, gl.drawingBufferHeight];

    if (this.picks.length) this.renderPicks(gl, program, options, viewport);

    gl.useProgram(program);
    this.bindProjection(gl, program, options);
    gl.uniform2f(gl.getUniformLocation(program, 'u_viewport'), viewport[0], viewport[1]);
    gl.uniform1f(gl.getUniformLocation(program, 'u_slop'), 0);
    this.bindAttributes(gl, program, this.vertices!);
    gl.enable(gl.BLEND);
    // MapLibre blends premultiplied colours, and the colours uploaded are premultiplied to match.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private program(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): WebGLProgram | null {
    const { variantName, vertexShaderPrelude, define } = options.shaderData;
    if (!this.programs.has(variantName)) this.programs.set(variantName, compile(gl, vertexShaderPrelude, define));
    return this.programs.get(variantName) ?? null;
  }

  private bindProjection(gl: WebGL2RenderingContext, program: WebGLProgram, options: CustomRenderMethodInput): void {
    const data = options.defaultProjectionData as unknown as Record<string, ArrayLike<number> | number>;
    for (const [uniform, field] of PROJECTION_UNIFORMS) {
      const location = gl.getUniformLocation(program, uniform);
      const value = data[field];
      if (!location || value === undefined) continue;
      // The matrices may be double precision, which WebGL will not take.
      if (typeof value === 'number') gl.uniform1f(location, value);
      else if (value.length === 16) gl.uniformMatrix4fv(location, false, Float32Array.from(value));
      else gl.uniform4f(location, value[0], value[1], value[2], value[3]);
    }
  }

  private bindAttributes(gl: WebGL2RenderingContext, program: WebGLProgram, buffer: WebGLBuffer): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices!);
    const attribute = (name: string, size: number, offset: number) => {
      const location = gl.getAttribLocation(program, name);
      if (location < 0) return;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
    };
    attribute('a_pos', 2, 0);
    attribute('a_height', 1, 2);
    attribute('a_other', 2, 3);
    attribute('a_other_height', 1, 5);
    attribute('a_side', 1, 6);
    attribute('a_dir', 1, 7);
    attribute('a_color', 4, 8);
    attribute('a_width', 1, 12);
  }

  /** The arcs as triangles: four corners and two triangles a segment. A second copy carries ids. */
  private upload(gl: WebGL2RenderingContext): void {
    this.dirty = false;
    const ratio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const shown: number[] = [];
    const picked: number[] = [];
    const indices: number[] = [];
    let base = 0;
    this.arcs.forEach((arc, number) => {
      // Longitudes made continuous, so a segment across the antimeridian is short, not round the world.
      let shift = 0;
      const points = arc.positions.map(([lon, lat, height], index) => {
        if (index > 0) {
          const previous = arc.positions[index - 1][0];
          if (lon - previous > 180) shift -= 360;
          else if (previous - lon > 180) shift += 360;
        }
        const [x, y] = mercator([lon + shift, lat]);
        return [x, y, height] as const;
      });
      const [r, g, b, a] = arc.color;
      const colour = [r * a, g * a, b * a, a];
      // The arc's number as a colour, one byte a channel, offset by one so nothing is zero.
      const code = number + 1;
      const id = [(code & 255) / 255, ((code >> 8) & 255) / 255, ((code >> 16) & 255) / 255, 1];
      const width = arc.width * ratio;
      for (let i = 0; i + 1 < points.length; i++) {
        const here = points[i];
        const next = points[i + 1];
        for (const [point, other, dir] of [
          [here, next, 1],
          [next, here, -1],
        ] as const) {
          for (const side of [-1, 1]) {
            const head = [point[0], point[1], point[2], other[0], other[1], other[2], side, dir];
            shown.push(...head, ...colour, width);
            picked.push(...head, ...id, width);
          }
        }
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        base += 4;
      }
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertices!);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(shown), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pickVertices!);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(picked), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices!);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.DYNAMIC_DRAW);
    this.count = indices.length;
  }

  /** Answers every waiting press: the arcs drawn by number off screen, and the pixel under each read. */
  private renderPicks(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    options: CustomRenderMethodInput,
    viewport: number[],
  ): void {
    const [width, height] = viewport;
    if (!this.pickTarget || this.pickTarget.width !== width || this.pickTarget.height !== height) {
      if (this.pickTarget) {
        gl.deleteFramebuffer(this.pickTarget.framebuffer);
        gl.deleteTexture(this.pickTarget.texture);
      }
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      this.pickTarget = { framebuffer, texture, width, height };
    }
    const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickTarget.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    this.bindProjection(gl, program, options);
    gl.uniform2f(gl.getUniformLocation(program, 'u_viewport'), width, height);
    const ratio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    gl.uniform1f(gl.getUniformLocation(program, 'u_slop'), PICK_SLOP * ratio);
    this.bindAttributes(gl, program, this.pickVertices!);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    const pixel = new Uint8Array(4);
    for (const { x, y, resolve } of this.picks.splice(0)) {
      gl.readPixels(Math.round(x * ratio), Math.round(height - y * ratio), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const code = pixel[0] + (pixel[1] << 8) + (pixel[2] << 16);
      resolve(pixel[3] && code > 0 ? (this.arcs[code - 1]?.id ?? null) : null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
    gl.viewport(0, 0, width, height);
  }
}
