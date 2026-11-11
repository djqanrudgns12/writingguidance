import { defaultConfig } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { useId, type FormEvent } from 'react';
import { Button } from '../../components/Button.tsx';
import { Checkbox } from '../../components/Checkbox.tsx';
import { Chip } from '../../components/Chip.tsx';
import { Switch } from '../../components/Switch.tsx';
import { TextField } from '../../components/TextField.tsx';
import { TimerPill } from '../../components/TimerPill.tsx';
import { formatMinutes } from './format.ts';
import styles from './NoticePanel.module.css';
import {
  TIMER_ALERT_MINUTES,
  timerAlertAvailable,
  timerDraftMinutes,
  type TimerAlertsDraft,
  type TimerDraft,
  type TimerModel,
} from './timerDraft.ts';

/** 자주 쓰는 문구 칩(PRD F-19). 누르면 바로 보낸다. */
const PRESET_NOTICES: readonly string[] = [
  ko.teacher.noticePreset5Min,
  ko.teacher.noticePresetSubmit,
  ko.teacher.noticePresetLookTeacher,
  ko.teacher.noticePresetPraise,
];

export interface NoticePanelViewProps {
  /** 직접 입력 한 줄. */
  readonly draft: string;
  readonly onDraftChange: (next: string) => void;
  readonly onSend: (text: string) => void;
  readonly sending?: boolean | undefined;
  /** 알림 소리(수업방 설정 `알림 소리`와 같은 값 하나, PRD F-19). */
  readonly sound: boolean;
  readonly onSoundChange: (on: boolean) => void;
  readonly timer: TimerModel;
  readonly timerDraft: TimerDraft;
  readonly onTimerDraftChange: (patch: Partial<TimerDraft>) => void;
  readonly onTimerStart: () => void;
  readonly onTimerPause: () => void;
  readonly onTimerResume: () => void;
  readonly onTimerCancel: () => void;
  readonly maxChars?: number | undefined;
  readonly timerPresets?: readonly number[] | undefined;
  readonly timerMaxMinutes?: number | undefined;
}

/**
 * 알림 팝오버 안쪽(PRD F-19): 위 칸 `바로 보내기`, 아래 칸 `타이머`, 맨 아래 `소리`.
 * 팝오버 틀은 대시보드가 두고, 이 부품은 내용만 그린다(견본에서 펼쳐 놓고 보려고).
 */
export function NoticePanelView({
  draft,
  onDraftChange,
  onSend,
  sending = false,
  sound,
  onSoundChange,
  timer,
  timerDraft,
  onTimerDraftChange,
  onTimerStart,
  onTimerPause,
  onTimerResume,
  onTimerCancel,
  maxChars = defaultConfig.NOTICE_MAX_CHARS,
  timerPresets = defaultConfig.TIMER_PRESETS_MIN,
  timerMaxMinutes = defaultConfig.TIMER_MAX_MIN,
}: NoticePanelViewProps) {
  const sendId = useId();
  const timerId = useId();
  const trimmed = draft.trim();
  const minutes = timerDraftMinutes(timerDraft, timerMaxMinutes);
  const timerActive = timer.status !== 'IDLE' && timer.remainingSec !== null;

  const handleSend = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (trimmed && !sending) onSend(trimmed);
  };

  const setAlert = (key: keyof TimerAlertsDraft, on: boolean) =>
    onTimerDraftChange({ alerts: { ...timerDraft.alerts, [key]: on } });

  return (
    <div className={styles.panel}>
      <section className={styles.section} aria-labelledby={sendId}>
        <h3 id={sendId} className={styles.heading}>
          {ko.teacher.noticeSendTab}
        </h3>
        <div className={styles.chips}>
          {PRESET_NOTICES.map(text => (
            <Chip key={text} icon="submit" disabled={sending} onClick={() => onSend(text)}>
              {text}
            </Chip>
          ))}
        </div>
        <form className={styles.sendRow} onSubmit={handleSend}>
          <TextField
            aria-label={ko.teacher.noticeCustomPlaceholder}
            placeholder={ko.teacher.noticeCustomPlaceholder}
            value={draft}
            maxLength={maxChars}
            autoComplete="off"
            onChange={e => onDraftChange(e.target.value)}
          />
          <Button type="submit" variant="secondary" icon="submit" loading={sending} disabled={!trimmed}>
            {ko.teacher.noticeSendAction}
          </Button>
        </form>
      </section>

      <section className={styles.section} aria-labelledby={timerId}>
        <h3 id={timerId} className={styles.heading}>
          {ko.teacher.timerTab}
        </h3>
        {timerActive && timer.remainingSec !== null ? (
          <div className={styles.running}>
            <TimerPill
              remainingSeconds={timer.remainingSec}
              state={timer.status === 'PAUSED' ? 'paused' : undefined}
            />
            <div className={styles.runningActions}>
              {timer.status === 'PAUSED' ? (
                <Button variant="secondary" icon="timer" onClick={onTimerResume}>
                  {ko.teacher.timerResumeAction}
                </Button>
              ) : timer.remainingSec > 0 ? (
                <Button variant="secondary" icon="pause" onClick={onTimerPause}>
                  {ko.teacher.timerPauseAction}
                </Button>
              ) : null}
              <Button variant="ghost" icon="close" onClick={onTimerCancel}>
                {ko.teacher.timerCancelAction}
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.timerForm}>
            <div className={styles.chips} role="group" aria-labelledby={timerId}>
              {timerPresets.map(m => (
                <Chip
                  key={m}
                  selected={timerDraft.preset === m}
                  onClick={() => onTimerDraftChange({ preset: m })}
                >
                  {formatMinutes(m)}
                </Chip>
              ))}
              <Chip
                selected={timerDraft.preset === 'custom'}
                onClick={() => onTimerDraftChange({ preset: 'custom' })}
              >
                {ko.teacher.timerPresetCustom}
              </Chip>
            </div>
            {timerDraft.preset === 'custom' ? (
              <TextField
                label={ko.teacher.timerCustomMinutesLabel}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={timerDraft.customMinutes}
                maxLength={String(timerMaxMinutes).length}
                onChange={e => onTimerDraftChange({ customMinutes: e.target.value.replace(/\D+/g, '') })}
              />
            ) : null}
            <div className={styles.alerts}>
              <Checkbox
                size="md"
                label={ko.teacher.timerAlert5Min}
                checked={
                  timerDraft.alerts.fiveMin && timerAlertAvailable(minutes, TIMER_ALERT_MINUTES.fiveMin)
                }
                disabled={!timerAlertAvailable(minutes, TIMER_ALERT_MINUTES.fiveMin)}
                onCheckedChange={on => setAlert('fiveMin', on)}
              />
              <Checkbox
                size="md"
                label={ko.teacher.timerAlert1Min}
                checked={timerDraft.alerts.oneMin && timerAlertAvailable(minutes, TIMER_ALERT_MINUTES.oneMin)}
                disabled={!timerAlertAvailable(minutes, TIMER_ALERT_MINUTES.oneMin)}
                onCheckedChange={on => setAlert('oneMin', on)}
              />
              <Checkbox
                size="md"
                label={ko.teacher.timerAlertEnd}
                checked={timerDraft.alerts.end}
                onCheckedChange={on => setAlert('end', on)}
              />
            </div>
            {timerDraft.alerts.end ? (
              <TextField
                aria-label={ko.teacher.timerEndTextLabel}
                value={timerDraft.endText}
                maxLength={maxChars}
                autoComplete="off"
                onChange={e => onTimerDraftChange({ endText: e.target.value })}
              />
            ) : null}
            <Button
              variant="primary"
              icon="timer"
              fullWidth
              disabled={minutes === null}
              onClick={onTimerStart}
            >
              {ko.teacher.timerStartAction}
            </Button>
          </div>
        )}
      </section>

      <Switch
        className={styles.sound}
        label={ko.teacher.soundSwitchLabel}
        checked={sound}
        onCheckedChange={onSoundChange}
      />
    </div>
  );
}
