import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useAuthStore } from '@/stores/authStore'

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-0 min-h-[100dvh] flex-1 flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="sticky top-0 z-30 shrink-0 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 lg:px-6">
          <Link to="/" className="font-display text-lg font-semibold text-[var(--accent)]">
            DealScannr
          </Link>

          <nav className="hidden flex-1 items-center justify-center gap-8 md:flex" aria-label="Public">
            <Link
              to="/pricing"
              className="text-sm font-medium text-[var(--textMuted)] hover:text-[var(--text)]"
            >
              Pricing
            </Link>
            <Link
              to="/methodology"
              className="text-sm font-medium text-[var(--textMuted)] hover:text-[var(--text)]"
            >
              Methodology
            </Link>
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <ThemeToggle compact />
            {token ? (
              <Link to="/dashboard">
                <Button variant="primary" size="sm">
                  Dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="ghost" size="sm">
                    Sign in
                  </Button>
                </Link>
                <Link to="/register">
                  <Button variant="primary" size="sm">
                    Get started
                  </Button>
                </Link>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 md:hidden">
            <ThemeToggle compact />
            <button
              type="button"
              className="rounded-[var(--radius-sm)] p-2 text-[var(--text)]"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        <div
          className={cn(
            'border-t border-[var(--border)] bg-[var(--surface)] md:hidden',
            open ? 'block' : 'hidden',
          )}
        >
          <div className="flex flex-col gap-1 px-4 py-3">
            <div className="mb-2 flex items-center justify-between px-3">
              <span className="text-xs font-medium text-[var(--textMuted)]">Theme</span>
              <ThemeToggle />
            </div>
            <Link
              to="/pricing"
              className="rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface2)]"
              onClick={() => setOpen(false)}
            >
              Pricing
            </Link>
            <Link
              to="/methodology"
              className="rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface2)]"
              onClick={() => setOpen(false)}
            >
              Methodology
            </Link>
            <div className="mt-2 flex flex-col gap-2 border-t border-[var(--border)] pt-3">
              {token ? (
                <Link to="/dashboard" onClick={() => setOpen(false)}>
                  <Button variant="primary" size="md" className="w-full">
                    Dashboard
                  </Button>
                </Link>
              ) : (
                <>
                  <Link to="/login" onClick={() => setOpen(false)}>
                    <Button variant="ghost" size="md" className="w-full">
                      Sign in
                    </Button>
                  </Link>
                  <Link to="/register" onClick={() => setOpen(false)}>
                    <Button variant="primary" size="md" className="w-full">
                      Get started
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col">{children}</main>

      <footer className="mt-auto shrink-0 border-t border-[var(--border)] bg-[var(--surface)] py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 lg:flex-row lg:items-start lg:justify-between lg:px-6">
          <div>
            <p className="font-display font-semibold text-[var(--accent)]">DealScannr</p>
            <p className="mt-1 max-w-xs text-sm text-[var(--textMuted)]">
              Due diligence signals for time-pressed investors.
            </p>
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <Link to="/methodology" className="text-[var(--textMuted)] hover:text-[var(--text)]">
              Methodology
            </Link>
            <Link to="/pricing" className="text-[var(--textMuted)] hover:text-[var(--text)]">
              Pricing
            </Link>
            <Link to="/login" className="text-[var(--textMuted)] hover:text-[var(--text)]">
              Sign in
            </Link>
          </div>
          <p className="max-w-xs text-xs text-[var(--textSubtle)] lg:text-right">
            Not investment advice. Automated research only; verify all material facts.
          </p>
        </div>
      </footer>
    </div>
  )
}
