import type { Plugin } from 'vite';

export function pwaPlugin(options: {
  name: string;
  shortName: string;
  themeColor?: string;
  backgroundColor?: string;
}): Plugin;
