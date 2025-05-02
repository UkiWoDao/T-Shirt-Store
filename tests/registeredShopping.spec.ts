import { test as base } from '@playwright/test';
import { expect } from '@playwright/test';
import { registrationPage } from './pages/registrationPage';
import { homePage, type Size } from './pages/homePage';
import { loginPage } from './pages/loginPage';
import { myAccountPage } from './pages/myAccountPage';
import { cartPage } from './pages/cartPage';
import { checkoutPage } from './pages/checkoutPage';
import { orderPage } from './pages/orderPage';

type RegistrationPage = ReturnType<typeof registrationPage>;
type HomePage = ReturnType<typeof homePage>;
type LoginPage = ReturnType<typeof loginPage>;
type MyAccountPage = ReturnType<typeof myAccountPage>;
type CartPage = ReturnType<typeof cartPage>;
type CheckoutPage = ReturnType<typeof checkoutPage>;
type OrderPage = ReturnType<typeof orderPage>;

const generateNumericalSuffix = () =>
	generateNumericalSuffixBetween(1000, 9999);

const generateNumericalSuffixBetween = (min: number, max: number) => {
	return Math.floor(Math.random() * (max - min + 1)) + min;
};

const test = base.extend<{
	registrationPage: RegistrationPage;
	homePage: HomePage;
	loginPage: LoginPage;
	myAccountPage: MyAccountPage;
	cartPage: CartPage;
	checkoutPage: CheckoutPage;
	orderPage: OrderPage;
}>({
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
	checkoutPage: async ({ page }, use) => {
		await use(checkoutPage(page));
	},
	orderPage: async ({ page }, use) => {
		await use(orderPage(page));
	},
});

test('Registration, login, shopping, logout', async ({
	page,
	homePage,
	registrationPage,
	loginPage,
	myAccountPage,
	cartPage,
}) => {
	const someValidUsername = `someName${generateNumericalSuffix()}`;
	const someValidEmail = `someEmail${generateNumericalSuffix()}@email.com`;
	const someValidPassword = `somePassword${generateNumericalSuffix()}`;

	await test.step('Successful registration should navigate to login page', async () => {
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
	});

	await test.step('Existing User can login', async () => {
		// ACT
		await loginPage.inputEmail(someValidEmail);
		await loginPage.inputPassword(someValidPassword);
		await loginPage.logIn();

		// ASSERT
		await expect(page).toHaveURL(/\/my-account/);
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

	await test.step('Guests should be able to add items to cart', async () => {
		// ARRANGE
		const expectedItem = 'Blue T-Shirt';
		const expectedSize: Size = 'L';

		// ACT
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

	await test.step('Existing User can log out', async () => {
		// ACT
		await myAccountPage.logOut();

		// ASSERT
		await expect(page).toHaveURL(/\/login/);
	});
});
