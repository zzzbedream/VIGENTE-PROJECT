// Generate test signature for CLI invocation
const { Keypair, Address } = require('@stellar/stellar-sdk');
const { createHmac } = require('crypto');

const adminSecret = 'SB7G3OJIVJR2MUJT6WCGPMFJPASEF5KDBG2CMOUCLDNRLPNLSK5JCDDT';
const userAddress = 'GCCQBYTIDSGV4QH624WGSHTFUEOGE53N3NCGL6U4HX4SACYY2YA2POQM';
const tier = 1;
const score = 1000;
const rut = '32131211'; // Clean RUT

// Calculate dataHash
const dataHash = createHmac('sha256', adminSecret).update(rut).digest();

// Build payload
const address = Address.fromString(userAddress);
const scAddress = address.toScAddress();
const userXdr = scAddress.toXDR('raw');

const tierBuf = Buffer.alloc(4);
tierBuf.writeUInt32BE(tier);

const scoreBuf = Buffer.alloc(4);
scoreBuf.writeUInt32BE(score);

const payload = Buffer.concat([userXdr, tierBuf, scoreBuf, dataHash]);

// Sign
const kp = Keypair.fromSecret(adminSecret);
const signature = kp.sign(payload);

console.log('User:', userAddress);
console.log('Tier:', tier);
console.log('Score:', score);
console.log('DataHash (hex):', dataHash.toString('hex'));
console.log('Signature (hex):', signature.toString('hex'));
