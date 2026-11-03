import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { ApiError, request } from '../api'

export const Route = createFileRoute('/')({
  component: CreateHomePage,
})

function CreateHomePage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function createHome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (name.trim() === '') {
      setError('Give the home a name.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const home = await request<{ id: string; name: string }>('/api/homes', {
        method: 'POST',
        body: { name },
      })
      await navigate({ to: '/homes/$homeId', params: { homeId: home.id } })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card" onSubmit={createHome}>
      <h2>Start a shared home</h2>
      <div className="row">
        <label>
          Home name <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create home'}
        </button>
      </div>
      {error !== '' && <p className="error">{error}</p>}
    </form>
  )
}
