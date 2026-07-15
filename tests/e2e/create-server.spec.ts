import { expect, test, type Page } from '@playwright/test'

const adminUsername = 'admin'
const adminPassword = 'e2e-admin-password'
const sshUsername = 'e2e-ssh-user'
const sshPassword = 'e2e-ssh-password'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be set by the E2E harness`)
  }
  return value
}

const sshPort = Number(requiredEnvironment('E2E_SSH_PORT'))
const sshPrivateKey = requiredEnvironment('E2E_SSH_PRIVATE_KEY')

async function login(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Username').fill(adminUsername)
  await page.getByRole('textbox', { name: 'Password' }).fill(adminPassword)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(
    page.getByRole('heading', { name: 'Create server' }),
  ).toBeVisible()
}

async function fillEndpoint(
  page: Page,
  name: string,
  host = '127.0.0.1',
): Promise<void> {
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await page.getByLabel('Host').fill(host)
  await page.getByLabel('Port').fill(String(sshPort))
  await page.getByLabel('SSH username').fill(sshUsername)
}

test('creates password and private-key servers, rejects duplicates, and clears failed credentials', async ({
  page,
}) => {
  await login(page)

  await fillEndpoint(page, 'Password fixture')
  await page.getByRole('textbox', { name: 'Password' }).fill(sshPassword)
  await page.getByRole('button', { name: 'Test & Save' }).click()
  await expect(page.getByText('Server saved')).toBeVisible()
  await expect(page.getByText(/^SHA256:/)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Password' })).toHaveValue('')

  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('Duplicate fixture')
  await page.getByRole('textbox', { name: 'Password' }).fill(sshPassword)
  await page.getByRole('button', { name: 'Test & Save' }).click()
  await expect(
    page.getByText('A server already exists for this endpoint'),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Password' })).toHaveValue('')

  await page.getByLabel('SSH username').fill('e2e-bad-user')
  await page.getByRole('textbox', { name: 'Password' }).fill('not-the-password')
  await page.getByRole('button', { name: 'Test & Save' }).click()
  await expect(page.getByText('SSH authentication failed')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Password' })).toHaveValue('')

  await fillEndpoint(page, 'Private key fixture', 'localhost')
  await page.getByRole('radio', { name: 'Private key' }).press('Space')
  await page.getByRole('textbox', { name: 'Private key' }).fill(sshPrivateKey)
  await page.getByRole('button', { name: 'Test & Save' }).click()
  await expect(page.getByText('Server saved')).toBeVisible()
  await expect(page.getByText(/^SHA256:/)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Private key' })).toHaveValue(
    '',
  )
})
