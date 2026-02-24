import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { PanelApp } from './PanelApp'

const root = document.getElementById('root')!
createRoot(root).render(
  <React.StrictMode>
    <PanelApp />
  </React.StrictMode>
)
