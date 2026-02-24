import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'public/manifest.json', dest: '.' },
        { src: 'public/icons/*', dest: 'icons' },
      ],
    }),
  ],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  // Chrome extensions require relative asset paths (not root-relative /...)
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        // Sidebar SPA (React app) — kept for reference
        sidebar: resolve(__dirname, 'src/sidebar/index.html'),
        // Popup panel (React app) — opened as a popup window on Bet click
        panel: resolve(__dirname, 'src/panel/index.html'),
        // Content script – must be a single self-contained file (ISOLATED world)
        contentScript: resolve(__dirname, 'src/content/contentScript.ts'),
        // Ethereum bridge – tiny MAIN world script that mirrors wallet calls
        ethereumBridge: resolve(__dirname, 'src/content/ethereumBridge.ts'),
        // Background service worker
        background: resolve(__dirname, 'src/background/background.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'contentScript') return 'content/contentScript.js'
          if (chunk.name === 'ethereumBridge') return 'content/ethereumBridge.js'
          if (chunk.name === 'background') return 'background/background.js'
          return '[name]/[name].js'
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (asset) => {
          const name = asset.name ?? ''
          if (name.endsWith('.css')) return 'assets/[name][extname]'
          return 'assets/[name]-[hash][extname]'
        },
      },
    },
  },
})
