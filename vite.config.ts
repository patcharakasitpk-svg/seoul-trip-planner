import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
} as any);
