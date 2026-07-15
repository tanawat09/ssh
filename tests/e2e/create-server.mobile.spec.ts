import { expect, test } from '@playwright/test'

test('renders the login and create-server workflow on a mobile viewport', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('Username').fill('admin')
  await page
    .getByRole('textbox', { name: 'Password' })
    .fill('e2e-admin-password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(
    page.getByRole('heading', { name: 'Create server' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Test & Save' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible()
})
