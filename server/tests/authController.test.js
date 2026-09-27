const test = require('node:test');
const assert = require('node:assert/strict');
const authController = require('../controllers/authController');
test('missing student number is rejected', () => {
  const result = authController.validateRegistrationInput({
    fullName: 'Test User',
    email: 'student@gmail.com',
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
    email: 'student@gmail.com',
    password: 'secret123',
    studentNumber: 'UJ/2023/CS/0012',
    phone: '08012345678'
  });

  assert.equal(result.valid, true);
  assert.equal(result.message, '');
});
