import { expect, test, type Page } from '@playwright/test'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be set by the E2E harness`)
  }
  return value
}

const sshPort = requiredEnvironment('E2E_SSH_PORT')

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

async function createServer(
  page: Page,
  name: string,
  host: string,
  username: string,
): Promise<void> {
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await page.getByLabel('Host').fill(host)
  await page.getByLabel('Port').fill(sshPort)
  await page.getByLabel('SSH username').fill(username)
  await page.getByRole('textbox', { name: 'Password' }).fill('e2e-ssh-password')
  await page.getByRole('button', { name: 'Test & Save' }).click()
  await expect(page.getByText('Server saved')).toBeVisible()
}

async function runCommand(page: Page, command: string): Promise<void> {
  const input = page.locator(
    '.terminal-pane-shell:visible .xterm-helper-textarea',
  )
  await input.focus()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

test('opens two SSH terminals, switches tabs, and disconnects one session', async ({
  page,
}) => {
  await login(page)
  await createServer(page, 'Terminal one', '127.0.0.1', 'e2e-terminal-one')
  await createServer(page, 'Terminal two', 'localhost', 'e2e-terminal-two')

  await page.goto('/servers')
  const firstServer = page
    .locator('article')
    .filter({ hasText: 'Terminal one' })
  await firstServer.getByRole('link', { name: 'Connect' }).click()
  await expect(page.getByText('1 / 5 sessions')).toBeVisible()
  await runCommand(page, 'whoami')
  await expect(
    page.locator('.terminal-pane-shell:visible .xterm-rows'),
  ).toContainText('e2e-terminal-one')

  await page.getByRole('button', { name: /Terminal two/ }).click()
  await expect(page.getByText('2 / 5 sessions')).toBeVisible()
  await runCommand(page, 'echo second-terminal')
  await expect(
    page.locator('.terminal-pane-shell:visible .xterm-rows'),
  ).toContainText('second-terminal')

  await page
    .locator('[data-test="terminal-tab"]')
    .filter({ hasText: 'Terminal one' })
    .getByRole('button', { name: 'Terminal one', exact: true })
    .click()
  await expect(
    page.locator('.terminal-pane-shell:visible .xterm-rows'),
  ).toContainText('e2e-terminal-one')

  await page.getByRole('button', { name: 'Disconnect Terminal one' }).click()
  await expect(page.getByText('1 / 5 sessions')).toBeVisible()
  await expect(
    page
      .locator('[data-test="terminal-tab"]')
      .filter({ hasText: 'Terminal one' }),
  ).toHaveCount(0)
})
