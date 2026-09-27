/**
 * Downloads real animal (and laugh) recordings from Wikimedia Commons, trims
 * the best part and writes them to assets/sounds/ as 16-bit mono WAV.
 *
 *   npm run fetch:sounds          (needs ffmpeg on PATH)
 *
 * Robot and beep are not animals, so they stay synthesized
 * (scripts/generate-sounds.mjs). Licences and authors are listed in
 * assets/sounds/CREDITS.md — keep that file with the sounds.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');
const SAMPLE_RATE = 22050;
const USER_AGENT = 'robo-car-sound-fetcher/1.0 (hobby project; https://commons.wikimedia.org)';

/** start/end are seconds inside the original recording (picked by loudness analysis). */
const CLIPS = [
  { id: 'cow', url: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Single_Cow_Moo.ogg', start: 0.85, end: 2.75 },
  { id: 'dog', url: 'https://upload.wikimedia.org/wikipedia/commons/5/58/Barking_of_a_dog_2.ogg', start: 0.0, end: 1.95 },
  { id: 'cat', url: 'https://upload.wikimedia.org/wikipedia/commons/6/6b/Meow_of_a_pleading_cat.oga', start: 3.5, end: 4.9 },
  { id: 'lion', url: 'https://upload.wikimedia.org/wikipedia/commons/7/7d/Lion_raring-sound1TamilNadu178.ogg', start: 0.35, end: 2.35 },
  { id: 'laugh', url: 'https://upload.wikimedia.org/wikipedia/commons/c/c6/Laughter.ogg', start: 2.75, end: 4.8 },
];

async function download(url, path) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (response.ok) {
        writeFileSync(path, Buffer.from(await response.arrayBuffer()));
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error; // flaky network / connect timeout
    }
    // Commons rate-limits bursts (HTTP 429); wait and retry.
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
  throw new Error(`download failed: ${url} (${lastError?.message ?? 'unknown error'})`);
}

function convert(input, output, { start, end }) {
  const length = end - start;
  const filters = [
    'highpass=f=80', // rumble / handling noise
    'afade=t=in:d=0.03',
    `afade=t=out:st=${(length - 0.15).toFixed(2)}:d=0.15`,
    'dynaudnorm=f=150:g=5:p=0.89', // even out loudness between clips
  ].join(',');
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    '-ss', String(start), '-t', String(length), '-i', input,
    '-af', filters,
    '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le',
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', // plain 44-byte header
    output,
  ]);
}

const work = mkdtempSync(join(tmpdir(), 'robo-sounds-'));
try {
  for (const clip of CLIPS) {
    const source = join(work, `${clip.id}.src`);
    await download(clip.url, source);
    const target = join(OUT_DIR, `${clip.id}.wav`);
    convert(source, target, clip);
    console.log(`wrote ${target}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
