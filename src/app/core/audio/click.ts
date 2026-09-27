/** A short woodblock-like click: a decaying sine, higher and louder on the accented beat. */
export function addClick(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  time: number,
  accent: boolean,
): void {
  const start = Math.round(time * sampleRate);
  const frequency = accent ? 1760 : 1320;
  const gain = accent ? 0.5 : 0.35;
  const length = Math.round(0.06 * sampleRate);
  for (let i = 0; i < length; i++) {
    const at = start + i;
    if (at < 0 || at >= left.length) continue;
    const t = i / sampleRate;
    const v = gain * Math.exp(-t * 60) * Math.sin(2 * Math.PI * frequency * t);
    left[at] += v;
    right[at] += v;
  }
}
