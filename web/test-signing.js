const { Keypair } = require('@stellar/stellar-sdk');

// El secreto NUNCA se escribe en el repositorio: se lee del entorno.
const adminSecret = process.env.ADMIN_SECRET;
if (!adminSecret) {
  throw new Error(
    'ADMIN_SECRET no está definida. Expórtala antes de ejecutar este script ' +
      '(p. ej. `export ADMIN_SECRET=$(stellar keys show admin-v2)`). ' +
      'Nunca la escribas en un archivo versionado.',
  );
}
// Opcional: pubkey esperada para verificar que el secreto es el correcto.
const expectedPublic = process.env.EXPECTED_PUBLIC_KEY;

const kp = Keypair.fromSecret(adminSecret);
const actualPublic = kp.publicKey();

console.log('Actual Public Key:  ', actualPublic);
if (expectedPublic) {
  console.log('Expected Public Key:', expectedPublic);
  console.log('Match:', expectedPublic === actualPublic);
}

// Test signing
const testPayload = Buffer.from('00000000000000008500e2681c8d5e40fed72c691e65a11c62776ddb4465fa9c3df9200b18d601a700000001000003e85ebd11e9459bc7dbeb8a3b15fdd7b9b0aa60002a31ad2b0fc66897cd0f64cbd4', 'hex');
const signature = kp.sign(testPayload);

console.log('\nTest Signature:', signature.toString('hex'));
console.log('Signature length:', signature.length);
