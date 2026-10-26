import { defineConfig } from 'vite'

export default defineConfig({
  root: 'site',
  base: './',
  publicDir: false,
  // Vite is only the local server/preview. npm run build copies site unchanged.
  build: { outDir: '../dist', emptyOutDir: false },
})
