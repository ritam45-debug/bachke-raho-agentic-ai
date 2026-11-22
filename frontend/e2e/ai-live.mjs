// LIVE end-to-end test of Phase 2 against the real Anthropic API, run on GitHub Actions with the
// ANTHROPIC_API_KEY repository secret. It drives the built site in a real browser exactly as a user would:
// register a company → add a route → switch AI on → enter the key → ask the Route Risk Analyst → verify the
// answer used live tools and was recorded (trace, server-priced cost, audit log).
import { chromium } from 'playwright'
import { appendFileSync } from 'node:fs'

const KEY = process.env.ANTHROPIC_API_KEY
const BASE = process.env.SITE_URL ?? 'http://localhost:4173/'
const MODEL = process.env.LIVE_MODEL ?? 'claude-sonnet-5-5'
const summary = (s) => { console.log(s); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + '\n') }
const fail = (m) => { summary(`\n**FAILED:** ${m}`); process.exit(1) }

if (!KEY) { summary('## Phase 2 live test: SKIPPED\nThe `ANTHROPIC_API_KEY` repository secret is not set, so the real-Claude test could not run. Phase 2 is **not** verified end-to-end.'); process.exit(78) }

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : {})
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
try {
  const stamp = Date.now()
  await page.goto(BASE)
  await page.getByText('Register your company').first().click()
  await page.locator('input').first().fill(`Live Test Freight ${stamp}`)
  await page.fill("input[placeholder='e.g. Electronics manufacturing']", 'Logistics')
  await page.locator("label:has-text('Headquarters') + input").fill('Kochi')
  await page.getByText('Continue').click(); await page.getByText('Continue').click()
  await page.locator("label:has-text('Full name') + input").fill('CI Bot')
  await page.locator("label:has-text('Work email') + input").fill(`ci+${stamp}@example.com`)
  await page.locator('input[type=password]').nth(0).fill('LiveTest!2026xyz')
  await page.locator('input[type=password]').nth(1).fill('LiveTest!2026xyz')
  await page.check('input[type=checkbox]')
  await page.getByText('Create workspace').click()
  await page.waitForSelector('text=Get set up')

  await page.click('nav >> text=Route & Risk Map')
  await page.click("button:has-text('Import CSV')")
  await page.getByRole('button', { name: 'Routes', exact: true }).click()
  await page.fill('textarea', 'name,mode,origin,destination\nKochi → Colombo,sea,9.97;76.27,6.94;79.84\n')
  await page.click("button:has-text('Import routes')")
  await page.waitForSelector('text=Imported 1 routes')

  await page.click('nav >> text=AI Consulting Centre')
  await page.click("button:has-text('Allow external AI processing')")
  await page.waitForSelector('text=AI is switched off for this company', { state: 'detached' })
  await page.selectOption("select:near(:text('Model'))", MODEL)
  await page.fill("input[placeholder='sk-ant-…']", KEY)
  await page.click('text=Test & save key')
  await page.waitForSelector('text=(this tab)', { timeout: 30000 }).catch(async () => fail(`Key test failed: ${(await page.locator('main').innerText()).slice(-600)}`))

  const q = 'Run a live risk check on our Kochi → Colombo route and tell me the main threats over the next 3 days.'
  await page.fill("input[placeholder^='Ask about route risk']", q)
  await page.click("button[aria-label='Send']")
  await page.waitForSelector('text=How this answer was made', { timeout: 180000 }).catch(async () => fail(`No answer: ${(await page.locator('section.card').innerText()).slice(0, 1500)}`))
  const answer = await page.locator('section.card').innerText()
  await page.click('text=How this answer was made')
  await page.waitForSelector("aside:has-text('Agent trace') >> text=Tool calls")
  const trace = await page.locator("aside:has-text('Agent trace')").innerText()
  await page.screenshot({ path: 'ai-live.png', fullPage: true })

  const toolsUsed = [...trace.matchAll(/tool call\s+(\w+)/g)].map((m) => m[1])
  const status = /Status\s+(\w+)/.exec(trace)?.[1]
  const cost = /Cost \(server-priced\)\s+\$([\d.]+)/.exec(trace)?.[1]
  summary(`## Phase 2 live test against the real Claude API (${MODEL})\n- Status: **${status}**\n- Tools used: ${toolsUsed.join(', ') || 'none'}\n- Server-priced cost: $${cost}\n\n### Answer\n\n${answer.replace(q, '').trim().slice(0, 3000)}\n`)

  if (status !== 'completed') fail(`run status ${status}`)
  if (!toolsUsed.length) fail('the agent answered without using any tool')
  if (!/colombo|kochi/i.test(answer)) fail('answer does not mention the route')
  if (!(Number(cost) > 0)) fail('no cost recorded')
  await page.click('nav >> text=Audit & Activity')
  const audit = await page.locator('tbody').innerText()
  if (!audit.includes('ai.run_finished')) fail('run not in audit log')
  if (pageErrors.length) fail(`page errors: ${pageErrors.join('; ')}`)
  summary('\n**PASSED** – real Claude call, tool use, trace, server-side cost and audit entry all verified.')
} finally { await browser.close() }
