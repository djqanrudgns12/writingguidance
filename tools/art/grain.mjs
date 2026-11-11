import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'apps/web/src/ui/art/paper-grain.webp');

const TILE_SIZE = 256;
const MAX_BYTES = 8 * 1024; // PRD 8.3, PLAN §9.3-6: 8KB 이하
const SEED = 0x20261111;

// 맥미니 자원 보호 규칙에 따라 ImageMagick 스레드를 1개로 제한한다.
const MAGICK_ENV = {
  ...process.env,
  MAGICK_THREAD_LIMIT: '1',
};

/**
 * 고정 씨앗값으로 언제나 같은 수열을 내는 32비트 PRNG(Mulberry32).
 * 다시 실행했을 때 바이트 단위까지 같은 종이 결 타일을 보장하려고 쓴다.
 */
function createRng(seed) {
  let state = seed >>> 0;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/**
 * 주기 `periodX` × `periodY` 격자 위에서 토러스(모듈로) 보간을 수행해
 * 256×256 경계에서 이음새가 전혀 생기지 않는 2차원 연속 잡음 층을 만든다.
 */
function samplePeriodicLayer(rng, periodX, periodY) {
  const grid = new Float32Array(periodX * periodY);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = rng() * 2 - 1;
  }

  const out = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let y = 0; y < TILE_SIZE; y++) {
    const fy = (y / TILE_SIZE) * periodY;
    const y0 = Math.floor(fy);
    const y1 = (y0 + 1) % periodY;
    const ty = smoothstep(fy - y0);

    for (let x = 0; x < TILE_SIZE; x++) {
      const fx = (x / TILE_SIZE) * periodX;
      const x0 = Math.floor(fx);
      const x1 = (x0 + 1) % periodX;
      const tx = smoothstep(fx - x0);

      const v00 = grid[(y0 % periodY) * periodX + (x0 % periodX)] ?? 0;
      const v10 = grid[(y0 % periodY) * periodX + x1] ?? 0;
      const v01 = grid[y1 * periodX + (x0 % periodX)] ?? 0;
      const v11 = grid[y1 * periodX + x1] ?? 0;

      const top = lerp(v00, v10, tx);
      const bottom = lerp(v01, v11, tx);
      out[y * TILE_SIZE + x] = lerp(top, bottom, ty);
    }
  }
  return out;
}

/**
 * 미세 입자 잡음을 주기적 3×3 가우시안 커널로 부드럽게 다듬어
 * 자글거리는 디지털 잡음 없이 따뜻한 인쇄 종이 섬유 결을 만든다.
 */
function sampleSmoothedFineGrain(rng) {
  const raw = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0; i < raw.length; i++) {
    raw[i] = rng() * 2 - 1;
  }

  const kernel = [
    [1, 2, 1],
    [2, 4, 2],
    [1, 2, 1],
  ];
  const out = new Float32Array(TILE_SIZE * TILE_SIZE);
  const mask = TILE_SIZE - 1;

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let acc = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = (y + dy) & mask;
        const rowWeight = kernel[dy + 1];
        for (let dx = -1; dx <= 1; dx++) {
          const xx = (x + dx) & mask;
          const w = rowWeight?.[dx + 1] ?? 1;
          acc += (raw[yy * TILE_SIZE + xx] ?? 0) * w;
        }
      }
      out[y * TILE_SIZE + x] = acc / 16;
    }
  }
  return out;
}

/**
 * PRD 8.3 기준(크림 바탕 #FFF8EF 근처, 대비 6% 이하, 256px 이음새 없음)에 맞춰
 * 결정론적 P6 PPM 이미지 버퍼를 만든다.
 */
function buildSeamlessGrainPpmBuffer() {
  const rng = createRng(SEED);
  const cloudLayer = samplePeriodicLayer(rng, 16, 16);
  const mediumLayer = samplePeriodicLayer(rng, 32, 32);
  const fiberH = samplePeriodicLayer(rng, 16, 64);
  const fiberV = samplePeriodicLayer(rng, 64, 16);
  const fineGrain = sampleSmoothedFineGrain(rng);

  const header = Buffer.from(`P6\n${TILE_SIZE} ${TILE_SIZE}\n255\n`, 'ascii');
  const pixels = Buffer.alloc(TILE_SIZE * TILE_SIZE * 3);

  // 기준색 #FFF8EF(255, 248, 239)에서 최대 변위 ±5(대비 약 3.9% <= 6%)로 제한해 글자 가독성을 지킨다.
  const baseR = 253;
  const baseG = 246;
  const baseB = 236;

  let minLum = 255;
  let maxLum = 0;

  for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
    const v =
      (cloudLayer[i] ?? 0) * 0.28 +
      (mediumLayer[i] ?? 0) * 0.28 +
      (fiberH[i] ?? 0) * 0.16 +
      (fiberV[i] ?? 0) * 0.14 +
      (fineGrain[i] ?? 0) * 0.24;

    const delta = v * 6.4;
    const r = clampByte(baseR + delta);
    const g = clampByte(baseG + delta);
    const b = clampByte(baseB + delta * 1.12);

    const offset = i * 3;
    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }

  const contrastPercent = ((maxLum - minLum) / 255) * 100;
  return {
    ppmBuffer: Buffer.concat([header, pixels]),
    contrastPercent,
  };
}

/**
 * 시스템 `magick`을 실행해 PPM 입력을 고정 옵션 WebP 바이트 버퍼로 변환한다.
 */
function encodeWebpWithMagick(ppmBuffer) {
  return new Promise((resolve, reject) => {
    const args = [
      'ppm:-',
      '-strip',
      '-quality',
      '92',
      '-define',
      'webp:method=6',
      '-define',
      'webp:sns-strength=50',
      '-define',
      'webp:filter-strength=10',
      'webp:-',
    ];
    const child = spawn('magick', args, { env: MAGICK_ENV, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on('data', chunk => stdoutChunks.push(chunk));
    child.stderr.on('data', chunk => stderrChunks.push(chunk));
    child.on('error', err => {
      reject(new Error(`magick 실행 실패: ${err.message}`));
    });
    child.on('close', code => {
      if (code !== 0) {
        const errText = Buffer.concat(stderrChunks).toString('utf8').trim();
        reject(new Error(`magick 종료 코드 ${code}: ${errText}`));
        return;
      }
      resolve(Buffer.concat(stdoutChunks));
    });

    child.stdin.write(ppmBuffer);
    child.stdin.end();
  });
}

function parseCliArgs(argv) {
  let checkOnly = false;
  let outputPath = DEFAULT_OUTPUT;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') {
      checkOnly = true;
    } else if (arg === '--output') {
      outputPath = path.resolve(REPO_ROOT, argv[++i] ?? '');
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        '사용법: node tools/art/grain.mjs [--check] [--output apps/web/src/ui/art/paper-grain.webp]',
      );
      process.exit(0);
    } else {
      throw new Error(`알 수 없는 옵션입니다: ${arg}`);
    }
  }

  return { checkOnly, outputPath };
}

async function main() {
  const { checkOnly, outputPath } = parseCliArgs(process.argv.slice(2));
  const { ppmBuffer, contrastPercent } = buildSeamlessGrainPpmBuffer();
  const webpBuffer = await encodeWebpWithMagick(ppmBuffer);

  if (contrastPercent > 6) {
    throw new Error(`종이 결 대비가 6% 한도를 초과했습니다 (${contrastPercent.toFixed(2)}%)`);
  }
  if (webpBuffer.length > MAX_BYTES) {
    throw new Error(`종이 결 WebP 용량이 8KB 한도를 초과했습니다 (${webpBuffer.length}B > ${MAX_BYTES}B)`);
  }

  if (checkOnly) {
    if (!fs.existsSync(outputPath)) {
      console.error(`[실패] 종이 결 파일이 없습니다: ${path.relative(REPO_ROOT, outputPath)}`);
      process.exit(1);
    }
    const existing = fs.readFileSync(outputPath);
    if (!existing.equals(webpBuffer)) {
      console.error(
        `[실패] 종이 결 파일이 결정론적 생성 결과와 일치하지 않습니다: ${path.relative(REPO_ROOT, outputPath)}`,
      );
      process.exit(1);
    }
    console.log(
      `paper-grain.webp check OK: ${TILE_SIZE}x${TILE_SIZE}, ${webpBuffer.length} B (${(
        webpBuffer.length / 1024
      ).toFixed(2)} KB <= 8.00 KB), contrast ${contrastPercent.toFixed(2)}% (<= 6%)`,
    );
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, webpBuffer);
  console.log(
    `paper-grain.webp generated: ${TILE_SIZE}x${TILE_SIZE}, ${webpBuffer.length} B (${(
      webpBuffer.length / 1024
    ).toFixed(2)} KB <= 8.00 KB), contrast ${contrastPercent.toFixed(2)}% (<= 6%)`,
  );
}

main().catch(err => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
