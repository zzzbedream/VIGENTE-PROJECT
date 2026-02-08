const { Address } = require('@stellar/stellar-sdk');

// Admin address from ADMIN_SECRET
const adminAddr = 'GAJT5NOKLJYDMO6WSUQAKYAWSH56YLPXLZTYPFP3PIJAKZ4PH7S235TU';

const address = Address.fromString(adminAddr);
const scAddress = address.toScAddress();
const xdr = scAddress.toXDR('raw');

console.log('Admin Address:', adminAddr);
console.log('XDR Hex:', xdr.toString('hex'));
console.log('XDR Length:', xdr.length);
console.log('Bytes 0-7:', xdr.slice(0, 8).toString('hex'));
console.log('Bytes 8-39 (pubkey):', xdr.slice(8).toString('hex'));
console.log('Pubkey length:', xdr.slice(8).length);
