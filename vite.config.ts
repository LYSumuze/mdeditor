import { defineConfig } from 'vite';
import { resolve } from 'path';

const isElectron = process.env.ELECTRON === 'true';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: isElectron ? undefined : {
    port: 5000,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
