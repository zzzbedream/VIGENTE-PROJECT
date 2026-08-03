const { Address } = require('@stellar/stellar-sdk');

// La dirección se pasa por argumento o entorno: no se incrusta ninguna pubkey
// en el repositorio, para que nadie tome una llave rotada como vigente.
const adminAddr = process.argv[2] || process.env.ADMIN_PUBLIC_KEY;
if (!adminAddr) {
  throw new Error(
    'Falta la dirección. Úsalo como `node debug-xdr.js G...` o exporta ' +
      'ADMIN_PUBLIC_KEY (p. ej. `export ADMIN_PUBLIC_KEY=$(stellar keys address admin-v2)`).',
  );
}

const address = Address.fromString(adminAddr);
const scAddress = address.toScAddress();
const xdr = scAddress.toXDR('raw');

console.log('Admin Address:', adminAddr);
console.log('XDR Hex:', xdr.toString('hex'));
console.log('XDR Length:', xdr.length);
console.log('Bytes 0-7:', xdr.slice(0, 8).toString('hex'));
console.log('Bytes 8-39 (pubkey):', xdr.slice(8).toString('hex'));
console.log('Pubkey length:', xdr.slice(8).length);
