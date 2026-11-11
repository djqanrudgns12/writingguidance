import { ko } from '@geulbang/core/copy';
import { Banner } from '../../components/Banner.tsx';
import { Button } from '../../components/Button.tsx';
import { LazyQr } from './qr/LazyQr.tsx';
import styles from './TeacherLinkQr.module.css';

export interface TeacherLinkQrViewProps {
  /** 선생님 링크 전체 주소(토큰 포함). 화면에는 글자로 보이지 않고 QR로만 보인다. */
  readonly teacherLinkUrl: string;
  readonly onClose: () => void;
}

/**
 * `선생님 링크 QR`(PRD F-16). 내 휴대폰으로 찍어 바로 대시보드를 여는 QR이라, **별도 창에서만** 띄우고
 * 맨 위에 "학생에게 보이지 않게 하세요" 경고를 둔다. 링크 글자는 화면에 쓰지 않는다(화면 공유로 새지 않게).
 */
export function TeacherLinkQrView({ teacherLinkUrl, onClose }: TeacherLinkQrViewProps) {
  return (
    <main className={styles.page}>
      <Banner tone="warning" icon="warning" message={ko.teacher.teacherLinkQrWarning} />
      <section className={styles.card} aria-label={ko.teacher.openTeacherLinkQrAction}>
        <h1 className={styles.title}>{ko.teacher.openTeacherLinkQrAction}</h1>
        <div className={styles.qr}>
          <LazyQr value={teacherLinkUrl} label={ko.teacher.openTeacherLinkQrAction} />
        </div>
      </section>
      <Button variant="secondary" icon="close" fullWidth onClick={onClose}>
        {ko.common.close}
      </Button>
    </main>
  );
}
