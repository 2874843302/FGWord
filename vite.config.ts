import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 渲染进程构建配置。Electron 加载 dist/index.html（生产）或 dev server（开发）。
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
