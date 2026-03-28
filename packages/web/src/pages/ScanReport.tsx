import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, Download, RefreshCw, Share2 } from 'lucide-react'
import { DiffModal, type ScanDiffPayload } from '@/components/scans/DiffModal'
import { getAxiosStatus } from '@/hooks/api/http'
import {
  fetchScanDiff,
  getScanReportPdf,
  postRescan,
  postScanShare,
  usePreviousScanQuery,
  useScanReportQuery,
} from '@/hooks/api/scans.hooks'
import type { ReportSection } from '@/hooks/api/types'
import { VerdictBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { useToast } from '@/components/ui/ToastContext'
import { cn } from '@/lib/cn'
import { normalizeVerdict, verdictStyles } from '@/lib/verdict-styles'
import {
  mergeCitationDisplayOrder,
  normalizeChunkIdRefs,
} from '@/lib/chunk-citations'
import { readScanMeta } from '@/lib/scan-meta'

const SECTION_ORDER = [
  'executive_summary',
  'synthesis',
  'summary',
  'litigation',
  'engineering',
  'hiring',
  'news',
] as const

function sortSectionKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a as (typeof SECTION_ORDER)[number])
    const ib = SECTION_ORDER.indexOf(b as (typeof SECTION_ORDER)[number])
    const va = ia === -1 ? 999 : ia
    const vb = ib === -1 ? 999 : ib
    return va - vb
  })
}

function statusLabel(status: string): { text: string; tone: string } {
  const u = status.toLowerCase()
  if (u.includes('complete')) return { text: 'Complete', tone: 'text-[var(--green)]' }
  if (u.includes('partial')) return { text: 'Partial', tone: 'text-[var(--yellow)]' }
  if (u.includes('insufficient')) return { text: 'Insufficient', tone: 'text-[var(--textMuted)]' }
  return { text: status, tone: 'text-[var(--textMuted)]' }
}

function renderCitedBody(text: string, citations: string[], slug: string) {
  const parts = text.split(/(\[\d+\])/g)
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/)
    if (m) {
      const n = m[1]
      const idx = parseInt(n, 10) - 1
      const cite = citations[idx] ?? `Source ${n}`
      const id = `cite-${slug}-${n}`
      return (
        <sup key={i}>
          <a
            href={`#${id}`}
            className="ml-0.5 font-mono text-[11px] text-[var(--accent)] underline decoration-transparent hover:decoration-current"
            title={cite}
          >
            [{n}]
          </a>
        </sup>
      )
    }
    return <span key={i}>{part}</span>
  })
}

function normHost(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    ?.split(':')[0] ?? ''
}

function splitExecutiveProbes(text: string): { narrative: string; probes: string } {
  const parts = text.split(/\n\s*Before the call, probe:\s*/i)
  if (parts.length < 2) return { narrative: text.trim(), probes: '' }
  return {
    narrative: (parts[0] ?? '').trim(),
    probes: parts.slice(1).join('\nBefore the call, probe:').trim(),
  }
}

function RiskTriageBadge({ triage }: { triage?: string }) {
  const t = (triage || 'unknown').toLowerCase()
  const map: Record<string, { label: string; ring: string }> = {
    clean: { label: 'No material risks found', ring: 'var(--green)' },
    watch: { label: 'Signals worth monitoring', ring: 'var(--yellow)' },
    flag: { label: 'Material adverse signals', ring: 'var(--red)' },
    unknown: { label: 'Insufficient data to assess', ring: 'var(--textMuted)' },
  }
  const x = map[t] ?? map.unknown
  return (
    <span
      className="inline-flex max-w-full items-center rounded-full border px-3 py-1 text-xs font-medium text-[var(--text)]"
      style={{ borderColor: x.ring, backgroundColor: 'var(--surface2)' }}
    >
      Risk: {x.label}
    </span>
  )
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value * 100))
  const [w, setW] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(pct))
    return () => cancelAnimationFrame(id)
  }, [pct])
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[var(--surface3)]">
      <div
        className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-[600ms] ease-out"
        style={{ width: `${w}%` }}
      />
    </div>
  )
}

type ScanReportProps = { guestMode?: boolean }

export function ScanReport({ guestMode }: ScanReportProps = {}) {
  const { scanId } = useParams<{ scanId: string }>()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isGuest = guestMode === true || pathname.startsWith('/try/')
  const { toast } = useToast()
  const meta = readScanMeta(scanId)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [copyDone, setCopyDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [diffOpen, setDiffOpen] = useState(false)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffErr, setDiffErr] = useState<string | null>(null)
  const [diffData, setDiffData] = useState<ScanDiffPayload | null>(null)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})

  const { data, isLoading, error } = useScanReportQuery(scanId, isGuest)
  const { data: prevScan } = usePreviousScanQuery(scanId, isGuest)

  const companyName = meta?.company || 'Company'
  const domain = meta?.domain || ''
  const duplicateTitleDomain =
    Boolean(domain) && normHost(companyName) === normHost(domain)

  useEffect(() => {
    document.title = `${companyName} — Report — DealScannr`
  }, [companyName])

  const sectionKeys = useMemo(() => {
    if (!data?.sections) return []
    return sortSectionKeys(Object.keys(data.sections))
  }, [data?.sections])

  const laneSectionStatusCounts = useMemo(() => {
    const counts = { complete: 0, partial: 0, preliminary: 0, insufficient: 0 }
    if (!data?.sections) return counts
    const keys = sortSectionKeys(Object.keys(data.sections))
    const ex = keys.find((k) => /summary|synthesis/i.test(k))
    for (const k of keys) {
      if (k === ex) continue
      const sec = data.sections[k] as ReportSection | undefined
      const u = sec?.status?.toLowerCase() ?? ''
      if (u.includes('insufficient')) counts.insufficient += 1
      else if (u.includes('preliminary')) counts.preliminary += 1
      else if (u.includes('partial')) counts.partial += 1
      else if (u.includes('complete')) counts.complete += 1
    }
    return counts
  }, [data?.sections])

  const laneStatusSummary = useMemo(() => {
    const { complete, partial, preliminary, insufficient } = laneSectionStatusCounts
    const parts: string[] = []
    if (complete) parts.push(`${complete} complete`)
    if (partial) parts.push(`${partial} partial`)
    if (preliminary) parts.push(`${preliminary} preliminary`)
    if (insufficient) parts.push(`${insufficient} insufficient`)
    return parts.length ? parts.join(' · ') : null
  }, [laneSectionStatusCounts])

  useEffect(() => {
    if (!data?.verdict || !sectionKeys.length) return
    const pass = normalizeVerdict(data.verdict) === 'PASS'
    const init: Record<string, boolean> = {}
    for (const k of sectionKeys) {
      init[k] = !pass
    }
    setOpenSections(init)
  }, [data?.verdict, sectionKeys.join('|')])

  async function loadDiff() {
    const prevId = prevScan?.previous_scan_id
    if (!scanId || !prevId) return
    setDiffOpen(true)
    setDiffLoading(true)
    setDiffErr(null)
    setDiffData(null)
    try {
      const d = await fetchScanDiff(scanId, prevId)
      setDiffData(d)
    } catch {
      setDiffErr('Could not load comparison.')
    } finally {
      setDiffLoading(false)
    }
  }

  async function openShare() {
    if (!scanId) return
    setBusy(true)
    try {
      const share = await postScanShare(scanId)
      setShareUrl(share.share_url)
      setShareOpen(true)
    } catch {
      toast('error', 'Could not create share link')
    } finally {
      setBusy(false)
    }
  }

  async function copyShare() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopyDone(true)
      toast('success', 'Link copied')
      window.setTimeout(() => setCopyDone(false), 2000)
    } catch {
      toast('error', 'Copy failed')
    }
  }

  async function downloadPdf() {
    if (!scanId) return
    setBusy(true)
    toast('info', 'Preparing PDF…')
    try {
      const { blob, filename } = await getScanReportPdf(scanId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      toast('success', 'PDF download started')
    } catch {
      toast('error', 'PDF download failed')
    } finally {
      setBusy(false)
    }
  }

  async function rescan() {
    if (!scanId) return
    setBusy(true)
    try {
      const r = await postRescan(scanId)
      const prev = readScanMeta(scanId)
      try {
        sessionStorage.setItem(
          `scan.${r.new_scan_id}.meta`,
          JSON.stringify(prev ?? { company: companyName, domain }),
        )
      } catch {
        /* ignore */
      }
      toast('success', 'Rescan started')
      navigate(`/scan/${r.new_scan_id}/progress`)
    } catch (e) {
      const st = getAxiosStatus(e)
      if (st === 402) toast('error', 'No credits remaining')
      else if (st === 429) toast('warning', 'Rate limited — try again in ~30s')
      else toast('error', 'Rescan failed')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) {
    const sk = (
      <div className="mx-auto max-w-3xl space-y-5 py-2">
        <Skeleton className="h-12 w-3/4 rounded-[var(--radius-md)]" />
        <Skeleton className="h-36 w-full rounded-[var(--radius-xl)]" />
        <Skeleton className="h-52 w-full rounded-[var(--radius-xl)]" />
      </div>
    )
    return isGuest ? <PublicLayout>{sk}</PublicLayout> : sk
  }

  if (error || !data) {
    const errBody = (
      <div className="mx-auto max-w-lg py-12 text-center">
        <p className="text-sm text-[var(--red)]">Could not load report.</p>
        <Link
          to={isGuest ? '/try' : '/dashboard'}
          className="mt-4 inline-block text-sm text-[var(--accent)] underline"
        >
          {isGuest ? 'Back to trial scan' : 'Dashboard'}
        </Link>
      </div>
    )
    return isGuest ? <PublicLayout>{errBody}</PublicLayout> : errBody
  }

  if (data.status === 'processing' || (!data.verdict && !data.sections)) {
    const prog = (
      <div className="mx-auto max-w-lg py-12">
        <p className="text-sm text-[var(--yellow)]">Still processing…</p>
        <Link
          to={isGuest ? `/try/scan/${scanId}/progress` : `/scan/${scanId}/progress`}
          className="mt-4 inline-block text-sm text-[var(--accent)] underline"
        >
          Back to progress
        </Link>
      </div>
    )
    return isGuest ? <PublicLayout>{prog}</PublicLayout> : prog
  }

  const vKey = normalizeVerdict(data.verdict)
  const vStyle = verdictStyles(vKey)
  const showPrelimNotice = (data.chunk_count ?? 0) < 5 || vKey === 'PRELIMINARY'
  const execKey = sectionKeys.find((k) => /summary|synthesis/i.test(k))
  const execSection = execKey ? data.sections[execKey] : null
  const otherSections = sectionKeys.filter((k) => k !== execKey)

  const chunk = data.chunk_count ?? 0
  const lanes = data.lane_coverage ?? 0
  const estPer = lanes > 0 ? Math.max(1, Math.round(chunk / Math.min(lanes, 4))) : chunk
  /** Do not imply independent per-lane source counts when the index is thin. */
  const showPerLaneSourceChips = chunk >= 5

  const actionRow = isGuest ? (
    <div className="flex flex-wrap gap-2">
      <Link to="/register">
        <Button type="button" variant="primary" size="sm">
          Save my scans — Register
        </Button>
      </Link>
      <Link to="/login">
        <Button type="button" variant="ghost" size="sm">
          Sign in
        </Button>
      </Link>
    </div>
  ) : (
    <div className="flex flex-wrap gap-2">
      {prevScan?.previous_scan_id && (
        <Button type="button" variant="secondary" size="sm" disabled={busy || diffLoading} onClick={loadDiff}>
          Compare
        </Button>
      )}
      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={rescan}>
        <RefreshCw className="h-4 w-4" aria-hidden /> Rescan
      </Button>
      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={downloadPdf}>
        <Download className="h-4 w-4" aria-hidden /> Export PDF
      </Button>
      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={openShare}>
        <Share2 className="h-4 w-4" aria-hidden /> Share
      </Button>
    </div>
  )

  const reportMain = (
    <div className="pb-24 text-[var(--text)] lg:pb-12">
      <DiffModal
        open={diffOpen}
        loading={diffLoading}
        error={diffErr}
        data={diffData}
        onClose={() => setDiffOpen(false)}
      />

      <Modal open={shareOpen} onClose={() => setShareOpen(false)} title="Share report">
        <p className="text-sm text-[var(--textMuted)]">
          Anyone with this link can view this report. Expires in 7 days.
        </p>
        <div className="mt-4 flex gap-2">
          <input
            readOnly
            className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 font-mono text-xs text-[var(--text)]"
            value={shareUrl}
          />
          <Button type="button" variant="primary" size="md" onClick={copyShare}>
            {copyDone ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </Modal>

      <header className="mx-auto max-w-3xl pb-2">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--textSubtle)]">
              Intelligence report
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-[var(--text)] lg:text-[1.65rem]">
              {duplicateTitleDomain ? domain || companyName : companyName}
            </h1>
            {domain && !duplicateTitleDomain ? (
              <p className="mt-0.5 font-mono text-xs text-[var(--textMuted)]">{domain}</p>
            ) : null}
            {data.company_tagline ? (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--textMuted)]">{data.company_tagline}</p>
            ) : null}
          </div>
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <RiskTriageBadge triage={data.risk_triage} />
              <VerdictBadge verdict={data.verdict} size="lg" pulse />
              <span className="rounded-full bg-[var(--surface)]/90 px-2.5 py-1 text-[11px] font-medium text-[var(--textMuted)] shadow-dsSm">
                {lanes}/4 lanes · {chunk} chunk{chunk === 1 ? '' : 's'}
              </span>
            </div>
            <div className="hidden lg:flex">{actionRow}</div>
          </div>
        </div>
      </header>

      <div className="fixed bottom-0 left-0 right-0 z-20 bg-[var(--contentCanvas)]/96 p-3 shadow-[var(--shadow-up)] backdrop-blur-md lg:hidden">
        <div className="flex flex-wrap justify-center gap-2">{actionRow}</div>
      </div>

      <div className="mx-auto mt-6 max-w-3xl space-y-10">
        <section
          className="rounded-[var(--radius-xl)] border px-6 py-7 shadow-dsMd"
          style={{
            backgroundColor: vStyle.bg,
            borderColor: vStyle.border,
          }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--textSubtle)]">
            Signal overview
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <RiskTriageBadge triage={data.risk_triage} />
            <VerdictBadge verdict={data.verdict} size="lg" pulse />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-[var(--textMuted)]">
            {chunk === 0
              ? `Lane coverage ${lanes}/4 — no evidence chunks for this scan.`
              : `Based on ${chunk} evidence chunk${chunk === 1 ? '' : 's'} · ${lanes} of 4 signal lanes returned usable text`}
          </p>
          {chunk === 1 ? (
            <p className="mt-2 text-sm leading-relaxed text-[var(--text)]">
              Single-source scan: every section that cites [1] is drawing from the same underlying capture. Verdict is capped when only one chunk is available — treat lane blurbs as page-level hints, not independent diligence.
            </p>
          ) : null}
          {laneStatusSummary ? (
            <p className="mt-2 text-xs text-[var(--textMuted)]">
              Lane section status (excl. summary): {laneStatusSummary}
            </p>
          ) : null}
          {showPerLaneSourceChips ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--text)]">
                ⚖ Litigation: ~{estPer} signals
              </span>
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--text)]">
                ⚙ Engineering: ~{estPer} signals
              </span>
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--text)]">
                👥 Hiring: ~{estPer} signals
              </span>
            </div>
          ) : (
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--textMuted)]">
              {chunk <= 1
                ? 'Per-lane signal counts are hidden when evidence is this thin — multiple sections may cite the same chunk. Use section status (Complete / Partial / Insufficient) and citations below, not the headline verdict alone.'
                : 'Per-lane “signals” chips are omitted below 5 indexed sources; lane sections may still share overlapping evidence.'}
            </p>
          )}
          {showPrelimNotice && (
            <div
              className="mt-4 flex gap-2 rounded-[var(--radius-md)] border border-[var(--noticeBorder)] bg-[var(--noticeBg)] px-3 py-2 text-sm text-[var(--noticeText)]"
              role="status"
            >
              <span aria-hidden>⚠</span>
              Thin evidence — under 5 distinct chunks in this report (indexed or live). Treat as preliminary; verify claims against primary sources.
            </div>
          )}
        </section>

        {data.confidence_score != null && (
          <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-5 py-4 shadow-dsSm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--textSubtle)]">
              Model confidence
            </p>
            <div className="mt-3">
              <ConfidenceBar value={data.confidence_score} />
            </div>
          </div>
        )}

        {execSection && (() => {
          const cites = execSection.citations ?? []
          const rawText = execSection.text ?? ''
          const apiProbes = (data.probe_questions ?? [])
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 3)
          const preSplit = splitExecutiveProbes(rawText)
          const embeddedProbeLines = preSplit.probes
            ? preSplit.probes
                .split('\n')
                .map((l) => l.trim().replace(/^•\s*/, ''))
                .filter(Boolean)
            : []
          const probeSourceForMerge = apiProbes.length > 0 ? apiProbes : embeddedProbeLines
          const displayCites = mergeCitationDisplayOrder(cites, probeSourceForMerge)

          const normalized = normalizeChunkIdRefs(rawText, displayCites)
          const { narrative: splitNarr, probes: embeddedProbes } = splitExecutiveProbes(normalized)
          const narrativeText = splitNarr || normalized
          let probeLines: string[] = []
          if (apiProbes.length > 0) {
            probeLines = apiProbes.map((l) => normalizeChunkIdRefs(l, displayCites))
          } else if (embeddedProbes) {
            probeLines = embeddedProbes
              .split('\n')
              .map((l) => l.trim().replace(/^•\s*/, ''))
              .filter(Boolean)
              .map((l) => normalizeChunkIdRefs(l, displayCites))
          }
          return (
            <Card padding="lg" className="border-[var(--border)] shadow-dsMd">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--textSubtle)]">
                Executive readout
              </p>
              {narrativeText ? (
                <p className="mt-3 text-base leading-[1.75] text-[var(--text)]">
                  {renderCitedBody(narrativeText, displayCites, 'exec')}
                </p>
              ) : null}
              {probeLines.length > 0 ? (
                <div className="mt-6 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface2)] px-5 py-5">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
                    Before the call, probe
                  </p>
                  <ul className="list-disc space-y-3 pl-5 marker:text-[var(--accent)]">
                    {probeLines.map((line, i) => (
                      <li key={i} className="text-base leading-relaxed text-[var(--text)]">
                        {renderCitedBody(line, displayCites, 'exec')}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {displayCites.length > 0 && (
                <ol className="mt-6 space-y-2 border-t border-[var(--contentInsetBorder)] pt-5 text-sm text-[var(--textMuted)]">
                  {displayCites.map((c, i) => (
                    <li key={i} id={`cite-exec-${i + 1}`} className="font-mono text-xs">
                      [{i + 1}] {c}
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )
        })()}

        {otherSections.map((key) => {
          const sec = data.sections[key] as ReportSection | undefined
          if (!sec) return null
          const slug = key.replace(/[^a-zA-Z0-9_-]+/g, '-')
          const open = openSections[key] ?? true
          const st = statusLabel(sec.status)
          const secCites = sec.citations ?? []
          const bodyNorm = normalizeChunkIdRefs(sec.text ?? '', secCites)
          const citeLen = secCites.length
          const citeBadge = showPerLaneSourceChips
            ? `${citeLen} signals`
            : citeLen === 0
              ? 'No citations'
              : citeLen === 1
                ? '1 citation'
                : `${citeLen} citations`
          return (
            <Card key={key} padding="none" className="overflow-hidden shadow-dsSm">
              <button
                type="button"
                className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--surface2)]"
                aria-expanded={open}
                onClick={() => setOpenSections((s) => ({ ...s, [key]: !open }))}
              >
                <ChevronDown
                  className={cn('h-5 w-5 shrink-0 text-[var(--textMuted)] transition-transform duration-200', open && 'rotate-180')}
                />
                <span className="font-display text-sm font-semibold capitalize tracking-tight text-[var(--text)]">
                  {key.replace(/_/g, ' ')}
                </span>
                <span className={cn('text-xs font-medium', st.tone)}>{st.text}</span>
                <span className="ml-auto rounded-full bg-[var(--surface2)] px-2.5 py-0.5 font-mono text-[10px] text-[var(--textMuted)]">
                  {citeBadge}
                </span>
              </button>
              <div
                className={cn(
                  'grid transition-[grid-template-rows] duration-200 ease-out',
                  open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                )}
              >
                <div className="overflow-hidden">
                  <div className="space-y-4 border-t border-[var(--contentInsetBorder)] bg-[var(--surface)]/40 px-5 py-5">
                    <div className="text-base leading-[1.7] text-[var(--text)]">
                      {renderCitedBody(bodyNorm, secCites, slug)}
                    </div>
                    {secCites.length > 0 && (
                      <ol className="space-y-2 text-sm text-[var(--textMuted)]">
                        {secCites.map((c, i) => (
                          <li key={i} id={`cite-${slug}-${i + 1}`} className="font-mono text-xs">
                            [{i + 1}] {c}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          )
        })}

        {data.known_unknowns && data.known_unknowns.length > 0 && (
          <Card
            padding="lg"
            className="border-l-4 border-l-[var(--yellow)] border-[var(--noticeBorder)] bg-[var(--yellowSoft)] shadow-dsSm"
          >
            <h3 className="font-display text-sm font-semibold text-[var(--noticeText)]">
              What we couldn&apos;t find
            </h3>
            <ul className="mt-4 list-disc space-y-2.5 pl-5 text-sm leading-relaxed text-[var(--textMuted)]">
              {data.known_unknowns.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </Card>
        )}

        <p className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]/60 px-4 py-3 text-[13px] leading-relaxed text-[var(--textSubtle)]">
          {data.disclaimer}
        </p>

        <div className="flex flex-wrap gap-6 pb-8 text-sm">
          {isGuest ? (
            <Link to="/try" className="text-[var(--accent)] underline hover:text-[var(--accentHover)]">
              Trial scan
            </Link>
          ) : (
            <Link to="/dashboard" className="text-[var(--accent)] underline hover:text-[var(--accentHover)]">
              Dashboard
            </Link>
          )}
          <Link to="/methodology" className="text-[var(--textMuted)] underline hover:text-[var(--text)]">
            Methodology
          </Link>
        </div>
      </div>
    </div>
  )

  return isGuest ? <PublicLayout>{reportMain}</PublicLayout> : reportMain
}
