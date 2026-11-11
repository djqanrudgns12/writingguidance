import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * 의존성 없는 PWA 빌드 단계(PLAN §6.6, ADR-056). `vite-plugin-pwa`(workbox 묶음)를 들이지 않고
 * 빌드 결과에서 미리 저장할 파일 목록을 만들어 `sw.js`와 `manifest.webmanifest`를 내보낸다.
 * - 미리 저장: `index.html`, 첫 화면 JS·CSS(`assets/app-*`), 작은 그림(`art/`, 20KB 이하). 글꼴 조각은 많아서 빼고 쓸 때 저장.
 * - 판 이름은 미리 저장 목록의 해시: 내용이 같으면 서비스 워커도 같다(쓸데없는 업데이트 없음).
 * 개발 서버(`vite`)에서는 아무것도 하지 않는다(서비스 워커 없이 개발).
 */
const SMALL_ART = 20 * 1024;

export function pwaPlugin({ name, shortName, themeColor = '#FFF8EF', backgroundColor = '#FFF8EF' }) {
  const template = readFileSync(new URL('../sw/sw.template.js', import.meta.url), 'utf8');
  return {
    name: 'geulbang-pwa',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = [];
      for (const [fileName, item] of Object.entries(bundle)) {
        if (fileName.startsWith('dev/') || fileName.includes('/dev-')) continue;
        if (item.type === 'chunk' && item.isEntry && fileName.startsWith('assets/app')) files.push(fileName);
        else if (item.type === 'asset' && /^assets\/app-.*\.css$/.test(fileName)) files.push(fileName);
        else if (item.type === 'asset' && fileName.startsWith('art/')) {
          const size =
            typeof item.source === 'string' ? Buffer.byteLength(item.source) : item.source.byteLength;
          if (size <= SMALL_ART) files.push(fileName);
        }
      }
      const precache = ['/index.html', ...files.sort().map(f => `/${f}`)];
      const version = createHash('sha256').update(JSON.stringify(precache)).digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache)),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: JSON.stringify(
          {
            name,
            short_name: shortName,
            lang: 'ko',
            start_url: '/',
            scope: '/',
            display: 'standalone',
            theme_color: themeColor,
            background_color: backgroundColor,
            icons: [
              { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
              { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
              { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          null,
          2,
        ),
      });
    },
  };
}
