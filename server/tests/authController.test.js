const test = require('node:test');
const assert = require('node:assert/strict');
const authController = require('../controllers/authController');
test('missing student number is rejected', () => {
  const result = authController.validateRegistrationInput({
    fullName: 'Test User',
    email: 'student@unijos.edu.ng',
    password: 'secret123',
    studentNumber: '',
    phone: '08012345678'
  });

  assert.equal(result.valid, false);
  assert.match(result.message, /student mat/i);
});

test('valid student number is accepted', () => {
  const result = authController.validateRegistrationInput({
    fullName: 'Test User',
    email: 'student@unijos.edu.ng',
    password: 'secret123',
    studentNumber: 'UJ/2023/CS/0012',
    phone: '08012345678'
  });

  assert.equal(result.valid, true);
  assert.equal(result.message, '');
});

test('non-institutional email is rejected', () => {
  const result = authController.validateRegistrationInput({
    fullName: 'Test User',
    email: 'student@gmail.com',
    password: 'secret123',
    studentNumber: 'UJ/2023/CS/0012',
    phone: '08012345678'
  });

  assert.equal(result.valid, false);
  assert.match(result.message, /unijos\.edu\.ng/i);
});

test('2FA login codes are normalized before validation', () => {
  assert.equal(authController.normalizeTwoFactorCode(' 123 456 '), '123456');
  assert.equal(authController.normalizeTwoFactorCode('123456'), '123456');
  assert.equal(authController.normalizeTwoFactorCode(null), '');
  assert.equal(authController.isValidTwoFactorCode(' 123456 '), true);
  assert.equal(authController.isValidTwoFactorCode('12345'), false);
});
