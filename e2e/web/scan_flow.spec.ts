import { test, expect } from '@playwright/test'

const reportBody = {
  verdict: 'MEET',
  confidence_score: 0.85,
  lane_coverage: 3,
  chunk_count: 12,
  sections: {
    executive_summary: { text: 'Summary', citations: [], status: 'complete' },
    legal_regulatory: { text: 'Legal', citations: [], status: 'complete' },
    engineering_health: { text: 'Eng', citations: [], status: 'complete' },
    hiring_trends: { text: 'Hire', citations: [], status: 'complete' },
    funding_news: { text: 'News', citations: [], status: 'complete' },
  },
  known_unknowns: ['A'],
  disclaimer: 'Disclaimer text',
}

test('full scan flow with mocked API', async ({ page }) => {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: '1', email: 't@test.co', plan_tier: 'free', scan_credits: 3 },
        credits: 3,
        plan: 'free',
      }),
    })
  })
  await page.route('**/api/users/me/credits', async (route) => {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        remaining: 3,
        plan: 'free',
        monthly_used: 0,
        monthly_limit: 3,
        resets_at: '2099-01-01T00:00:00+00:00',
      }),
    })
  })
  await page.route('**/api/scans/history**', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify({ scans: [], total: 0, page: 1, limit: 20 }) })
  })
  await page.route('**/api/entity/autocomplete**', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify([]) })
  })
  await page.route('**/api/entity/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        candidates: [
          { candidate_id: null, legal_name: 'A Co', domain: 'a.co', confidence: 0.95, source: 'hint' },
        ],
        confidence: 0.95,
      }),
    })
  })
  await page.route('**/api/entity/confirm', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify({ entity_id: 'ent1' }) })
  })
  let statusCalls = 0
  await page.route('**/api/scans/test-123/status', async (route) => {
    statusCalls += 1
    const complete = statusCalls >= 2
    const lanes = complete
      ? {
          litigation: { status: 'complete', chunk_count: 2, connectors: [] },
          engineering: { status: 'complete', chunk_count: 2, connectors: [] },
          hiring: { status: 'complete', chunk_count: 2, connectors: [] },
          news: { status: 'complete', chunk_count: 2, connectors: [] },
        }
      : {
          litigation: { status: 'running', chunk_count: 0, connectors: [] },
          engineering: { status: 'running', chunk_count: 0, connectors: [] },
          hiring: { status: 'running', chunk_count: 0, connectors: [] },
          news: { status: 'running', chunk_count: 0, connectors: [] },
        }
    const created_at = new Date(Date.now() - 2000).toISOString()
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        scan_id: 'test-123',
        status: complete ? 'complete' : 'running',
        lanes,
        total_chunks: complete ? 8 : 0,
        elapsed_seconds: 1,
        created_at,
      }),
    })
  })
  await page.route('**/api/scans', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, body: JSON.stringify({ scan_id: 'test-123', status: 'running' }) })
    } else {
      await route.continue()
    }
  })
  await page.route('**/api/scans/test-123/report', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reportBody) })
  })

  await page.addInitScript(() => {
    localStorage.setItem(
      'dealscannr.auth',
      JSON.stringify({ state: { token: 'mock-token' }, version: 0 }),
    )
  })
  await page.goto('/dashboard')
  await page.getByLabel(/company name or domain/i).fill('MockCo')
  await page.getByRole('button', { name: /scan/i }).click()
  // High confidence single match → auto-starts, navigates to progress
  await expect(page).toHaveURL(/\/scan\/test-123\/progress/, { timeout: 10_000 })
  await expect(page).toHaveURL(/\/scan\/test-123\/report/, { timeout: 15_000 })
  await expect(page.getByText('MEET').first()).toBeVisible()
  await expect(page.getByText(/Disclaimer text/)).toBeVisible()
})

test('402 shows credits error on dashboard', async ({ page }) => {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        user: { id: '1', email: 't@test.co', plan_tier: 'free', scan_credits: 0 },
        credits: 0,
        plan: 'free',
      }),
    })
  })
  await page.route('**/api/users/me/credits**', async (route) => {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        remaining: 0,
        plan: 'free',
        monthly_used: 3,
        monthly_limit: 3,
        resets_at: '2099-01-01T00:00:00+00:00',
      }),
    })
  })
  await page.route('**/api/scans/history**', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify({ scans: [], total: 0, page: 1, limit: 20 }) })
  })
  await page.route('**/api/entity/autocomplete**', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify([]) })
  })
  await page.route('**/api/entity/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        candidates: [
          { candidate_id: null, legal_name: 'X Co', domain: 'x.co', confidence: 0.95, source: 'hint' },
        ],
        confidence: 0.95,
      }),
    })
  })
  await page.route('**/api/entity/confirm', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify({ entity_id: 'e1' }) })
  })
  await page.route('**/api/scans', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 402,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'credits_exhausted', message: 'No credits' }),
      })
    } else {
      await route.continue()
    }
  })
  await page.addInitScript(() => {
    localStorage.setItem('dealscannr.auth', JSON.stringify({ state: { token: 'x' }, version: 0 }))
  })
  await page.goto('/dashboard')
  await page.getByLabel(/company name or domain/i).fill('X')
  await page.getByRole('button', { name: /scan/i }).click()
  await expect(page.getByRole('alert').getByText(/no scan credits/i)).toBeVisible({ timeout: 10_000 })
})
