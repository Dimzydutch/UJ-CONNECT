const crypto = require('crypto');
const pool = require('../config/db');
const paystack = require('../utils/paystack');

const MEETING_SPOTS = new Set([
  'Permanent Site Library',
  'Social Center, Naraguta',
  'SUG Building, Naraguta',
  'NASSA Rock, Main Camp'
]);

function amountToKobo(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [naira, kobo = ''] = text.split('.');
  const amount = Number(naira) * 100 + Number(kobo.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function calculateOrderAmounts(itemSubtotalKobo, deliveryFeeKobo, commissionBps) {
  const platformFeeKobo = Math.floor(itemSubtotalKobo * commissionBps / 10000);
  const totalAmountKobo = itemSubtotalKobo + deliveryFeeKobo;
  return {
    platformFeeKobo,
    totalAmountKobo,
    sellerAmountKobo: totalAmountKobo - platformFeeKobo
  };
}

function koboToNaira(kobo) {
  return (kobo / 100).toFixed(2);
}

function getCommissionBps() {
  const value = Number.parseInt(process.env.PLATFORM_COMMISSION_BPS || '0', 10);
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new Error('PLATFORM_COMMISSION_BPS must be an integer between 0 and 10000.');
  }
  return value;
}

function newReference(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

function isValidPaystackSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !/^[a-f\d]{128}$/i.test(signature) || !secret) {
    return false;
  }
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest();
  const supplied = Buffer.from(signature, 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function sendError(res, err) {
  if (err instanceof paystack.PaystackError) {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }
  console.error('Payment error:', err);
  return res.status(500).json({ success: false, message: 'Payment service error.' });
}

async function getSellerRecipient(userId) {
  const [rows] = await pool.query(
    `SELECT paystack_recipient_code, payout_bank_name, payout_account_name, payout_account_last4
     FROM users WHERE id = ? AND is_seller = TRUE`,
    [userId]
  );
  return rows[0] || null;
}

async function resolveNigerianBankAccount(accountNumber, bankCode) {
  const cleanAccountNumber = String(accountNumber || '').trim();
  const cleanBankCode = String(bankCode || '').trim();
  if (!/^\d{10}$/.test(cleanAccountNumber) || !/^\d{2,10}$/.test(cleanBankCode)) {
    const err = new Error('Enter a valid 10-digit Nigerian account number and choose a bank.');
    err.statusCode = 400;
    throw err;
  }
  const banks = await paystack.getBanks();
  const bank = banks.find(item => String(item.code) === cleanBankCode);
  if (!bank) {
    const err = new Error('Choose a bank from the list.');
    err.statusCode = 400;
    throw err;
  }
  const resolved = await paystack.resolveAccount(cleanAccountNumber, cleanBankCode);
  if (!resolved || !resolved.account_name) {
    const err = new Error('Paystack could not verify this bank account.');
    err.statusCode = 400;
    throw err;
  }
  return { cleanAccountNumber, cleanBankCode, bank, resolved };
}

async function verifyPaymentForOrder(order, transaction) {
  if (!transaction || transaction.status !== 'success') {
    throw new Error('Paystack has not confirmed this payment.');
  }
  if (Number(transaction.amount) !== amountToKobo(order.total_amount) || transaction.currency !== 'NGN') {
    throw new Error('The confirmed payment amount or currency does not match this order.');
  }
  if (!transaction.metadata || String(transaction.metadata.order_id) !== String(order.id)) {
    throw new Error('The payment metadata does not match this order.');
  }
  const [[buyer]] = await pool.query('SELECT email FROM users WHERE id = ?', [order.buyer_id]);
  if (!buyer || !transaction.customer || String(transaction.customer.email || '').toLowerCase() !== buyer.email.toLowerCase()) {
    throw new Error('The payment customer does not match the buyer.');
  }
}

async function markOrderPaid(orderId, reference, transaction) {
  const connection = await pool.getConnection();
  let shouldRefund = false;
  let transactionId = transaction.id;
  const processingFeeKobo = Number.isSafeInteger(Number(transaction.fees)) && Number(transaction.fees) > 0
    ? Number(transaction.fees)
    : 0;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT * FROM seller_orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    const order = rows[0];
    if (!order || order.payment_reference !== reference) {
      await connection.rollback();
      return { status: 'not_found' };
    }
    if (['paid', 'payout_pending', 'payout_failed', 'completed'].includes(order.status)) {
      await connection.commit();
      return { status: order.status };
    }
    if (order.status === 'refund_required') {
      await connection.commit();
      return { status: 'refund_required' };
    }

    const expired = !order.expires_at || new Date(order.expires_at).getTime() <= Date.now();
    if (order.status !== 'awaiting_payment' || expired) {
      await connection.query('UPDATE seller_orders SET status = ? WHERE id = ?', ['refund_required', orderId]);
      shouldRefund = true;
    } else if (processingFeeKobo >= amountToKobo(order.seller_amount)) {
      await connection.query('UPDATE seller_orders SET status = ? WHERE id = ?', ['refund_required', orderId]);
      shouldRefund = true;
    } else if (order.delivery_method !== 'service') {
      const [result] = await connection.query(
        `UPDATE listings
         SET status = CASE WHEN quantity - ? = 0 THEN 'sold' ELSE status END,
             quantity = quantity - ?
         WHERE id = ? AND status = 'approved' AND quantity >= ?`,
        [order.quantity, order.quantity, order.listing_id, order.quantity]
      );
      if (result.affectedRows === 0) {
        await connection.query('UPDATE seller_orders SET status = ? WHERE id = ?', ['refund_required', orderId]);
        shouldRefund = true;
      } else {
        await connection.query(
          'UPDATE seller_orders SET status = ?, paid_at = NOW(), paystack_fee = ?, seller_amount = GREATEST(seller_amount - ?, 0) WHERE id = ?',
          ['paid', koboToNaira(processingFeeKobo), koboToNaira(processingFeeKobo), orderId]
        );
      }
    } else {
      await connection.query(
        'UPDATE seller_orders SET status = ?, paid_at = NOW(), paystack_fee = ?, seller_amount = GREATEST(seller_amount - ?, 0) WHERE id = ?',
        ['paid', koboToNaira(processingFeeKobo), koboToNaira(processingFeeKobo), orderId]
      );
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  if (shouldRefund) {
    try {
      await paystack.refundTransaction(transactionId);
    } catch (err) {
      console.error(`Could not automatically refund order ${orderId}:`, err.message);
    }
    return { status: 'refund_required' };
  }
  return { status: 'paid' };
}

async function verifyAndRecordPayment(order, reference) {
  const transaction = await paystack.verifyTransaction(reference);
  if (!transaction || transaction.status !== 'success') return { status: 'pending' };
  await verifyPaymentForOrder(order, transaction);
  return markOrderPaid(order.id, reference, transaction);
}

async function submitTransfer(orderId, transferReference, recipientCode, amountKobo) {
  try {
    const transfer = await paystack.createTransfer({
      amountKobo,
      recipientCode,
      reference: transferReference,
      reason: `UJ Connect order ${orderId} seller payout`
    });

    if (transfer.status === 'success') {
      await pool.query(
        'UPDATE seller_orders SET status = ? WHERE id = ? AND transfer_reference = ? AND status = ?',
        ['completed', orderId, transferReference, 'payout_pending']
      );
      return { status: 'completed' };
    }
    if (transfer.status === 'otp' || transfer.status === 'failed' || transfer.status === 'reversed') {
      await pool.query(
        'UPDATE seller_orders SET status = ? WHERE id = ? AND transfer_reference = ? AND status = ?',
        ['payout_failed', orderId, transferReference, 'payout_pending']
      );
      return { status: 'payout_failed', message: 'Paystack could not complete this transfer. Check the payout account or Paystack transfer settings.' };
    }
    return { status: 'payout_pending' };
  } catch (err) {
    if (err instanceof paystack.PaystackError && err.statusCode >= 400 && err.statusCode < 500) {
      await pool.query(
        'UPDATE seller_orders SET status = ? WHERE id = ? AND transfer_reference = ? AND status = ?',
        ['payout_failed', orderId, transferReference, 'payout_pending']
      );
      return { status: 'payout_failed', message: err.message };
    }
    // Keep ambiguous network/provider errors pending to avoid duplicate transfers.
    console.error(`Payout ${transferReference} needs reconciliation:`, err.message);
    return { status: 'payout_pending' };
  }
}

exports.getBanks = async (req, res) => {
  try {
    const banks = await paystack.getBanks();
    res.json({ success: true, banks: banks.map(({ name, code }) => ({ name, code })) });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getBankAccount = async (req, res) => {
  try {
    const account = await getSellerRecipient(req.user.id);
    if (!account) return res.status(403).json({ success: false, message: 'Set up a seller profile before linking a payout account.' });
    res.json({
      success: true,
      account: account.paystack_recipient_code ? {
        linked: true,
        bankName: account.payout_bank_name,
        accountName: account.payout_account_name,
        last4: account.payout_account_last4
      } : { linked: false }
    });
  } catch (err) {
    sendError(res, err);
  }
};

exports.linkBankAccount = async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT is_seller FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ success: false, message: 'User account not found.' });
    if (!user.is_seller) return res.status(403).json({ success: false, message: 'Set up a seller profile before linking a payout account.' });

    const { accountNumber, bankCode, confirmedAccountName } = req.body;
    const { cleanAccountNumber, cleanBankCode, bank, resolved } = await resolveNigerianBankAccount(accountNumber, bankCode);
    if (String(confirmedAccountName || '').trim().toLowerCase() !== resolved.account_name.trim().toLowerCase()) {
      return res.status(400).json({ success: false, message: 'Confirm the verified account name before linking this account.' });
    }
    const recipient = await paystack.createTransferRecipient({
      name: resolved.account_name,
      accountNumber: cleanAccountNumber,
      bankCode: cleanBankCode
    });

    const [result] = await pool.query(
      `UPDATE users SET paystack_recipient_code = ?, payout_bank_name = ?,
        payout_account_name = ?, payout_account_last4 = ?
       WHERE id = ?`,
      [recipient.recipient_code, bank.name, resolved.account_name, cleanAccountNumber.slice(-4), req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'User account not found.' });

    res.json({
      success: true,
      account: { linked: true, bankName: bank.name, accountName: resolved.account_name, last4: cleanAccountNumber.slice(-4) }
    });
  } catch (err) {
    sendError(res, err);
  }
};

exports.completeSellerOnboarding = async (req, res) => {
  try {
    const { sellerBio, phone, accountNumber, bankCode, confirmedAccountName } = req.body;
    if (typeof sellerBio !== 'string' || !sellerBio.trim()) {
      return res.status(400).json({ success: false, message: 'Please describe what you sell.' });
    }
    if (typeof phone !== 'string' || phone.trim().length < 7) {
      return res.status(400).json({ success: false, message: 'Please enter a valid phone number.' });
    }

    const { cleanAccountNumber, cleanBankCode, bank, resolved } = await resolveNigerianBankAccount(accountNumber, bankCode);
    if (String(confirmedAccountName || '').trim().toLowerCase() !== resolved.account_name.trim().toLowerCase()) {
      return res.status(400).json({ success: false, message: 'Confirm the verified account name before completing seller setup.' });
    }
    const recipient = await paystack.createTransferRecipient({
      name: resolved.account_name,
      accountNumber: cleanAccountNumber,
      bankCode: cleanBankCode
    });

    const [result] = await pool.query(
      `UPDATE users SET is_seller = TRUE, seller_bio = ?, phone = ?, paystack_recipient_code = ?,
       payout_bank_name = ?, payout_account_name = ?, payout_account_last4 = ? WHERE id = ?`,
      [sellerBio.trim(), phone.trim(), recipient.recipient_code, bank.name, resolved.account_name, cleanAccountNumber.slice(-4), req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'User account not found.' });

    res.json({ success: true, message: 'Seller profile and payout account saved.' });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    sendError(res, err);
  }
};

exports.resolveBankAccount = async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT id FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ success: false, message: 'User account not found.' });
    const { bank, resolved } = await resolveNigerianBankAccount(req.body.accountNumber, req.body.bankCode);
    res.json({ success: true, bankName: bank.name, accountName: resolved.account_name });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    sendError(res, err);
  }
};

exports.createOrder = async (req, res) => {
  const { listingId, quantity = 1, deliveryMethod, meetingSpot, deliveryAddress, buyerNote = '' } = req.body;
  const parsedListingId = Number.parseInt(listingId, 10);
  const parsedQuantity = Number.parseInt(quantity, 10);
  if (!Number.isSafeInteger(parsedListingId) || parsedListingId < 1 || !Number.isSafeInteger(parsedQuantity) || parsedQuantity < 1) {
    return res.status(400).json({ success: false, message: 'Choose a valid listing and quantity.' });
  }
  if (typeof buyerNote !== 'string' || buyerNote.length > 2000) {
    return res.status(400).json({ success: false, message: 'Order notes must be 2,000 characters or fewer.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [listings] = await connection.query(
      `SELECT l.id, l.user_id, l.title, l.price, l.quantity, l.listing_type, l.status, u.status AS seller_status
       FROM listings l JOIN users u ON u.id = l.user_id
       WHERE l.id = ? FOR UPDATE`,
      [parsedListingId]
    );
    const listing = listings[0];
    if (!listing || listing.status !== 'approved' || listing.seller_status !== 'active') {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'This listing is not currently available.' });
    }
    if (Number(listing.user_id) === Number(req.user.id)) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'You cannot place an order on your own listing.' });
    }

    let method = 'service';
    let cleanMeetingSpot = null;
    let cleanDeliveryAddress = null;
    let orderQuantity = 1;
    if (listing.listing_type === 'good') {
      orderQuantity = parsedQuantity;
      if (!['pickup', 'delivery'].includes(deliveryMethod)) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'Choose pickup or delivery.' });
      }
      method = deliveryMethod;
      if (method === 'pickup') {
        if (!MEETING_SPOTS.has(meetingSpot)) {
          await connection.rollback();
          return res.status(400).json({ success: false, message: 'Choose one of the listed campus meeting spots.' });
        }
        cleanMeetingSpot = meetingSpot;
      } else {
        cleanDeliveryAddress = String(deliveryAddress || '').trim();
        if (cleanDeliveryAddress.length < 5 || cleanDeliveryAddress.length > 500) {
          await connection.rollback();
          return res.status(400).json({ success: false, message: 'Enter delivery directions between 5 and 500 characters.' });
        }
      }

      const [[reserved]] = await connection.query(
        `SELECT COALESCE(SUM(quantity), 0) AS quantity FROM seller_orders
         WHERE listing_id = ? AND status IN ('requested', 'awaiting_payment') AND expires_at > NOW()`,
        [parsedListingId]
      );
      if (Number(listing.quantity) - Number(reserved.quantity) < orderQuantity) {
        await connection.rollback();
        return res.status(409).json({ success: false, message: 'There is not enough unreserved stock for that quantity.' });
      }
      const [[existingBuyerOrder]] = await connection.query(
        `SELECT COUNT(*) AS count FROM seller_orders
         WHERE buyer_id = ? AND listing_id = ? AND status IN ('requested', 'awaiting_payment') AND expires_at > NOW()`,
        [req.user.id, parsedListingId]
      );
      if (Number(existingBuyerOrder.count) > 0) {
        await connection.rollback();
        return res.status(409).json({ success: false, message: 'You already have an active order request for this listing.' });
      }
    }

    const unitPriceKobo = amountToKobo(listing.price);
    if (unitPriceKobo === null || unitPriceKobo <= 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'This listing has an invalid price.' });
    }
    const itemSubtotalKobo = unitPriceKobo * orderQuantity;
    if (!Number.isSafeInteger(itemSubtotalKobo) || itemSubtotalKobo > 9999999999) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Order amount is too large.' });
    }

    const [result] = await connection.query(
      `INSERT INTO seller_orders
       (buyer_id, seller_id, listing_id, listing_title, quantity, unit_price, item_subtotal,
        delivery_method, meeting_spot, delivery_address, buyer_note, total_amount, seller_amount, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.00, DATE_ADD(NOW(), INTERVAL 2 HOUR))`,
      [
        req.user.id,
        listing.user_id,
        listing.id,
        listing.title,
        orderQuantity,
        koboToNaira(unitPriceKobo),
        koboToNaira(itemSubtotalKobo),
        method,
        cleanMeetingSpot,
        cleanDeliveryAddress,
        buyerNote.trim(),
        koboToNaira(itemSubtotalKobo)
      ]
    );
    await connection.commit();
    res.status(201).json({ success: true, orderId: result.insertId, message: 'Order request sent. The seller must confirm it before payment.' });
  } catch (err) {
    await connection.rollback();
    sendError(res, err);
  } finally {
    connection.release();
  }
};

exports.getOrders = async (req, res) => {
  try {
    await pool.query(
      `UPDATE seller_orders SET status = 'cancelled'
       WHERE (buyer_id = ? OR seller_id = ?) AND status IN ('requested', 'awaiting_payment') AND expires_at <= NOW()`,
      [req.user.id, req.user.id]
    );
    const [orders] = await pool.query(
      `SELECT o.*, b.full_name AS buyer_name, s.full_name AS seller_name,
              CASE WHEN o.buyer_id = ? THEN 'buyer' ELSE 'seller' END AS viewer_role
       FROM seller_orders o
       JOIN users b ON b.id = o.buyer_id
       JOIN users s ON s.id = o.seller_id
       WHERE o.buyer_id = ? OR o.seller_id = ?
       ORDER BY o.created_at DESC`,
      [req.user.id, req.user.id, req.user.id]
    );
    res.json({ success: true, orders });
  } catch (err) {
    sendError(res, err);
  }
};

exports.quoteOrder = async (req, res) => {
  const orderId = Number.parseInt(req.params.id, 10);
  const { action, deliveryFee = '0' } = req.body;
  if (!Number.isSafeInteger(orderId) || orderId < 1 || !['accept', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid order action.' });
  }
  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query('SELECT * FROM seller_orders WHERE id = ? FOR UPDATE', [orderId]);
      const order = rows[0];
      if (!order || Number(order.seller_id) !== Number(req.user.id)) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: 'Order not found.' });
      }
      if (order.status !== 'requested') {
        await connection.rollback();
        return res.status(409).json({ success: false, message: 'This order request is no longer awaiting a response.' });
      }
      if (!order.expires_at || new Date(order.expires_at).getTime() <= Date.now()) {
        await connection.query('UPDATE seller_orders SET status = ? WHERE id = ?', ['cancelled', orderId]);
        await connection.commit();
        return res.status(409).json({ success: false, message: 'This order request has expired. Ask the buyer to send a new request.' });
      }
      if (action === 'reject') {
        await connection.query('UPDATE seller_orders SET status = ? WHERE id = ?', ['rejected', orderId]);
        await connection.commit();
        return res.json({ success: true, message: 'Order request declined.' });
      }

      const [sellerRows] = await connection.query(
        'SELECT paystack_recipient_code FROM users WHERE id = ? AND is_seller = TRUE',
        [req.user.id]
      );
      if (!sellerRows[0] || !sellerRows[0].paystack_recipient_code) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'Link a verified Nigerian bank account before accepting paid orders.' });
      }

      const deliveryFeeKobo = amountToKobo(deliveryFee);
      if (deliveryFeeKobo === null || deliveryFeeKobo > 1000000000) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'Enter a valid delivery fee.' });
      }
      if (order.delivery_method !== 'delivery' && deliveryFeeKobo !== 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'A delivery fee is only allowed for delivery orders.' });
      }

      const itemSubtotalKobo = amountToKobo(order.item_subtotal);
      const { platformFeeKobo, totalAmountKobo, sellerAmountKobo } = calculateOrderAmounts(
        itemSubtotalKobo,
        deliveryFeeKobo,
        getCommissionBps()
      );
      await connection.query(
        `UPDATE seller_orders SET status = 'awaiting_payment', delivery_fee = ?, platform_fee = ?,
         total_amount = ?, seller_amount = ?, seller_quoted_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 24 HOUR)
         WHERE id = ?`,
        [koboToNaira(deliveryFeeKobo), koboToNaira(platformFeeKobo), koboToNaira(totalAmountKobo), koboToNaira(sellerAmountKobo), orderId]
      );
      await connection.commit();
      res.json({ success: true, message: 'Order accepted and ready for buyer payment.' });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    sendError(res, err);
  }
};

exports.startCheckout = async (req, res) => {
  const orderId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(orderId) || orderId < 1) return res.status(400).json({ success: false, message: 'Invalid order.' });
  let order;
  let reference;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT o.*, u.email AS buyer_email, s.paystack_recipient_code
       FROM seller_orders o
       JOIN users u ON u.id = o.buyer_id
       JOIN users s ON s.id = o.seller_id
       WHERE o.id = ? FOR UPDATE`,
      [orderId]
    );
    order = rows[0];
    if (!order || Number(order.buyer_id) !== Number(req.user.id)) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (order.status !== 'awaiting_payment' || !order.expires_at || new Date(order.expires_at).getTime() <= Date.now()) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'This order is no longer available for payment.' });
    }
    if (!order.paystack_recipient_code) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'The seller payout account is not available. Contact the seller.' });
    }
    if (order.checkout_url && order.payment_reference) {
      await connection.commit();
      return res.json({ success: true, authorizationUrl: order.checkout_url });
    }
    if (order.payment_reference) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'Checkout initialization is being reconciled. Check your orders before trying again.' });
    }

    reference = newReference(`UJ-${orderId}`);
    await connection.query(
      `UPDATE seller_orders SET payment_reference = ?, checkout_url = NULL, expires_at = DATE_ADD(NOW(), INTERVAL 24 HOUR)
       WHERE id = ? AND status = 'awaiting_payment'`,
      [reference, orderId]
    );
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    sendError(res, err);
    return;
  } finally {
    connection.release();
  }

  try {
    const callbackUrl = `${(process.env.APP_BASE_URL || 'http://localhost:5000').replace(/\/$/, '')}/payment-return.html?orderId=${orderId}`;
    const checkout = await paystack.initializeTransaction({
      email: order.buyer_email,
      amountKobo: amountToKobo(order.total_amount),
      reference,
      callbackUrl,
      orderId
    });
    await pool.query('UPDATE seller_orders SET checkout_url = ? WHERE id = ? AND payment_reference = ?', [checkout.authorization_url, orderId, reference]);
    res.json({ success: true, authorizationUrl: checkout.authorization_url });
  } catch (err) {
    if (err instanceof paystack.PaystackError && !err.ambiguous) {
      await pool.query('UPDATE seller_orders SET payment_reference = NULL WHERE id = ? AND payment_reference = ?', [orderId, reference]);
    }
    sendError(res, err);
  }
};

exports.verifyOrderPayment = async (req, res) => {
  const orderId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(orderId) || orderId < 1) return res.status(400).json({ success: false, message: 'Invalid order.' });
  try {
    const [rows] = await pool.query('SELECT * FROM seller_orders WHERE id = ? AND buyer_id = ?', [orderId, req.user.id]);
    const order = rows[0];
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    if (!order.payment_reference) return res.status(409).json({ success: false, message: 'No Paystack payment has been started for this order.' });
    if (['paid', 'payout_pending', 'payout_failed', 'completed'].includes(order.status)) {
      return res.json({ success: true, status: order.status });
    }
    const result = await verifyAndRecordPayment(order, order.payment_reference);
    res.json({
      success: !['refund_required', 'pending'].includes(result.status),
      status: result.status,
      message: result.status === 'pending' ? 'Paystack is still processing this payment.' : undefined
    });
  } catch (err) {
    sendError(res, err);
  }
};

exports.confirmReceived = async (req, res) => {
  const orderId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(orderId) || orderId < 1) return res.status(400).json({ success: false, message: 'Invalid order.' });
  const connection = await pool.getConnection();
  let transferReference;
  let recipientCode;
  let amountKobo;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT o.*, u.paystack_recipient_code FROM seller_orders o
       JOIN users u ON u.id = o.seller_id WHERE o.id = ? FOR UPDATE`,
      [orderId]
    );
    const order = rows[0];
    if (!order || Number(order.buyer_id) !== Number(req.user.id)) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (order.status !== 'paid') {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'Only a paid order can be confirmed as received.' });
    }
    if (!order.paystack_recipient_code) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'The seller has no verified payout account. Contact support.' });
    }

    transferReference = newReference(`UJ-PAYOUT-${orderId}`);
    recipientCode = order.paystack_recipient_code;
    amountKobo = amountToKobo(order.seller_amount);
    if (!amountKobo || amountKobo < 1) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'The seller payout amount is zero after fees. Contact support before completing this order.' });
    }
    await connection.query(
      `UPDATE seller_orders SET status = 'payout_pending', buyer_confirmed_at = NOW(), transfer_reference = ?
       WHERE id = ? AND status = 'paid'`,
      [transferReference, orderId]
    );
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    return sendError(res, err);
  } finally {
    connection.release();
  }

  const payout = await submitTransfer(orderId, transferReference, recipientCode, amountKobo);
  res.json({
    success: true,
    status: payout.status,
    message: payout.message || (payout.status === 'completed'
      ? 'Receipt confirmed and seller payout completed.'
      : 'Receipt confirmed. Seller payout is being processed.')
  });
};

exports.retryPayout = async (req, res) => {
  const orderId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(orderId) || orderId < 1) return res.status(400).json({ success: false, message: 'Invalid order.' });
  try {
    const [rows] = await pool.query(
      `SELECT o.*, u.paystack_recipient_code FROM seller_orders o
       JOIN users u ON u.id = o.seller_id
       WHERE o.id = ? AND o.seller_id = ?`,
      [orderId, req.user.id]
    );
    const order = rows[0];
    if (!order || order.status !== 'payout_failed' || !order.buyer_confirmed_at || !order.paystack_recipient_code) {
      return res.status(409).json({ success: false, message: 'This payout is not eligible for retry.' });
    }
    const transferReference = newReference(`UJ-PAYOUT-${orderId}`);
    const [updated] = await pool.query(
      `UPDATE seller_orders SET status = 'payout_pending', transfer_reference = ?
       WHERE id = ? AND seller_id = ? AND status = 'payout_failed'`,
      [transferReference, orderId, req.user.id]
    );
    if (updated.affectedRows === 0) return res.status(409).json({ success: false, message: 'This payout is already being processed.' });
    const payout = await submitTransfer(orderId, transferReference, order.paystack_recipient_code, amountToKobo(order.seller_amount));
    res.json({ success: true, status: payout.status, message: payout.message || 'Payout retry submitted.' });
  } catch (err) {
    sendError(res, err);
  }
};

exports.webhook = async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = req.get('x-paystack-signature');
  if (!secret || !signature || !req.rawBody) {
    return res.status(400).json({ success: false, message: 'Invalid webhook request.' });
  }
  if (!isValidPaystackSignature(req.rawBody, signature, secret)) {
    return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });
  }

  const event = req.body;
  try {
    if (event.event === 'charge.success' && event.data && event.data.reference) {
      const [rows] = await pool.query('SELECT * FROM seller_orders WHERE payment_reference = ?', [event.data.reference]);
      if (rows[0]) await verifyAndRecordPayment(rows[0], event.data.reference);
    } else if (['transfer.success', 'transfer.failed', 'transfer.reversed'].includes(event.event) && event.data && event.data.reference) {
      const status = event.event === 'transfer.success' ? 'completed' : 'payout_failed';
      const eligibleStatuses = event.event === 'transfer.reversed' ? ['payout_pending', 'completed'] : ['payout_pending'];
      await pool.query(
        `UPDATE seller_orders SET status = ? WHERE transfer_reference = ? AND status IN (${eligibleStatuses.map(() => '?').join(', ')})`,
        [status, event.data.reference, ...eligibleStatuses]
      );
    } else if (event.event === 'refund.processed' && event.data) {
      const reference = event.data.transaction && (event.data.transaction.reference || event.data.transaction);
      if (reference) {
        await pool.query(
          'UPDATE seller_orders SET status = ? WHERE payment_reference = ? AND status = ?',
          ['cancelled', reference, 'refund_required']
        );
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('Paystack webhook processing error:', err.message);
    res.sendStatus(500);
  }
};

exports.testHelpers = { amountToKobo, calculateOrderAmounts, isValidPaystackSignature };
