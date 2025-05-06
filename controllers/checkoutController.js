import dbPromise from "../database/db.js";
import jwt from "jsonwebtoken";

/**
 * GET /checkout
 * Show the Checkout Page with cart details.
 */
export const showCheckoutPage = (req, res) => {
  const cart = req.session.cart || [];

  if (cart.length === 0) {
    console.warn("⚠️ Empty cart. Redirecting to cart page.");
    return res.redirect("/cart");
  }

  // ✅ Always send user (null if not logged in)
  let user = null;

  if (req.session.token) {
    try {
      user = jwt.decode(req.session.token);
    } catch (err) {
      console.warn("⚠️ Failed to decode JWT:", err.message);
      user = null;
    }
  }

  // ✅ Pass user into the view
  res.render("checkout", {
    cart,
    user, // << YOU MUST PASS THIS
    session: req.session,
  });
};

/**
 * POST /api/checkout/guest
 * Save guest shipping info into session (used in API checkout flow).
 * This does NOT place an order — it's step 2 of 4 in the API-based checkout.
 */

export const handleGuestCheckout = (req, res) => {
  const { fullName, email, street, city, postcode, country } = req.body;

  if (!fullName || !email || !street || !city || !postcode || !country) {
    console.warn("❗ Missing guest shipping details");
    return res.status(400).json({ error: "Missing guest shipping details" });
  }

  req.session.guest = {
    fullName,
    email,
    street,
    city,
    postcode,
    country,
  };

  console.log("✅ Guest shipping info saved in session:", req.session.guest);

  return res.status(200).json({ message: "Guest info saved" });
};

/**
 * POST /api/payment
 * Simulates payment (mocked for API checkout flow).
 * Saves a flag in the session: paymentConfirmed = true
 */
export const processMockPayment = (req, res) => {
  const { cardNumber, expiryDate, cvv } = req.body;

  // Basic mock validation (no real checks)
  if (!cardNumber || !expiryDate || !cvv) {
    return res.status(400).json({ error: "Missing payment details" });
  }

  if (cardNumber.length < 13 || cvv.length !== 3) {
    return res.status(400).json({ error: "Invalid card or CVV format" });
  }

  // ✅ Save payment flag to session
  req.session.paymentConfirmed = true;

  console.log("💳 Payment mocked successfully — flag saved in session");

  return res.status(200).json({ message: "Payment processed (mock)" });
};

/**
 * POST /checkout
 * Process checkout: guest or user checkout → create order, save shipping, order items, update stock, clear cart.
 */
export const processCheckout = async (req, res) => {
  const cart = req.session.cart || [];

  if (cart.length === 0) {
    console.warn("❗ Checkout attempted with empty cart.");
    return res.status(400).send("Cart is empty.");
  }

  let {
    fullName,
    email,
    phone,
    street,
    city,
    postcode,
    country,
    checkoutAsGuest,
  } = req.body;

  if (!fullName || !email || !street || !city || !postcode || !country) {
    console.warn("❗ Missing shipping fields in checkout form.");
    return res.status(400).send("Please fill in all required shipping fields.");
  }

  // ✅ Transform data before inserting into DB
  fullName = toTitleCase(fullName);
  street = toTitleCase(street);
  city = toTitleCase(city);
  country = toTitleCase(country);
  postcode = postcode.toUpperCase();

  try {
    const db = await dbPromise;

    // ✅ Stock validation BEFORE proceeding
    for (const item of cart) {
      const { productId, size, quantity } = item;

      const stock = await db.get(
        'SELECT quantity FROM product_stock WHERE product_id = ? AND size = ?',
        [productId, size]
      );

      if (!stock || stock.quantity < quantity) {
        console.warn(
          `❗ Not enough stock for "${
            item.name
          }" (Size: ${size}). Requested: ${quantity}, Available: ${
            stock ? stock.quantity : 0
          }`
        );

        return res.status(400).render("checkout", {
          cart,
          user: req.session.token ? jwt.decode(req.session.token) : null,
          session: req.session,
          error: `Sorry! Only ${stock ? stock.quantity : 0} left for "${
            item.name
          }" (Size: ${size}). Please update your cart.`,
        });
      }
    }

    // ✅ If stock is OK → Process the order
    const totalAmount = cart.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const guestCheckout = checkoutAsGuest === "on" || !req.session.token;

    let userId = null;
    if (!guestCheckout) {
      const token = req.session.token;
      const decodedUser = jwt.decode(token);

      if (!decodedUser || !decodedUser.id) {
        console.warn("❗ No valid user found in session token.");
        return res.redirect("/login");
      }

      userId = decodedUser.id;
    }

    const orderNumber = generateOrderNumber();

    // ✅ Insert order (user_id is NULL if guest)
    const orderResult = await db.run(
      `INSERT INTO orders (user_id, order_date, total_amount, status, order_number)
       VALUES (?, datetime('now'), ?, ?, ?)`,
      [userId, totalAmount, "processing", orderNumber]
    );

    const orderId = orderResult.lastID;
    console.log(`✅ Order #${orderId} created`);

    // ✅ Check if a shipping address exists for this user+order
    const existingAddress = await db.get(
      'SELECT id FROM shipping_addresses WHERE order_id = ? AND user_id = ?',
      [orderId, user?.id || null]
    );

    if (!existingAddress) {
      await db.run(
        `INSERT INTO shipping_addresses
     (order_id, user_id, full_name, street, address_line2, city, postcode, country, phone, email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          user?.id || null,
          toTitleCase(fullName),
          toTitleCase(street),
          "", // address_line2 optional
          toTitleCase(city),
          postcode.toUpperCase(),
          toTitleCase(country),
          "", // phone optional
          email,
        ]
      );
    }

    console.log(`✅ Shipping address saved for order #${orderId}`);

    // ✅ Insert order items + update stock
    for (const item of cart) {
      const { productId, size, quantity, price } = item;

      await db.run(
        `INSERT INTO order_items (order_id, product_id, size, quantity, price)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, productId, size, quantity, price]
      );

      await db.run(
        `UPDATE product_stock
         SET quantity = quantity - ?
         WHERE product_id = ? AND size = ?`,
        [quantity, productId, size]
      );
    }

    console.log(`✅ Order items added & stock updated for order #${orderId}`);

    // ✅ Clear cart after successful order
    req.session.cart = [];

    // ✅ Pass guestCheckout flag to success page
    res.redirect(
      `/checkout/success?orderId=${orderId}&guestCheckout=${
        guestCheckout ? "1" : "0"
      }`
    );
  } catch (err) {
    console.error("❌ Error during checkout process:", err);
    res.status(500).send("Something went wrong during checkout.");
  }
};

/**
 * GET /checkout/success
 * Show the checkout success page with Order ID.
 */
export const showCheckoutSuccess = async (req, res) => {
  const orderId = req.query.orderId;
  const guestCheckout = req.query.guestCheckout === "1";

  if (!orderId) {
    console.warn("⚠️ No orderId in checkout success query.");
    return res.redirect("/");
  }

  try {
    const db = await dbPromise;

    const order = await db.get('SELECT * FROM orders WHERE id = ?', [orderId]);

    if (!order) {
      console.warn(`⚠️ No order found with ID: ${orderId}`);
      return res.redirect("/");
    }

    const shippingAddress = await db.get(
      'SELECT * FROM shipping_addresses WHERE order_id = ?',
      [orderId]
    );

    const orderItems = await db.all(
      `SELECT oi.*, p.name AS productName, p.image
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    console.log(`✅ Fetched order summary for order #${orderId}`);

    res.render("checkout-success", {
      order,
      shippingAddress,
      orderItems,
      guestCheckout,
    });
  } catch (err) {
    console.error("❌ Error fetching checkout success data:", err);
    res.status(500).send("Something went wrong loading your order summary.");
  }
};

/**
 * Helpers
 */
function generateOrderNumber() {
  const randomNum = Math.floor(100000 + Math.random() * 900000);
  return randomNum.toString();
}

function toTitleCase(str) {
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * POST /api/checkout/place-order
 * Final step: creates the order (guest only, API-only).
 * Requires session: cart, guest, paymentConfirmed
 */
export const placeOrder = async (req, res) => {
  const cart = req.session.cart || [];
  const user = req.session.user;
  const guest = req.session.guest;
  const paymentConfirmed = req.session.paymentConfirmed;

  if (cart.length === 0 || (!guest && !user) || !paymentConfirmed) {
    return res.status(400).json({
      error: "Missing cart, user/guest info, or payment confirmation",
    });
  }

  const db = await dbPromise;

  let fullName;
  let email;
  let street;
  let city;
  let postcode;
  let country;

  // 👤 Registered user
  if (user) {
    const address = await db.get(
      'SELECT * FROM shipping_addresses WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [user.id]
    );

    if (!address) {
      return res.status(400).json({
        error: "No shipping address found for user",
      });
    }

    fullName = address.full_name;
    email = address.email;
    street = address.street;
    city = address.city;
    postcode = address.postcode;
    country = address.country;
  }

  // 🧑‍🤝‍🧑 Guest user
  else if (guest) {
    fullName = guest.fullName;
    email = guest.email;
    street = guest.street;
    city = guest.city;
    postcode = guest.postcode;
    country = guest.country;
  }

  try {
    const db = await dbPromise;

    // ✅ Validate stock before continuing
    for (const item of cart) {
      const stock = await db.get(
        'SELECT quantity FROM product_stock WHERE product_id = ? AND size = ?',
        [item.productId, item.size]
      );

      if (!stock || stock.quantity < item.quantity) {
        return res.status(400).json({
          error: `Insufficient stock for "${item.name}" (Size: ${item.size})`,
        });
      }
    }

    const totalAmount = cart.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const orderNumber = generateOrderNumber();

    // ✅ Insert order (guest = no user_id)
    const orderResult = await db.run(
      `INSERT INTO orders (user_id, order_date, total_amount, status, order_number)
       VALUES (?, datetime('now'), ?, ?, ?)`,
      [user?.id || null, totalAmount, "processing", orderNumber]
    );

    const orderId = orderResult.lastID;

    // ✅ Insert shipping address
    await db.run(
      `INSERT INTO shipping_addresses
       (order_id, full_name, street, address_line2, city, postcode, country, phone, email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        toTitleCase(fullName),
        toTitleCase(street),
        "", // address_line2 optional
        toTitleCase(city),
        postcode.toUpperCase(),
        toTitleCase(country),
        "", // phone optional
        email,
      ]
    );

    // ✅ Insert order items + update stock
    for (const item of cart) {
      await db.run(
        `INSERT INTO order_items (order_id, product_id, size, quantity, price)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, item.productId, item.size, item.quantity, item.price]
      );

      await db.run(
        `UPDATE product_stock
         SET quantity = quantity - ?
         WHERE product_id = ? AND size = ?`,
        [item.quantity, item.productId, item.size]
      );
    }

    // ✅ Clear session after successful order
    req.session.cart = [];

    if (!req.session.user) {
      req.session.guest = null;
    }

    req.session.paymentConfirmed = false;

    console.log(`✅ Order #${orderId} placed via API`);

    return res.status(201).json({
      message: "Order placed successfully",
      orderId,
      orderNumber,
      totalPaid: totalAmount.toFixed(2),
    });
  } catch (err) {
    console.error("❌ Error placing order via API:", err);
    res.status(500).json({ error: "Failed to place order" });
  }
};
