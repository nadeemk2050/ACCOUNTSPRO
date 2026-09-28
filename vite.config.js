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
        maximumFileSizeToCacheInBytes: 5000000, // 5MB
        importScripts: ['sw-sync.js'],
        // Perf: never pre-cache the heavy on-demand libraries; they are fetched (and then
        // runtime-cached) only when the user actually imports/exports. Keeps deploy refresh small.
        globIgnores: [
          '**/*.map',
          '**/xlsx-*.js',
          '**/jspdf-*.js',
          '**/html2canvas-*.js',
          '**/jspreadsheet-*.js',
          '**/canvg-*.js'
        ],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(xlsx|jspdf|html2canvas|jspreadsheet|canvg)-[^/]+\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'accpro-lazy-libs',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      },
      devOptions: {
        // Perf: no service worker during `npm run dev` (slowed HMR and served stale assets)
        enabled: false
      }
    })
  ],
  build: {
    // Perf: no source maps in the shipped build (index map alone was ~11 MB per deploy)
    sourcemap: false,
    rollupOptions: {
      output: {
        // Perf: stable chunk names for the heavy on-demand libraries so the service worker
        // can exclude them from the pre-cache manifest (see workbox.globIgnores).
        manualChunks(id) {
          // Keep Vite's dynamic-import preload helper in its own tiny chunk.
          // (If it lands inside a heavy lazy library chunk, the browser preloads that
          // whole library at boot — e.g. jspdf was being downloaded on startup.)
          if (id.includes('preload-helper')) return 'runtime';
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor';
          if (/[\\/]node_modules[\\/](@firebase|firebase|@grpc|protobufjs)[\\/]/.test(id)) return 'firebase';
          if (id.includes('lucide-react')) return 'ui';
          if (/[\\/]node_modules[\\/]xlsx[\\/]/.test(id)) return 'xlsx';
          if (id.includes('canvg')) return 'canvg';
          if (id.includes('jspdf')) return 'jspdf';
          if (id.includes('html2canvas')) return 'html2canvas';
          if (id.includes('jspreadsheet') || id.includes('jsuites')) return 'jspreadsheet';
          return undefined;
        }
      }
    },
    chunkSizeWarningLimit: 1000,
  }
})
