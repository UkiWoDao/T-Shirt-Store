import { APIRequestContext, test as base } from '@playwright/test';
import jwt from 'jsonwebtoken';
import { expect } from '@playwright/test';
import { registrationPage } from '../pages/registrationPage';
import { homePage, Size } from '../pages/homePage';
import { loginPage } from '../pages/loginPage';
import { myAccountPage } from '../pages/myAccountPage';
import { cartPage } from '../pages/cartPage';

type Pages = {
	registrationPage: ReturnType<typeof registrationPage>;
	homePage: ReturnType<typeof homePage>;
	loginPage: ReturnType<typeof loginPage>;
	myAccountPage: ReturnType<typeof myAccountPage>;
	cartPage: ReturnType<typeof cartPage>;
};

const generateNumericalSuffix = () =>
	generateNumericalSuffixBetween(1000, 9999);

const generateNumericalSuffixBetween = (min: number, max: number) => {
	return Math.floor(Math.random() * (max - min + 1)) + min;
};

const test = base.extend<Pages>({
	registrationPage: async ({ page }, use) => {
		await use(registrationPage(page));
	},
	homePage: async ({ page }, use) => {
		await use(homePage(page));
	},
	loginPage: async ({ page }, use) => {
		await use(loginPage(page));
	},
	myAccountPage: async ({ page }, use) => {
		await use(myAccountPage(page));
	},
	cartPage: async ({ page }, use) => {
		await use(cartPage(page));
	},
});

const apiLoginAs = async (
	request: APIRequestContext,
	email: string,
	password: string,
) => {
	return request.post('./api/auth/login', {
		data: {
			email: email,
			password: password,
		},
	});
};

const generateSomeUserData = () => ({
	username: `someName${generateNumericalSuffix()}`,
	email: `someEmail${generateNumericalSuffix()}@email.com`,
	password: `somePassword${generateNumericalSuffix()}`,
});

test.describe('Registration and shopping suite', () => {
	test.describe.configure({ mode: 'default' });

	test('Registering with valid data should succeed and navigate to login page', async ({
		page,
		request,
		homePage,
		registrationPage,
	}) => {
		// ARRANGE
		const {
			username: someValidUsername,
			email: someValidEmail,
			password: someValidPassword,
		} = generateSomeUserData();

		// ACT
		await homePage.go();
		await homePage.goRegister();
		await registrationPage.inputUsername(someValidUsername);
		await registrationPage.inputEmail(someValidEmail);
		await registrationPage.inputPassword(someValidPassword);
		await registrationPage.submit();

		// ASSERT
		await expect(registrationPage.getSuccessMessage()).toBeVisible();
		await expect(page).toHaveURL(/\/login/);

		const apiLoginResponse = await apiLoginAs(
			request,
			someValidEmail,
			someValidPassword,
		);

		expect(apiLoginResponse.status()).toBe(200);
		const apiResponseBody = await apiLoginResponse.json();
		expect.soft(apiResponseBody.message).toBe('Login successful');
		expect.soft(apiResponseBody.user.name).toBe(someValidUsername);
		expect.soft(apiResponseBody.user.email).toBe(someValidEmail);
	});

	test('Logging in as registered User should succeed and navigate to my account page', async ({
		page,
		request,
		homePage,
		loginPage,
		myAccountPage,
	}) => {
		// ARRANGE
		const {
			username: someValidUsername,
			email: someValidEmail,
			password: someValidPassword,
		} = generateSomeUserData();

		const apiRegisterResponse = await request.post('./api/auth/register', {
			data: {
				email: someValidEmail,
				name: someValidUsername,
				password: someValidPassword,
			},
		});

		test.skip(
			apiRegisterResponse.status() !== 201,
			'Failed to register; aborting test',
		);

		// ACT
		await homePage.go();
		await homePage.goLogin();
		await loginPage.inputEmail(someValidEmail);
		await loginPage.inputPassword(someValidPassword);
		await loginPage.logIn();

		// ASSERT
		await expect(page).toHaveURL('./my-account');
		await expect(myAccountPage.getWelcomeMessage()).toHaveText(
			` Welcome, ${someValidUsername}! `,
			{ ignoreCase: true },
		);
		await expect(myAccountPage.getFullName()).toHaveText(
			`Username: ${someValidUsername}`,
		);
		await expect(myAccountPage.getEmail()).toHaveText(
			`Email: ${someValidEmail}`,
		);
	});

	test('Adding to cart as a logged in User', async ({
		page,
		request,
		homePage,
		loginPage,
		cartPage,
	}) => {
		// ARRANGE
		const {
			username: someValidUsername,
			email: someValidEmail,
			password: someValidPassword,
		} = generateSomeUserData();

		const apiRegisterResponse = await request.post('./api/auth/register', {
			data: {
				email: someValidEmail,
				name: someValidUsername,
				password: someValidPassword,
			},
		});

		test.skip(
			apiRegisterResponse.status() !== 201,
			'Failed to register; aborting test',
		);

		const expectedItem = 'Blue T-Shirt';
		const expectedSize: Size = 'L';

		// ACT
		await homePage.go();
		await homePage.goLogin();
		await loginPage.inputEmail(someValidEmail);
		await loginPage.inputPassword(someValidPassword);
		await loginPage.logIn();
		await homePage.go();
		await homePage.selectSizeFor(expectedItem, expectedSize);
		const expectedPrice =
			(await homePage.getPriceFor(expectedItem).textContent()) ?? '';
		await homePage.addToCart(expectedItem);

		// ASSERT
		await expect(page).toHaveURL(/\/cart/);
		await expect.soft(cartPage.getItemName()).toHaveText(expectedItem);
		await expect
			.soft(cartPage.getItemSize())
			.toHaveText(`Size: ${expectedSize}`);
		await expect.soft(cartPage.getItemTotal()).toHaveText(expectedPrice);
		await expect.soft(cartPage.getItemQuantity()).toHaveValue('1');
		await expect.soft(cartPage.getItemTotal()).toHaveText(expectedPrice);
		await expect
			.soft(cartPage.getGrandTotal())
			.toHaveText(`Grand Total: ${expectedPrice}`);
	});

	test('Logged in User can log out', async ({
		page,
		request,
		loginPage,
		myAccountPage,
	}) => {
		// ARRANGE
		const {
			username: someValidUsername,
			email: someValidEmail,
			password: someValidPassword,
		} = generateSomeUserData();

		const apiRegisterResponse = await request.post('./api/auth/register', {
			data: {
				email: someValidEmail,
				name: someValidUsername,
				password: someValidPassword,
			},
		});

		test.skip(
			apiRegisterResponse.status() !== 201,
			'Failed to register; aborting test',
		);

		// ACT
		await loginPage.go();
		await loginPage.inputEmail(someValidEmail);
		await loginPage.inputPassword(someValidPassword);
		await loginPage.logIn();
		await myAccountPage.logOut();
		await myAccountPage.go(); // attempt to access an otherwise restricted page

		// ASSERT
		await expect(page).toHaveURL(/\/login/);
	});
});
