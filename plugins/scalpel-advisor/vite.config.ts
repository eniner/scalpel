import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(root, 'src/index.tsx'),
      formats: ['es'],
      fileName: () => 'plugin.js',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react-dom/client', 'react-dom/server', 'react/jsx-runtime', '@scalpelpoe/plugin-sdk'],
    },
    minify: 'oxc',
    sourcemap: true,
  },
})
