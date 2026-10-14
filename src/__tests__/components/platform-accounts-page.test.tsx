import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlatformAccountsPage } from '@/components/lifeos/admin/platform-accounts-page'
import { Sidebar } from '@/components/lifeos/sidebar'

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))

const member: { accountId: string; username: string; displayName: string; role: string; legacyOwner: boolean; enabled: boolean; workspaces: string[] } = {
  accountId: 'acct_test_member', username: 'member.one', displayName: 'Member One', role: 'member',
  legacyOwner: false, enabled: true, workspaces: [],
}
const workspace = { workspaceId: 'ws_ops_internal', slug: 'ops', displayName: 'Ops Desk', kind: 'internal', configured: true }
const lifeos = { workspaceId: 'ws_lifeos_legacy', slug: 'lifeos', displayName: 'Life OS', kind: 'lifeos', configured: true }

function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('PlatformAccountsPage', () => {
  it('shows the account navigation after an admin session is confirmed', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => Promise.resolve(
      String(input) === '/api/platform/session'
        ? response({ principal: { role: 'platform_admin' } })
        : response({ workspaces: [] }),
    )))

    render(<Sidebar />)

    expect(await screen.findByRole('button', { name: 'Accounts & access' })).toBeInTheDocument()
  })

  it('keeps the account navigation hidden for a regular member', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ principal: { role: 'member' } })))

    render(<Sidebar />)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Accounts & access' })).not.toBeInTheDocument())
  })

  it('does not request account data for a non-admin session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ principal: { role: 'member' } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<PlatformAccountsPage />)

    expect(await screen.findByText('This page is available to platform administrators only.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/platform/session', expect.any(Object))
  })

  it('creates a member, grants a configured workspace, and clears password input after a reset', async () => {
    const user = userEvent.setup()
    const confirmMock = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirmMock)
    const calls: { path: string; init?: RequestInit }[] = []
    let accounts = [{ ...member }]
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      if (path === '/api/platform/session') return response({ principal: { role: 'platform_admin' } })
      if (path === '/api/platform/admin/accounts' && !init?.method) return response({ accounts })
      if (path === '/api/platform/admin/workspaces') return response({ workspaces: [workspace, lifeos] })
      if (path === '/api/platform/admin/accounts' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        accounts = [...accounts, { ...member, accountId: 'acct_created', username: body.username, displayName: body.displayName || body.username }]
        return response({ account: accounts.at(-1) }, 201)
      }
      if (path.endsWith('/workspaces') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        accounts = accounts.map(account => account.accountId === 'acct_test_member'
          ? { ...account, workspaces: body.granted ? [body.workspaceId] : [] } : account)
        return response({})
      }
      if (path.endsWith('/enabled') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        accounts = accounts.map(account => account.accountId === 'acct_test_member' ? { ...account, enabled: body.enabled } : account)
        return response(null, 204)
      }
      if (path.endsWith('/password') && init?.method === 'POST') return response(null, 204)
      return response({}, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<PlatformAccountsPage />)
    expect(await screen.findByText('Accounts and workspace access')).toBeInTheDocument()
    expect(screen.getByText('Life OS')).toBeInTheDocument()
    const reservedSwitch = screen.getByRole('switch', { name: 'Life OS member.one' })
    expect(reservedSwitch).toBeDisabled()

    await user.type(screen.getByLabelText('Username'), 'new.member')
    await user.type(screen.getByLabelText('Display name'), 'New Member')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await screen.findByText('New Member')
    expect(calls.some(call => call.path === '/api/platform/admin/accounts' && call.init?.method === 'POST')).toBe(true)

    await user.click(screen.getByRole('switch', { name: 'Ops Desk member.one' }))
    await waitFor(() => expect(calls.some(call => call.path === '/api/platform/admin/accounts/acct_test_member/workspaces'
      && JSON.parse(String(call.init?.body)).granted === true)).toBe(true))

    await user.click(screen.getByRole('switch', { name: 'Account status member.one' }))
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining('Disable this account?'))
    await waitFor(() => expect(calls.some(call => call.path === '/api/platform/admin/accounts/acct_test_member/enabled'
      && JSON.parse(String(call.init?.body)).enabled === false)).toBe(true))

    await user.click(screen.getAllByRole('button', { name: 'Set or reset password' })[0])
    const passwordInput = screen.getByLabelText('Temporary password')
    await user.type(passwordInput, 'synthetic-test-pass')
    await user.type(screen.getByLabelText('Confirm password'), 'synthetic-test-pass')
    await user.click(screen.getByRole('button', { name: 'Save password' }))
    await screen.findByText('Password updated. Existing sessions were ended.')
    expect(screen.queryByLabelText('Temporary password')).not.toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Set or reset password' })[0])
    expect(screen.getByLabelText('Temporary password')).toHaveValue('')
    expect(calls.some(call => call.path === '/api/platform/admin/accounts/acct_test_member/password'
      && call.init?.method === 'POST'
      && JSON.parse(String(call.init.body)).password === 'synthetic-test-pass')).toBe(true)
  })
})
