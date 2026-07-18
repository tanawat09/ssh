import { expect, test } from '@playwright/test'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be set by the E2E harness`)
  }
  return value
}

const sshPort = requiredEnvironment('E2E_SSH_PORT')

test('opens and uses a terminal without horizontal overflow on mobile', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('Username').fill('admin')
  await page
    .getByRole('textbox', { name: 'Password' })
    .fill('e2e-admin-password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('Terminal mobile')
  await page.getByLabel('Host').fill('127.0.0.1')
  await page.getByLabel('Port').fill(sshPort)
  await page.getByLabel('SSH username').fill('e2e-terminal-mobile')
  await page.getByRole('textbox', { name: 'Password' }).fill('e2e-ssh-password')
  await page.getByRole('button', { name: 'Test & Save' }).click()
  await expect(page.getByText('Server saved')).toBeVisible()

  await page.goto('/servers')
  const server = page.locator('article').filter({ hasText: 'Terminal mobile' })
  await server.getByRole('link', { name: 'Connect' }).click()
  await expect(page.getByText('1 / 5 sessions')).toBeVisible()
  const input = page.locator(
    '.terminal-pane-shell:visible .xterm-helper-textarea',
  )
  await input.focus()
  await page.keyboard.type('whoami')
  await page.keyboard.press('Enter')
  await expect(
    page.locator('.terminal-pane-shell:visible .xterm-rows'),
  ).toContainText('e2e-terminal-mobile')

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }))
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport)
})
