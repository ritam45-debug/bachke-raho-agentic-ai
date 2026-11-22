// Phase 4 browser test on the preview build: register → import suppliers & products → vendor scoring +
// allocation → finance calculators + saved scenario → product lifecycle BOM cost build-up.
import { chromium } from 'playwright'
import { resolve } from 'node:path'

const BASE = process.env.SITE_URL ?? 'file://' + resolve('dist-preview/index.html')
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1) } console.log('ok -', m) }
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : {})
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
try {
  await page.goto(BASE)
  await page.getByText('Register your company').first().click()
  await page.locator('input').first().fill('Phase Four Industries')
  await page.fill("input[placeholder='e.g. Electronics manufacturing']", 'Manufacturing')
  await page.locator("label:has-text('Headquarters') + input").fill('Chennai')
  await page.getByText('Continue').click(); await page.getByText('Continue').click()
  await page.locator("label:has-text('Full name') + input").fill('Test Admin')
  await page.locator("label:has-text('Work email') + input").fill('admin@p4.example')
  await page.locator('input[type=password]').nth(0).fill('Phase4!Test2026')
  await page.locator('input[type=password]').nth(1).fill('Phase4!Test2026')
  await page.check('input[type=checkbox]')
  await page.getByText('Create workspace').click()
  await page.waitForSelector('text=Get set up')

  const imp = async (label, csv, n) => {
    await page.click('nav >> text=Data Import')
    await page.getByRole('button', { name: new RegExp(`\\d\\. ${label}$`) }).click()
    await page.fill('textarea', csv)
    await page.click(`button:has-text('Import ${n} ${label.toLowerCase()}')`)
    await page.waitForSelector(`text=/Imported|created|updated/`)
  }
  await imp('Suppliers', 'code,name,category,country,on_time_delivery_rate,quality_score,avg_lead_time_days,financial_stability_score,risk_exposure_score,capacity_units_per_month,moq_units\n'
    + 'S1,Alpha Steel,Steel,India,95%,90,10,80,20,600,100\nS2,Beta Steel,Steel,Vietnam,80%,70,25,60,50,5000,100\nS3,Gamma Paints,Coatings,India,90%,85,7,75,15,,\n', 3)
  await imp('Products', 'sku,name,kind,category,unit_cost,unit_price,conversion_cost,primary_supplier_code\n'
    + 'RM-ST,Steel sheet,raw_material,Metals,120,,,S1\nRM-PT,Paint,raw_material,Coatings,40,,,S3\nFG-CAB,Cabinet,finished_good,Furniture,900,1500,150,\n', 3)

  // Vendor scoring
  await page.click('nav >> text=Vendor Performance')
  await page.waitForSelector('text=Ranking')
  await page.selectOption("select:near(:text('Category to compare'))", 'Steel')
  await page.waitForSelector('text=Ranking – Steel')
  const rows = await page.locator('table tbody tr').allInnerTexts()
  ok(rows.length === 2 && rows[0].includes('Alpha Steel'), `Alpha ranks first without quotes (${rows.map((r) => r.split('\t')[1]).join(' > ')})`)
  ok(rows[0].includes('missing: cost'), 'missing price (cost criterion) flagged and scored 0')
  const quotes = page.locator("input[placeholder='Quote ₹/unit']")
  await quotes.nth(0).fill('130'); await quotes.nth(1).fill('100')
  await page.waitForTimeout(200)
  const alloc = await page.locator('text=Recommended allocation').locator('..').innerText()
  ok(/Alpha Steel\s*600 units/.test(alloc) && /Beta Steel\s*400 units/.test(alloc), 'dual-source allocation respects Alpha capacity cap (600 + 400)')
  await page.click("button:has-text('Save snapshot')")
  await page.waitForSelector('text=Snapshot saved')
  // weights total guard
  await page.locator('input[type=range]').first().fill('60')
  await page.waitForSelector('text=Weights must total exactly 100%')
  ok(await page.locator("button:has-text('Save weights')").isDisabled(), 'save disabled while weights ≠ 100')
  await page.click("button:has-text('Reset to default')")

  // Finance
  await page.click('nav >> text=Financial Intelligence')
  await page.waitForSelector('text=Disruption impact')
  const f = (label) => page.locator(`label:has-text('${label}') + input`).first()
  await f('Disruption length').fill('10'); await f('Revenue at risk per day').fill('100000'); await f('Gross margin').fill('30')
  await f('Downtime cost per day').fill('20000'); await f('Expediting').fill('50000'); await f('Contract penalties').fill('0')
  await f('Likelihood').fill('50'); await f('Loss avoided').fill('80'); await f('Mitigation cost').fill('100000')
  const fin = await page.locator('main').innerText()
  ok(fin.includes('₹5.50 L'), 'impact = 10×1L×30% + 10×20k + 50k = ₹5,50,000')
  ok(fin.includes('₹2.20 L') && fin.includes('₹1.20 L'), 'benefit ₹2,20,000, net ₹1,20,000')
  ok(fin.includes('expected to pay back'), 'verdict: mitigation pays')
  await page.fill("input[placeholder='Scenario name']", 'Port strike 10d')
  await page.click("button:has-text('Save scenario')")
  await page.waitForSelector('li:has-text("Port strike 10d")')
  ok(await page.locator('li:has-text("Vendor scoring – Steel")').count() === 1, 'vendor snapshot listed among saved scenarios')

  // Lifecycle / BOM
  await page.click('nav >> text=Product Lifecycle')
  await page.waitForSelector('text=Bill of materials')
  const addBom = async (sku, q) => {
    await page.selectOption("select:has(option:text('Add component…'))", sku)
    await page.locator("select:has(option:text('Add component…')) + input").fill(String(q))
    await page.locator("select:has(option:text('Add component…')) ~ button").click()
    await page.waitForSelector(`td:has-text('${sku}')`)
  }
  await addBom('RM-ST', 5); await addBom('RM-PT', 2)
  const lc = await page.locator('main').innerText()
  ok(lc.includes('₹680') && lc.includes('₹830'), 'material ₹680 (5×120 + 2×40), built-up cost ₹830 (+150 conversion)')
  ok(lc.includes('Concentration'), 'supplier concentration warning (Alpha = 88% of material)')
  ok(errors.length === 0, `no page errors ${errors.join('; ')}`)
  console.log('\nPhase 4 e2e: all checks passed')
} catch (e) {
  console.error('FAIL:', e.message); await page.screenshot({ path: '/tmp/p4-fail.png', fullPage: true }); process.exit(1)
} finally { await browser.close() }
