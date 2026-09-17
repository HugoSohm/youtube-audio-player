import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  // Le plugin @crxjs gère automatiquement le bundling du manifest,
  // l'injection des content scripts et les web-accessible resources.
  plugins: [
    crx({ manifest }),
  ],

  // SCSS global
  css: {
    preprocessorOptions: {
      scss: {
        // API Sass moderne (silence les warnings de déprécation)
        api: 'modern-compiler' as const,
      },
    },
  },

  build: {
    // Target ES2022 pour les content scripts (Chrome 100+)
    target: 'es2022',
    // Inline les petits assets (<4KB) directement dans le JS
    assetsInlineLimit: 4096,
    // Minification Terser désactivée pour faciliter le debug initial
    minify: false,
    // Pas de sourcemaps dans le paquet publié (npm run package → RELEASE=true)
    sourcemap: process.env.RELEASE !== 'true',
    rollupOptions: {
      output: {
        // Content scripts doivent être des fichiers uniques (pas de chunks)
        inlineDynamicImports: false,
      },
    },
  },

  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
