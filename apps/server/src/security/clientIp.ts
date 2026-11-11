import { isIP } from 'node:net';

/**
 * 학생 IP(PLAN §7.3). CloudFront 시청자 요청 함수가 시청자 IP로 덮어쓴 `x-we-client-ip`만 믿는다.
 * Cloudflare의 `CF-Connecting-IP`는 CloudFront 주소라 쓰지 않는다. 원문은 저장·기록하지 않고 HMAC로만 쓴다.
 * 머리가 없으면(개발·맥 안에서 직접) `127.0.0.1`.
 */
export const CLIENT_IP_HEADER = 'x-we-client-ip';

export function clientIpFrom(headers: Headers): string {
  const value = headers.get(CLIENT_IP_HEADER)?.trim();
  if (value && isIP(value) !== 0) return value;
  return '127.0.0.1';
}

/** 터널(cloudflared)을 거쳐 들어온 요청인가. 맥 안의 상태 확인 경로를 밖에서 못 부르게 한다. */
export function cameThroughTunnel(headers: Headers): boolean {
  return headers.has('cf-connecting-ip') || headers.has('cf-ray') || headers.has(CLIENT_IP_HEADER);
}
