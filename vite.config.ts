import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'

// O launch.json do preview do Claude Code (só nesta máquina) inicia o Vite dev-server via
// caminho curto (8.3, ex.: MEU-CO~1), e fs.realpathSync NÃO expande esse alias pro nome longo
// real (não é um symlink) — então root/fs.allow calculados a partir de cwd continuam no
// formato curto e o Vite responde 403. A correção é fixar a raiz como string absoluta (longa),
// mas isso NÃO pode ser incondicional: travaria o build em qualquer outra máquina/CI, onde esse
// caminho específico do Windows não existe. `fs.existsSync` garante que só se aplica aqui.
const RAIZ_DEV_LOCAL = 'C:/Users/silar/OneDrive/PESSSOAL/IA/Claude Code/Projetos/Saude/meu-coach'
const temRaizDevLocal = fs.existsSync(RAIZ_DEV_LOCAL)

export default defineConfig({
  plugins: [react()],
  ...(temRaizDevLocal ? { root: RAIZ_DEV_LOCAL } : {}),
  server: {
    host: true, // permite abrir pelo celular na mesma rede Wi-Fi
    ...(temRaizDevLocal ? { fs: { allow: [RAIZ_DEV_LOCAL] } } : {}),
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
