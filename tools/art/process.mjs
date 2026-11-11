import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const DEFAULT_MANIFEST = path.join(HERE, 'manifest.json');

// 맥미니 자원 보호 규칙에 따라 ImageMagick 스레드를 항상 1개로 제한한다.
const MAGICK_ENV = {
  ...process.env,
  MAGICK_THREAD_LIMIT: '1',
};

/**
 * 시스템 `magick` 명령을 자식 프로세스로 실행하고 표준 출력을 돌려준다.
 */
function runMagick(args) {
  return new Promise((resolve, reject) => {
    execFile('magick', args, { env: MAGICK_ENV, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || error.message || '').trim();
        reject(new Error(`magick 실행 실패: ${detail}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * 시스템 `magick`이 WebP 쓰기(`w` 또는 `rw`)를 지원하는지 먼저 확인한다.
 * 지원하지 않으면 새로 설치하지 않고 즉시 멈춰 보고할 수 있게 한다.
 */
async function ensureWebpWritable() {
  let formatList = '';
  try {
    formatList = await runMagick(['-list', 'format']);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`시스템에서 ImageMagick(magick)을 실행할 수 없습니다: ${message}`);
  }

  const webpLine = formatList.split('\n').find(line => /^\s*WEBP\*?\s+WEBP\s+/i.test(line));
  if (!webpLine) {
    throw new Error('ImageMagick에 WEBP 포맷 지원이 없습니다. 설치하지 않고 중단합니다.');
  }

  // 포맷 표의 세 번째 열(모드)에 쓰기 권한(`w`)이 있어야 WebP 파일을 만들 수 있다.
  const cols = webpLine.trim().split(/\s+/);
  const mode = cols[2] ?? '';
  if (!mode.includes('w')) {
    throw new Error(`ImageMagick WEBP 포맷이 쓰기를 지원하지 않습니다 (mode=${mode}). 중단합니다.`);
  }
}

/**
 * 명령줄 인자를 해석해 실행 모드와 대상 목록 설정을 돌려준다.
 */
function parseCliArgs(argv) {
  let checkOnly = false;
  let manifestPath = DEFAULT_MANIFEST;
  let input = null;
  let output = null;
  let name = null;
  let width = null;
  let maxBytes2x = null;
  let quality = null;
  let alphaLowPercent = null;
  let alphaHighPercent = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') {
      checkOnly = true;
    } else if (arg === '--manifest') {
      manifestPath = path.resolve(REPO_ROOT, argv[++i] ?? '');
    } else if (arg === '--input') {
      input = argv[++i] ?? null;
    } else if (arg === '--output') {
      output = argv[++i] ?? null;
    } else if (arg === '--name') {
      name = argv[++i] ?? null;
    } else if (arg === '--width') {
      width = Number(argv[++i]);
    } else if (arg === '--max-bytes-2x' || arg === '--max-bytes') {
      maxBytes2x = Number(argv[++i]);
    } else if (arg === '--quality') {
      quality = Number(argv[++i]);
    } else if (arg === '--alpha-low') {
      alphaLowPercent = Number(argv[++i]);
    } else if (arg === '--alpha-high') {
      alphaHighPercent = Number(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          '사용법:',
          '  node tools/art/process.mjs [--manifest tools/art/manifest.json]',
          '  node tools/art/process.mjs --check',
          '  node tools/art/process.mjs --input <in.png> --output <outDir> [--name <kebab>] --width <px> [--max-bytes-2x <bytes>]',
        ].join('\n'),
      );
      process.exit(0);
    } else {
      throw new Error(`알 수 없는 옵션입니다: ${arg}`);
    }
  }

  // 단일 파일을 명령줄 인자로 직접 지정한 경우 manifest 대신 1건 구성을 만든다.
  if (input !== null || output !== null || width !== null) {
    if (!output || !width || !Number.isFinite(width) || width <= 0) {
      throw new Error('단일 실행 시 --output 과 양수 --width 가 필요합니다.');
    }
    if (!checkOnly && !input) {
      throw new Error('변환 실행 시 --input 경로가 필요합니다.');
    }
    const derivedName =
      name ?? path.basename(input ?? output, path.extname(input ?? output)).replace(/@[12]x$/, '');
    const outLooksLikeFile = /\.webp$/i.test(output);
    const outDir = outLooksLikeFile ? path.dirname(output) : output;

    return {
      checkOnly,
      config: {
        outputDir: outDir,
        quality: quality ?? 85,
        alphaLowPercent: alphaLowPercent ?? 14,
        alphaHighPercent: alphaHighPercent ?? 97,
        firstScreenBudget: null,
        items: [
          {
            name: derivedName,
            input: input ?? '',
            width,
            maxBytes2x: maxBytes2x && Number.isFinite(maxBytes2x) ? maxBytes2x : Infinity,
          },
        ],
      },
    };
  }

  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return {
    checkOnly,
    config: {
      outputDir: raw.outputDir,
      quality: quality ?? raw.quality ?? 85,
      alphaLowPercent: alphaLowPercent ?? raw.alphaLowPercent ?? 14,
      alphaHighPercent: alphaHighPercent ?? raw.alphaHighPercent ?? 97,
      firstScreenBudget: raw.firstScreenBudget ?? null,
      items: raw.items,
    },
  };
}

/**
 * 투명 PNG의 여백을 잘라낸 뒤 목표 표시 상자(`width` × `width`)에 비율을 유지해 맞췄을 때의 1× 높이를 구한다.
 * 세로가 긴 그림도 표시 크기 상한을 넘지 않게 맞추면서 2× 높이가 정확히 1×의 2배가 되도록 먼저 1× 높이를 확정한다.
 */
async function measureTargetHeight1x(inputPath, width, alphaLow, alphaHigh) {
  const out = await runMagick([
    inputPath,
    '-strip',
    '-channel',
    'A',
    '-level',
    `${alphaLow}%,${alphaHigh}%`,
    '+channel',
    '-alpha',
    'background',
    '-trim',
    '+repage',
    '-resize',
    `${width}x${width}`,
    '-format',
    '%h',
    'info:',
  ]);
  const parsed = Number.parseInt(out.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`잘라낸 뒤 높이를 계산할 수 없습니다: ${inputPath} (출력: ${out})`);
  }
  return parsed;
}

/**
 * 투명 PNG에서 여백 제거·반투명 가장자리 문턱값 정리를 거쳐 지정 배율(1× 또는 2×) WebP를 생성한다.
 */
async function renderWebpVariant({
  inputPath,
  outputPath,
  targetWidth,
  targetHeight,
  quality,
  alphaLow,
  alphaHigh,
}) {
  const postResizeAlphaLow = Math.min(alphaLow + 4, 25);
  await runMagick([
    inputPath,
    '-strip',
    // 코코아 색연필 선과 가시 결 대비는 지키고 단색 채색 면의 미세 노이즈만 정돈해 용량 한도를 지킨다.
    '-channel',
    'RGB',
    '-selective-blur',
    '0x3+10%',
    '+channel',
    // 여백 바깥의 옅은 반투명 잔상을 먼저 지워야 -trim 이 실제 사물 윤곽에 딱 맞게 잘린다.
    '-channel',
    'A',
    '-level',
    `${alphaLow}%,${alphaHigh}%`,
    '+channel',
    '-alpha',
    'background',
    '-trim',
    '+repage',
    '-filter',
    'Triangle',
    '-resize',
    `${targetWidth}x${targetHeight}`,
    '-gravity',
    'center',
    '-background',
    'none',
    '-extent',
    `${targetWidth}x${targetHeight}`,
    // 축소 보간 과정에서 가장자리에 새로 생긴 미세 반투명 번짐을 한 번 더 정리한다.
    '-channel',
    'A',
    '-level',
    `${postResizeAlphaLow}%,96%`,
    '+channel',
    '-alpha',
    'background',
    '-quality',
    String(quality),
    '-define',
    'webp:method=6',
    '-define',
    'webp:alpha-quality=55',
    '-define',
    'webp:alpha-filtering=2',
    '-define',
    'webp:preprocessing=2',
    '-define',
    'webp:sns-strength=85',
    '-define',
    'webp:filter-strength=55',
    outputPath,
  ]);
}

/**
 * 생성된 WebP 파일의 픽셀 가로·세로와 알파 채널 포함 여부를 읽는다.
 */
async function inspectWebpFile(filePath) {
  const out = await runMagick([filePath, '-format', '%w %h %[channels]', 'info:']);
  const [wStr, hStr, channels = ''] = out.trim().split(/\s+/);
  const width = Number.parseInt(wStr ?? '', 10);
  const height = Number.parseInt(hStr ?? '', 10);
  const bytes = fs.statSync(filePath).size;
  return {
    width,
    height,
    hasAlpha: channels.includes('a'),
    bytes,
  };
}

/**
 * 바이트 크기를 읽기 쉬운 KiB 문자열(`12.34 KB`)로 바꾼다.
 */
function formatKb(bytes) {
  if (!Number.isFinite(bytes)) return '-';
  return `${(bytes / 1024).toFixed(2)} KB`;
}

async function main() {
  const { checkOnly, config } = parseCliArgs(process.argv.slice(2));
  await ensureWebpWritable();

  const outDirAbs = path.resolve(REPO_ROOT, config.outputDir);
  if (!checkOnly) {
    fs.mkdirSync(outDirAbs, { recursive: true });
  }

  const rows = [];
  const violations = [];

  for (const item of config.items) {
    const out1x = path.join(outDirAbs, `${item.name}@1x.webp`);
    const out2x = path.join(outDirAbs, `${item.name}@2x.webp`);

    if (!checkOnly) {
      const inputAbs = path.resolve(REPO_ROOT, item.input);
      if (!fs.existsSync(inputAbs)) {
        violations.push(`${item.name}: 입력 PNG가 없습니다 (${item.input})`);
        rows.push({
          name: item.name,
          dims1x: '-',
          bytes1x: 0,
          dims2x: '-',
          bytes2x: 0,
          limit2x: item.maxBytes2x,
          status: 'MISSING_INPUT',
        });
        continue;
      }

      const height1x = await measureTargetHeight1x(
        inputAbs,
        item.width,
        config.alphaLowPercent,
        config.alphaHighPercent,
      );

      await renderWebpVariant({
        inputPath: inputAbs,
        outputPath: out1x,
        targetWidth: item.width,
        targetHeight: height1x,
        quality: config.quality,
        alphaLow: config.alphaLowPercent,
        alphaHigh: config.alphaHighPercent,
      });

      await renderWebpVariant({
        inputPath: inputAbs,
        outputPath: out2x,
        targetWidth: item.width * 2,
        targetHeight: height1x * 2,
        quality: config.quality,
        alphaLow: config.alphaLowPercent,
        alphaHigh: config.alphaHighPercent,
      });
    }

    if (!fs.existsSync(out1x) || !fs.existsSync(out2x)) {
      violations.push(`${item.name}: 출력 WebP 파일이 없습니다 (@1x 또는 @2x 누락)`);
      rows.push({
        name: item.name,
        dims1x: fs.existsSync(out1x) ? 'ok' : 'missing',
        bytes1x: fs.existsSync(out1x) ? fs.statSync(out1x).size : 0,
        dims2x: fs.existsSync(out2x) ? 'ok' : 'missing',
        bytes2x: fs.existsSync(out2x) ? fs.statSync(out2x).size : 0,
        limit2x: item.maxBytes2x,
        status: 'MISSING',
      });
      continue;
    }

    const info1x = await inspectWebpFile(out1x);
    const info2x = await inspectWebpFile(out2x);
    let status = 'OK';

    if (info1x.width !== item.width) {
      status = 'BAD_DIM';
      violations.push(
        `${item.name}@1x.webp: 가로 폭이 ${item.width}px 이어야 하지만 ${info1x.width}px 입니다`,
      );
    }
    if (info2x.width !== item.width * 2 || info2x.height !== info1x.height * 2) {
      status = 'BAD_DIM';
      violations.push(
        `${item.name}@2x.webp: 치수가 ${item.width * 2}x${info1x.height * 2} 이어야 하지만 ${info2x.width}x${info2x.height} 입니다`,
      );
    }
    if (!info1x.hasAlpha || !info2x.hasAlpha) {
      status = 'NO_ALPHA';
      violations.push(`${item.name}: 투명 알파 채널이 누락되었습니다`);
    }
    if (info2x.bytes > item.maxBytes2x) {
      status = 'OVER_LIMIT';
      violations.push(`${item.name}@2x.webp: 크기 한도 초과 (${info2x.bytes} B > ${item.maxBytes2x} B)`);
    }

    rows.push({
      name: item.name,
      dims1x: `${info1x.width}x${info1x.height}`,
      bytes1x: info1x.bytes,
      dims2x: `${info2x.width}x${info2x.height}`,
      bytes2x: info2x.bytes,
      limit2x: item.maxBytes2x,
      status,
    });
  }

  const header = [
    'Name'.padEnd(19),
    '1x Dims'.padEnd(9),
    '1x Size'.padStart(10),
    '2x Dims'.padEnd(9),
    '2x Size'.padStart(10),
    '2x Limit'.padStart(10),
    'Status',
  ].join('  ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const r of rows) {
    console.log(
      [
        r.name.padEnd(19),
        r.dims1x.padEnd(9),
        formatKb(r.bytes1x).padStart(10),
        r.dims2x.padEnd(9),
        formatKb(r.bytes2x).padStart(10),
        formatKb(r.limit2x).padStart(10),
        r.status,
      ].join('  '),
    );
  }

  // PRD 8.8 첫 화면(홈) 무게 예산: 홈 그림 2x + 기본 얼굴 2x + 종이 결(8KB 예약) <= 80KB
  if (config.firstScreenBudget) {
    const { items2x, grainReserveBytes, maxTotalBytes } = config.firstScreenBudget;
    let sumArt2x = 0;
    let missingBudgetItem = false;

    for (const targetName of items2x) {
      const found = rows.find(r => r.name === targetName);
      if (!found || found.bytes2x <= 0) {
        missingBudgetItem = true;
      } else {
        sumArt2x += found.bytes2x;
      }
    }

    const totalFirstScreen = sumArt2x + grainReserveBytes;
    const budgetOk = !missingBudgetItem && totalFirstScreen <= maxTotalBytes;
    console.log('-'.repeat(header.length));
    console.log(
      `First-screen budget (${items2x.join(' + ')} @2x + grain ${formatKb(grainReserveBytes)}): ` +
        `${formatKb(totalFirstScreen)} (${totalFirstScreen} B) / ${formatKb(maxTotalBytes)} (${maxTotalBytes} B) -> ${
          budgetOk ? 'OK' : 'FAIL'
        }`,
    );

    if (missingBudgetItem) {
      violations.push('첫 화면 합계 계산에 필요한 그림 파일이 누락되었습니다.');
    } else if (totalFirstScreen > maxTotalBytes) {
      violations.push(
        `첫 화면(홈) 그림 합계가 한도를 초과했습니다 (${totalFirstScreen} B > ${maxTotalBytes} B)`,
      );
    }
  }

  if (violations.length > 0) {
    console.error('\n[한도/검증 실패]');
    for (const v of violations) {
      console.error(`- ${v}`);
    }
    process.exitCode = 1;
  }
}

main().catch(err => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
