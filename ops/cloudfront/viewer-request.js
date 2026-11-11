// 쌤유 글방 CloudFront 시청자 요청 함수 (런타임 cloudfront-js-2.0, 이벤트: viewer-request) — 정식 호스트 강제 + 시청자 IP 덮어쓰기.
// 배포 E3TFCRGRU1HG1Q의 모든 cache behavior(`*`, `/assets/*`, `/art/*`)에 연결한다(PLAN §2.1, §7.3, §15.2).
//
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
