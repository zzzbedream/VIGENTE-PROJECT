const { Keypair } = require('@stellar/stellar-sdk');

const adminSecret = 'SB7G3OJIVJR2MUJT6WCGPMFJPASEF5KDBG2CMOUCLDNRLPNLSK5JCDDT';
const expectedPublic = 'GAJT5NOKLJYDMO6WSUQAKYAWSH56YLPXLZTYPFP3PIJAKZ4PH7S235TU';

const kp = Keypair.fromSecret(adminSecret);
const actualPublic = kp.publicKey();

console.log('Expected Public Key:', expectedPublic);
console.log('Actual Public Key:  ', actualPublic);
console.log('Match:', expectedPublic === actualPublic);

// Test signing
const testPayload = Buffer.from('00000000000000008500e2681c8d5e40fed72c691e65a11c62776ddb4465fa9c3df9200b18d601a700000001000003e85ebd11e9459bc7dbeb8a3b15fdd7b9b0aa60002a31ad2b0fc66897cd0f64cbd4', 'hex');
const signature = kp.sign(testPayload);

console.log('\nTest Signature:', signature.toString('hex'));
console.log('Signature length:', signature.length);
