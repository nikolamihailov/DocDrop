import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The browser calls /api/... on the Vite dev server, which forwards it to Express.
    // That way the frontend and backend look like one origin, so no CORS setup is needed.
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
