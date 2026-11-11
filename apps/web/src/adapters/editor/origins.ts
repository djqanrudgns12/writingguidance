/**
 * Yjs 변경 출처 표시(PLAN §6.3 "두 문서 잇기").
 * - LOCAL: 이 기기의 입력, 앱이 하는 변경. 되돌리기는 이것만 되돌린다(학생의 `[되돌리기]`가 교사 수정을 안 건드림).
 * - INIT_MEMO: 메모 칸 준비. 빈 `Y.Text` 그릇 만들기(예전 글), 서버 칸을 받기 전에 보관한 입력을 그 칸에 옮기기(검토 B02).
 *   통신용 문서로는 중계하되 Undo 스택에는 넣지 않는다.
 * - SANITIZE: 원격·초기 문서에 섞인 허용 외 줄바꿈(`\r`, 제목의 `\n`)을 정리하는 트랜잭션. Undo 스택에는 넣지 않는다.
 * - FROM_VIEW: 편집용 → 통신용으로 옮긴 것(통신용에서 다시 편집용으로 돌려보내지 않음).
 * - FROM_NET: 통신용 → 편집용으로 옮긴 것(반영 문이 열릴 때만).
 */
export const LOCAL = Symbol('local');
export const INIT_MEMO = Symbol('init-memo');
export const SANITIZE = Symbol('sanitize');
export const FROM_VIEW = Symbol('from-view');
export const FROM_NET = Symbol('from-net');
