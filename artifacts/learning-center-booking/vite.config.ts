import fs from 'fs';
import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const rawPort = process.env.PORT ?? '5173';
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? '/';

// Environment files live at the monorepo root, matching the documented setup.
const envDir = path.resolve(import.meta.dirname, '..', '..');

// Staging must never silently fall back to .env.local, which is production.
const modeIndex = process.argv.indexOf('--mode');
if (
  modeIndex >= 0 &&
  process.argv[modeIndex + 1] === 'staging' &&
  !fs.existsSync(path.join(envDir, '.env.staging.local')) &&
  !fs.existsSync(path.join(envDir, '.env.staging'))
) {
  throw new Error(`Staging mode needs ${path.join(envDir, '.env.staging.local')} with the staging project's URL and publishable key.`);
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  // Vite otherwise defaults envDir to `root` above (the app subdirectory).
  envDir,
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '127.0.0.1',
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '127.0.0.1',
  },
});
