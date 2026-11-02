import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

type ShareRow = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Accepts only { name: <non-blank string> }. Returns the trimmed name or null.
function parseName(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('name' in body)) return null
  const { name } = body
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : null
}

// Accepts { title: non-blank string, totalCents: positive safe integer }, else null.
function parseBill(body: unknown): { title: string; totalCents: number } | null {
  if (typeof body !== 'object' || body === null) return null
  if (!('title' in body) || !('totalCents' in body)) return null
  const { title, totalCents } = body
  if (typeof title !== 'string' || title.trim().length === 0) return null
  if (typeof totalCents !== 'number') return null
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return null
  return { title: title.trim(), totalCents }
}

// ---------- Part 1: homes and members ----------

app.post('/api/homes', async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const name = parseName(body)
  if (name === null) return c.json({ error: 'name must be a non-empty string' }, 422)

  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()
  return c.json({ id, name }, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!home) return c.json({ error: 'home not found' }, 404)

  const body: unknown = await c.req.json().catch(() => null)
  const name = parseName(body)
  if (name === null) return c.json({ error: 'name must be a non-empty string' }, 422)

  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(id, homeId, name)
    .run()
  return c.json({ id, homeId, name }, 201)
})

// ---------- Part 2: bills, payments, balances ----------

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!home) return c.json({ error: 'home not found' }, 404)

  const body: unknown = await c.req.json().catch(() => null)
  const input = parseBill(body)
  if (input === null) {
    return c.json({ error: 'title and a positive whole-number totalCents are required' }, 422)
  }

  const { results: members } = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY seq ASC',
  )
    .bind(homeId)
    .all<{ id: string }>()
  if (members.length === 0) return c.json({ error: 'home has no members' }, 422)

  // Split: everyone gets the base amount; the first `remainder` members get +1 cent.
  const base = Math.floor(input.totalCents / members.length)
  const remainder = input.totalCents % members.length
  const shares = members.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: base + (index < remainder ? 1 : 0),
    paidAt: null,
  }))

  const billId = crypto.randomUUID()
  // One batch = one transaction: a bill never exists without all of its shares.
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, input.title, input.totalCents),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      ).bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ])

  return c.json(
    { id: billId, homeId, title: input.title, totalCents: input.totalCents, shares },
    201,
  )
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key) return c.json({ error: 'Idempotency-Key header is required' }, 400)

  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  // One atomic statement: only a share that is still unpaid can match, so of two
  // simultaneous requests exactly one gets a row back.
  const paid = await c.env.DB.prepare(
    `UPDATE shares
     SET paid_at = ?, idempotency_key = ?
     WHERE id = ? AND bill_id = ? AND paid_at IS NULL
     RETURNING id, member_id AS memberId, amount_cents AS amountCents, paid_at AS paidAt`,
  )
    .bind(new Date().toISOString(), key, shareId, billId)
    .first<ShareRow>()
  if (paid) return c.json(paid, 200)

  // No row updated: the share is missing, or it was already paid.
  const existing = await c.env.DB.prepare(
    `SELECT id, member_id AS memberId, amount_cents AS amountCents,
            paid_at AS paidAt, idempotency_key AS idempotencyKey
     FROM shares WHERE id = ? AND bill_id = ?`,
  )
    .bind(shareId, billId)
    .first<ShareRow & { idempotencyKey: string | null }>()
  if (!existing) return c.json({ error: 'bill or share not found' }, 404)

  if (existing.idempotencyKey === key) {
    // Retry of the same payment: same answer, no second payment.
    const { id, memberId, amountCents, paidAt } = existing
    return c.json({ id, memberId, amountCents, paidAt }, 200)
  }
  return c.json({ error: 'share already paid with a different key' }, 409)
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!home) return c.json({ error: 'home not found' }, 404)

  const { results } = await c.env.DB.prepare(
    `SELECT m.id AS memberId, m.name AS name,
            COALESCE(SUM(s.amount_cents), 0) AS outstandingCents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id AND s.paid_at IS NULL
     WHERE m.home_id = ?
     GROUP BY m.id
     ORDER BY m.seq ASC`,
  )
    .bind(homeId)
    .all<{ memberId: string; name: string; outstandingCents: number }>()

  return c.json({ balances: results }, 200)
})

type BillRow = { id: string; homeId: string; title: string; totalCents: number }
type BillShareRow = ShareRow & { billId: string; memberName: string }

app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!home) return c.json({ error: 'home not found' }, 404)

  const { results: bills } = await c.env.DB.prepare(
    `SELECT id, home_id AS homeId, title, total_cents AS totalCents
     FROM bills WHERE home_id = ? ORDER BY rowid DESC`,
  )
    .bind(homeId)
    .all<BillRow>()

  const { results: shares } = await c.env.DB.prepare(
    `SELECT s.id, s.bill_id AS billId, s.member_id AS memberId, m.name AS memberName,
            s.amount_cents AS amountCents, s.paid_at AS paidAt
     FROM shares s
     JOIN members m ON m.id = s.member_id
     JOIN bills b ON b.id = s.bill_id
     WHERE b.home_id = ?
     ORDER BY m.seq ASC`,
  )
    .bind(homeId)
    .all<BillShareRow>()

  const sharesByBill = new Map<string, BillShareRow[]>()
  for (const share of shares) {
    const list = sharesByBill.get(share.billId) ?? []
    list.push(share)
    sharesByBill.set(share.billId, list)
  }

  return c.json(
    {
      bills: bills.map((bill) => ({
        ...bill,
        shares: (sharesByBill.get(bill.id) ?? []).map(
          ({ id, memberId, memberName, amountCents, paidAt }) => ({
            id,
            memberId,
            memberName,
            amountCents,
            paidAt,
          }),
        ),
      })),
    },
    200,
  )
})

// ---------- Errors: always JSON { "error": "message" } ----------

app.notFound((c) => c.json({ error: 'not found' }, 404))
app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'internal server error' }, 500)
})

export default app
