const PAYSTACK_BASE_URL = 'https://api.paystack.co';

class PaystackError extends Error {
  constructor(message, statusCode = 502, response = null, ambiguous = false) {
    super(message);
    this.name = 'PaystackError';
    this.statusCode = statusCode;
    this.response = response;
    this.ambiguous = ambiguous;
  }
}

function getSecretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new PaystackError('Paystack is not configured. Add PAYSTACK_SECRET_KEY on the server.', 503);
  return key;
}

async function request(path, { method = 'GET', body, query } = {}) {
  const url = new URL(`${PAYSTACK_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000)
    });
  } catch (err) {
    throw new PaystackError('Could not reach Paystack. The payment status may still be pending; verify it before retrying.', 503, null, true);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    throw new PaystackError('Paystack returned an invalid response.', 502, null, true);
  }

  if (!response.ok || !payload.status) {
    throw new PaystackError(payload.message || 'Paystack request failed.', response.status || 502, payload, response.status >= 500);
  }
  return payload.data;
}

function getBanks() {
  return request('/bank', { query: { country: 'nigeria', perPage: '100', currency: 'NGN' } });
}

function resolveAccount(accountNumber, bankCode) {
  return request('/bank/resolve', {
    query: { account_number: accountNumber, bank_code: bankCode }
  });
}

function createTransferRecipient({ name, accountNumber, bankCode }) {
  return request('/transferrecipient', {
    method: 'POST',
    body: {
      type: 'nuban',
      name,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: 'NGN'
    }
  });
}

function initializeTransaction({ email, amountKobo, reference, callbackUrl, orderId }) {
  return request('/transaction/initialize', {
    method: 'POST',
    body: {
      email,
      amount: String(amountKobo),
      currency: 'NGN',
      reference,
      callback_url: callbackUrl,
      metadata: { order_id: String(orderId), custom_fields: [] }
    }
  });
}

function verifyTransaction(reference) {
  return request(`/transaction/verify/${encodeURIComponent(reference)}`);
}

function createTransfer({ amountKobo, recipientCode, reference, reason }) {
  return request('/transfer', {
    method: 'POST',
    body: {
      source: 'balance',
      amount: String(amountKobo),
      recipient: recipientCode,
      reference,
      reason
    }
  });
}

function verifyTransfer(reference) {
  return request(`/transfer/verify/${encodeURIComponent(reference)}`);
}

function refundTransaction(transactionId) {
  return request('/refund', {
    method: 'POST',
    body: { transaction: transactionId }
  });
}

module.exports = {
  PaystackError,
  createTransfer,
  createTransferRecipient,
  getBanks,
  initializeTransaction,
  refundTransaction,
  resolveAccount,
  verifyTransaction,
  verifyTransfer
};
