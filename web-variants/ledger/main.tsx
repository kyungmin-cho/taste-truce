import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import './theme.css'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      <Toaster position="bottom-left" duration={2500} />
    </TooltipProvider>
  </StrictMode>,
)
