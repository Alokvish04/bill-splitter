import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  type Balance,
  type Bill,
  formatCents,
  type PaidShare,
  parseDollarsToCents,
  request,
} from '../api'

export const Route = createFileRoute('/homes/$homeId')({
  component: HomePage,
})

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong.'
}

function HomePage() {
  const { homeId } = Route.useParams()
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading')
  const [loadError, setLoadError] = useState('')
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])

  const [paying, setPaying] = useState<Record<string, boolean>>({})
  const [payErrors, setPayErrors] = useState<Record<string, string>>({})
  // One idempotency key per share, kept until the payment succeeds, so a retry
  // after a timeout can never charge the share twice.
  const keys = useRef(new Map<string, string>())

  const [memberName, setMemberName] = useState('')
  const [memberError, setMemberError] = useState('')
  const [addingMember, setAddingMember] = useState(false)

  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [billError, setBillError] = useState('')
  const [creatingBill, setCreatingBill] = useState(false)

  const load = useCallback(
    async (silent: boolean) => {
      try {
        const [billData, balanceData] = await Promise.all([
          request<{ bills: Bill[] }>(`/api/homes/${homeId}/bills`),
          request<{ balances: Balance[] }>(`/api/homes/${homeId}/balances`),
        ])
        setBills(billData.bills)
        setBalances(balanceData.balances)
        setStatus('ready')
      } catch (error) {
        if (silent) return
        setLoadError(messageOf(error))
        setStatus('error')
      }
    },
    [homeId],
  )

  useEffect(() => {
    setStatus('loading')
    load(false)
  }, [load])

  async function pay(billId: string, shareId: string) {
    if (paying[shareId]) return
    let key = keys.current.get(shareId)
    if (!key) {
      key = crypto.randomUUID()
      keys.current.set(shareId, key)
    }
    setPaying((current) => ({ ...current, [shareId]: true }))
    setPayErrors((current) => ({ ...current, [shareId]: '' }))
    try {
      const result = await request<PaidShare>(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
      })
      keys.current.delete(shareId)
      // Only now, after the server said 200, does the share show as paid.
      setBills((current) =>
        current.map((bill) =>
          bill.id !== billId
            ? bill
            : {
                ...bill,
                shares: bill.shares.map((share) =>
                  share.id === shareId ? { ...share, paidAt: result.paidAt } : share,
                ),
              },
        ),
      )
      load(true)
    } catch (error) {
      setPayErrors((current) => ({ ...current, [shareId]: messageOf(error) }))
    } finally {
      setPaying((current) => ({ ...current, [shareId]: false }))
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (addingMember) return
    if (memberName.trim() === '') {
      setMemberError('Enter the member’s name.')
      return
    }
    setAddingMember(true)
    setMemberError('')
    try {
      await request(`/api/homes/${homeId}/members`, { method: 'POST', body: { name: memberName } })
      setMemberName('')
      await load(true)
    } catch (error) {
      setMemberError(messageOf(error))
    } finally {
      setAddingMember(false)
    }
  }

  async function createBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (creatingBill) return
    const totalCents = parseDollarsToCents(amount)
    if (title.trim() === '' || totalCents === null) {
      setBillError('Enter a title and an amount like 120 or 45.50.')
      return
    }
    setCreatingBill(true)
    setBillError('')
    try {
      await request(`/api/homes/${homeId}/bills`, {
        method: 'POST',
        body: { title, totalCents },
      })
      setTitle('')
      setAmount('')
      await load(true)
    } catch (error) {
      setBillError(messageOf(error))
    } finally {
      setCreatingBill(false)
    }
  }

  if (status === 'loading') return <p className="muted">Loading…</p>

  if (status === 'error') {
    return (
      <div className="card">
        <p className="error">{loadError}</p>
        <button
          type="button"
          onClick={() => {
            setStatus('loading')
            load(false)
          }}
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <>
      <section className="card">
        <h2>Members</h2>
        {balances.length === 0 ? (
          <p className="muted">No members yet. Add someone to start splitting bills.</p>
        ) : (
          <ul>
            {balances.map((balance) => (
              <li key={balance.memberId} className="row between">
                <span>{balance.name}</span>
                <span className={balance.outstandingCents === 0 ? 'muted' : ''}>
                  owes {formatCents(balance.outstandingCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <form className="row" onSubmit={addMember}>
          <label>
            Name{' '}
            <input value={memberName} onChange={(event) => setMemberName(event.target.value)} />
          </label>
          <button type="submit" disabled={addingMember}>
            {addingMember ? 'Adding…' : 'Add member'}
          </button>
        </form>
        {memberError !== '' && <p className="error">{memberError}</p>}
      </section>

      <section className="card">
        <h2>New bill</h2>
        <form className="row" onSubmit={createBill}>
          <label>
            Title <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            Amount{' '}
            <input
              value={amount}
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <button type="submit" disabled={creatingBill}>
            {creatingBill ? 'Splitting…' : 'Split bill'}
          </button>
        </form>
        {billError !== '' && <p className="error">{billError}</p>}
      </section>

      <h2>Bills</h2>
      {bills.length === 0 && <p className="muted">No bills yet.</p>}
      {bills.map((bill) => (
        <section key={bill.id} className="card">
          <div className="row between">
            <strong>{bill.title}</strong>
            <span>{formatCents(bill.totalCents)}</span>
          </div>
          <ul>
            {bill.shares.map((share) => (
              <li key={share.id}>
                <div className="row between">
                  <span>
                    {share.memberName} · {formatCents(share.amountCents)}
                  </span>
                  {share.paidAt !== null ? (
                    <span className="paid">Paid</span>
                  ) : (
                    <button
                      type="button"
                      disabled={paying[share.id] === true}
                      onClick={() => pay(bill.id, share.id)}
                    >
                      {paying[share.id] === true ? 'Paying…' : 'Pay'}
                    </button>
                  )}
                </div>
                {(payErrors[share.id] ?? '') !== '' && (
                  <p className="error">{payErrors[share.id]} Nothing was marked as paid.</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}
