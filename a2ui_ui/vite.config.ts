import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { conversationsApiPlugin } from './server/conversationsPlugin.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), conversationsApiPlugin()],
})
