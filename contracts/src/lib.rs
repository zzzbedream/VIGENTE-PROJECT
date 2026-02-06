#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, 
    Address, BytesN, Env
};

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

// =============================================================================
// TESTS UNITARIOS
// =============================================================================
#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Events as _, Env, Address, BytesN};

    fn setup_contract(env: &Env) -> (Address, Address, VigenteProtocolClient<'_>) {
        let contract_id = env.register_contract(None, VigenteProtocol);
        let client = VigenteProtocolClient::new(env, &contract_id);
        
        let admin = Address::generate(env);
        let user = Address::generate(env);
        
        // Mock auth para inicialización
        env.mock_all_auths();
        client.initialize(&admin);
        
        (admin, user, client)
    }

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let contract_id = env.register_contract(None, VigenteProtocol);
        let client = VigenteProtocolClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        env.mock_all_auths();
        
        client.initialize(&admin);
        
        let stored_admin = client.get_admin();
        assert_eq!(stored_admin, admin);
    }

    #[test]
    #[should_panic(expected = "Contract already initialized")]
    fn test_double_initialize_fails() {
        let env = Env::default();
        let contract_id = env.register_contract(None, VigenteProtocol);
        let client = VigenteProtocolClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        env.mock_all_auths();
        
        client.initialize(&admin);
        client.initialize(&admin); // Should panic
    }

    #[test]
    fn test_mint_badge_success() {
        let env = Env::default();
        let (_admin, user, client) = setup_contract(&env);
        
        let data_hash = BytesN::from_array(&env, &[0xAB; 32]);
        let tier = 1u32;  // Tier A
        let score = 850u32;
        
        let badge = client.mint_badge(&user, &tier, &score, &data_hash);
        
        assert_eq!(badge.tier, tier);
        assert_eq!(badge.score, score);
        assert_eq!(badge.data_hash, data_hash);
        assert!(badge.expires_at > badge.issued_at);
        
        // Verificar que el badge está en storage
        let verified = client.verify_badge(&user);
        assert!(verified.is_some());
        assert_eq!(verified.unwrap().tier, tier);
    }

    #[test]
    fn test_verify_badge_returns_none_for_unknown_user() {
        let env = Env::default();
        let (_, _, client) = setup_contract(&env);
        
        let unknown_user = Address::generate(&env);
        let verified = client.verify_badge(&unknown_user);
        
        assert!(verified.is_none());
    }

    #[test]
    fn test_get_tier() {
        let env = Env::default();
        let (_, user, client) = setup_contract(&env);
        
        let data_hash = BytesN::from_array(&env, &[0xCD; 32]);
        client.mint_badge(&user, &2u32, &650u32, &data_hash);
        
        let tier = client.get_tier(&user);
        assert_eq!(tier, 2);
    }

    #[test]
    fn test_get_tier_returns_zero_for_no_badge() {
        let env = Env::default();
        let (_, _, client) = setup_contract(&env);
        
        let unknown_user = Address::generate(&env);
        let tier = client.get_tier(&unknown_user);
        
        assert_eq!(tier, 0);
    }

    #[test]
    #[should_panic(expected = "Invalid tier")]
    fn test_mint_badge_invalid_tier() {
        let env = Env::default();
        let (_, user, client) = setup_contract(&env);
        
        let data_hash = BytesN::from_array(&env, &[0xEF; 32]);
        client.mint_badge(&user, &5u32, &500u32, &data_hash); // Invalid tier
    }

    #[test]
    #[should_panic(expected = "Invalid score")]
    fn test_mint_badge_invalid_score() {
        let env = Env::default();
        let (_, user, client) = setup_contract(&env);
        
        let data_hash = BytesN::from_array(&env, &[0x11; 32]);
        client.mint_badge(&user, &1u32, &1500u32, &data_hash); // Invalid score
    }

    #[test]
    fn test_multiple_badges_different_users() {
        let env = Env::default();
        let (_, _, client) = setup_contract(&env);
        
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        
        let hash1 = BytesN::from_array(&env, &[0x11; 32]);
        let hash2 = BytesN::from_array(&env, &[0x22; 32]);
        
        client.mint_badge(&user1, &1u32, &900u32, &hash1);
        client.mint_badge(&user2, &3u32, &400u32, &hash2);
        
        assert_eq!(client.get_tier(&user1), 1);
        assert_eq!(client.get_tier(&user2), 3);
    }

    #[test]
    fn test_badge_update_overwrites() {
        let env = Env::default();
        let (_, user, client) = setup_contract(&env);
        
        let hash1 = BytesN::from_array(&env, &[0x11; 32]);
        let hash2 = BytesN::from_array(&env, &[0x22; 32]);
        
        // Primer badge
        client.mint_badge(&user, &3u32, &400u32, &hash1);
        assert_eq!(client.get_tier(&user), 3);
        
        // Segundo badge (upgrade)
        client.mint_badge(&user, &1u32, &900u32, &hash2);
        assert_eq!(client.get_tier(&user), 1);
    }

    #[test]
    fn test_legacy_mint_deal_still_works() {
        let env = Env::default();
        env.mock_all_auths();
        
        let contract_id = env.register_contract(None, VigenteProtocol);
        let client = VigenteProtocolClient::new(&env, &contract_id);
        
        let partner = Address::generate(&env);
        let fake_hash = BytesN::from_array(&env, &[0xAA; 32]);
        let amount = 10_000_000_i128;
        let nonce = 1_i128;
        
        // No debería fallar
        client.mint_deal(&fake_hash, &partner, &amount, &nonce);
        
        // Verificar que se emitió evento
        let events = env.events().all();
        assert!(!events.is_empty());
    }
}
