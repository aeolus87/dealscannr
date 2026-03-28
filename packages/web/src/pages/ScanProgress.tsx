import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Newspaper, Users, Wrench } from 'lucide-react'
import { useScanStatusQuery } from '@/hooks/api/scans.hooks'
import { readScanMeta } from '@/lib/scan-meta'
import { StatusDot } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PublicLayout } from '@/components/layout/PublicLayout'

const LANES = ['litigation', 'engineering', 'hiring', 'news'] as const

const LANE_META: Record<
  (typeof LANES)[number],
  { label: string; icon: React.ReactNode; searching: string }
> = {
  litigation: {
    label: 'Litigation',
    icon: <span aria-hidden>⚖</span>,
    searching: 'Searching SEC EDGAR, CourtListener…',
  },
  engineering: {
    label: 'Engineering',
    icon: <Wrench className="h-4 w-4 text-[var(--textMuted)]" aria-hidden />,
    searching: 'Analyzing GitHub activity…',
  },
  hiring: {
    label: 'Hiring',
    icon: <Users className="h-4 w-4 text-[var(--textMuted)]" aria-hidden />,
    searching: 'Scanning job boards…',
  },
  news: {
    label: 'News',
    icon: <Newspaper className="h-4 w-4 text-[var(--textMuted)]" aria-hidden />,
    searching: 'Fetching recent coverage…',
  },
}

function formatElapsed(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

type ScanProgressProps = { guestMode?: boolean }

export function ScanProgress({ guestMode }: ScanProgressProps = {}) {
  const { scanId } = useParams<{ scanId: string }>()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isGuest = guestMode === true || pathname.startsWith('/try/')
  const meta = readScanMeta(scanId)
  const { data, error } = useScanStatusQuery(scanId, isGuest)
  const [flashed, setFlashed] = useState<Record<string, boolean>>({})
  const prevStatus = useRef<Record<string, string>>({})
  /** Re-render once per second while running so elapsed from `created_at` stays current. */
  const [elapsedTick, setElapsedTick] = useState(0)

  useEffect(() => {
    document.title = 'Scan in progress — DealScannr'
  }, [])

  useEffect(() => {
    if (!data?.lanes) return
    const next: Record<string, boolean> = {}
    for (const lane of LANES) {
      const st = data.lanes[lane]?.status ?? 'queued'
      const prev = prevStatus.current[lane]
      if (st === 'complete' && prev && prev !== 'complete') {
        next[lane] = true
      }
      prevStatus.current[lane] = st
    }
    if (Object.keys(next).length) {
      setFlashed((f) => ({ ...f, ...next }))
      window.setTimeout(() => {
        setFlashed((f) => {
          const c = { ...f }
          for (const k of Object.keys(next)) delete c[k]
          return c
        })
      }, 320)
    }
  }, [data?.lanes])

  useEffect(() => {
    if (data?.status !== 'complete') return
    const t = window.setTimeout(() => {
      const reportPath = isGuest ? `/try/scan/${scanId}/report` : `/scan/${scanId}/report`
      navigate(reportPath, { replace: true })
    }, 800)
    return () => window.clearTimeout(t)
  }, [data?.status, navigate, scanId, isGuest])

  useEffect(() => {
    if (!data || data.status === 'complete') return
    const id = window.setInterval(() => setElapsedTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [data?.status, scanId])

  const scanStartMs = useMemo(() => {
    const raw = data?.created_at
    if (!raw) return null
    const t = Date.parse(raw)
    return Number.isFinite(t) ? t : null
  }, [data?.created_at, scanId])

  const displayElapsedSec = useMemo(() => {
    if (!data) return 0
    if (data.status === 'complete') return Math.max(0, Math.floor(data.elapsed_seconds ?? 0))
    if (scanStartMs != null) return Math.max(0, Math.floor((Date.now() - scanStartMs) / 1000))
    return Math.max(0, Math.floor(data.elapsed_seconds ?? 0))
  }, [data, scanStartMs, elapsedTick])

  const completedLanes = useMemo(() => {
    if (!data?.lanes) return 0
    return LANES.filter((l) => {
      const s = data.lanes[l]?.status
      return s === 'complete' || s === 'partial'
    }).length
  }, [data?.lanes])

  const runningLanes = useMemo(() => {
    if (!data?.lanes) return 0
    return LANES.filter((l) => data.lanes[l]?.status === 'running').length
  }, [data?.lanes])

  const progressPct = useMemo(() => {
    if (!data?.lanes) return 0
    if (data.status === 'complete') return 100
    const laneUnit = (completedLanes + runningLanes * 0.28) / 4
    return Math.min(96, Math.round(laneUnit * 1000) / 10)
  }, [completedLanes, runningLanes, data?.lanes, data?.status])

  function laneStatusText(lane: (typeof LANES)[number], status: string) {
    if (status === 'complete') return { text: 'Complete', className: 'text-[var(--green)]' }
    if (status === 'failed') return { text: 'No data', className: 'text-[var(--red)]' }
    if (status === 'partial') return { text: 'Partial data', className: 'text-[var(--yellow)]' }
    if (status === 'running') return { text: LANE_META[lane].searching, className: 'text-[var(--textMuted)]' }
    return { text: 'Queued', className: 'text-[var(--textSubtle)]' }
  }

  const inner = (
    <div className="mx-auto max-w-[640px] px-4 py-4 text-[var(--text)] lg:py-6">
      {isGuest ? (
        <p className="mb-4 rounded-[var(--radius-md)] border border-[var(--accentBorder)] bg-[var(--accentSoft)] px-3 py-2 text-center text-sm text-[var(--text)]">
          <Link to="/register" className="font-medium text-[var(--accent)] underline">
            Create a free account
          </Link>{' '}
          to save this scan and run more reports.
        </p>
      ) : null}
      <p className="font-mono text-xs text-[var(--textMuted)]">Scan {scanId ?? '…'}</p>
      <h1 className="mt-2 font-display text-2xl font-semibold lg:text-[28px]">
        {meta?.company?.trim() || 'Company'}
      </h1>
      <p className="mt-1 font-mono text-sm text-[var(--textMuted)]">{meta?.domain?.trim() || '—'}</p>
      <p className="mt-3 text-sm text-[var(--textMuted)]">
        Scanning…{' '}
        <span className="font-mono tabular-nums text-[var(--text)]">
          {formatElapsed(displayElapsedSec)}
        </span>{' '}
        elapsed
      </p>

      {error && (
        <p className="mt-4 text-sm text-[var(--red)]" role="alert">
          {(error as Error).message || 'Failed to load status'}
        </p>
      )}

      <ul className="mt-8 space-y-3">
        {LANES.map((lane) => {
          const row = data?.lanes?.[lane]
          const st = row?.status ?? 'queued'
          const laneInfo = LANE_META[lane]
          const { text, className } = laneStatusText(lane, st)
          const chunks = row?.chunk_count ?? 0
          const flash = flashed[lane]
          return (
            <li
              key={lane}
              className={`flex flex-wrap items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-dsSm transition-colors lg:flex-nowrap ${
                flash ? 'ds-lane-flash border-l-2 border-l-[var(--green)]' : ''
              }`}
            >
              <div className="pt-0.5">
                <StatusDot status={st} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    {laneInfo.icon}
                    <span className="text-sm font-medium capitalize text-[var(--text)]">{laneInfo.label}</span>
                  </div>
                  {st === 'failed' && row?.error ? (
                    <span className="text-[11px] text-[var(--textMuted)]">{row.error}</span>
                  ) : null}
                </div>
                <p className={`text-xs sm:text-right ${className}`}>{text}</p>
              </div>
              <span className="w-full font-mono text-xs text-[var(--textMuted)] sm:w-auto sm:text-right">
                {chunks > 0 ? `${chunks} signals` : '—'}
              </span>
            </li>
          )
        })}
      </ul>

      <p className="mt-8 text-center text-sm text-[var(--textMuted)]">This usually takes 30–60 seconds</p>
      <div
        className="ds-scan-progress-track mt-4 ring-1 ring-[var(--border)] ring-inset"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progressPct)}
        aria-label="Scan lane progress"
      >
        <div
          className={`ds-scan-progress-fill ${data?.status !== 'complete' ? 'ds-scan-progress-fill--active' : ''}`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="mt-8 text-center">
        <Link to={isGuest ? '/try' : '/dashboard'}>
          <Button variant="ghost" size="md">
            {isGuest ? 'Cancel — back to trial scan' : 'Cancel — back to dashboard'}
          </Button>
        </Link>
      </div>
    </div>
  )

  return isGuest ? <PublicLayout>{inner}</PublicLayout> : inner
}
