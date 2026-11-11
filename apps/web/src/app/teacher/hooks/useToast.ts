import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToastTone } from '../../../ui/components/Toast.tsx';

export interface ToastMessage {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

export interface ToastControl {
  readonly toast: ToastMessage | null;
  show(message: string, tone?: ToastTone): void;
  dismiss(): void;
}

/** 하단 종이 토스트 한 줄(PRD 7.2 오류). 새 것이 오면 앞의 것을 바꾸고, `hideMs` 뒤 사라진다. */
export function useToast(hideMs: number): ToastControl {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const seq = useRef(0);
  const show = useCallback((message: string, tone: ToastTone = 'default') => {
    if (!message) return;
    seq.current += 1;
    setToast({ id: seq.current, message, tone });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), hideMs);
    return () => clearTimeout(timer);
  }, [toast, hideMs]);
  return { toast, show, dismiss };
}
