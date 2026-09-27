const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { testHelpers } = require('../controllers/paymentController');

test('amountToKobo converts decimal naira amounts without floating point rounding', () => {
  assert.equal(testHelpers.amountToKobo('125.30'), 12530);
  assert.equal(testHelpers.amountToKobo('0.01'), 1);
  assert.equal(testHelpers.amountToKobo('900'), 90000);
});

test('amountToKobo rejects malformed and over-precision amounts', () => {
  assert.equal(testHelpers.amountToKobo('1.001'), null);
  assert.equal(testHelpers.amountToKobo('-2'), null);
  assert.equal(testHelpers.amountToKobo('not money'), null);
});

test('order calculation includes delivery and deducts only configured commission', () => {
  assert.deepEqual(testHelpers.calculateOrderAmounts(100000, 5000, 0), {
    platformFeeKobo: 0,
    totalAmountKobo: 105000,
    sellerAmountKobo: 105000
  });
  assert.deepEqual(testHelpers.calculateOrderAmounts(100000, 5000, 250), {
    platformFeeKobo: 2500,
    totalAmountKobo: 105000,
    sellerAmountKobo: 102500
  });
});

test('Paystack webhook signature uses HMAC-SHA512 and rejects tampering', () => {
  const secret = 'test-paystack-secret';
  const body = Buffer.from('{"event":"charge.success"}');
  const signature = crypto.createHmac('sha512', secret).update(body).digest('hex');
  assert.equal(testHelpers.isValidPaystackSignature(body, signature, secret), true);
  assert.equal(testHelpers.isValidPaystackSignature(Buffer.from('{"event":"charge.failed"}'), signature, secret), false);
  assert.equal(testHelpers.isValidPaystackSignature(body, 'bad-signature', secret), false);
});