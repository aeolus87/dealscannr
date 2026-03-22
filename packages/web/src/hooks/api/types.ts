export type CreditsPayload = {
  remaining: number
  plan: string
  monthly_used: number
  monthly_limit: number
  resets_at: string
}

export type HistoryRow = {
  scan_id: string
  entity_name: string
  domain: string
  verdict: string | null
  confidence_score: number | null
  lane_coverage: number
  created_at: string
  chunk_count: number
  has_report: boolean
}

export type EntityCandidate = {
  candidate_id: string | null
  legal_name: string
  domain: string
  hq_city?: string | null
  hq_country?: string | null
  confidence: number
  source?: string
}

/** Clearbit company suggest API shape (proxied via our API). */
export type ClearbitSuggestion = {
  name: string
  domain: string
  logo?: string | null
}

export type BillingStatus = {
  plan: string
  status: string
  stripe_customer_id: string | null
  current_period_end: string | null
  manage_url: string | null
}

export type ReportSection = {
  text: string
  citations: string[]
  status: string
}

export type ScanReportPayload = {
  verdict: string
  confidence_score: number
  lane_coverage: number
  chunk_count: number
  risk_triage?: 'clean' | 'watch' | 'flag' | 'unknown'
  probe_questions?: string[]
  sections: Record<string, ReportSection>
  known_unknowns: string[]
  disclaimer: string
  scan_id?: string
  hallucinated_citations_count?: number
  status?: string
  company_tagline?: string
  meta?: {
    estimated_cost_usd: number
    prompt_tokens: number
    completion_tokens: number
  }
}

export type LaneRow = {
  status: string
  chunk_count: number
  connectors: string[]
  error?: string | null
}

export type ScanStatusPayload = {
  scan_id: string
  status: string
  lanes: Record<string, LaneRow>
  total_chunks: number
  elapsed_seconds: number
  /** UTC instant; client derives smooth elapsed via Date.now() - Date.parse(created_at). */
  created_at: string | null
}

export type SharedReportPayload = {
  report: {
    verdict: string
    confidence_score: number
    lane_coverage: number
    chunk_count: number
    risk_triage?: 'clean' | 'watch' | 'flag' | 'unknown'
    probe_questions?: string[]
    sections: Record<string, ReportSection>
    known_unknowns: string[]
    disclaimer: string
  }
  entity_name: string
  scan_date: string
}

export type WatchlistEntry = {
  id: string
  entity_id: string
  entity_name: string
  domain: string
  added_at: string | null
  last_scanned_at: string | null
  last_verdict: string | null
  notify_on: string[]
}

export type BatchResultRow = {
  company_name: string | null
  domain: string | null
  scan_id: string | null
  verdict: string | null
  status: string | null
  error: string | null
}

export type BatchStatusPayload = {
  batch_id: string
  total: number
  completed: number
  failed: number
  status: string
  results: BatchResultRow[]
}

export type ApiKeyRow = {
  prefix: string
  name: string
  created_at: string | null
  last_used_at: string | null
  scopes: string[]
}
