import { ko } from '@geulbang/core/copy';
import styles from './NotFound.module.css';

/** 없는 주소. P3에서 "없는 수업방" 상태 화면(PRD 7.2, 그림 4)으로 바뀐다. */
export function NotFound() {
  return (
    <main className={styles.page}>
      <p className={styles.message}>{ko.errors.E_ROOM_NOT_FOUND}</p>
    </main>
  );
}
