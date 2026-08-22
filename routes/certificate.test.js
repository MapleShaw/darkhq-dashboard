'use strict';

const assert = require('assert');
const { certificateInfo } = require('./certificate')._test;

const info = certificateInfo({
  subject: { CN: 'darkhq.indiehacker.fun' },
  issuer: { O: 'Example CA' },
  valid_to: 'Aug 22 12:00:00 2027 GMT',
}, 'darkhq.indiehacker.fun');

assert.deepStrictEqual(info, {
  host: 'darkhq.indiehacker.fun',
  subject: 'darkhq.indiehacker.fun',
  issuer: 'Example CA',
  expiresAt: '2027-08-22T12:00:00.000Z',
  checkedAt: info.checkedAt,
});
assert.throws(() => certificateInfo({ valid_to: 'not-a-date' }, 'example.test'), /valid expiration date/);

console.log('routes/certificate tests passed');
