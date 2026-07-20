import { expect, test, type Page } from '@playwright/test'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be set by the E2E harness`)
  }
  return value
}

const sshPort = requiredEnvironment('E2E_SSH_PORT')
const serverUsername = 'e2e-delete-server'

async function login(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Username').fill('admin')
  await page
    .getByRole('textbox', { name: 'Password' })
    .fill('e2e-admin-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(
    page.getByRole('heading', { name: 'Create server' }),
  ).toBeVisible()
}

async function createServer(page: Page, serverName: string): Promise<void> {
  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill(serverName)
  await page.getByLabel('Host').fill('127.0.0.1')
  await page.getByLabel('Port').fill(sshPort)
  await page.getByLabel('SSH username').fill(serverUsername)
  await page.getByRole('textbox', { name: 'Password' }).fill('e2e-ssh-password')
  await page.getByRole('button', { name: 'Test & Save' }).click()
  await expect(page.getByText('Server saved')).toBeVisible()
}

test('blocks deletion while a terminal is active and deletes after disconnecting', async ({
  page,
}) => {
  const serverName = `Delete target ${Date.now().toString(36)}`
  await login(page)
  await createServer(page, serverName)

  await page.goto('/servers')
  const terminalServerRow = page.locator('article').filter({
    has: page.getByRole('heading', { name: serverName, exact: true }),
  })
  const terminalSocketPromise = page.waitForEvent('websocket')
  await terminalServerRow.getByRole('link', { name: 'Connect' }).click()
  const terminalSocket = await terminalSocketPromise
  await expect(page.getByText('1 / 5 sessions')).toBeVisible()
  await expect(
    page.locator('[data-test="terminal-tab"]').filter({ hasText: serverName }),
  ).toBeVisible()
  await expect(
    page.locator('.terminal-pane-shell:visible .xterm-rows'),
  ).toContainText(`${serverUsername}@fixture`)

  const serverListPage = await page.context().newPage()
  await serverListPage.goto('/servers')
  await expect(
    serverListPage.getByRole('heading', { name: 'Servers' }),
  ).toBeVisible()
  const serverRow = serverListPage.locator('article').filter({
    has: serverListPage.getByRole('heading', {
      name: serverName,
      exact: true,
    }),
  })

  await serverRow.getByRole('button', { name: `Delete ${serverName}` }).click()
  const blockedResponsePromise = serverListPage.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      response.url().includes('/api/v1/servers/'),
  )
  await serverListPage.getByRole('button', { name: 'Delete server' }).click()
  expect((await blockedResponsePromise).status()).toBe(409)
  await expect(
    serverListPage.getByText(
      'Disconnect the active terminal before deleting this server.',
    ),
  ).toBeVisible()
  await expect(serverRow).toBeVisible()

  await page.bringToFront()
  const terminalClosedPromise = terminalSocket.waitForEvent('close')
  await page.getByRole('button', { name: `Disconnect ${serverName}` }).click()
  await terminalClosedPromise
  await expect(page.getByText('0 / 5 sessions')).toBeVisible()

  await serverListPage.bringToFront()
  const deletedResponsePromise = serverListPage.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      response.url().includes('/api/v1/servers/'),
  )
  await serverListPage.getByRole('button', { name: 'Delete server' }).click()
  expect((await deletedResponsePromise).status()).toBe(204)
  await expect(serverRow).toHaveCount(0)
})
