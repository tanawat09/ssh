import { expect, test } from '@playwright/test'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be set by the E2E harness`)
  }
  return value
}

const sshPort = requiredEnvironment('E2E_SSH_PORT')
const sshHostKeyFingerprint = requiredEnvironment('E2E_SSH_FINGERPRINT')

test('creates a server and clears failed credentials on a mobile viewport', async ({
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
    .fill('Mobile password fixture')
  await page.getByLabel('Host').fill('127.0.0.1')
  await page.getByLabel('Port').fill(sshPort)
  await page.getByLabel('SSH username').fill('e2e-mobile-user')
  const password = page.getByRole('textbox', { name: 'Password' })
  const submit = page.getByRole('button', { name: 'Test & Save' })

  await password.fill('wrong-mobile-password')
  await submit.click()
  await expect(
    page.getByRole('button', { name: 'Testing connection...' }),
  ).toBeVisible()
  await expect(page.getByText('SSH authentication failed')).toBeVisible()
  await expect(password).toHaveValue('')

  await password.fill('e2e-ssh-password')
  await submit.click()
  await expect(
    page.getByRole('button', { name: 'Testing connection...' }),
  ).toBeVisible()
  await expect(page.getByText('Server saved')).toBeVisible()
  await expect(
    page.getByText(sshHostKeyFingerprint, { exact: true }),
  ).toBeVisible()
  await expect(password).toHaveValue('')

  const viewportWidth = await page.evaluate(
    () => document.documentElement.clientWidth,
  )
  const pageWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  )
  expect(pageWidth).toBeLessThanOrEqual(viewportWidth)
})
