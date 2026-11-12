// 쌤유 글방 CloudFront 시청자 요청 함수 we-viewer-request (런타임 cloudfront-js-2.0, 이벤트: viewer-request) — 정식 호스트 강제 + 시청자 IP 덮어쓰기.
//
// [2026-11-13부터 운영에 연결돼 있지 않음 — 되돌리기용 보관본] (ADR-060)
//   배포 E3TFCRGRU1HG1Q는 갤러리(gallery.ssamuniverse.com)와 함께 쓰는 "쌤유 앱 공용 입구"다. 세 동작(`*`, `/assets/*`, `/art/*`)에는
//   공용 함수 ssam-viewer-request가 연결돼 있고, 그 코드 원본은 gallerywalk 저장소 `ops/cloudfront/viewer-request.js`다
//   (write 요청에는 이 함수와 같은 x-we-client-ip · x-we-forwarded-host를 넣는다).
//   이 함수는 write 외 주소를 308로 보내므로 세 동작에 다시 연결하면 갤러리가 끊긴다. `ops/aws/setup-ops.sh`는 이 파일을 게시하지 않고
//   ssam-viewer-request만 연결하며, 다른 함수가 연결돼 있으면 멈춘다. 이 파일을 고쳐도 운영에는 반영되지 않으니, 글방 요청 처리를
//   바꾸려면 gallerywalk 쪽 공용 함수를 함께 바꿔야 한다. AWS의 we-viewer-request 함수(LIVE)도 지우지 않고 남겨 두었다.
//
// 원래 설계(PLAN §2.1, §7.3, §15.2):
// 왜 필요한가:
//   1) write.ssamuniverse.com 외 호스트(d*.cloudfront.net 등)로 들어오면 정식 주소로 308 이동시킨다.
//   2) 시청자 실제 IP를 x-we-client-ip로 덮어써 클라이언트가 같은 이름의 머리를 위조해 보내도 무력화한다.
//      원본(origin-write.ssamuniverse.com)은 CloudFront 비밀 머리(x-we-origin-auth) 없이는 Cloudflare WAF가 403으로 막는다.

var CANONICAL_HOST = 'write.ssamuniverse.com';
var ALLOWED_HOSTS = { 'write.ssamuniverse.com': true };

function serializeQuery(querystring) {
  var parts = [];
  for (var key in querystring) {
    var item = querystring[key];
    if (item.multiValue) {
      for (var i = 0; i < item.multiValue.length; i++) {
        parts.push(item.multiValue[i].value === '' ? key : key + '=' + item.multiValue[i].value);
      }
    } else {
      parts.push(item.value === '' ? key : key + '=' + item.value);
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}

function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value : '';

  if (!ALLOWED_HOSTS[host]) {
    return {
      statusCode: 308,
      statusDescription: 'Permanent Redirect',
      headers: {
        location: {
          value: 'https://' + CANONICAL_HOST + request.uri + serializeQuery(request.querystring),
        },
      },
    };
  }

  request.headers['x-we-client-ip'] = { value: event.viewer.ip };
  request.headers['x-we-forwarded-host'] = { value: host };
  return request;
}
