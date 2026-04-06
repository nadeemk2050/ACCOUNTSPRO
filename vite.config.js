import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  base: './', // CRUCIAL FOR ELECTRON
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      'firebase/firestore': path.resolve(process.cwd(), './src/rxfs.js'),
      'firebase/database': path.resolve(process.cwd(), './src/rxrtdb.js'),
      'firebase/functions': path.resolve(process.cwd(), './src/rxfunctions.js'),
      'firebase/storage': path.resolve(process.cwd(), './src/rxstorage.js')
    }
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['accpro-icon.svg', 'accpro-icon-maskable.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        id: '/?app=accpro-offline',
        name: 'ACCPRO Offline',
        short_name: 'ACCPRO',
        description: 'ACCPRO Offline Data App',
        start_url: './?app=accpro-offline',
        scope: './',
        display: 'standalone',
        theme_color: '#0b4a5a',
        background_color: '#0b4a5a',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 5000000 // 5MB
      },
      devOptions: {
        enabled: true
      }
    })
  ],
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/database', 'firebase/functions'],
          ui: ['lucide-react']
        }
      }
    },
    chunkSizeWarningLimit: 1000,
  }
})
