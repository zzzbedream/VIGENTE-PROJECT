/**
 * Vigente Protocol — Crypto Engine
 * 
 * Ed25519 key generation, signing, verification, and SHA-256 commitment
 * utilities. Uses Node.js built-in crypto module (no external deps).
 * 
 * In production (Tranche 3+), the signing key is derived from the
 * TLSNotary MPC-TLS Notary protocol. In this PoC, we generate a
 * local Ed25519 keypair to simulate the Notary's attestation.
 */

const crypto = require('crypto');

class CryptoEngine {
  /**
   * Generate an Ed25519 keypair (simulates Notary key).
   * In production, the Notary's key is established during the MPC-TLS
   * handshake and is never fully held by any single party.
   */
  static generateNotaryKeypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    return {
      publicKey,
      privateKey,
      publicKeyHex: publicKey
        .export({ type: 'spki', format: 'der' })
        .subarray(-32) // Ed25519 raw public key is last 32 bytes of SPKI DER
        .toString('hex'),
    };
  }

  /**
   * Compute SHA-256 commitment over raw data.
   * This binds the proof to the exact dataset without revealing the data.
   */
  static computeCommitment(data) {
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Sign a payload with Ed25519.
   * @param {object} payload - The attestation payload (claim + commitment + metadata)
   * @param {crypto.KeyObject} privateKey - Ed25519 private key
   * @returns {string} Hex-encoded signature
   */
  static sign(payload, privateKey) {
    const message = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = crypto.sign(null, message, privateKey);
    return signature.toString('hex');
  }

  /**
   * Verify an Ed25519 signature.
   * @param {object} payload - The attestation payload
   * @param {string} signatureHex - Hex-encoded Ed25519 signature
   * @param {crypto.KeyObject} publicKey - Ed25519 public key
   * @returns {boolean} True if signature is valid
   */
  static verify(payload, signatureHex, publicKey) {
    const message = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = Buffer.from(signatureHex, 'hex');
    return crypto.verify(null, message, publicKey, signature);
  }

  /**
   * Generate a cryptographically secure random nonce.
   */
  static generateNonce() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Serialize a public key to DER format for transport.
   */
  static exportPublicKey(publicKey) {
    return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  }

  /**
   * Import a public key from DER Base64 for verification.
   */
  static importPublicKey(base64Der) {
    return crypto.createPublicKey({
      key: Buffer.from(base64Der, 'base64'),
      format: 'der',
      type: 'spki',
    });
  }
}

module.exports = CryptoEngine;
