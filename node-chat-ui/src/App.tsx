import { useState } from 'react'
import heroImg from './assets/hero.png'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import './App.css'
import WhatsAppChat from './components/WhatsAppChat'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="app-layout">
      <div className="app-content">
      <div className="ticks">
<section id="spacer">
           <WhatsAppChat />
        </section>
      </div>
        
      </div>
     
    </div>
  )
}

export default App
