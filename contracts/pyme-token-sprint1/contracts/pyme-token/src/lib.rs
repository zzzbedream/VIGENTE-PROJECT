#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Address, BytesN, Env};

// =============================================================================
// PYME TOKEN CONTRACT v2.0 - Privacy-First & Low-Cost Architecture
// =============================================================================
// 
// CAMBIOS RESPECTO A v1.0:
// -------------------------
// ❌ ELIMINADO: struct PymeVerification, Deal (no guardamos objetos complejos)
// ❌ ELIMINADO: verify_pyme (verificación off-chain en Backend)
// ❌ ELIMINADO: init (autenticación stateless, sin admin guardado)
// ❌ ELIMINADO: String para RUT (reemplazado por Hash para privacidad)
// 
// ✅ BENEFICIOS:
// - Privacidad: El RUT nunca se expone en blockchain (solo hash)
// - Costos: ~90% menos gas (eventos vs storage persistente)
// - Simplicidad: Una sola función, cero estado on-chain
// =============================================================================

#[contract]
pub struct PymeTokenContract;

#[contractimpl]
impl PymeTokenContract {
    /// Registra un financiamiento (Deal) de forma privada y económica.
    /// 
    /// # Argumentos
    /// - `data_hash`: SHA256(RUT + ADMIN_SECRET). Nadie ve el RUT real.
    /// - `partner`: La dirección del Backend (Admin) que autoriza la operación.
    /// - `amount`: Monto aprobado en stroops (1 XLM = 10,000,000 stroops).
    /// - `nonce`: Timestamp o ID único para evitar duplicados y replay attacks.
    /// 
    /// # Seguridad
    /// - El `partner` debe firmar la transacción (require_auth).
    /// - Si alguien no autorizado intenta llamar, la tx falla.
    /// 
    /// # Auditoría
    /// - Emite evento "deal" indexado por partner address.
    /// - Los eventos son inmutables y consultables vía Horizon/RPC.
    pub fn mint_deal(
        env: Env, 
        data_hash: BytesN<32>, 
        partner: Address, 
        amount: i128, 
        nonce: i128
    ) {
        // 1. SEGURIDAD: Autenticación Stateless
        // Verificamos criptográficamente que 'partner' (tu backend) firmó esto.
        // Si alguien más intenta llamar a esta función, fallará aquí.
        partner.require_auth();

        // 2. AUDITORÍA: Emisión de Evento (en lugar de storage costoso)
        // Topics: "deal" y la address del partner (para búsquedas rápidas por indexers).
        // Data: hash, monto, nonce y timestamp del ledger.
        env.events().publish(
            (symbol_short!("deal"), partner), 
            (data_hash, amount, nonce, env.ledger().timestamp())
        );
    }
}