import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { X } from 'lucide-react'
import guestAxios from '@/core/api/guest-axios.instance'
import { GUEST } from '@/core/api/routes'
import {
  useGuestConfirmEntityMutation,
  useGuestCreateScanMutation,
  useGuestResolveEntityMutation,
} from '@/hooks/api/guest.hooks'
import { getAxiosStatus } from '@/hooks/api/http'
import type { ClearbitSuggestion, EntityCandidate } from '@/hooks/api/types'
import { useToast } from '@/components/ui/ToastContext'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { PublicLayout } from '@/components/layout/PublicLayout'

function parseScanQuery(raw: string): { name: string; domain_hint?: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { name: '' }
  const noProto = trimmed.replace(/^https?:\/\//i, '').split('/')[0]?.split(':')[0] ?? trimmed
  const candidate = noProto.toLowerCase()
  if (/\s/.test(trimmed)) return { name: trimmed }
  if (!candidate.includes('.')) return { name: trimmed }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(candidate)) {
    return { name: trimmed }
  }
  return { name: trimmed, domain_hint: candidate }
}

export function TryScan() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const resolveMut = useGuestResolveEntityMutation()
  const confirmMut = useGuestConfirmEntityMutation()
  const createScanMut = useGuestCreateScanMutation()

  const [query, setQuery] = useState('')
  const [disambiguationOpen, setDisambiguationOpen] = useState(false)
  const [noMatchMode, setNoMatchMode] = useState(false)
  const [candidates, setCandidates] = useState<EntityCandidate[]>([])
  const [confidence, setConfidence] = useState(0)
  const [manualDomain, setManualDomain] = useState('')
  const [pick, setPick] = useState<string | 'manual' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [inputFocus, setInputFocus] = useState(false)
  const [pendingAuto, setPendingAuto] = useState(false)
  const [suggestions, setSuggestions] = useState<ClearbitSuggestion[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const scanInputWrapRef = useRef<HTMLDivElement>(null)

  const busy = resolveMut.isPending || confirmMut.isPending || createScanMut.isPending

  useEffect(() => {
    document.title = 'Try a scan — DealScannr'
  }, [])

  useEffect(() => {
    const intent = searchParams.get('intent')
    const company = searchParams.get('company')
    if (company && intent === 'scan') {
      setQuery(decodeURIComponent(company))
      setPendingAuto(true)
      const next = new URLSearchParams(searchParams)
      next.delete('intent')
      next.delete('company')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setSuggestions([])
      setShowDropdown(false)
      setHighlightIndex(-1)
      return
    }
    const ac = new AbortController()
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await guestAxios.get<ClearbitSuggestion[]>(GUEST.AUTOCOMPLETE(q), {
            signal: ac.signal,
          })
          const data = Array.isArray(res.data) ? res.data.slice(0, 6) : []
          setSuggestions(data)
          setShowDropdown(data.length > 0)
          setHighlightIndex(-1)
        } catch (e: unknown) {
          if (axios.isCancel(e)) return
          const code = (e as { code?: string }).code
          if (code === 'ERR_CANCELED') return
          setSuggestions([])
          setShowDropdown(false)
        }
      })()
    }, 300)
    return () => {
      window.clearTimeout(timer)
      ac.abort()
    }
  }, [query])

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (scanInputWrapRef.current?.contains(e.target as Node)) return
      setShowDropdown(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  const openManualDomainEntry = useCallback(() => {
    setShowDropdown(false)
    setHighlightIndex(-1)
    setDisambiguationOpen(true)
    setNoMatchMode(true)
    setCandidates([])
    setPick('manual')
    setManualDomain('')
    setErr(null)
  }, [])

  const confirmAndStart = useCallback(
    async (c: EntityCandidate | null, manual?: string) => {
      setErr(null)
      const legal = c?.legal_name ?? query.trim()
      const dom = (manual ?? c?.domain ?? '').trim()
      try {
        const data = await confirmMut.mutateAsync({
          legal_name: legal,
          domain: dom,
          candidate_id: c?.candidate_id ?? undefined,
        })
        const scan = await createScanMut.mutateAsync({
          entity_id: data.entity_id,
          legal_name: legal,
          domain: dom,
          company_name: legal,
        })
        toast('success', 'Scan started')
        setDisambiguationOpen(false)
        setNoMatchMode(false)
        setCandidates([])
        setPick(null)
        setManualDomain('')
        try {
          sessionStorage.setItem(
            `scan.${scan.scan_id}.meta`,
            JSON.stringify({ company: legal, domain: dom }),
          )
        } catch {
          /* ignore */
        }
        navigate(`/try/scan/${scan.scan_id}/progress`)
      } catch (e) {
        const st = getAxiosStatus(e)
        const code = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        if (st === 403 && (code === 'guest_scan_exhausted' || code === 'guest_ip_limit')) {
          const msg =
            code === 'guest_ip_limit'
              ? 'A trial scan was already used from this network recently. Create a free account to continue.'
              : 'Your free trial scan was already used. Sign up to run more scans.'
          setErr(msg)
          toast('error', msg)
        } else if (st === 429) {
          setErr('Too many requests — wait about 30 seconds and try again.')
          toast('warning', 'Rate limited — try again shortly.')
        } else {
          setErr('Could not start scan.')
          toast('error', 'Could not start scan.')
        }
      }
    },
    [query, confirmMut, createScanMut, navigate, toast],
  )

  const selectClearbitSuggestion = useCallback(
    (s: ClearbitSuggestion) => {
      setQuery(s.name)
      setShowDropdown(false)
      setHighlightIndex(-1)
      setSuggestions([])
      const c: EntityCandidate = {
        candidate_id: null,
        legal_name: s.name,
        domain: s.domain,
        confidence: 0.97,
        source: 'clearbit',
      }
      void confirmAndStart(c)
    },
    [confirmAndStart],
  )

  const submitScan = useCallback(async () => {
    if (!query.trim()) return
    setShowDropdown(false)
    setErr(null)
    setNoMatchMode(false)
    setDisambiguationOpen(false)
    const { name, domain_hint } = parseScanQuery(query)
    try {
      const data = await resolveMut.mutateAsync({
        name,
        domain_hint,
      })
      const list = data.candidates || []
      setCandidates(list)
      setConfidence(data.confidence ?? 0)
      if (list.length === 0) {
        setNoMatchMode(true)
        setDisambiguationOpen(true)
        setPick('manual')
        setManualDomain('')
        setErr(
          'No company matched. Add the website domain below (e.g. stripe.com) — we will create an entity and run the scan.',
        )
        toast('warning', 'No automatic match — enter a domain to continue')
        return
      }
      if (data.confidence >= 0.85 && list.length === 1) {
        await confirmAndStart(list[0], list[0].domain ?? undefined)
      } else {
        setDisambiguationOpen(true)
        const first = list[0]
        setPick(first ? (first.candidate_id ?? first.legal_name) : 'manual')
      }
    } catch {
      setErr('Could not resolve company. Check spelling and try again.')
      toast('error', 'Resolve failed')
    }
  }, [query, resolveMut, confirmAndStart, toast])

  const handleScanInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!showDropdown || suggestions.length === 0) return
      const total = suggestions.length + 1
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowDropdown(false)
        setHighlightIndex(-1)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightIndex((prev) => (prev < 0 ? 0 : (prev + 1) % total))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightIndex((prev) => (prev < 0 ? total - 1 : (prev - 1 + total) % total))
        return
      }
      if (e.key === 'Enter' && highlightIndex >= 0) {
        e.preventDefault()
        if (highlightIndex < suggestions.length) {
          selectClearbitSuggestion(suggestions[highlightIndex])
        } else {
          openManualDomainEntry()
        }
      }
    },
    [
      showDropdown,
      suggestions,
      highlightIndex,
      selectClearbitSuggestion,
      openManualDomainEntry,
    ],
  )

  useEffect(() => {
    if (!pendingAuto || !query.trim()) return
    setPendingAuto(false)
    const t = window.setTimeout(() => void submitScan(), 200)
    return () => window.clearTimeout(t)
  }, [pendingAuto, query, submitScan])

  function onConfirmDisambiguation() {
    if (pick === 'manual') {
      if (!manualDomain.trim()) {
        setErr('Enter a domain or pick a match.')
        return
      }
      void confirmAndStart(null, manualDomain.trim())
      return
    }
    const c = candidates.find((x) => (x.candidate_id ?? x.legal_name) === pick)
    if (!c) {
      setErr('Select a company.')
      return
    }
    void confirmAndStart(c)
  }

  return (
    <PublicLayout>
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 py-8 text-[var(--text)]">
        <PageHeader
          title="Try your first scan"
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                to="/login"
                className="text-sm font-medium text-[var(--accent)] hover:text-[var(--accentHover)]"
              >
                Log in
              </Link>
              <span className="text-[var(--textSubtle)]" aria-hidden>
                ·
              </span>
              <Link
                to="/register"
                className="text-sm font-medium text-[var(--accent)] hover:text-[var(--accentHover)]"
              >
                Sign up
              </Link>
            </div>
          }
        />

        <p className="mb-6 text-sm text-[var(--textMuted)]">
          One free scan without an account. Results are saved in this browser session — create an account
          afterward to keep scans in your dashboard.
        </p>

        <Card
          padding="lg"
          className={`transition-shadow ${
            inputFocus ? 'ring-2 ring-[var(--accentSoft)] ring-offset-2 ring-offset-[var(--bg)]' : ''
          }`}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submitScan()
            }}
            className="flex flex-col gap-3 sm:flex-row sm:items-stretch"
          >
            <div ref={scanInputWrapRef} className="relative min-w-0 flex-1">
              <div
                className={`relative flex min-h-12 items-center rounded-[var(--radius-md)] border bg-[var(--surface)] transition-shadow sm:min-h-[48px] ${
                  inputFocus
                    ? 'border-[var(--accent)] shadow-[0_0_0_3px_var(--accentSoft)]'
                    : 'border-[var(--border)]'
                }`}
              >
                <input
                  className="h-12 w-full border-0 bg-transparent px-3 pr-10 text-[var(--text)] outline-none placeholder:text-[var(--textSubtle)] sm:h-12"
                  placeholder="Enter company name or domain…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setInputFocus(true)}
                  onBlur={() => setInputFocus(false)}
                  onKeyDown={handleScanInputKeyDown}
                  disabled={busy}
                  aria-label="Company name or domain"
                  aria-expanded={showDropdown && suggestions.length > 0}
                  aria-controls="try-scan-autocomplete-list"
                  autoComplete="off"
                  role="combobox"
                />
                {query ? (
                  <button
                    type="button"
                    className="absolute right-2 rounded p-1 text-[var(--textMuted)] hover:bg-[var(--surface2)] hover:text-[var(--text)]"
                    aria-label="Clear"
                    onClick={() => {
                      setQuery('')
                      setSuggestions([])
                      setShowDropdown(false)
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              {showDropdown && suggestions.length > 0 ? (
                <div
                  id="try-scan-autocomplete-list"
                  role="listbox"
                  className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-md)]"
                >
                  {suggestions.map((s, i) => (
                    <div
                      key={`${s.domain}-${i}`}
                      role="option"
                      aria-selected={highlightIndex === i}
                      className={`flex cursor-pointer items-center gap-3 border-b border-[var(--border)] px-3.5 py-2.5 last:border-b-0 ${
                        highlightIndex === i ? 'bg-[var(--surface2)]' : 'bg-transparent'
                      }`}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setHighlightIndex(i)}
                      onClick={() => selectClearbitSuggestion(s)}
                    >
                      {s.logo ? (
                        <img
                          src={s.logo}
                          alt=""
                          width={20}
                          height={20}
                          className="shrink-0 rounded object-contain"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                          }}
                        />
                      ) : (
                        <span className="h-5 w-5 shrink-0" aria-hidden />
                      )}
                      <span className="text-sm font-medium text-[var(--text)]">{s.name}</span>
                      <span className="ml-auto font-mono text-xs text-[var(--textMuted)]">{s.domain}</span>
                    </div>
                  ))}
                  <div
                    role="option"
                    aria-selected={highlightIndex === suggestions.length}
                    className={`cursor-pointer px-3.5 py-2 text-xs text-[var(--textMuted)] ${
                      highlightIndex === suggestions.length ? 'bg-[var(--surface2)]' : ''
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlightIndex(suggestions.length)}
                    onClick={() => openManualDomainEntry()}
                  >
                    Not listed? Enter domain manually →
                  </div>
                </div>
              ) : null}
            </div>
            <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!query.trim()}>
              Scan
            </Button>
          </form>
        </Card>

        {disambiguationOpen && (
          <Card padding="md" className="mt-6 border-[var(--accentBorder)] bg-[var(--accentSoft)]/40">
            <p className="font-display text-sm font-semibold text-[var(--text)]">
              {noMatchMode ? 'No automatic match' : 'We found multiple matches'}
            </p>
            <p className="mt-1 text-xs text-[var(--textMuted)]">
              {noMatchMode
                ? "Enter the company's website domain so we can confirm the entity and start the scan."
                : `Confidence ${Math.round(confidence * 100)}% — pick one or enter a domain.`}
            </p>
            <ul className="mt-4 space-y-2">
              {candidates.map((c, i) => {
                const id = c.candidate_id ?? c.legal_name ?? `${i}`
                return (
                  <li key={id}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3 hover:border-[var(--accent)]">
                      <input
                        type="radio"
                        name="pick-try"
                        className="mt-1"
                        checked={pick === id}
                        onChange={() => setPick(id)}
                      />
                      <div className="min-w-0 flex-1 text-sm">
                        <span className="font-medium text-[var(--text)]">{c.legal_name}</span>
                        <span className="mt-0.5 block font-mono text-xs text-[var(--textMuted)]">
                          {c.domain || '—'}
                          {(c.hq_city || c.hq_country) && (
                            <span className="text-[var(--textSubtle)]">
                              {' '}
                              · {[c.hq_city, c.hq_country].filter(Boolean).join(', ')}
                            </span>
                          )}
                        </span>
                        <span className="mt-1 inline-block text-xs text-[var(--accent)]">
                          {Math.round(c.confidence * 100)}% match
                        </span>
                      </div>
                    </label>
                  </li>
                )
              })}
              <li>
                <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3 hover:border-[var(--accent)]">
                  <input
                    type="radio"
                    name="pick-try"
                    className="mt-1"
                    checked={pick === 'manual'}
                    onChange={() => setPick('manual')}
                  />
                  <div className="flex-1 text-sm font-medium text-[var(--text)]">None of these</div>
                </label>
              </li>
            </ul>
            {pick === 'manual' && (
              <div className="mt-3">
                <label htmlFor="try-manual-domain" className="text-xs font-medium text-[var(--textMuted)]">
                  Domain
                </label>
                <input
                  id="try-manual-domain"
                  className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accentSoft)]"
                  placeholder="company.com"
                  value={manualDomain}
                  onChange={(e) => setManualDomain(e.target.value)}
                />
              </div>
            )}
            <Button
              type="button"
              className="mt-4"
              variant="primary"
              onClick={onConfirmDisambiguation}
              loading={busy}
            >
              Confirm
            </Button>
          </Card>
        )}

        {err && (
          <p className="mt-4 text-sm text-[var(--red)]" role="alert">
            {err}
          </p>
        )}

        <p className="mt-10 text-center text-sm text-[var(--textSubtle)]">
          <Link to="/" className="text-[var(--accent)] hover:underline">
            ← Back to home
          </Link>
        </p>
      </div>
    </PublicLayout>
  )
}
