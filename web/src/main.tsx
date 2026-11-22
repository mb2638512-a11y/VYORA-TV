import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './styles/player-pro.css'
import './styles/phone.css'
import './styles/tv.css'

// Native Android identifies the actual device class. Browser previews fall
// back to viewport + pointer capabilities without mistaking a desktop for TV.
const nativeBridge = (window as Window & { VyoraBridge?: { isTvDevice?: () => boolean } }).VyoraBridge
const isNativeTv = nativeBridge?.isTvDevice?.() === true
const isPhoneViewport = window.matchMedia('(max-width: 768px)').matches
const isAndroidPhone = /Android/i.test(navigator.userAgent) && !isNativeTv
const deviceMode = isNativeTv ? 'tv' : (isPhoneViewport || isAndroidPhone ? 'phone' : 'desktop')
document.documentElement.dataset.device = deviceMode
document.body.classList.add(`device-${deviceMode}`)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
