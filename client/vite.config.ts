import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const clientDir = import.meta.dirname ?? path.resolve()

export default defineConfig({
  // Always resolve from the client/ directory regardless of where vite is invoked from
  root: clientDir,
  plugins: [react()],
  server: {
    port: 8000,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    // Absolute path so it works whether invoked from repo root or client/
    outDir: path.resolve(clientDir, '../dist/client'),
    emptyOutDir: true,
  },
})