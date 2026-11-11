import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'apps/web/src/ui/art/frames');

const INK_HEX = '#4A3B32';

/**
 * PRD 8.3, PLAN §9.3-5:
 * 흔들리는 손그림 선은 화면당 핵심 요소 1개(홈 수업 카드, 제출 도장, 빈 화면 그림 둘레)에만 크기별로 만든다.
 */
const FRAME_SPECS = [
  {
    name: 'home-card-sm',
    kind: 'rounded-rect',
    width: 328,
    height: 176,
    radii: [24, 28, 22, 26],
    seed: 0x4843534d,
    stepPx: 18,
    wobblePx: 1.05,
  },
  {
    name: 'home-card-md',
    kind: 'rounded-rect',
    width: 480,
    height: 200,
    radii: [24, 28, 22, 26],
    seed: 0x48434d44,
    stepPx: 20,
    wobblePx: 1.15,
  },
  {
    name: 'home-card-lg',
    kind: 'rounded-rect',
    width: 640,
    height: 220,
    radii: [24, 28, 22, 26],
    seed: 0x48434c47,
    stepPx: 22,
    wobblePx: 1.2,
  },
  {
    name: 'stamp-sm',
    kind: 'circle-stamp',
    width: 128,
    height: 128,
    radii: [60, 60, 60, 60],
    seed: 0x5354534d,
    stepPx: 14,
    wobblePx: 0.95,
  },
  {
    name: 'stamp-md',
    kind: 'circle-stamp',
    width: 168,
    height: 168,
    radii: [80, 80, 80, 80],
    seed: 0x53544d44,
    stepPx: 16,
    wobblePx: 1.05,
  },
  {
    name: 'empty-sm',
    kind: 'rounded-rect',
    width: 160,
    height: 160,
    radii: [22, 26, 24, 28],
    seed: 0x454d534d,
    stepPx: 16,
    wobblePx: 0.95,
  },
  {
    name: 'empty-md',
    kind: 'rounded-rect',
    width: 240,
    height: 180,
    radii: [24, 28, 22, 26],
    seed: 0x454d4d44,
    stepPx: 18,
    wobblePx: 1.05,
  },
  {
    name: 'empty-lg',
    kind: 'rounded-rect',
    width: 320,
    height: 220,
    radii: [24, 28, 22, 26],
    seed: 0x454d4c47,
    stepPx: 20,
    wobblePx: 1.1,
  },
];

/**
 * 고정 씨앗값 PRNG(Mulberry32). 다시 만들었을 때 완전히 같은 SVG 문자열이 나오도록 보장한다.
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

function fmt(n) {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * 비대칭 둥근 직사각형 둘레를 따라 점들과 바깥 법선 벡터를 일정 간격(`stepPx`)으로 샘플링한다.
 */
function sampleRoundedRectPerimeter(width, height, radii, inset, stepPx) {
  const [rTL = 24, rTR = 28, rBR = 22, rBL = 26] = radii;
  const left = inset;
  const top = inset;
  const right = width - inset;
  const bottom = height - inset;

  const segments = [
    // 위쪽 변 (왼쪽 -> 오른쪽)
    {
      type: 'line',
      x0: left + rTL,
      y0: top,
      x1: right - rTR,
      y1: top,
      nx: 0,
      ny: -1,
    },
    // 오른쪽 위 모서리
    {
      type: 'arc',
      cx: right - rTR,
      cy: top + rTR,
      r: rTR,
      a0: -Math.PI / 2,
      a1: 0,
    },
    // 오른쪽 변 (위 -> 아래)
    {
      type: 'line',
      x0: right,
      y0: top + rTR,
      x1: right,
      y1: bottom - rBR,
      nx: 1,
      ny: 0,
    },
    // 오른쪽 아래 모서리
    {
      type: 'arc',
      cx: right - rBR,
      cy: bottom - rBR,
      r: rBR,
      a0: 0,
      a1: Math.PI / 2,
    },
    // 아래쪽 변 (오른쪽 -> 왼쪽)
    {
      type: 'line',
      x0: right - rBR,
      y0: bottom,
      x1: left + rBL,
      y1: bottom,
      nx: 0,
      ny: 1,
    },
    // 왼쪽 아래 모서리
    {
      type: 'arc',
      cx: left + rBL,
      cy: bottom - rBL,
      r: rBL,
      a0: Math.PI / 2,
      a1: Math.PI,
    },
    // 왼쪽 변 (아래 -> 위)
    {
      type: 'line',
      x0: left,
      y0: bottom - rBL,
      x1: left,
      y1: top + rTL,
      nx: -1,
      ny: 0,
    },
    // 왼쪽 위 모서리
    {
      type: 'arc',
      cx: left + rTL,
      cy: top + rTL,
      r: rTL,
      a0: Math.PI,
      a1: (3 * Math.PI) / 2,
    },
  ];

  const points = [];
  for (const seg of segments) {
    if (seg.type === 'line') {
      const dx = seg.x1 - seg.x0;
      const dy = seg.y1 - seg.y0;
      const len = Math.hypot(dx, dy);
      const count = Math.max(2, Math.round(len / stepPx));
      for (let i = 0; i < count; i++) {
        const t = i / count;
        points.push({
          x: seg.x0 + dx * t,
          y: seg.y0 + dy * t,
          nx: seg.nx,
          ny: seg.ny,
        });
      }
    } else {
      const arcLen = Math.abs(seg.a1 - seg.a0) * seg.r;
      const count = Math.max(3, Math.round(arcLen / (stepPx * 0.75)));
      for (let i = 0; i < count; i++) {
        const t = i / count;
        const angle = seg.a0 + (seg.a1 - seg.a0) * t;
        const nx = Math.cos(angle);
        const ny = Math.sin(angle);
        points.push({
          x: seg.cx + nx * seg.r,
          y: seg.cy + ny * seg.r,
          nx,
          ny,
        });
      }
    }
  }

  return points;
}

/**
 * 원형 도장 둘레를 따라 점들과 바깥 법선 벡터를 샘플링한다.
 */
function sampleCirclePerimeter(width, height, radius, stepPx) {
  const cx = width / 2;
  const cy = height / 2;
  const circumference = 2 * Math.PI * radius;
  const count = Math.max(16, Math.round(circumference / stepPx));
  const points = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    points.push({
      x: cx + nx * radius,
      y: cy + ny * radius,
      nx,
      ny,
    });
  }
  return points;
}

/**
 * 긴 변에서도 같은 굴곡이 되풀이되지 않도록 비통약 주파수 파동과 미세 손떨림을 더해
 * 점 좌표를 흔든다.
 */
function perturbPoints(basePoints, rng, amplitude) {
  const phase1 = rng() * Math.PI * 2;
  const phase2 = rng() * Math.PI * 2;
  const phase3 = rng() * Math.PI * 2;
  const freq1 = 2 + Math.floor(rng() * 3);
  const freq2 = 5 + Math.floor(rng() * 4);
  const freq3 = 9 + Math.floor(rng() * 5);

  const n = basePoints.length;
  return basePoints.map((pt, idx) => {
    const u = (idx / n) * Math.PI * 2;
    const wave =
      Math.sin(u * freq1 + phase1) * 0.45 +
      Math.cos(u * freq2 + phase2) * 0.35 +
      Math.sin(u * freq3 + phase3) * 0.2;
    const jitterN = (rng() * 2 - 1) * 0.45;
    const jitterT = (rng() * 2 - 1) * 0.3;

    const offsetN = (wave * 0.65 + jitterN) * amplitude;
    const offsetT = jitterT * amplitude;
    const tx = -pt.ny;
    const ty = pt.nx;

    return {
      x: pt.x + pt.nx * offsetN + tx * offsetT,
      y: pt.y + pt.ny * offsetN + ty * offsetT,
    };
  });
}

/**
 * 닫힌 점 목록을 부드러운 Catmull-Rom -> 3차 베지에(`M ... C ... Z`) SVG 경로 문자열로 바꾼다.
 */
function buildClosedSmoothPath(points, tension = 0.2) {
  const n = points.length;
  if (n < 3) return '';

  const first = points[0];
  let d = `M${fmt(first.x)} ${fmt(first.y)}`;

  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];

    const c1x = p1.x + (p2.x - p0.x) * tension;
    const c1y = p1.y + (p2.y - p0.y) * tension;
    const c2x = p2.x - (p3.x - p1.x) * tension;
    const c2y = p2.y - (p3.y - p1.y) * tension;

    d += ` C${fmt(c1x)} ${fmt(c1y)},${fmt(c2x)} ${fmt(c2y)},${fmt(p2.x)} ${fmt(p2.y)}`;
  }

  return `${d}Z`;
}

/**
 * 품목 명세 하나에서 손그림 코코아 잉크 테두리 SVG 문자열을 생성한다.
 */
function renderFrameSvg(spec) {
  const rng = createRng(spec.seed);

  if (spec.kind === 'circle-stamp') {
    const outerRadius = Math.min(spec.width, spec.height) / 2 - 4;
    const innerRadius = outerRadius - 6;
    const outerBase = sampleCirclePerimeter(spec.width, spec.height, outerRadius, spec.stepPx);
    const innerBase = sampleCirclePerimeter(spec.width, spec.height, innerRadius, spec.stepPx);

    const outerPath = buildClosedSmoothPath(perturbPoints(outerBase, rng, spec.wobblePx));
    const innerPath = buildClosedSmoothPath(perturbPoints(innerBase, rng, spec.wobblePx * 0.85));

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} ${spec.height}" fill="none">`,
      `  <path d="${outerPath}" stroke="${INK_HEX}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.9" />`,
      `  <path d="${innerPath}" stroke="${INK_HEX}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.55" />`,
      '</svg>',
      '',
    ].join('\n');
  }

  const basePoints = sampleRoundedRectPerimeter(spec.width, spec.height, spec.radii, 2.5, spec.stepPx);
  const mainPoints = perturbPoints(basePoints, rng, spec.wobblePx);
  const echoPoints = perturbPoints(basePoints, rng, spec.wobblePx * 0.9);

  const mainPath = buildClosedSmoothPath(mainPoints);
  const echoPath = buildClosedSmoothPath(echoPoints);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} ${spec.height}" preserveAspectRatio="none" fill="none">`,
    `  <path d="${mainPath}" stroke="${INK_HEX}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />`,
    `  <path d="${echoPath}" stroke="${INK_HEX}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.32" vector-effect="non-scaling-stroke" />`,
    '</svg>',
    '',
  ].join('\n');
}

function parseCliArgs(argv) {
  let checkOnly = false;
  let outDir = DEFAULT_OUT_DIR;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') {
      checkOnly = true;
    } else if (arg === '--output-dir') {
      outDir = path.resolve(REPO_ROOT, argv[++i] ?? '');
    } else if (arg === '--help' || arg === '-h') {
      console.log('사용법: node tools/art/frames.mjs [--check] [--output-dir apps/web/src/ui/art/frames]');
      process.exit(0);
    } else {
      throw new Error(`알 수 없는 옵션입니다: ${arg}`);
    }
  }

  return { checkOnly, outDir };
}

function main() {
  const { checkOnly, outDir } = parseCliArgs(process.argv.slice(2));
  if (!checkOnly) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const violations = [];
  let totalBytes = 0;

  for (const spec of FRAME_SPECS) {
    const svgContent = renderFrameSvg(spec);
    const filePath = path.join(outDir, `${spec.name}.svg`);
    const byteLen = Buffer.byteLength(svgContent, 'utf8');
    totalBytes += byteLen;

    if (checkOnly) {
      if (!fs.existsSync(filePath)) {
        violations.push(`${spec.name}.svg 파일이 없습니다`);
        continue;
      }
      const existing = fs.readFileSync(filePath, 'utf8');
      if (existing !== svgContent) {
        violations.push(`${spec.name}.svg 내용이 결정론적 생성 결과와 일치하지 않습니다`);
      }
    } else {
      fs.writeFileSync(filePath, svgContent, 'utf8');
    }
  }

  if (violations.length > 0) {
    console.error('[손그림 테두리 검사 실패]');
    for (const v of violations) {
      console.error(`- ${v}`);
    }
    process.exit(1);
  }

  console.log(
    `frames/*.svg ${checkOnly ? 'check OK' : 'generated'}: ${FRAME_SPECS.length} files, total ${totalBytes} B (${(
      totalBytes / 1024
    ).toFixed(2)} KB)`,
  );
}

main();
