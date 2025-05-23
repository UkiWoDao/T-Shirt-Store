import type { Page } from '@playwright/test';

export const registrationPage = (page: Page) => ({
	navigate: async () => {
		await page.goto('./register');
	},
	inputUsername: async (name: string) => {
		const nameInputField = page.getByRole('textbox', { name: 'Name' });
		await nameInputField.click();
		await nameInputField.fill(name);
	},
	inputEmail: async (email: string) => {
		const emailInputField = page.getByRole('textbox', {
			name: 'Email address',
		});
		await emailInputField.click();
		await emailInputField.fill(email);
	},
	inputPassword: async (password: string) => {
		const passwordInputField = page.getByRole('textbox', { name: 'Password' });
		await passwordInputField.click();
		await passwordInputField.fill(password);
	},
	submit: async () => {
		const responsePromise = page.waitForResponse(
			(response) =>
				response.url().includes('/api/auth/register') &&
				response.status() === 201 &&
				response.request().method() === 'POST',
		);
		await page.getByRole('button', { name: 'Register' }).click();
		await responsePromise;
	},
	getSuccessMessage: () => page.getByText('✅ Registration successful!'),
});
