import { Hand, NOTE_NAMES, keyName } from '../scene/options';
import { Scene, lastAtOrBefore } from '../scene/scene';
import { lowerBound, upperBound } from '../sequence/tempo-map';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Logical drawing size; frames are scaled to the output resolution. */
export const WIDTH = 1920;
export const HEIGHT = 1080;
const KEYBOARD_HEIGHT = 230;
export const HIT_Y = HEIGHT - KEYBOARD_HEIGHT;
export const KEYS_TOP = HIT_Y + 11;
const BLACK_PCS = new Set([1, 3, 6, 8, 10]);

export const FONT_FAMILY = '"Noto Sans", system-ui, sans-serif';

const BG_TOP = '#12141c';
const BG_BOTTOM = '#1e212e';
const OCTAVE_LINE = '#2c3040';
const F_LINE = '#222532';
const BAR_LINE = '#34384a';
const WHITE_KEY = '#f6f6f2';
const BLACK_KEY = '#16161a';
const TEXT = '#ebebf0';
const HUD = '#bebec8';

interface KeyRect {
  x: number;
  w: number;
  black: boolean;
}

interface Layout {
  keys: Map<number, KeyRect>;
  whiteWidth: number;
  colors: Record<
    Hand,
    { white: string; black: string; whiteOutline: string; blackOutline: string; lit: string }
  >;
}

const layouts = new WeakMap<Scene, Layout>();

/**
 * Draws the frame at video time `t`. Pure apart from the context: the same inputs always give
 * the same pixels, so the live preview and the export share it.
 */
export function drawFrame(
  ctx: Ctx2D,
  t: number,
  scene: Scene,
  width: number,
  height: number,
): void {
  const layout = getLayout(scene);
  ctx.setTransform(width / WIDTH, 0, 0, height / HEIGHT, 0, 0);
  ctx.textBaseline = 'middle';

  drawBackground(ctx, layout, scene, t);
  // Under the notes, so falling notes are never hidden by the label.
  drawChord(ctx, scene, t);
  const active = drawNotes(ctx, layout, scene, t);
  drawGlows(ctx, layout, scene, active);
  drawKeyboard(ctx, layout, scene, active);
  drawHud(ctx, scene, t);
  drawIntro(ctx, scene, t);
}

/** Left edge of `key` in logical pixels, or null when the keyboard does not show it. */
export function keyX(scene: Scene, key: number): number | null {
  return getLayout(scene).keys.get(key)?.x ?? null;
}

/** The white key under logical x (the split marker snaps to white-key boundaries). */
export function whiteKeyAt(scene: Scene, x: number): number {
  let found = scene.lowKey;
  for (const [key, rect] of getLayout(scene).keys) {
    if (!rect.black && rect.x <= x) found = key;
  }
  return found;
}

function getLayout(scene: Scene): Layout {
  let layout = layouts.get(scene);
  if (!layout) {
    const whites: number[] = [];
    for (let k = scene.lowKey; k <= scene.highKey; k++) if (!BLACK_PCS.has(k % 12)) whites.push(k);
    const whiteWidth = WIDTH / whites.length;
    const blackWidth = whiteWidth * 0.6;
    const keys = new Map<number, KeyRect>();
    let xi = 0;
    for (let k = scene.lowKey; k <= scene.highKey; k++) {
      if (BLACK_PCS.has(k % 12)) {
        keys.set(k, { x: xi * whiteWidth - blackWidth / 2, w: blackWidth, black: true });
      } else {
        keys.set(k, { x: xi * whiteWidth, w: whiteWidth, black: false });
        xi++;
      }
    }
    const handColors = (hex: string) => ({
      white: hex,
      black: mix(hex, '#000000', 0.38),
      whiteOutline: mix(hex, '#ffffff', 0.35),
      blackOutline: mix(mix(hex, '#000000', 0.38), '#ffffff', 0.35),
      lit: mix(hex, '#ffffff', 0.25),
    });
    layout = {
      keys,
      whiteWidth,
      colors: { right: handColors(scene.colors.right), left: handColors(scene.colors.left) },
    };
    layouts.set(scene, layout);
  }
  return layout;
}

function drawBackground(ctx: Ctx2D, layout: Layout, scene: Scene, t: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, HIT_Y);
  gradient.addColorStop(0, BG_TOP);
  gradient.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HIT_Y);

  ctx.lineWidth = 1;
  for (const [key, rect] of layout.keys) {
    const pc = key % 12;
    if (pc !== 0 && pc !== 5) continue;
    ctx.strokeStyle = pc === 0 ? OCTAVE_LINE : F_LINE;
    line(ctx, rect.x, 0, rect.x, HIT_Y);
  }

  const lookAhead = HIT_Y / scene.fallSpeed;
  ctx.strokeStyle = BAR_LINE;
  const from = lowerBound(scene.barTimes, t);
  const to = upperBound(scene.barTimes, t + lookAhead);
  for (let i = from; i < to; i++) {
    const y = HIT_Y - (scene.barTimes[i] - t) * scene.fallSpeed;
    line(ctx, 0, y, WIDTH, y);
  }
}

/** Draws the falling notes and returns the keys sounding at `t`. */
function drawNotes(ctx: Ctx2D, layout: Layout, scene: Scene, t: number): Map<number, Hand> {
  const active = new Map<number, Hand>();
  const speed = scene.fallSpeed;
  const lookAhead = HIT_Y / speed;
  const from = lowerBound(scene.starts, t - scene.maxNoteDuration);
  const to = upperBound(scene.starts, t + lookAhead);
  const names = scene.noteNames === 'none' ? null : NOTE_NAMES[scene.noteNames];
  ctx.textAlign = 'center';

  for (let i = from; i < to; i++) {
    const note = scene.notes[i];
    if (note.end <= t) continue;
    const rect = layout.keys.get(note.key);
    if (!rect) continue;
    if (note.start <= t) active.set(note.key, note.hand);

    const pad = rect.black ? 2 : 4;
    const bottom = Math.min(HIT_Y - (note.start - t) * speed, HIT_Y);
    let top = HIT_Y - (note.end - t) * speed + 3;
    if (bottom - top < 4) top = bottom - 4;
    const colors = layout.colors[note.hand];
    roundRect(ctx, rect.x + pad, top, rect.w - 2 * pad, bottom - top, 7);
    ctx.fillStyle = rect.black ? colors.black : colors.white;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = rect.black ? colors.blackOutline : colors.whiteOutline;
    ctx.stroke();

    if (names && bottom - top > 30 && bottom > 20) {
      const size = fitFont(names[note.key % 12], rect.w - 2 * pad - 2, rect.black ? 13 : 17);
      ctx.font = `700 ${size}px ${FONT_FAMILY}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(names[note.key % 12], rect.x + rect.w / 2, bottom - 14);
    }
  }
  return active;
}

/** Largest font size ≤ `max` whose text roughly fits `width` (0.62 em per character). */
function fitFont(text: string, width: number, max: number): number {
  return Math.max(8, Math.min(max, Math.floor(width / (text.length * 0.62))));
}

function drawGlows(ctx: Ctx2D, layout: Layout, scene: Scene, active: Map<number, Hand>): void {
  const glowWidth = layout.whiteWidth * 2.4;
  const glowHeight = 70;
  for (const [key, hand] of active) {
    const rect = layout.keys.get(key)!;
    const cx = rect.x + rect.w / 2;
    ctx.save();
    ctx.translate(cx, HIT_Y);
    ctx.scale(glowWidth / 2 / glowHeight, 1);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowHeight);
    glow.addColorStop(0, withAlpha(scene.colors[hand], 0.75));
    glow.addColorStop(1, withAlpha(scene.colors[hand], 0));
    ctx.fillStyle = glow;
    ctx.fillRect(-glowHeight, -glowHeight, glowHeight * 2, glowHeight);
    ctx.restore();
  }
}

function drawKeyboard(ctx: Ctx2D, layout: Layout, scene: Scene, active: Map<number, Hand>): void {
  ctx.fillStyle = '#78141e';
  ctx.fillRect(0, HIT_Y, WIDTH, 8);
  ctx.fillStyle = '#3c0a0f';
  ctx.fillRect(0, HIT_Y + 8, WIDTH, 3);
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, KEYS_TOP, WIDTH, HEIGHT - KEYS_TOP);

  ctx.textAlign = 'center';
  ctx.font = `400 14px ${FONT_FAMILY}`;
  for (const [key, rect] of layout.keys) {
    if (rect.black) continue;
    const hand = active.get(key);
    roundRect(ctx, rect.x + 1, KEYS_TOP, rect.w - 2, HEIGHT - 2 - KEYS_TOP, 6);
    ctx.fillStyle = hand ? layout.colors[hand].lit : WHITE_KEY;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#46464b';
    ctx.stroke();
    if (key % 12 === 0) {
      ctx.fillStyle = '#8c8c96';
      ctx.fillText(keyName(key, scene.noteNames), rect.x + rect.w / 2, HEIGHT - 16);
    }
  }

  const blackHeight = (HEIGHT - KEYS_TOP) * 0.62;
  for (const [key, rect] of layout.keys) {
    if (!rect.black) continue;
    const hand = active.get(key);
    roundRect(ctx, rect.x, KEYS_TOP - 2, rect.w, blackHeight, 4);
    ctx.fillStyle = hand ? layout.colors[hand].black : BLACK_KEY;
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.stroke();
    if (!hand) {
      ctx.fillStyle = '#3c3c42';
      ctx.fillRect(rect.x + 4, KEYS_TOP - 2 + blackHeight - 14, rect.w - 8, 8);
    }
  }
}

/** The latest chord, shown until the next one or until a whole bar passes without one. */
function drawChord(ctx: Ctx2D, scene: Scene, t: number): void {
  const i = lastAtOrBefore(scene.chordTimes, t);
  if (i < 0) return;
  const chord = scene.chords[i];
  if (lastAtOrBefore(scene.barTimes, t) - lastAtOrBefore(scene.barTimes, chord.time) > 1) return;
  ctx.font = `700 44px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  const width = ctx.measureText(chord.text).width + 48;
  roundRect(ctx, WIDTH / 2 - width / 2, HIT_Y - 92, width, 64, 14);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fill();
  ctx.fillStyle = 'rgba(235, 235, 240, 0.85)';
  ctx.fillText(chord.text, WIDTH / 2, HIT_Y - 60);
}

const HAND_LABELS: Record<Hand, string> = { right: 'Right hand', left: 'Left hand' };

function drawHud(ctx: Ctx2D, scene: Scene, t: number): void {
  // Keeps the HUD readable over light falling notes.
  const shade = ctx.createLinearGradient(0, 0, 0, 140);
  shade.addColorStop(0, 'rgba(8, 9, 14, 0.7)');
  shade.addColorStop(1, 'rgba(8, 9, 14, 0)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, WIDTH, 140);

  ctx.textAlign = 'left';
  ctx.font = `700 34px ${FONT_FAMILY}`;
  ctx.fillStyle = TEXT;
  const title = scene.artist ? `${scene.artist} – ${scene.title}` : scene.title;
  ctx.fillText(title, 30, 44);

  ctx.font = `400 24px ${FONT_FAMILY}`;
  let x = 32;
  for (const hand of scene.hands) {
    roundRect(ctx, x, 80, 18, 18, 4);
    ctx.fillStyle = scene.colors[hand];
    ctx.fill();
    ctx.fillStyle = HUD;
    ctx.fillText(HAND_LABELS[hand], x + 28, 90);
    x += 60 + ctx.measureText(HAND_LABELS[hand]).width;
  }

  ctx.textAlign = 'right';
  const bar = lastAtOrBefore(scene.barTimes, t);
  if (bar >= 0) {
    ctx.fillStyle = HUD;
    ctx.fillText(`Bar ${bar + 1} / ${scene.bars.length}`, WIDTH - 30, 44);
  }
  const section = lastAtOrBefore(scene.sectionTimes, t);
  if (section >= 0) {
    const text = scene.sections[section].text;
    ctx.font = `700 22px ${FONT_FAMILY}`;
    const width = ctx.measureText(text).width + 28;
    roundRect(ctx, WIDTH - 30 - width, 72, width, 36, 18);
    ctx.fillStyle = withAlpha(scene.colors.right, 0.22);
    ctx.fill();
    ctx.fillStyle = TEXT;
    ctx.fillText(text, WIDTH - 44, 91);
  }

  ctx.fillStyle = scene.colors.right;
  ctx.fillRect(0, 0, WIDTH * Math.min(1, Math.max(0, t / scene.duration)), 4);
}

function drawIntro(ctx: Ctx2D, scene: Scene, t: number): void {
  if (t >= scene.songOffset) return;
  const fade = Math.min(1, (scene.songOffset - t) / 1);
  ctx.textAlign = 'center';
  ctx.globalAlpha = fade;
  ctx.font = `700 76px ${FONT_FAMILY}`;
  ctx.fillStyle = '#f5f5fa';
  ctx.fillText(scene.title, WIDTH / 2, HIT_Y / 2 - 60);
  if (scene.artist) {
    ctx.font = `700 34px ${FONT_FAMILY}`;
    ctx.fillStyle = '#aaaab9';
    ctx.fillText(scene.artist, WIDTH / 2, HIT_Y / 2 + 20);
  }
  ctx.globalAlpha = 1;

  const click = lastAtOrBefore(scene.countIn, t);
  if (click >= 0) {
    const beat = scene.countIn.length > 1 ? scene.countIn[1] - scene.countIn[0] : 0.5;
    const phase = Math.min(1, (t - scene.countIn[click]) / beat);
    ctx.globalAlpha = 1 - phase * 0.6;
    ctx.font = `700 ${Math.round(150 - phase * 30)}px ${FONT_FAMILY}`;
    ctx.fillStyle = scene.colors.right;
    ctx.fillText(String(scene.countIn.length - click), WIDTH / 2, HIT_Y / 2 + 150);
    ctx.globalAlpha = 1;
  }
}

function line(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

function parseHex(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function mix(a: string, b: string, f: number): string {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  const c = (x: number, y: number) =>
    Math.round(x + (y - x) * f)
      .toString(16)
      .padStart(2, '0');
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
