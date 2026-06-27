import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// @a2ui/react@0.10.1's package.json "exports" map points
// "./styles/structural.css" at a file that doesn't exist on disk, and
// the real stylesheet (v0_9/index.css) isn't exposed via "exports" at
// all - so it can't be imported as a bare package import under strict
// ESM resolution. Vendored as a workaround; re-sync from
// node_modules/@a2ui/react/v0_9/index.css if the package is upgraded.
import './vendor/a2ui-structural.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
