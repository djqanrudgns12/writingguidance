/** CSS 모듈 이름 잇기. `noUncheckedIndexedAccess`라 `styles.x`가 `string | undefined`여서 빈 값은 걸러 낸다. */
export function cx(...names: ReadonlyArray<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}
