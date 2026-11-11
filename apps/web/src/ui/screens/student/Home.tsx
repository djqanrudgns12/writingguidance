import { ko } from '@geulbang/core/copy';
import styles from './Home.module.css';

/** S0 홈(PRD F-01). P1은 빈 껍데기다. 배치는 P3-9(시안), 결합은 P3-10. */
export function Home() {
  return (
    <main className={styles.home}>
      <h1 className={styles.title}>{ko.common.appName}</h1>
    </main>
  );
}
