import { useCallback, useEffect, useRef } from 'react';

/**
 * 교사 알림 소리(PLAN §6.7): 오디오 파일 없이 Web Audio로 짧게. iOS는 사용자가 한 번 만진 뒤에만 소리 장치를 열 수
 * 있어서 첫 터치(누름) 때 장치를 연다. 그 전에 온 알림은 소리 없이 글만 보인다.
 * 소리 모양(높이·길이·크기)은 설정값이 아니라 알림 소리 디자인 값이다.
 */
const TONE_HZ = 880;
const TONE_SEC = 0.18;
const TONE_GAIN = 0.12;

type AudioCtor = typeof AudioContext;

export function useNoticeSound(): () => void {
  const ctx = useRef<AudioContext | null>(null);

  useEffect(() => {
    const Ctor = (globalThis.AudioContext ??
      (globalThis as { webkitAudioContext?: AudioCtor }).webkitAudioContext) as AudioCtor | undefined;
    if (!Ctor) return;
    const unlock = () => {
      try {
        ctx.current ??= new Ctor();
        void ctx.current.resume();
      } catch {
        // 소리 장치를 열 수 없는 기기: 글로만 알린다.
      }
    };
    globalThis.addEventListener('pointerdown', unlock, { once: true, capture: true });
    return () => {
      globalThis.removeEventListener('pointerdown', unlock, { capture: true });
      void ctx.current?.close().catch(() => {});
      ctx.current = null;
    };
  }, []);

  return useCallback(() => {
    const audio = ctx.current;
    if (!audio || audio.state !== 'running') return;
    try {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const t = audio.currentTime;
      osc.frequency.value = TONE_HZ;
      gain.gain.setValueAtTime(TONE_GAIN, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + TONE_SEC);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + TONE_SEC);
    } catch {
      // 소리는 덤이다.
    }
  }, []);
}
