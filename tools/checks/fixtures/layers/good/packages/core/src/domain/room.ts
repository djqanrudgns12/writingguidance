import { formatDay } from './clock.ts';

export function isSameDay(a: number, b: number): boolean {
  return formatDay(a) === formatDay(b);
}
