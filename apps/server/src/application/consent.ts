import { AppError } from '@geulbang/core/errors';

/**
 * 처리방침 동의 판 검사 한 곳(PRD F-03). 동의한 판이 지금 `POLICY_VERSION`과 다르면 다시 동의 전이다.
 * 거절 모양은 입장·재동의와 같은 `E_INPUT {consentVersion:'outdated'}`(새 오류 코드를 만들지 않는다, P6-consent-block).
 * 쓰는 곳: 입장(`joinRoom`), 재동의(`consent.update`), 학생의 새 글(`doc.create`)·제출(`doc.submit`).
 */
export function isConsentCurrent(consentVersion: string | null | undefined, policyVersion: string): boolean {
  return consentVersion === policyVersion;
}

export function assertConsentCurrent(consentVersion: string | null | undefined, policyVersion: string): void {
  if (!isConsentCurrent(consentVersion, policyVersion)) {
    throw new AppError('E_INPUT', 'consent version is not current', { consentVersion: 'outdated' });
  }
}
