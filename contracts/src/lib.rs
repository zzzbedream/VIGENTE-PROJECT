#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, 
    Address, BytesN, Env
};

// External test module
#[cfg(test)]
mod test;

// =============================================================================
// VIGENTE PROTOCOL v2.0 - Financial Identity & On-Chain Reputation
// =============================================================================
// 
// EVOLUCIÓN DEL CONTRATO:
// -------------------------
// ✅ NUEVO: CreditBadge struct para reputación crediticia
// ✅ NUEVO: mint_badge() para emitir badges de crédito
// ✅ NUEVO: verify_badge() para integración con Blend Protocol
// ✅ NUEVO: Instance storage para consulta rápida del último badge
// ✅ MANTIENE: mint_deal() para compatibilidad con flujo anterior
// 
// ARQUITECTURA:
// - Stateless: Los eventos son la fuente de verdad (auditables vía indexers)
// - Instance Storage: Solo para el último badge (consulta rápida por Blend)
// - Privacy-First: Solo hashes on-chain, nunca datos personales
// =============================================================================

// -----------------------------------------------------------------------------
// STORAGE KEYS
// -----------------------------------------------------------------------------

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Badge(Address),  // Almacena el último badge por usuario
}

// -----------------------------------------------------------------------------
// CREDIT BADGE STRUCTURE
// -----------------------------------------------------------------------------
/// Representa la reputación crediticia de un usuario basada en su historial
/// de remesas (MoneyGram) convertido en un score on-chain.
/// 
/// # Tiers
/// - Tier 1 (A): Score 800-1000, Alto volumen, historial largo
/// - Tier 2 (B): Score 500-799, Volumen medio, historial estable
/// - Tier 3 (C): Score 300-499, Volumen bajo, historial corto
/// - Tier 4 (D): Score 0-299, Datos insuficientes
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct CreditBadge {
    /// Tier de crédito (1=A, 2=B, 3=C, 4=D)
    pub tier: u32,
    /// Score numérico (0-1000)
    pub score: u32,
    /// Timestamp de emisión (ledger timestamp)
    pub issued_at: u64,
    /// Timestamp de expiración (issued_at + 90 días)
    pub expires_at: u64,
    /// Hash SHA256 de los datos de remesas (privacidad)
    pub data_hash: BytesN<32>,
}

// -----------------------------------------------------------------------------
// CONTRACT DEFINITION
// -----------------------------------------------------------------------------

#[contract]
pub struct VigenteProtocol;

#[contractimpl]
impl VigenteProtocol {
    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    
    /// Inicializa el contrato con un administrador.
    /// Solo puede llamarse una vez.
    /// 
    /// # Arguments
    /// - `admin`: Dirección del administrador (Oracle backend)
    pub fn initialize(env: Env, admin: Address) {
        // Verificar que no esté ya inicializado
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }
        
        // Guardar admin
        env.storage().instance().set(&DataKey::Admin, &admin);
        
        // Emitir evento de inicialización
        env.events().publish(
            (symbol_short!("init"), admin.clone()),
            env.ledger().timestamp()
        );
    }

    // =========================================================================
    // CREDIT BADGE FUNCTIONS
    // =========================================================================
    
    /// Emite un CreditBadge para un usuario basado en su historial de remesas.
    /// 
    /// # Arguments
    /// - `user`: Dirección del usuario que recibe el badge
    /// - `tier`: Tier de crédito (1=A, 2=B, 3=C, 4=D)
    /// - `score`: Score numérico (0-1000)
    /// - `data_hash`: Hash SHA256 de los datos de remesas
    /// 
    /// # Security
    /// - Solo el admin puede llamar esta función (require_auth)
    /// - El badge se guarda en instance storage para consultas rápidas
    /// - Se emite un evento inmutable para auditoría
    /// 
    /// # Returns
    /// - `CreditBadge`: El badge emitido con todos sus campos
    pub fn mint_badge(
        env: Env,
        user: Address,
        tier: u32,
        score: u32,
        data_hash: BytesN<32>,
    ) -> CreditBadge {
        // 1. AUTENTICACIÓN: Verificar que el caller es el admin
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized");
        admin.require_auth();

        // 2. VALIDACIÓN: Verificar que tier y score son válidos
        if tier < 1 || tier > 4 {
            panic!("Invalid tier: must be 1-4");
        }
        if score > 1000 {
            panic!("Invalid score: must be 0-1000");
        }

        // 3. CALCULAR TIMESTAMPS
        let issued_at = env.ledger().timestamp();
        // 90 días = 90 * 24 * 60 * 60 = 7,776,000 segundos
        let expires_at = issued_at + 7_776_000_u64;

        // 4. CREAR BADGE
        let badge = CreditBadge {
            tier,
            score,
            issued_at,
            expires_at,
            data_hash: data_hash.clone(),
        };

        // 5. GUARDAR EN INSTANCE STORAGE (para consulta rápida por Blend)
        env.storage().instance().set(&DataKey::Badge(user.clone()), &badge);
        
        // Extender TTL del storage (90 días en ledgers, ~17280 ledgers/día)
        env.storage().instance().extend_ttl(1_555_200, 1_555_200);

        // 6. EMITIR EVENTO (fuente de verdad auditable)
        env.events().publish(
            (symbol_short!("badge"), user.clone()),
            (tier, score, issued_at, expires_at, data_hash)
        );

        // 7. RETORNAR BADGE
        badge
    }

    /// Verifica si un usuario tiene un CreditBadge válido (no expirado).
    /// Esta función será usada por Blend Protocol para determinar elegibilidad.
    /// 
    /// # Arguments
    /// - `user`: Dirección del usuario a verificar
    /// 
    /// # Returns
    /// - `Option<CreditBadge>`: El badge si existe y no ha expirado, None si no
    pub fn verify_badge(env: Env, user: Address) -> Option<CreditBadge> {
        // Intentar obtener el badge del storage
        let badge_result: Option<CreditBadge> = env.storage()
            .instance()
            .get(&DataKey::Badge(user.clone()));

        match badge_result {
            Some(badge) => {
                // Verificar que no ha expirado
                let current_time = env.ledger().timestamp();
                if current_time <= badge.expires_at {
                    Some(badge)
                } else {
                    // Badge expirado
                    None
                }
            }
            None => None,
        }
    }

    /// Obtiene el tier de un usuario (helper para Blend).
    /// Retorna 0 si no tiene badge válido.
    pub fn get_tier(env: Env, user: Address) -> u32 {
        match Self::verify_badge(env, user) {
            Some(badge) => badge.tier,
            None => 0,
        }
    }

    /// Obtiene el admin del contrato.
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized")
    }

    // =========================================================================
    // LEGACY: MINT DEAL (Compatibilidad con v1.0)
    // =========================================================================
    
    /// Registra un financiamiento (Deal) de forma privada y económica.
    /// MANTIENE COMPATIBILIDAD con el flujo anterior de PymeToken.
    /// 
    /// # Arguments
    /// - `data_hash`: SHA256(RUT + ADMIN_SECRET). Nadie ve el RUT real.
    /// - `partner`: La dirección del Backend (Admin) que autoriza la operación.
    /// - `amount`: Monto aprobado en stroops (1 XLM = 10,000,000 stroops).
    /// - `nonce`: Timestamp o ID único para evitar duplicados y replay attacks.
    pub fn mint_deal(
        env: Env, 
        data_hash: BytesN<32>, 
        partner: Address, 
        amount: i128, 
        nonce: i128
    ) {
        // SEGURIDAD: Autenticación Stateless
        partner.require_auth();

        // AUDITORÍA: Emisión de Evento
        env.events().publish(
            (symbol_short!("deal"), partner), 
            (data_hash, amount, nonce, env.ledger().timestamp())
        );
    }
}

// Note: Unit tests are now in src/test.rs
