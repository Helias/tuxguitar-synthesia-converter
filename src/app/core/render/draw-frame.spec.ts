import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { GlobalFonts, createCanvas, loadImage } from '@napi-rs/canvas';
import { fixture, hasFixture } from '../testing/fixtures';
import { importFile } from '../import';
import { DEFAULT_OPTIONS } from '../scene/options';
import { buildScene } from '../scene/scene';
import { Ctx2D, drawFrame } from './draw-frame';

const SNAPSHOT = 'test/snapshots/frame-1080p.png';
const FONTS = 'node_modules/@fontsource/noto-sans/files';
GlobalFonts.registerFromPath(`${FONTS}/noto-sans-latin-400-normal.woff2`, 'Noto Sans');
GlobalFonts.registerFromPath(`${FONTS}/noto-sans-latin-700-normal.woff2`, 'Noto Sans');

const SONG = 'non-ti-riconosco-piu.tg';
const available = hasFixture(SONG);
const song = available ? importFile(fixture(SONG), 'x.tg') : (null as never);
const scene = available
  ? buildScene(
      song,
      song.tracks.map((t) => ({
        role: t.index === 0 ? 'right' : t.index === 1 ? 'left' : 'backing',
        splitKey: 60,
        volume: 1,
      })),
      { ...DEFAULT_OPTIONS, countIn: true },
    )
  : (null as never);

function render(t: number, width = 1920, height = 1080) {
  const canvas = createCanvas(width, height);
  drawFrame(canvas.getContext('2d') as unknown as Ctx2D, t, scene, width, height);
  return canvas;
}

describe.skipIf(!available)('drawFrame', () => {
  it('matches the reference frame', async () => {
    const actual = render(scene.songOffset + 12.3);
    if (!existsSync(SNAPSHOT) || process.env['UPDATE_SNAPSHOTS']) {
      mkdirSync('test/snapshots', { recursive: true });
      writeFileSync(SNAPSHOT, await actual.encode('png'));
    }
    const reference = createCanvas(1920, 1080);
    reference.getContext('2d').drawImage(await loadImage(SNAPSHOT), 0, 0);
    const a = actual.getContext('2d').getImageData(0, 0, 1920, 1080).data;
    const b = reference.getContext('2d').getImageData(0, 0, 1920, 1080).data;
    let different = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(
        Math.abs(a[i] - b[i]),
        Math.abs(a[i + 1] - b[i + 1]),
        Math.abs(a[i + 2] - b[i + 2]),
      );
      if (d > 40) different++;
    }
    // Tolerates anti-aliasing and font rasterisation differences between machines.
    expect(different / (1920 * 1080)).toBeLessThan(0.005);
  });

  it('is deterministic and resolution independent', async () => {
    const t = scene.songOffset + 30;
    const one = render(t).getContext('2d').getImageData(0, 0, 1920, 1080).data;
    const two = render(t).getContext('2d').getImageData(0, 0, 1920, 1080).data;
    expect(Buffer.from(one).equals(Buffer.from(two))).toBe(true);
    expect(() => render(t, 1280, 720)).not.toThrow();
  });

  it('draws the title card and count-in before the song', async () => {
    const intro = render(scene.countIn[0] + 0.05);
    writeFileSync('test/snapshots/.intro-latest.png', await intro.encode('png'));
    // The big count-in digit, in the right-hand colour, sits in the middle of the note area.
    const box = intro.getContext('2d').getImageData(880, 500, 160, 150).data;
    let blue = 0;
    for (let i = 0; i < box.length; i += 4) if (box[i + 2] > 180 && box[i] < 120) blue++;
    expect(blue).toBeGreaterThan(1500);
  });
});
