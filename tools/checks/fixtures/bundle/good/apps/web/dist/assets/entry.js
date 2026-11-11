import { helper } from './chunk.js';
export async function openEditor() {
  return import('./lazy-editor.js');
}
console.log(helper, 'hero.webp');
