import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El BFF (puerto 3300) sirve la API en /api/mc y, en producción, esta carpeta dist/.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3300', changeOrigin: false },
    },
  },
  preview: { host: '127.0.0.1', port: 4173 },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, target: 'es2022' },
});
