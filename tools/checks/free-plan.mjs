import fs from 'node:fs';
import path from 'node:path';
import { isCliMain, REPO_ROOT, runCheckCli, toPosixRelative, walkFiles } from './lib/common.mjs';

/** PRD 0.2-3 예외: LLM API(Anthropic) 하나만 허용 */
const ALLOWED_PACKAGES = new Set(['@anthropic-ai/sdk']);
const ALLOWED_ENV_KEYS = new Set(['ANTHROPIC_API_KEY']);

/** 유료 서비스·외부 SaaS SDK 패키지 이름 또는 접두사 목록 */
export const FORBIDDEN_PACKAGE_PATTERNS = [
  'stripe',
  '@stripe/',
  'sentry',
  '@sentry/',
  'datadog',
  '@datadog/',
  'dd-trace',
  'datadog-metrics',
  'firebase',
  'firebase-admin',
  '@firebase/',
  'supabase',
  '@supabase/',
  'vercel',
  '@vercel/',
  'openai',
  '@openai/',
  '@ai-sdk/',
  'pusher',
  'pusher-js',
  'ably',
  'liveblocks',
  '@liveblocks/',
  'clerk',
  '@clerk/',
  'auth0',
  '@auth0/',
  'mixpanel',
  'amplitude',
  '@amplitude/',
  'posthog-js',
  'posthog-node',
  '@planetscale/',
  '@neondatabase/',
  '@upstash/',
  '@sendgrid/',
  'resend',
  'postmark',
  'mailgun.js',
  'algoliasearch',
  '@algolia/',
  'newrelic',
  '@newrelic/',
];

/** 유료 서비스·외부 SaaS 환경 변수·비밀키 접두사 목록 */
export const FORBIDDEN_ENV_KEY_RE =
  /^(?:VITE_|NEXT_PUBLIC_)?(?:STRIPE|SENTRY|DATADOG|DD_API|DD_APP|FIREBASE|SUPABASE|VERCEL|OPENAI|PUSHER|ABLY|LIVEBLOCKS|CLERK|AUTH0|MIXPANEL|AMPLITUDE|POSTHOG|PLANETSCALE|NEON|UPSTASH|SENDGRID|RESEND|POSTMARK|MAILGUN|ALGOLIA|NEW_RELIC)(?:_[A-Z0-9]+)+$/;

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function isForbiddenPackage(pkgName) {
  if (ALLOWED_PACKAGES.has(pkgName)) return false;
  return FORBIDDEN_PACKAGE_PATTERNS.some(pattern =>
    pattern.endsWith('/')
      ? pkgName.startsWith(pattern)
      : pkgName === pattern || pkgName.startsWith(`${pattern}-`),
  );
}

function isForbiddenEnvKey(keyName) {
  if (ALLOWED_ENV_KEYS.has(keyName)) return false;
  return FORBIDDEN_ENV_KEY_RE.test(keyName);
}

function findLineOfToken(lines, token) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.includes(token)) return i + 1;
  }
  return 1;
}

/**
 * 모든 `package.json`, `.env.example`, 설정 파일에 유료 서비스 SDK·키 이름이 있는지 검사한다(PRD 0.2-3, PLAN §10.1).
 * 주의: 실제 `.env*` 비밀값 파일은 절대 읽지 않고 `.env.example`·`.env.sample`·`.env.template`만 검사한다.
 */
export function checkFreePlan({ rootDir = REPO_ROOT } = {}) {
  const violations = [];

  // 1. 모든 package.json 검사 (tools/checks/fixtures 제외)
  const pkgFiles = walkFiles(rootDir, {
    filter: (fullPath, name) =>
      name === 'package.json' && !toPosixRelative(rootDir, fullPath).startsWith('tools/checks/fixtures/'),
  });

  for (const pkgPath of pkgFiles) {
    const relFile = toPosixRelative(rootDir, pkgPath);
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const lines = raw.split('\n');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    for (const field of DEP_FIELDS) {
      const deps = parsed?.[field];
      if (!deps || typeof deps !== 'object') continue;
      for (const pkgName of Object.keys(deps)) {
        if (isForbiddenPackage(pkgName)) {
          violations.push({
            file: relFile,
            line: findLineOfToken(lines, `"${pkgName}"`),
            rule: 'free-plan-sdk',
            message: `유료 서비스 SDK를 의존성에 넣을 수 없습니다 (${pkgName})`,
          });
        }
      }
    }
  }

  // 2. .env.example / .env.sample / .env.template 검사 (실제 .env는 읽지 않음)
  const envTemplateNames = ['.env.example', '.env.sample', '.env.template'];
  const envTemplateFiles = walkFiles(rootDir, {
    filter: (fullPath, name) =>
      envTemplateNames.includes(name) &&
      !toPosixRelative(rootDir, fullPath).startsWith('tools/checks/fixtures/'),
  });

  for (const envPath of envTemplateFiles) {
    const relFile = toPosixRelative(rootDir, envPath);
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = (lines[i] ?? '').trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const m = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      const key = m?.[1];
      if (key && isForbiddenEnvKey(key)) {
        violations.push({
          file: relFile,
          line: i + 1,
          rule: 'free-plan-env',
          message: `유료 서비스 환경 변수를 쓸 수 없습니다 (${key})`,
        });
      }
    }
  }

  // 3. 설정 파일 검사 (config.ts 등)
  const configCandidates = [
    'packages/core/src/config.ts',
    'apps/server/src/config.ts',
    'apps/web/vite.config.ts',
    'wrangler.json',
    'wrangler.jsonc',
    'wrangler.toml',
  ];

  for (const relCandidate of configCandidates) {
    const fullPath = path.join(rootDir, relCandidate);
    if (!fs.existsSync(fullPath)) continue;
    const relFile = toPosixRelative(rootDir, fullPath);
    const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i] ?? '';
      if (lineText.trim().startsWith('//') || lineText.trim().startsWith('*')) continue;

      for (const m of lineText.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
        const token = m[1];
        if (token && isForbiddenEnvKey(token)) {
          violations.push({
            file: relFile,
            line: i + 1,
            rule: 'free-plan-env',
            message: `설정 파일에 유료 서비스 키를 쓸 수 없습니다 (${token})`,
          });
        }
      }

      for (const m of lineText.matchAll(/["'](@?[a-z0-9-]+(?:\/[a-z0-9-]+)?)["']/g)) {
        const token = m[1];
        if (token && isForbiddenPackage(token)) {
          violations.push({
            file: relFile,
            line: i + 1,
            rule: 'free-plan-sdk',
            message: `설정 파일에 유료 서비스 SDK를 쓸 수 없습니다 (${token})`,
          });
        }
      }
    }
  }

  return { violations };
}

if (isCliMain(import.meta.url)) {
  runCheckCli(checkFreePlan);
}
