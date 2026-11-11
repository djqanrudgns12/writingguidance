import { iconPaths, type IconName } from './icons.generated.tsx';

export type { IconName };

export interface IconProps {
  readonly name: IconName;
  readonly size?: 16 | 20 | 24 | 32 | 48;
  /** 아이콘만 있는 버튼이면 읽기 이름을 준다. 글자와 함께 쓰면 비워 둔다(장식으로 숨김). */
  readonly label?: string;
  readonly className?: string | undefined;
}

/**
 * 앱의 모든 아이콘은 이 부품 하나로 그린다(PRD 8.6 `[고정]`). 나중에 손그림 아이콘으로 바꿀 때 여기만 고친다.
 * Duotone: 옅은 면(`.icon-tone`, currentColor의 20%) + 선.
 */
export function Icon({ name, size = 24, label, className }: IconProps) {
  const paths = iconPaths[name];
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="currentColor"
      focusable="false"
      className={className}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {/* 생성 파일의 고정 목록이라 순서가 바뀌지 않는다. */}
      {paths.tone.map((d, i) => (
        <path key={`tone-${i}`} className="icon-tone" d={d} opacity={0.2} />
      ))}
      {paths.line.map((d, i) => (
        <path key={`line-${i}`} d={d} />
      ))}
    </svg>
  );
}
