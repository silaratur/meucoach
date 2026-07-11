import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// O launch.json do preview inicia este servidor via caminho curto (8.3, ex.: MEU-CO~1), e
// fs.realpathSync NÃO expande esse alias pro nome longo real (não é um symlink, é um nome
// alternativo válido do próprio filesystem) — então root/fs.allow calculados a partir de
// cwd ou import.meta.url continuam no formato curto e nunca batem com o path real das
// requisições. Fixamos a raiz como uma string absoluta (longa) em vez de derivar do cwd.
const RAIZ_PROJETO = 'C:/Users/silar/OneDrive/PESSSOAL/IA/Claude Code/Projetos/Saude/meu-coach'

export default defineConfig({
  root: RAIZ_PROJETO,
  plugins: [react()],
  server: {
    host: true, // permite abrir pelo celular na mesma rede Wi-Fi
    fs: { allow: [RAIZ_PROJETO] },
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
