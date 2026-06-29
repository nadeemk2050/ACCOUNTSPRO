import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'dist'),
  server: {
    port: 5200,
    host: true
  },
  build: {
    outDir: resolve(__dirname, 'dist')
  }
});
