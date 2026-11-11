import { AI_BUTTONS, GENRE_IDS, type AiButton, type GenreId } from '@geulbang/core';
import { useId } from 'react';
import { Checkbox } from '../../components/Checkbox.tsx';
import { Switch } from '../../components/Switch.tsx';
import { aiButtonLabel, genreLabel, genreSubtitle } from './format.ts';
import styles from './RoomOptionFields.module.css';

export interface GenreChecksProps {
  readonly legend: string;
  readonly value: readonly GenreId[];
  readonly onChange: (next: readonly GenreId[]) => void;
  readonly error?: string | undefined;
  readonly disabled?: boolean | undefined;
}

function toggle<T extends string>(list: readonly T[], item: T, on: boolean, order: readonly T[]): T[] {
  const set = new Set(list);
  if (on) set.add(item);
  else set.delete(item);
  // 고른 순서가 아니라 카탈로그 순서로 돌려준다(서버에 보내는 값이 늘 같은 모양이 되게).
  return order.filter(id => set.has(id));
}

/**
 * 보여 줄 글 종류 6개 체크(PRD F-15·F-22). 하위 종류를 설명 글씨로 함께 보인다.
 * 마지막 하나는 끌 수 없게 막는다(수업방에 글 종류가 하나는 있어야 한다).
 */
export function GenreChecks({ legend, value, onChange, error, disabled = false }: GenreChecksProps) {
  const legendId = useId();
  return (
    <fieldset className={styles.group} aria-labelledby={legendId}>
      <legend id={legendId} className={styles.legend}>
        {legend}
      </legend>
      <div className={styles.genreGrid}>
        {GENRE_IDS.map(id => {
          const checked = value.includes(id);
          return (
            <Checkbox
              key={id}
              size="md"
              card
              checked={checked}
              disabled={disabled || (checked && value.length === 1)}
              label={genreLabel(id)}
              description={genreSubtitle(id)}
              onCheckedChange={on => onChange(toggle(value, id, on, GENRE_IDS))}
            />
          );
        })}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export interface AiButtonSwitchesProps {
  readonly legend: string;
  readonly value: readonly AiButton[];
  readonly onChange: (next: readonly AiButton[]) => void;
  readonly disabled?: boolean | undefined;
}

/** 글벗(AI) 버튼 4개 스위치(PRD F-15·F-22). 끄면 학생 화면에서 바로 사라진다(F-08). */
export function AiButtonSwitches({ legend, value, onChange, disabled = false }: AiButtonSwitchesProps) {
  const legendId = useId();
  return (
    <fieldset className={styles.group} aria-labelledby={legendId}>
      <legend id={legendId} className={styles.legend}>
        {legend}
      </legend>
      <div className={styles.switchGrid}>
        {AI_BUTTONS.map(button => (
          <Switch
            key={button}
            className={styles.switchRow}
            checked={value.includes(button)}
            disabled={disabled}
            label={aiButtonLabel(button)}
            onCheckedChange={on => onChange(toggle(value, button, on, AI_BUTTONS))}
          />
        ))}
      </div>
    </fieldset>
  );
}
