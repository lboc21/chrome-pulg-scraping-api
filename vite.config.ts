import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// popup 页面用 Vite 构建，background / content scripts 由 scripts/build-extension.mjs（esbuild）构建，
// 因为 MV3 的 content script 必须是 IIFE，且 MAIN world 脚本不能走 @crxjs 的动态 import 加载器。
export default defineConfig({
  root: fileURLToPath(new URL('./src/popup', import.meta.url)),
  base: './',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: false, // dist 由 npm run build 统一清理，避免与 esbuild 产物互相覆盖
    target: 'chrome111',
    assetsDir: 'assets',
    rollupOptions: {
      input: { popup: fileURLToPath(new URL('./src/popup/index.html', import.meta.url)) },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  }
});
