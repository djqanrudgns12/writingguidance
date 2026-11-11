import { randomUUID } from 'node:crypto';
export { z } from 'zod';

export function makeId() {
  return randomUUID();
}
