import type { AiButton, GenreId } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { Sheet } from '../../components/Sheet.tsx';
import { Switch } from '../../components/Switch.tsx';
import { AiButtonSwitches, GenreChecks } from './RoomOptionFields.tsx';
import styles from './RoomSettings.module.css';

/** 수업 중에 바꿀 수 있는 설정(PRD F-22 MUST: `room.update`). */
export interface RoomSettingsValues {
  readonly genres: readonly GenreId[];
  readonly aiButtons: readonly AiButton[];
  readonly sound: boolean;
}

export interface RoomSettingsPanelViewProps {
  readonly settings: RoomSettingsValues;
  /** 바꾸는 즉시 부른다(저장 단추 없음, 학생 화면에 바로 반영, PRD F-22). */
  readonly onChange: (patch: Partial<RoomSettingsValues>) => void;
  readonly disabled?: boolean | undefined;
}

/** 수업방 설정 내용: 보여 줄 글 종류 · 글벗 버튼 · 알림 소리(v1). v1.1 항목은 아직 두지 않는다. */
export function RoomSettingsPanelView({ settings, onChange, disabled = false }: RoomSettingsPanelViewProps) {
  return (
    <div className={styles.panel}>
      <GenreChecks
        legend={ko.teacher.visibleGenresLabel}
        value={settings.genres}
        disabled={disabled}
        onChange={genres => onChange({ genres })}
      />
      <AiButtonSwitches
        legend={ko.teacher.enabledAiButtonsLabel}
        value={settings.aiButtons}
        disabled={disabled}
        onChange={aiButtons => onChange({ aiButtons })}
      />
      <Switch
        className={styles.sound}
        label={ko.teacher.noticeSoundSettingLabel}
        checked={settings.sound}
        disabled={disabled}
        onCheckedChange={sound => onChange({ sound })}
      />
    </div>
  );
}

export interface RoomSettingsSheetProps extends RoomSettingsPanelViewProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** `··· > 수업방 설정` 시트(900px 이상은 옆 패널). */
export function RoomSettingsSheet({ open, onOpenChange, ...panel }: RoomSettingsSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      mode="responsive"
      headerIcon="settings"
      title={ko.teacher.roomSettingsTitle}
    >
      <RoomSettingsPanelView {...panel} />
    </Sheet>
  );
}
