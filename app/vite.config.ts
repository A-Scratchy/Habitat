import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'sample-habitat.csv'],
      manifest: {
        name: 'Our Habitat',
        short_name: 'Habitat',
        description: 'A calm, team-first household ecosystem.',
        theme_color: '#e8eee4',
        background_color: '#f4f1ea',
        display: 'standalone',
        // Honoured by the installed app on Android; elsewhere orientation.ts shows a gentle "turn it upright" screen.
        orientation: 'portrait',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,csv}'] },
    }),
  ],
  test: { environment: 'node' },
});
