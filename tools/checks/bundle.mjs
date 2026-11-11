import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseConfigDefaultsFile } from './lib/ast.mjs';
import { isCliMain, REPO_ROOT, runCheckCli, toPosixRelative, walkFiles } from './lib/common.mjs';

const DEFAULT_JS_GZIP_LIMIT = 250 * 1024;
const DEFAULT_ART_LIMIT = 80 * 1024;
const IMAGE_EXT_RE = /\.(?:webp|png|jpe?g|gif|avif|svg)$/i;
const TEXT_ASSET_RE = /\.(?:html|m?js|css)$/i;
const DEV_ROUTE_RE = /(?:["'`(]|^|\s)(\/dev\/[a-zA-Z0-9_./-]*)/;

/**
 * `config.ts`에 번들 한도 키가 있으면 읽고, 없으면 PLAN §2.6 기본값(250KB, 80KB)을 돌려준다.
 */
function resolveBudgets(rootDir) {
  const configPath = path.join(rootDir, 'packages/core/src/config.ts');
  const map = parseConfigDefaultsFile(configPath);
  const jsKeys = ['INITIAL_JS_GZIP_MAX_BYTES', 'BUNDLE_JS_GZIP_MAX_BYTES', 'FIRST_SCREEN_JS_MAX_BYTES'];
  const artKeys = ['INITIAL_ART_MAX_BYTES', 'BUNDLE_ART_MAX_BYTES', 'FIRST_SCREEN_ART_MAX_BYTES'];

  let maxJsGzipBytes = DEFAULT_JS_GZIP_LIMIT;
  for (const k of jsKeys) {
    const val = map.get(k)?.value;
    if (typeof val === 'number') {
      maxJsGzipBytes = val;
      break;
    }
  }

  let maxArtBytes = DEFAULT_ART_LIMIT;
  for (const k of artKeys) {
    const val = map.get(k)?.value;
    if (typeof val === 'number') {
      maxArtBytes = val;
      break;
    }
  }

  return { maxJsGzipBytes, maxArtBytes };
}

/**
 * 번들 내부 참조 경로를 `distDir` 안의 실제 파일 경로로 바꾼다.
 */
function resolveDistAsset(distDir, fromFile, rawSpec) {
  const clean = rawSpec.split(/[?#]/)[0] ?? '';
  if (!clean || /^(?:https?:|data:|blob:|\/\/)/.test(clean)) return null;
  const candidate = clean.startsWith('/')
    ? path.join(distDir, clean.slice(1))
    : path.resolve(path.dirname(fromFile), clean);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }
  return null;
}

/**
 * JS 코드에서 정적 import 경로와 동적 `import(...)` 경로를 구분해 뽑는다.
 */
function extractJsImports(jsContent) {
  const staticSpecs = [];
  const dynamicSpecs = [];

  const staticFromRe = /\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g;
  for (const m of jsContent.matchAll(staticFromRe)) {
    if (m[1]) staticSpecs.push(m[1]);
  }

  const sideEffectRe = /\bimport\s*["']([^"']+)["']/g;
  for (const m of jsContent.matchAll(sideEffectRe)) {
    if (m[1]) staticSpecs.push(m[1]);
  }

  const dynamicRe = /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  for (const m of jsContent.matchAll(dynamicRe)) {
    if (m[1]) dynamicSpecs.push(m[1]);
  }

  return { staticSpecs, dynamicSpecs };
}

/**
 * 첫 화면 JS(진입 청크 + 정적 import 청크) 목록과 비초기(동적) 청크 목록을 구한다.
 */
function collectInitialAndLazyJs(distDir) {
  const indexHtmlPath = path.join(distDir, 'index.html');
  const initialJs = new Set();
  const queue = [];

  if (fs.existsSync(indexHtmlPath)) {
    const html = fs.readFileSync(indexHtmlPath, 'utf8');
    const scriptRe = /<script\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;
    for (const m of html.matchAll(scriptRe)) {
      const resolved = resolveDistAsset(distDir, indexHtmlPath, m[1] ?? '');
      if (resolved && /\.m?js$/i.test(resolved)) queue.push(resolved);
    }
    const preloadRe = /<link\b[^>]*?\bhref=["']([^"']+)["'][^>]*>/gi;
    for (const m of html.matchAll(preloadRe)) {
      const tag = m[0] ?? '';
      if (!/\brel=["']modulepreload["']/i.test(tag)) continue;
      const resolved = resolveDistAsset(distDir, indexHtmlPath, m[1] ?? '');
      if (resolved && /\.m?js$/i.test(resolved)) queue.push(resolved);
    }
  }

  if (queue.length === 0) {
    const allJs = walkFiles(distDir, { filter: f => /\.m?js$/i.test(f) });
    for (const f of allJs) queue.push(f);
  }

  const dynamicCandidates = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || initialJs.has(current)) continue;
    initialJs.add(current);

    const content = fs.readFileSync(current, 'utf8');
    const { staticSpecs, dynamicSpecs } = extractJsImports(content);

    for (const spec of staticSpecs) {
      const resolved = resolveDistAsset(distDir, current, spec);
      if (resolved && /\.m?js$/i.test(resolved) && !initialJs.has(resolved)) {
        queue.push(resolved);
      }
    }

    for (const spec of dynamicSpecs) {
      const resolved = resolveDistAsset(distDir, current, spec);
      if (resolved && /\.m?js$/i.test(resolved)) {
        dynamicCandidates.add(resolved);
      }
    }
  }

  const lazyJs = new Set();
  const lazyQueue = [...dynamicCandidates].filter(f => !initialJs.has(f));
  while (lazyQueue.length > 0) {
    const current = lazyQueue.shift();
    if (!current || lazyJs.has(current) || initialJs.has(current)) continue;
    lazyJs.add(current);
    const content = fs.readFileSync(current, 'utf8');
    const { staticSpecs, dynamicSpecs } = extractJsImports(content);
    for (const spec of [...staticSpecs, ...dynamicSpecs]) {
      const resolved = resolveDistAsset(distDir, current, spec);
      if (resolved && /\.m?js$/i.test(resolved) && !initialJs.has(resolved) && !lazyJs.has(resolved)) {
        lazyQueue.push(resolved);
      }
    }
  }

  return { initialJs, lazyJs };
}

/**
 * 첫 화면 그림·질감 파일 집합을 구한다.
 * 동적 import 청크에서만 참조되는 그림은 제외하고, 첫 화면에서 참조되거나 정적 배치된 그림을 합산한다.
 */
function collectInitialArtFiles(distDir, initialJs, lazyJs) {
  const allImages = walkFiles(distDir, { filter: f => IMAGE_EXT_RE.test(f) });
  if (allImages.length === 0) return [];

  const initialFiles = [...initialJs];
  const indexHtmlPath = path.join(distDir, 'index.html');
  if (fs.existsSync(indexHtmlPath)) initialFiles.push(indexHtmlPath);
  const cssFiles = walkFiles(distDir, { filter: f => f.endsWith('.css') });
  initialFiles.push(...cssFiles);

  const initialTexts = initialFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  // 웹 앱 매니페스트의 아이콘은 홈 화면에 추가할 때만 받는다(첫 화면 아님, PLAN §6.6). 나중에 불러오는 쪽으로 센다.
  const manifestPath = path.join(distDir, 'manifest.webmanifest');
  const manifestText = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : '';
  const lazyTexts = [...[...lazyJs].map(f => fs.readFileSync(f, 'utf8')), manifestText].join('\n');

  return allImages.filter(imgPath => {
    const base = path.basename(imgPath);
    const relFromDist = toPosixRelative(distDir, imgPath);
    const referencedInInitial = initialTexts.includes(base) || initialTexts.includes(relFromDist);
    const referencedInLazy = lazyTexts.includes(base) || lazyTexts.includes(relFromDist);
    if (referencedInInitial) return true;
    if (referencedInLazy) return false;
    return true;
  });
}

/**
 * 빌드 결과물(`apps/web/dist`)의 용량 예산과 `/dev/` 화면 혼입 여부를 검사한다(PLAN §2.6, §10.1).
 */
export function checkBundle({ rootDir = REPO_ROOT } = {}) {
  const distDir = path.join(rootDir, 'apps/web/dist');
  if (!fs.existsSync(distDir)) {
    return {
      violations: [],
      skippedMessage: '빌드 없음, 건너뜀',
    };
  }

  const violations = [];
  const { maxJsGzipBytes, maxArtBytes } = resolveBudgets(rootDir);
  const indexAnchor = fs.existsSync(path.join(distDir, 'index.html'))
    ? toPosixRelative(rootDir, path.join(distDir, 'index.html'))
    : toPosixRelative(rootDir, distDir);

  // 1. 첫 화면 JS(진입 청크 + 정적 import 청크) gzip 합계 검사
  const { initialJs, lazyJs } = collectInitialAndLazyJs(distDir);
  let totalJsGzip = 0;
  for (const jsFile of initialJs) {
    const raw = fs.readFileSync(jsFile);
    totalJsGzip += zlib.gzipSync(raw).length;
  }
  if (totalJsGzip > maxJsGzipBytes) {
    violations.push({
      file: indexAnchor,
      line: 1,
      rule: 'bundle-js-budget',
      message: `첫 화면 JS gzip 합계가 한도를 초과했습니다 (${totalJsGzip}B > ${maxJsGzipBytes}B)`,
    });
  }

  // 2. 첫 화면 그림·질감 합계 검사
  const initialArtFiles = collectInitialArtFiles(distDir, initialJs, lazyJs);
  let totalArtBytes = 0;
  for (const artFile of initialArtFiles) {
    totalArtBytes += fs.statSync(artFile).size;
  }
  if (totalArtBytes > maxArtBytes) {
    violations.push({
      file: indexAnchor,
      line: 1,
      rule: 'bundle-art-budget',
      message: `첫 화면 그림·질감 합계가 한도를 초과했습니다 (${totalArtBytes}B > ${maxArtBytes}B)`,
    });
  }

  // 3. 운영 빌드 안의 `/dev/` 화면 파일·경로 문자열 검사
  const devDir = path.join(distDir, 'dev');
  if (fs.existsSync(devDir)) {
    violations.push({
      file: toPosixRelative(rootDir, devDir),
      line: 1,
      rule: 'bundle-no-dev-route',
      message: '운영 빌드에 dev/ 디렉터리가 포함되어 있습니다',
    });
  }

  const textAssets = walkFiles(distDir, { filter: f => TEXT_ASSET_RE.test(f) });
  for (const assetPath of textAssets) {
    const relFile = toPosixRelative(rootDir, assetPath);
    const lines = fs.readFileSync(assetPath, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i]?.match(DEV_ROUTE_RE);
      if (m) {
        violations.push({
          file: relFile,
          line: i + 1,
          rule: 'bundle-no-dev-route',
          message: `운영 빌드에 개발 전용 경로 문자열이 포함되어 있습니다 (${m[1]})`,
        });
      }
    }
  }

  return { violations };
}

if (isCliMain(import.meta.url)) {
  runCheckCli(checkBundle);
}
