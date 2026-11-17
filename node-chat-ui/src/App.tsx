import { useCallback, useState } from 'react'
import './App.css'
import { clearAuth, persistAuth, readAuthState, type AuthState } from './auth'
import AuthForms from './components/AuthForms'
import WhatsAppChat from './components/WhatsAppChat'

function App() {
  // The stored JWT is the only session state we restore on load.
  const [auth, setAuth] = useState<AuthState | null>(() => readAuthState())

  const handleLoginSuccess = useCallback((nextAuth: AuthState) => {
    persistAuth(nextAuth)
    setAuth(nextAuth)
  }, [])

  const handleLogout = useCallback(() => {
    clearAuth()
    setAuth(null)
  }, [])

  const handleUnauthorized = useCallback(() => {
    clearAuth()
    setAuth(null)
  }, [])

  return (
    <div className="app-layout">
      <div className="app-content">
        <div className="ticks">
          <section id="spacer">
            {auth ? (
              <WhatsAppChat
                displayName={auth.user.name || auth.user.email || 'Chat'}
                onLogout={handleLogout}
                onUnauthorized={handleUnauthorized}
              />
            ) : (
              <AuthForms onLoginSuccess={handleLoginSuccess} />
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

export default App
