import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Habilita la escucha en toda la red local (para conectar notebooks)
    port: 5174, // Cambiado a 5174 para evitar conflicto con la app CRIN en el puerto 5173
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      }
    }
  }
})
