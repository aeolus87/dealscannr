import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  FileText,
  Search,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { VerdictBadge } from '@/components/ui/Badge'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { FaqAccordion } from '@/components/marketing/FaqAccordion'
import { useAuthStore } from '@/stores/authStore'

const SAMPLE = [
  {
    co: '[Series B SaaS]',
    verdict: 'MEET',
    signals: [
      { icon: '⚖', label: 'Litigation', text: 'No active filings found' },
      { icon: '⚙', label: 'Engineering', text: '87 commits last month, 12 contributors' },
      { icon: '👥', label: 'Hiring', text: '23 open roles, 40% engineering' },
    ],
  },
  {
    co: '[Growth fintech]',
    verdict: 'FLAG',
    signals: [
      { icon: '⚖', label: 'Litigation', text: 'Civil action referenced in regional filings' },
      { icon: '⚙', label: 'Engineering', text: 'Steady commit velocity, 8 contributors' },
      { icon: '👥', label: 'Hiring', text: 'Compliance roles outpacing eng hires' },
    ],
  },
  {
    co: '[Seed marketplace]',
    verdict: 'PASS',
    signals: [
      { icon: '⚖', label: 'Litigation', text: 'No material cases in indexed courts' },
      { icon: '⚙', label: 'Engineering', text: 'Limited public GitHub footprint' },
      { icon: '👥', label: 'Hiring', text: '12 open roles, mixed functions' },
    ],
  },
] as const

export function Home() {
  const navigate = useNavigate()
  const token = useAuthStore((s) => s.token)
  const [heroQuery, setHeroQuery] = useState('')
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    document.title = 'DealScannr — Due diligence in 60 seconds'
  }, [])

  function onHeroSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = heroQuery.trim()
    if (!q) return
    if (token) {
      navigate(`/dashboard?intent=scan&company=${encodeURIComponent(q)}`)
    } else {
      navigate(`/register?intent=scan&company=${encodeURIComponent(q)}`)
    }
  }

  return (
    <PublicLayout>
      <section className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4 py-16 text-center lg:py-20">
        <h1 className="max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight text-[var(--text)] lg:text-[56px] lg:leading-[1.05]">
          Due diligence in
          <br />
          60 seconds.
        </h1>
        <p className="mt-5 max-w-[480px] text-lg text-[var(--textMuted)]">
          Surface litigation risk, engineering health, and hiring signals for any company — before the
          meeting.
        </p>

        <form
          onSubmit={onHeroSubmit}
          className="mt-10 w-full max-w-[560px]"
        >
          <div
            className={`flex overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--surface)] shadow-dsSm transition-shadow ${
              focused
                ? 'border-[var(--accent)] shadow-[0_0_0_3px_var(--accentSoft)]'
                : 'border-[var(--border)]'
            }`}
          >
            <input
              className="min-h-14 flex-1 border-0 bg-transparent px-4 text-[var(--text)] outline-none placeholder:text-[var(--textSubtle)]"
              placeholder="Enter company name..."
              value={heroQuery}
              onChange={(e) => setHeroQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              aria-label="Company name"
            />
            <Button type="submit" variant="primary" size="lg" className="shrink-0 rounded-none px-5">
              Scan <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          <p className="mt-3 text-sm text-[var(--textSubtle)]">No account needed for your first scan</p>
        </form>

        <p className="mt-14 text-xs font-medium uppercase tracking-wider text-[var(--textSubtle)]">
          Trusted by investors at
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-4 opacity-60 grayscale">
          {['Northline', 'Harbor', 'Atlas', 'Crescent', 'Meridian'].map((n) => (
            <div
              key={n}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface2)] px-4 py-2 font-display text-sm font-semibold text-[var(--textMuted)]"
            >
              {n}
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-16 lg:py-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center font-display text-2xl font-semibold text-[var(--text)] lg:text-3xl">
            How it works
          </h2>
          <div className="mt-12 flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
            {[
              {
                n: '1',
                title: 'Enter company name',
                body: 'We match legal entity and domain from public registries and your hint.',
                icon: Search,
              },
              {
                n: '2',
                title: 'We scan 5 sources in parallel',
                body: 'Filings, courts, GitHub, hiring, and news — indexed into one timeline.',
                icon: Activity,
              },
              {
                n: '3',
                title: 'Get a verdict with citations',
                body: 'MEET / PASS / FLAG / INSUFFICIENT with chunk-level references you can audit.',
                icon: FileText,
              },
            ].map((step, i) => (
              <div key={step.n} className="relative flex flex-1 flex-col items-center text-center">
                {i < 2 && (
                  <div
                    className="absolute left-[60%] top-8 hidden h-px w-[calc(100%-2rem)] border-t border-dashed border-[var(--accent)]/50 lg:block"
                    aria-hidden
                  />
                )}
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accentSoft)] font-mono text-sm font-bold text-[var(--accent)]">
                  {step.n}
                </span>
                <step.icon className="mt-4 h-8 w-8 text-[var(--accent)]" strokeWidth={1.5} aria-hidden />
                <h3 className="mt-3 font-display text-lg font-semibold text-[var(--text)]">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--textMuted)]">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 lg:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center font-display text-2xl font-semibold text-[var(--text)]">
            Sample outputs
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-sm text-[var(--textMuted)]">
            Redacted examples — structure mirrors live reports.
          </p>
          <div className="mt-10 flex gap-4 overflow-x-auto pb-2 lg:grid lg:grid-cols-3 lg:overflow-visible">
            {SAMPLE.map((s) => (
              <Card key={s.co} hover padding="md" className="min-w-[280px] shrink-0 lg:min-w-0">
                <p className="font-display text-sm font-semibold text-[var(--text)]">{s.co}</p>
                <div className="mt-3">
                  <VerdictBadge verdict={s.verdict} size="sm" />
                </div>
                <ul className="mt-4 space-y-3 text-sm text-[var(--textMuted)]">
                  {s.signals.map((x) => (
                    <li key={x.label} className="flex gap-2">
                      <span aria-hidden>{x.icon}</span>
                      <span>
                        <span className="font-medium text-[var(--text)]">{x.label}:</span> {x.text}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  to={token ? '/dashboard' : '/register'}
                  className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)] hover:text-[var(--accentHover)]"
                >
                  View full report →
                </Link>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--surface2)] px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center font-display text-2xl font-semibold text-[var(--text)]">
            Simple pricing
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-center text-sm text-[var(--textMuted)]">
            No data contracts. Upgrade when you need scale.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              { name: 'Free', price: '$0', desc: 'Occasional diligence', href: '/register', featured: false },
              {
                name: 'Pro',
                price: '$99',
                desc: 'Active angels',
                href: '/pricing',
                featured: true,
              },
              { name: 'Team', price: '$299', desc: 'Syndicates', href: '/pricing', featured: false },
            ].map((p) => (
              <Card
                key={p.name}
                padding="md"
                className={
                  p.featured ? 'border-2 border-[var(--accent)] shadow-dsMd' : ''
                }
              >
                {p.featured && (
                  <span className="inline-block rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    Most popular
                  </span>
                )}
                <h3 className="mt-2 font-display text-lg font-semibold text-[var(--text)]">{p.name}</h3>
                <p className="mt-1 text-2xl font-semibold text-[var(--text)]">
                  {p.price}
                  <span className="text-sm font-normal text-[var(--textMuted)]">/mo</span>
                </p>
                <p className="mt-2 text-sm text-[var(--textMuted)]">{p.desc}</p>
                <Link to={p.href} className="mt-4 inline-block">
                  <Button variant={p.featured ? 'primary' : 'secondary'} className="w-full">
                    {p.name === 'Free' ? 'Get started free' : 'View details'}
                  </Button>
                </Link>
              </Card>
            ))}
          </div>
          <p className="mt-8 text-center">
            <Link to="/pricing" className="text-sm font-medium text-[var(--accent)] hover:text-[var(--accentHover)]">
              Full comparison →
            </Link>
          </p>
        </div>
      </section>

      <section className="px-4 py-16 lg:py-24">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-center font-display text-2xl font-semibold text-[var(--text)]">FAQ</h2>
          <div className="mt-8">
            <FaqAccordion />
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--accentSoft)] px-4 py-14">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-6 text-center md:flex-row md:text-left">
          <div>
            <h2 className="font-display text-xl font-semibold text-[var(--text)] lg:text-2xl">
              Start your first scan — free.
            </h2>
            <p className="mt-1 text-sm text-[var(--textMuted)]">Three scans per month on the Free plan.</p>
          </div>
          <Link to={token ? '/dashboard' : '/register'}>
            <Button variant="primary" size="lg">
              Get started <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
        </div>
      </section>
    </PublicLayout>
  )
}
