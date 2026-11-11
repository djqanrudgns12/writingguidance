import { Toast } from '../../ui/components/Toast.tsx';
import type { ToastControl } from './hooks/useToast.ts';
import styles from './ToastLayer.module.css';

/** 토스트 한 줄. `floating`이면 화면 아래에 띄운다(토스트 자리가 없는 화면용). */
export function ToastLayer({ control, floating = true }: { control: ToastControl; floating?: boolean }) {
  const { toast, dismiss } = control;
  if (!toast) return null;
  const node = <Toast key={toast.id} message={toast.message} tone={toast.tone} onDismiss={dismiss} />;
  return floating ? <div className={styles.layer}>{node}</div> : node;
}
