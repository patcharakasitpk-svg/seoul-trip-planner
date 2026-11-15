import { defineConfig } from 'vite';
// ทดสอบกฎความปลอดภัย Firestore — รันผ่าน `npm run test:rules` (ต้องมี Firestore emulator)
export default defineConfig({ test: { include: ['tests/rules/**/*.test.ts'], environment: 'node', testTimeout: 20000, fileParallelism: false } } as any);
