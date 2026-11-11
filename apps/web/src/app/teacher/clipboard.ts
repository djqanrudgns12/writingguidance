/**
 * 글·선생님 링크 복사. 클립보드는 포트를 두지 않고 결합 부품에서 바로 쓴다(P4-13 브리프).
 * 권한이 없거나 안전하지 않은 주소라 막히면 false(부른 쪽이 토스트로 알린다).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
