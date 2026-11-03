import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import '../styles.css'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <main className="app">
      <h1>
        <Link to="/">Bill Splitter</Link>
      </h1>
      <Outlet />
    </main>
  )
}
