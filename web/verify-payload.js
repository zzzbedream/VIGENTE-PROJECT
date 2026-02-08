// Simular la construcción del payload como lo hace el contrato Rust
const { Address } = require('@stellar/stellar-sdk');

const userAddress = 'GCCQBYTIDSGV4QH624WGSHTFUEOGE53N3NCGL6U4HX4SACYY2YA2POQM';
const tier = 1;
const score = 1000;
const dataHashHex = '5ebd11e9459bc7dbeb8a3b15fdd7b9b0aa60002a31ad2b0fc66897cd0f64cbd4';

// 1. User address XDR
const address = Address.fromString(userAddress);
const scAddress = address.toScAddress();
const userXdr = scAddress.toXDR('raw');

// 2. Tier as 4-byte BE
const tierBuf = Buffer.alloc(4);
tierBuf.writeUInt32BE(tier);

// 3. Score as 4-byte BE  
const scoreBuf = Buffer.alloc(4);
scoreBuf.writeUInt32BE(score);

// 4. Data hash (raw bytes)
const dataHash = Buffer.from(dataHashHex, 'hex');

// Concatenate
const payload = Buffer.concat([userXdr, tierBuf, scoreBuf, dataHash]);

console.log('=== EXPECTED PAYLOAD ===');
console.log('userXdr:', userXdr.toString('hex'));
console.log('tierBuf:', tierBuf.toString('hex'));
console.log('scoreBuf:', scoreBuf.toString('hex'));
console.log('dataHash:', dataHash.toString('hex'));
console.log('\nFULL PAYLOAD:', payload.toString('hex'));
console.log('LENGTH:', payload.length);
