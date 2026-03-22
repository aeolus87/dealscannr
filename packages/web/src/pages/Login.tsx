import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useLoginMutation } from '@/hooks/api/auth.hooks'
import { getAxiosResponseMessage, getAxiosStatus } from '@/hooks/api/http'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { useAuthStore } from '@/stores/authStore'

export function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const setToken = useAuthStore((s) => s.setToken)
  const loginMut = useLoginMutation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [fieldErr, setFieldErr] = useState<{ email?: string; password?: string }>({})

  const intent = searchParams.get('intent')
  const company = searchParams.get('company')

  useEffect(() => {
    document.title = 'Sign in — DealScannr'
  }, [])

  async function onLogin(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setFieldErr({})
    const fe: typeof fieldErr = {}
    if (!email.trim()) fe.email = 'Enter your email'
    if (!password) fe.password = 'Enter your password'
    if (Object.keys(fe).length) {
      setFieldErr(fe)
      return
    }
    try {
      const data = await loginMut.mutateAsync({ email: email.trim(), password })
      setToken(data.token)
      if (intent === 'scan' && company?.trim()) {
        navigate(`/dashboard?intent=scan&company=${encodeURIComponent(company.trim())}`, {
          replace: true,
        })
      } else {
        navigate('/dashboard', { replace: true })
      }
    } catch (e) {
      const st = getAxiosStatus(e)
      const apiMsg = getAxiosResponseMessage(e)
      if (st === 401) {
        setErr(apiMsg || 'Incorrect email or password.')
      } else if (st === 429) {
        setErr(apiMsg || 'Too many attempts. Wait a minute and try again.')
      } else if (st !== undefined) {
        setErr(apiMsg || 'Something went wrong. Try again.')
      } else if (!navigator.onLine) {
        setErr('You appear to be offline.')
      } else {
        setErr(
          `Could not reach the API. Check that it is running and VITE_API_URL matches (currently ${import.meta.env.VITE_API_URL || 'http://localhost:5200'}).`,
        )
      }
    }
  }

  return (
    <PublicLayout>
      <main className="flex min-h-[calc(100vh-200px)] items-center justify-center px-4 py-12">
        <Card
          padding="lg"
          className="w-full max-w-[400px] opacity-0 animate-[ds-login-in_300ms_ease-out_forwards]"
        >
          <style>{`
            @keyframes ds-login-in {
              from { opacity: 0; transform: translateY(8px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accentSoft)] font-display text-lg font-bold text-[var(--accent)]">
              D
            </div>
            <h1 className="font-display text-xl font-semibold text-[var(--text)]">Welcome back</h1>
            <p className="mt-1 text-sm text-[var(--textMuted)]">Sign in to your account</p>
          </div>

          {intent === 'scan' && company?.trim() && (
            <div
              className="mb-4 rounded-[var(--radius-md)] border border-[var(--noticeBorder)] bg-[var(--noticeBg)] px-3 py-2 text-sm text-[var(--noticeText)]"
              role="status"
            >
              Sign in to scan <span className="font-medium">{company.trim()}</span>
            </div>
          )}

          <form className="space-y-4" onSubmit={onLogin} noValidate>
            <Input
              id="login-email"
              label="Email address"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={fieldErr.email}
            />
            <Input
              id="login-password"
              label="Password"
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={fieldErr.password}
              endAdornment={
                <button
                  type="button"
                  className="rounded p-1.5 text-[var(--textMuted)] hover:bg-[var(--surface2)] hover:text-[var(--text)]"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPw((s) => !s)}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
            />
            <div className="text-right">
              <span className="text-sm text-[var(--textSubtle)]">Forgot password?</span>
            </div>
            {err && (
              <p className="rounded-[var(--radius-sm)] bg-[var(--negativeSoft)] px-3 py-2 text-sm text-[var(--red)]" role="alert">
                {err}
              </p>
            )}
            <Button type="submit" variant="primary" className="w-full" size="lg" loading={loginMut.isPending}>
              Sign in
            </Button>
          </form>

          <div className="relative my-8 text-center">
            <span className="relative z-10 bg-[var(--surface)] px-3 text-xs uppercase tracking-wide text-[var(--textSubtle)]">
              or
            </span>
            <div className="absolute left-0 right-0 top-1/2 h-px bg-[var(--border)]" aria-hidden />
          </div>

          <p className="text-center text-sm text-[var(--textMuted)]">
            Don&apos;t have an account?{' '}
            <Link
              to={company?.trim() ? `/register?intent=scan&company=${encodeURIComponent(company.trim())}` : '/register'}
              className="font-medium text-[var(--accent)] hover:text-[var(--accentHover)]"
            >
              Get started →
            </Link>
          </p>
        </Card>
      </main>
    </PublicLayout>
  )
}
