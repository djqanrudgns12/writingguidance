// icon-catalog.mjs → src/ui/icons/icons.generated.tsx (PRD 8.6, ADR-014)
//   npm run gen:icons -w @geulbang/web            파일을 쓴다
//   npm run gen:icons -w @geulbang/web -- --check  낡았으면 실패(검사용)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICONS } from './icon-catalog.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'src', 'ui', 'icons', 'icons.generated.tsx');
// 패키지 exports가 package.json을 숨겨서 폴더를 직접 찾는다.
const pkgDir = [
  join(here, '..', 'node_modules', '@phosphor-icons', 'core'),
  join(here, '..', '..', '..', 'node_modules', '@phosphor-icons', 'core'),
].find(d => existsSync(join(d, 'package.json')));
if (!pkgDir) throw new Error('@phosphor-icons/core가 없다: npm install');
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const license = readFileSync(join(pkgDir, 'LICENSE'), 'utf8')
  .trim()
  .split('\n')
  .map(line => ` * ${line}`.trimEnd())
  .join('\n');

const readDuotone = ph => {
  const file = join(pkgDir, 'assets', 'duotone', `${ph}-duotone.svg`);
  if (!existsSync(file)) throw new Error(`없는 Phosphor 아이콘: ${ph} (duotone)`);
  const paths = [...readFileSync(file, 'utf8').matchAll(/<path ([^>]*?)\/>/g)].map(m => ({
    d: /d="([^"]+)"/.exec(m[1])[1],
    tone: /opacity="0\.2"/.test(m[1]),
  }));
  return { tone: paths.filter(p => p.tone).map(p => p.d), line: paths.filter(p => !p.tone).map(p => p.d) };
};

const seen = new Set();
const entries = ICONS.map(icon => {
  if (seen.has(icon.name)) throw new Error(`이름 중복: ${icon.name}`);
  seen.add(icon.name);
  const { tone, line } = readDuotone(icon.ph);
  return `  /** ${icon.ko} */\n  ${icon.name}: { tone: ${JSON.stringify(tone)}, line: ${JSON.stringify(line)} },`;
});

const text = [
  '// scripts/gen-icons.mjs가 scripts/icon-catalog.mjs에서 만든다. 손으로 고치지 않는다.',
  `// 원본: @phosphor-icons/core ${version} (duotone)`,
  `/*! @license Phosphor Icons (icon paths)\n${license}\n */`,
  '',
  'export interface IconPaths {',
  '  readonly tone: readonly string[];',
  '  readonly line: readonly string[];',
  '}',
  '',
  'export const iconPaths = {',
  ...entries,
  '} as const satisfies Record<string, IconPaths>;',
  '',
  'export type IconName = keyof typeof iconPaths;',
  '',
].join('\n');

if (process.argv.includes('--check')) {
  if (!existsSync(out) || readFileSync(out, 'utf8') !== text) {
    console.error('아이콘 생성 파일이 낡았다: npm run gen:icons -w @geulbang/web');
    process.exit(1);
  }
  console.log(`아이콘 ${ICONS.length}개: 생성 파일 최신`);
} else {
  writeFileSync(out, text);
  console.log(`아이콘 ${ICONS.length}개 생성`);
}
