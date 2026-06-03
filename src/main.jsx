// src/main.jsx
// -----------------------------------------------------------------------------
// The entry point. Vite loads this first (see index.html). Its only job is to
// mount our top-level <App /> component into the page and load global styles.
// -----------------------------------------------------------------------------
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// React 18's createRoot is the modern way to render. StrictMode adds extra
// dev-only checks (it double-invokes some functions in development to surface
// bugs — this does NOT happen in the production build).
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
