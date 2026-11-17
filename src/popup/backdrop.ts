/**
 * A slow, warm, flowing background for the popup header. It is one small WebGL shader, drawn at
 * 40% resolution, capped at 20 frames per second, and paused when the popup is hidden.
 * Idea from the flowing-silk style of Radiant (MIT licence, radiant-shaders.com). The code is new.
 */

const VERTEX = `attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAGMENT = `precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_bg;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 p = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0) * 1.8;
  float t = u_time * 0.016;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - vec2(t, 0.0)));
  vec2 r = vec2(fbm(p + 1.6 * q + vec2(1.7, 9.2) + 0.5 * t), fbm(p + 1.6 * q + vec2(8.3, 2.8) - 0.4 * t));
  float f = fbm(p + 1.4 * r);
  vec3 col = mix(u_c1, u_c2, smoothstep(0.25, 0.85, f));
  col = mix(col, u_c3, smoothstep(0.45, 1.0, length(r)) * 0.4);
  col = mix(u_bg, col, 0.6 + 0.25 * f);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Light: washi cream with a soft vermilion and gold flow. Dark: sumi ink with deep red and gold. */
const PALETTE = {
  light: { bg: [0.984, 0.965, 0.918], c1: [0.937, 0.894, 0.812], c2: [0.93, 0.82, 0.73], c3: [0.91, 0.77, 0.52] },
  dark: { bg: [0.106, 0.078, 0.051], c1: [0.165, 0.122, 0.082], c2: [0.26, 0.17, 0.13], c3: [0.33, 0.24, 0.13] },
} as const;

export interface Backdrop {
  setDark(dark: boolean): void;
  setAnimated(animated: boolean): void;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

/** Returns null when WebGL is not available. The header then simply has no animation. */
export function createBackdrop(canvas: HTMLCanvasElement): Backdrop | null {
  const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const u = {
    res: gl.getUniformLocation(program, "u_res"),
    time: gl.getUniformLocation(program, "u_time"),
    bg: gl.getUniformLocation(program, "u_bg"),
    c1: gl.getUniformLocation(program, "u_c1"),
    c2: gl.getUniformLocation(program, "u_c2"),
    c3: gl.getUniformLocation(program, "u_c3"),
  };

  const startedAt = performance.now();
  let dark = false;
  let animated = true;
  let frame = 0;
  let lastDraw = 0;

  const draw = (now: number): void => {
    const width = Math.max(1, Math.round(canvas.clientWidth * 0.4));
    const height = Math.max(1, Math.round(canvas.clientHeight * 0.4));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    const colors = dark ? PALETTE.dark : PALETTE.light;
    gl.uniform2f(u.res, width, height);
    gl.uniform1f(u.time, (now - startedAt) / 1000);
    gl.uniform3fv(u.bg, colors.bg);
    gl.uniform3fv(u.c1, colors.c1);
    gl.uniform3fv(u.c2, colors.c2);
    gl.uniform3fv(u.c3, colors.c3);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const loop = (now: number): void => {
    frame = 0;
    if (!animated || document.hidden) return;
    if (now - lastDraw >= 1000 / 20) {
      lastDraw = now;
      draw(now);
    }
    frame = requestAnimationFrame(loop);
  };
  const ensureRunning = (): void => {
    if (animated && !frame && !document.hidden) frame = requestAnimationFrame(loop);
  };

  document.addEventListener("visibilitychange", ensureRunning);
  window.addEventListener("resize", () => draw(performance.now()));
  draw(performance.now());
  ensureRunning();

  return {
    setDark(value) {
      dark = value;
      draw(performance.now());
    },
    setAnimated(value) {
      animated = value;
      if (value) {
        ensureRunning();
      } else {
        cancelAnimationFrame(frame);
        frame = 0;
        draw(performance.now());
      }
    },
  };
}
