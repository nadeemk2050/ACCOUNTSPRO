import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  base: './', // CRUCIAL FOR ELECTRON
  server: {
    open: true, // open in external default browser, not VS Code simple browser
    browser: 'external',
  },
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
        ],
        shortcuts: [
          {
            name: 'New Payment',
            short_name: 'Payment',
            description: 'Create a new payment voucher',
            url: './?app=accpro-offline&voucher=payment',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
          },
          {
            name: 'New Receipt',
            short_name: 'Receipt',
            description: 'Create a new receipt voucher',
            url: './?app=accpro-offline&voucher=receipt',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
          },
          {
            name: 'New Journal',
            short_name: 'Journal',
            description: 'Create a new journal voucher',
            url: './?app=accpro-offline&voucher=journal',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
          },
          {
            name: 'New Contra',
            short_name: 'Contra',
            description: 'Create a new contra voucher',
            url: './?app=accpro-offline&voucher=contra',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
          },
          {
            name: 'New Sales',
            short_name: 'Sales',
            description: 'Create a new sales invoice',
            url: './?app=accpro-offline&voucher=sales',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
          },
          {
            name: 'New Purchase',
            short_name: 'Purchase',
            description: 'Create a new purchase invoice',
            url: './?app=accpro-offline&voucher=purchase',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
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
