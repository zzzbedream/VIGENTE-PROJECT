// =============================================================================
// MONEYGRAM ORACLE SERVICE - Vigente Protocol
// =============================================================================
// 
// Este servicio simula la integración con MoneyGram Access API.
// En producción, esto se conectaría al sandbox/producción de MoneyGram.
// 
// Sandbox real: https://sandboxapi.moneygram.com
// Docs: https://developer.moneygram.com
// =============================================================================

// -----------------------------------------------------------------------------
// INTERFACES
// -----------------------------------------------------------------------------

/**
 * Representa una transacción de remesas de MoneyGram.
 * Estructura basada en el Transfer API de MoneyGram.
 */
export interface MoneyGramTransaction {
  /** ID único de la transacción (formato: MGT-XXXXXXXX) */
  id: string;
  /** Monto en USD (normalizado desde cualquier moneda origen) */
  amountUSD: number;
  /** Fecha de la transacción (ISO 8601) */
  date: string;
  /** Moneda original de la transacción */
  currency: string;
  /** País del destinatario (ISO 3166-1 alpha-2) */
  recipientCountry: string;
  /** Estado de la transacción */
  status: 'COMPLETED' | 'PENDING' | 'CANCELLED';
}

/**
 * Perfil del usuario con nivel de verificación KYC.
 */
export interface UserProfile {
  /** ID único del usuario */
  id: string;
  /** Nombre del usuario (sanitizado para privacidad) */
  name: string;
  /** Nivel de KYC: 1=Básico, 2=Intermedio, 3=Completo */
  kycLevel: 1 | 2 | 3;
  /** País de residencia */
  country: string;
  /** Fecha de registro */
  registeredAt: string;
}

/**
 * Respuesta completa del oráculo con transacciones y perfil.
 */
export interface OracleResponse {
  user: UserProfile;
  transactions: MoneyGramTransaction[];
  metadata: {
    fetchedAt: string;
    source: 'MOCK' | 'SANDBOX' | 'PRODUCTION';
    totalTransactions: number;
    periodMonths: number;
  };
}

// -----------------------------------------------------------------------------
// HELPER FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Genera un ID de transacción único.
 */
function generateTransactionId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'MGT-';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * Calcula una fecha relativa a hoy.
 * @param daysAgo - Número de días hacia atrás
 * @returns Fecha en formato ISO 8601
 */
function getRelativeDate(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
}

/**
 * Genera un monto aleatorio dentro de un rango.
 */
function randomAmount(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

/**
 * Selecciona un país aleatorio de LATAM.
 */
function randomLatamCountry(): string {
  const countries = ['MX', 'GT', 'SV', 'HN', 'NI', 'CO', 'PE', 'EC', 'BO', 'PY'];
  return countries[Math.floor(Math.random() * countries.length)];
}

// -----------------------------------------------------------------------------
// MOCK DATA GENERATORS
// -----------------------------------------------------------------------------

/**
 * Genera transacciones para usuario Tier A.
 * - 20 transacciones en 6 meses
 * - Promedio $600 USD/mes
 * - Frecuencia constante (cada ~15 días)
 */
function generateTierATransactions(): MoneyGramTransaction[] {
  const transactions: MoneyGramTransaction[] = [];

  // 20 transacciones distribuidas en 190 días (> 6 meses)
  // Cada transacción cada 10 días para llegar a 190 días
  for (let i = 0; i < 20; i++) {
    const daysAgo = i * 10; // Distribuir uniformemente
    // Promedio $600/mes = $3600 en 6 meses / 20 tx = ~$180 por tx
    // Variamos entre $150-$220 para mantener promedio ~$180
    const amount = randomAmount(150, 220);

    transactions.push({
      id: generateTransactionId(),
      amountUSD: amount,
      date: getRelativeDate(daysAgo),
      currency: 'USD',
      recipientCountry: randomLatamCountry(),
      status: 'COMPLETED',
    });
  }

  return transactions.sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

/**
 * Genera transacciones para usuario Tier B.
 * - 10 transacciones en 4 meses
 * - Promedio $350 USD/mes
 */
function generateTierBTransactions(): MoneyGramTransaction[] {
  const transactions: MoneyGramTransaction[] = [];

  // 10 transacciones en 120 días (~4 meses)
  // Cada transacción cada ~12 días
  for (let i = 0; i < 10; i++) {
    const daysAgo = i * 12;
    // Promedio $350/mes = $1400 en 4 meses / 10 tx = ~$140 por tx
    // Variamos entre $100-$180
    const amount = randomAmount(100, 180);

    transactions.push({
      id: generateTransactionId(),
      amountUSD: amount,
      date: getRelativeDate(daysAgo),
      currency: 'USD',
      recipientCountry: randomLatamCountry(),
      status: 'COMPLETED',
    });
  }

  return transactions.sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

/**
 * Genera transacciones para usuario que no califica.
 * - 2 transacciones pequeñas ($50 USD cada una)
 */
function generateFailTransactions(): MoneyGramTransaction[] {
  return [
    {
      id: generateTransactionId(),
      amountUSD: 50,
      date: getRelativeDate(30), // Hace 1 mes
      currency: 'USD',
      recipientCountry: 'MX',
      status: 'COMPLETED',
    },
    {
      id: generateTransactionId(),
      amountUSD: 50,
      date: getRelativeDate(60), // Hace 2 meses
      currency: 'USD',
      recipientCountry: 'GT',
      status: 'COMPLETED',
    },
  ];
}

// -----------------------------------------------------------------------------
// MAIN ORACLE FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Obtiene las transacciones de un usuario desde MoneyGram.
 * En este MVP, retorna datos mock según el userId.
 * 
 * @param userId - ID del usuario para consultar
 * @returns Array de transacciones
 * 
 * @example
 * ```typescript
 * // Tier A - Alto volumen
 * const txA = await fetchUserTransactions('user_tier_a');
 * 
 * // Tier B - Volumen medio
 * const txB = await fetchUserTransactions('user_tier_b');
 * 
 * // No califica
 * const txFail = await fetchUserTransactions('user_fail');
 * 
 * // Usuario desconocido
 * const txEmpty = await fetchUserTransactions('unknown');
 * ```
 */
export async function fetchUserTransactions(
  userId: string
): Promise<MoneyGramTransaction[]> {
  // Simular latencia de red (200-500ms)
  await new Promise(resolve =>
    setTimeout(resolve, 200 + Math.random() * 300)
  );

  switch (userId.toLowerCase()) {
    case 'user_tier_a':
      return generateTierATransactions();

    case 'user_tier_b':
      return generateTierBTransactions();

    case 'user_fail':
      return generateFailTransactions();

    default:
      // Usuario desconocido o sin transacciones
      return [];
  }
}

/**
 * Obtiene el perfil del usuario desde MoneyGram.
 * 
 * @param userId - ID del usuario
 * @returns Perfil del usuario o null si no existe
 */
export async function fetchUserProfile(
  userId: string
): Promise<UserProfile | null> {
  // Simular latencia
  await new Promise(resolve =>
    setTimeout(resolve, 100 + Math.random() * 200)
  );

  const profiles: Record<string, UserProfile> = {
    'user_tier_a': {
      id: 'user_tier_a',
      name: 'María García',
      kycLevel: 3,
      country: 'CL',
      registeredAt: getRelativeDate(365), // Hace 1 año
    },
    'user_tier_b': {
      id: 'user_tier_b',
      name: 'Carlos Rodríguez',
      kycLevel: 2,
      country: 'CL',
      registeredAt: getRelativeDate(180), // Hace 6 meses
    },
    'user_fail': {
      id: 'user_fail',
      name: 'Ana López',
      kycLevel: 1,
      country: 'CL',
      registeredAt: getRelativeDate(30), // Hace 1 mes
    },
  };

  return profiles[userId.toLowerCase()] || null;
}

/**
 * Obtiene datos completos del usuario: perfil + transacciones.
 * Esta es la función principal que usa el frontend.
 * 
 * @param userId - ID del usuario
 * @returns Respuesta completa del oráculo
 */
export async function fetchOracleData(
  userId: string
): Promise<OracleResponse | null> {
  const [user, transactions] = await Promise.all([
    fetchUserProfile(userId),
    fetchUserTransactions(userId),
  ]);

  if (!user) {
    return null;
  }

  // Calcular período cubierto por las transacciones
  let periodMonths = 0;
  if (transactions.length >= 2) {
    const oldest = new Date(transactions[transactions.length - 1].date);
    const newest = new Date(transactions[0].date);
    const diffMs = newest.getTime() - oldest.getTime();
    periodMonths = Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 30));
  }

  return {
    user,
    transactions,
    metadata: {
      fetchedAt: new Date().toISOString(),
      source: 'MOCK',
      totalTransactions: transactions.length,
      periodMonths,
    },
  };
}

// -----------------------------------------------------------------------------
// ANALYTICS HELPERS
// -----------------------------------------------------------------------------

/**
 * Calcula estadísticas agregadas de las transacciones.
 * Útil para el motor de scoring.
 */
export function calculateTransactionStats(transactions: MoneyGramTransaction[]) {
  if (transactions.length === 0) {
    return {
      totalVolume: 0,
      avgPerMonth: 0,
      transactionCount: 0,
      avgTransactionSize: 0,
      consistencyScore: 0,
      oldestTransactionDays: 0,
    };
  }

  // Volumen total
  const totalVolume = transactions.reduce((sum, tx) => sum + tx.amountUSD, 0);

  // Calcular días del período
  const dates = transactions.map(tx => new Date(tx.date).getTime());
  const oldestDate = Math.min(...dates);
  const newestDate = Math.max(...dates);
  const periodDays = Math.max(1, (newestDate - oldestDate) / (1000 * 60 * 60 * 24));
  const periodMonths = Math.max(1, periodDays / 30);

  // Promedio mensual
  const avgPerMonth = totalVolume / periodMonths;

  // Tamaño promedio de transacción
  const avgTransactionSize = totalVolume / transactions.length;

  // Días desde la transacción más antigua
  const oldestTransactionDays = Math.floor(
    (Date.now() - oldestDate) / (1000 * 60 * 60 * 24)
  );

  // Score de consistencia (0-100)
  // Basado en regularidad de transacciones
  // Ideal: 2+ transacciones por mes = 100
  const txPerMonth = transactions.length / periodMonths;
  const consistencyScore = Math.min(100, txPerMonth * 50);

  return {
    totalVolume: Math.round(totalVolume * 100) / 100,
    avgPerMonth: Math.round(avgPerMonth * 100) / 100,
    transactionCount: transactions.length,
    avgTransactionSize: Math.round(avgTransactionSize * 100) / 100,
    consistencyScore: Math.round(consistencyScore),
    oldestTransactionDays,
  };
}

/**
 * Determina el tier basado en las estadísticas.
 * Esta lógica se usará en el scoring engine.
 */
export function determineTier(stats: ReturnType<typeof calculateTransactionStats>): {
  tier: 1 | 2 | 3 | 4;
  tierName: 'A' | 'B' | 'C' | 'D';
  reason: string;
} {
  // Tier A: $500+/mes, 6+ meses historial, alta consistencia
  if (
    stats.avgPerMonth >= 500 &&
    stats.oldestTransactionDays >= 180 &&
    stats.consistencyScore >= 60
  ) {
    return {
      tier: 1,
      tierName: 'A',
      reason: 'Alto volumen con historial estable de 6+ meses',
    };
  }

  // Tier B: $300-$499/mes, 3+ meses historial
  if (
    stats.avgPerMonth >= 300 &&
    stats.oldestTransactionDays >= 90 &&
    stats.transactionCount >= 6
  ) {
    return {
      tier: 2,
      tierName: 'B',
      reason: 'Volumen medio con historial de 3+ meses',
    };
  }

  // Tier C: $100-$299/mes, cualquier historial
  if (
    stats.avgPerMonth >= 100 &&
    stats.transactionCount >= 3
  ) {
    return {
      tier: 3,
      tierName: 'C',
      reason: 'Volumen bajo pero con historial demostrable',
    };
  }

  // Tier D: No califica
  return {
    tier: 4,
    tierName: 'D',
    reason: 'Datos insuficientes para evaluación crediticia',
  };
}
