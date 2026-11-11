import { defaultConfig } from '@geulbang/core/config';
import { ko } from '@geulbang/core/copy';
import { type CSSProperties } from 'react';
import { Chip } from '../../../components/index.ts';
import { SheetSurface } from '../../common/SheetSurface.tsx';
import styles from './SmallSheets.module.css';

/** `FONT_SIZES`(16·18·21·24) 순서와 같은 이름(PRD F-13). */
const SIZE_LABELS = [
  ko.common.fontSizeSmall,
  ko.common.fontSizeMedium,
  ko.common.fontSizeLarge,
  ko.common.fontSizeXLarge,
] as const;

export interface FontSizeSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly value: number;
  readonly onChange: (size: number) => void;
  readonly inline?: boolean | undefined;
}

/** `··· > 글자 크기`(PRD F-13): 작게·보통·크게·아주 크게. 쓰기 칸과 패널에 함께 적용하고 기기에 기억한다(결합). */
export function FontSizeSheet({ open, onOpenChange, value, onChange, inline }: FontSizeSheetProps) {
  return (
    <SheetSurface open={open} onOpenChange={onOpenChange} title={ko.common.fontSize} inline={inline}>
      <div className={styles.sizes} role="group" aria-label={ko.common.fontSize}>
        {defaultConfig.FONT_SIZES.map((size, index) => (
          <Chip
            key={size}
            selected={value === size}
            onClick={() => onChange(size)}
            className={styles.sizeChip}
            style={{ '--size-sample': `${size}px` } as CSSProperties}
            data-font-size={size}
          >
            {SIZE_LABELS[index] ?? String(size)}
          </Chip>
        ))}
      </div>
    </SheetSurface>
  );
}
