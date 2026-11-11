import type { Observable } from './observable.ts';

/**
 * 앱 업데이트 포트(PLAN §6.6, ADR-025). 새 판은 받아 두기만 하고, 홈·선생님 홈·다음 실행 때만 적용한다.
 * 쓰기·대시보드 화면은 `applyIfReady`를 부르지 않는다(쓰는 중에 화면이 바뀌지 않게).
 */
export interface PwaPort {
  /** 새 판을 받아 두었는가 */
  readonly updateReady: Observable<boolean>;
  /** 받아 둔 새 판이 있으면 적용하고 한 번 다시 불러온다. 없으면 아무것도 하지 않는다. */
  applyIfReady(): void;
}
