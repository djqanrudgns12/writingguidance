/* 글방 서비스 워커(PLAN §6.6). 빌드 때 `scripts/pwa-plugin.mjs`가 아래 자리표시를 채워 `/sw.js`로 내보낸다.
 * - 미리 저장: 앱 껍데기(HTML·첫 JS·CSS)와 작은 그림. 글꼴 조각·그림은 쓸 때 저장(CacheFirst, 해시 붙은 파일이라 바뀌지 않음).
 * - `/api`·`/ws`·`/internal`·`/dev`는 손대지 않는다(네트워크만).
 * - 화면 이동은 네트워크 먼저, 안 되면 저장한 앱 껍데기(`/index.html`) — 인터넷 없이 새로고침해도 열린다(PRD F-09).
 * - 새 판은 받아 두기만 하고, 앱이 `SKIP_WAITING`을 보낼 때(홈·선생님 홈·다음 실행) 적용한다(ADR-025).
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL = '/index.html';
const SHELL_CACHE = `geulbang-shell-${VERSION}`;
const RUNTIME_CACHE = 'geulbang-runtime-v1';
const BYPASS = /^\/(api|ws|internal|dev)(\/|$)/;
const IMMUTABLE = /^\/(assets|art)\//;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys.filter(k => k.startsWith('geulbang-shell-') && k !== SHELL_CACHE).map(k => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || BYPASS.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(SHELL, { cacheName: SHELL_CACHE }).then(r => r || Response.error()),
      ),
    );
    return;
  }
  if (IMMUTABLE.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        hit =>
          hit ||
          fetch(request).then(res => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
            }
            return res;
          }),
      ),
    );
  }
});
