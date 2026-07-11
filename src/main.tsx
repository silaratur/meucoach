import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { aplicarTema, temaSalvoNesteAparelho } from './theme.ts'

aplicarTema(temaSalvoNesteAparelho())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
