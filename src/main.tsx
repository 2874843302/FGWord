import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import QuickAddPanel from './components/QuickAddPanel'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get('view') === 'quick-add' ? <QuickAddPanel /> : <App />}
  </React.StrictMode>,
)
