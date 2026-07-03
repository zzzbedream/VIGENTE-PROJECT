/**
 * Landing copy — bilingual ES/EN, pivot "reputation-powered collateralized
 * credit" (2026-07). Spanish is canonical (pilot corridor is LATAM); English
 * mirrors it. No unconfirmed partner names in public copy — infrastructure we
 * compose on (Blend, RedStone, Stellar) is named; data/RWA/wallet targets are
 * generic until an LOI is signed (see docs/private/partner-roster.md).
 *
 * Honesty rules baked in:
 *  - What is live today = the credit primitive (threshold oracle + badge +
 *    reference vault) on testnet. The Blend-composed pool is "en curso".
 *  - Demo parameters are labeled as pilot-calibration estimates.
 */

export type Lang = "es" | "en";

export interface HeroVariant {
  title: string;
  sub: string;
}

export interface TierDef {
  label: string;
  ltv: number;
  rate: string;
}

const es = {
  navHow: "cómo funciona",
  navWho: "para quién",
  navTrust: "seguridad",
  navFaq: "faq",
  navCta: "unirme a la whitelist",

  heroCta: "unirme a la whitelist",
  heroCta2: "ver contrato en testnet",
  heroCta3: "evaluar mi capacidad de pago",
  heroFinePrint:
    "primitivo de crédito en vivo en testnet de stellar · sin token propio · custodia en contratos verificables",
  heroVariants: [
    {
      title: "pide prestado contra tus activos, sin venderlos.",
      sub: "deposita USDC, XLM o tesoros tokenizados como colateral y recibe stablecoins al instante. cada repago puntual construye una reputación que sube tu límite y baja tu tasa.",
    },
    {
      title: "tu buen historial vale más colateral.",
      sub: "un pool de crédito colateralizado en stellar donde la reputación — on-chain y, con tu consentimiento, off-chain — aumenta cuánto puedes pedir por cada dólar que depositas.",
    },
    {
      title: "liquidez hoy. tus activos siguen siendo tuyos.",
      sub: "bloquea colateral, pide prestado en stablecoins y recupéralo todo al repagar. sin vender tu posición, sin pedirle permiso a un banco.",
    },
  ] as HeroVariant[],

  demoTitle: "simulador de posición",
  demoCollateral: "colateral depositado",
  demoBorrow: "préstamo disponible",
  demoRate: "ajuste de tasa",
  demoNote:
    "parámetros ilustrativos, sujetos a calibración del piloto. tu tier sube con repagos puntuales y datos verificados que tú decides conectar.",
  tiers: [
    { label: "nuevo", ltv: 0.5, rate: "tasa base" },
    { label: "establecido", ltv: 0.65, rate: "−1.5 pt" },
    { label: "probado", ltv: 0.75, rate: "−3.0 pt" },
  ] as TierDef[],

  strip1: "contratos verificables · testnet en vivo",
  strip2: "pool: compone sobre blend (auditado)",
  strip3: "precios: oráculo redstone",
  strip4: "stellar · soroban",

  howTitle: "cómo funciona",
  howSub: "tres pasos. tu colateral vive en un contrato verificable, no en una empresa.",
  steps: [
    {
      num: "01",
      title: "deposita colateral",
      body: "USDC, XLM o activos del mundo real tokenizados (p. ej. tesoros). queda bloqueado en un contrato público en stellar que cualquiera puede auditar.",
    },
    {
      num: "02",
      title: "pide prestado en stablecoins",
      body: "recibe liquidez al instante, hasta el límite que marca tu LTV. repaga a tu ritmo y recupera tu colateral al cerrar la posición.",
    },
    {
      num: "03",
      title: "tu reputación mejora tus condiciones",
      body: "repagos puntuales — y, si tú lo autorizas, datos verificados de ingreso o remesas — suben tu LTV y bajan tu tasa con el tiempo.",
    },
  ],

  diffTitle: "no es un CDP genérico",
  diffColCdp: "CDP típico",
  diffBody1:
    "en un protocolo de préstamo estándar, todos reciben el mismo trato: mismo LTV, misma tasa, sin importar cuántas veces hayas repagado bien. tu historial no vale nada.",
  diffBody2:
    "vigente añade una capa de reputación sobre el pool: tu comportamiento — verificable on-chain, enriquecible con datos off-chain que tú consientes — se traduce directamente en más préstamo por unidad de colateral y mejor tasa.",
  diffRows: [
    { label: "LTV", cdp: "fijo, igual para todos", vig: "dinámico, por reputación" },
    { label: "tasa", cdp: "solo utilización", vig: "mejora con historial" },
    { label: "tu historial", cdp: "no cuenta", vig: "es el activo central" },
    { label: "datos off-chain", cdp: "no existen", vig: "opcionales, con consentimiento" },
  ],

  whoTitle: "para quién es",
  segments: [
    {
      tag: "día 1",
      title: "tienes activos y necesitas liquidez",
      body: "holders de cripto o RWA con rendimiento que no quieren vender su posición para cubrir un gasto. deposita, pide prestado, repaga, recupera. tu posición sigue intacta.",
    },
    {
      tag: "segmento puente",
      title: "recibes ingresos verificables",
      body: "si recibes o envías remesas, o tienes ingreso verificable, puedes conectarlo — con tu consentimiento — para pre-calificar tu reputación y arrancar con mejores condiciones desde el primer préstamo.",
    },
  ],

  ppTag: "pasaporte financiero",
  ppTitle: "evalúa tu capacidad de pago — sin activos, sin costo",
  ppSub: "cualquiera puede generar su puntaje crediticio inicial hoy. responde cuatro preguntas, guarda tu pasaporte y, cuando deposites colateral, arrancas con reputación pre-calificada en lugar de empezar de cero.",
  ppIncome: "ingreso mensual (USD)",
  ppRemit: "remesas mensuales recibidas (USD)",
  ppExpenses: "gastos fijos mensuales (USD)",
  ppHistory: "¿has pagado créditos antes?",
  ppHistoryOpts: [
    { v: "none", label: "nunca he pedido crédito" },
    { v: "always", label: "sí, siempre a tiempo" },
    { v: "sometimes", label: "sí, con algún atraso" },
    { v: "late", label: "sí, con atrasos frecuentes" },
  ],
  ppCalc: "calcular mi puntaje",
  ppError: "ingresa al menos un ingreso o remesa mayor a cero.",
  ppPrivacy: "el cálculo ocurre en tu navegador. nada se envía ni se publica on-chain.",
  ppEmpty: "completa el formulario y calcula tu puntaje inicial. no necesitas wallet ni activos.",
  ppScoreLabel: "puntaje crediticio inicial",
  ppTierLabel: "tier de reputación",
  ppLtvLabel: "LTV estimado al depositar",
  ppNote:
    "este puntaje es una estimación local. se convierte en reputación verificada cuando conectas datos y repagas on-chain. ¿no tienes activos aún? guarda tu pasaporte: al depositar colateral más adelante, desbloqueas tu préstamo con estas condiciones pre-calificadas.",
  ppDownload: "descargar mi pasaporte",
  ppNext: "reservar cupo en la whitelist",
  ppBadgePreview: "vista previa",
  ppBadgeVerified: "wallet leída on-chain",
  ppLockTag: "verifica con tu wallet",
  ppLockBody:
    "pega tu dirección de stellar y leemos tu estado en el contrato de reputación en vivo (get_score / is_defaulted — lectura permissionless, sin firma). si ya tienes badge, tu puntaje on-chain aparece junto a la estimación.",
  ppWalletError: "dirección inválida. una dirección de stellar empieza con G y tiene 56 caracteres.",
  ppReadError: "no pudimos leer el contrato ahora. intenta de nuevo en unos segundos.",
  ppVerify: "leer mi wallet on-chain",
  ppVerifying: "leyendo el contrato…",
  ppVerifiedTag: "leída del contrato en vivo",
  ppOnchainScore: "puntaje on-chain (badge)",
  ppOnchainNone: "sin badge aún — se emite en el piloto",
  ppTiers: ["inicial", "establecido", "probado"],
  ppFile: {
    title: "VIGENTE PROTOCOL — PASAPORTE FINANCIERO (estimación inicial)",
    date: "Fecha",
    score: "Puntaje inicial",
    tier: "Tier",
    ltv: "LTV estimado al depositar colateral",
    income: "Ingreso mensual",
    remit: "Remesas mensuales",
    expenses: "Gastos fijos",
    history: "Historial declarado",
    onchain: "Puntaje on-chain (badge)",
    onchainNone: "sin badge",
    note: "Estimación generada localmente en el navegador. No constituye una oferta de crédito. Se convierte en reputación verificada al conectar datos y repagar on-chain. Parámetros sujetos a calibración del piloto.",
  },

  trustTitle: "construido sobre infraestructura probada",
  trustSub: "no reinventamos el pool de préstamos: lo componemos sobre piezas auditadas y verificables, y añadimos la capa de reputación.",
  trustCards: [
    {
      name: "blend",
      body: "la infraestructura de pools de préstamo, auditada y en producción en stellar. el pool del piloto se compone sobre ella (patrón orbit) en lugar de reescribirla.",
    },
    {
      name: "redstone",
      body: "oráculo de precios para el colateral. los precios que disparan liquidaciones no dependen de una sola parte.",
    },
    {
      name: "stellar · soroban",
      body: "liquidación en segundos con comisiones de fracciones de centavo. contratos inteligentes en soroban.",
    },
    {
      name: "contratos verificables",
      body: "todo el código que custodia tu reputación y tu colateral es público y verificable en el explorador. nada opaco en la ruta de confianza.",
    },
    {
      name: "primitivo en vivo",
      body: "el primitivo de crédito ya corre en testnet de stellar: oráculo de umbral 3-de-5, badge de reputación y vault de referencia. puedes leerlo abajo, ahora.",
    },
    {
      name: "sin token propio",
      body: "sin token de gobernanza, sin emisiones infladas. el modelo se sostiene con las comisiones del crédito, no con especulación.",
    },
  ],
  liveTitle: "en vivo on-chain",
  liveReading: "leyendo…",
  liveRead: "leído del contrato ahora",
  liveThreshold: "umbral",
  liveThresholdSub: "quórum ed25519",
  liveKeys: "claves del oráculo",
  liveKeysSub: "firmantes independientes",
  liveAge: "edad mínima de cuenta",
  liveAgeSub: "control anti-sybil",
  liveContract: "contrato",
  liveContractSub: "testnet · soroban",

  wlTitle: "entra a la whitelist del piloto",
  wlSub: "cupos limitados para el primer pool. te avisamos cuando tu acceso esté listo — y si conectas tus datos, arrancas con reputación pre-calificada.",
  wlPlaceholder: "tu@correo.com",
  wlCheckbox:
    "quiero pre-calificar mi reputación conectando datos de ingreso o remesas (opcional, con consentimiento, revocable).",
  wlButton: "reservar mi lugar",
  wlError: "escribe un correo válido.",
  wlPrivacy: "sin spam. solo avisos del piloto. nunca publicamos tus datos on-chain.",
  wlSuccessTitle: "listo — estás en la lista.",
  wlSuccessBody: "para asegurar tu cupo mientras conectamos el registro, envíanos tu correo con un clic:",
  wlSuccessMail: "confirmar mi cupo por correo",
  wlSuccessData: "marcaste pre-calificación de reputación: te contactaremos primero para conectar tus datos.",

  visionTag: "la visión",
  visionTitle: "cada vez menos colateral",
  visionBody1:
    "hoy, cada préstamo está respaldado por colateral. pero cada repago puntual es evidencia — y la evidencia acumulada debería valer algo.",
  visionBody2:
    "el destino es un glide-path: a medida que tu reputación se consolida, el colateral exigido baja. crédito justo para quien construye historial, aunque ningún banco lo conozca. esa es la meta — no una promesa del día 1.",
  glidePath: [
    {
      phase: "hoy",
      title: "sobre-colateralizado",
      body: "préstamos respaldados 100%+ por colateral. la reputación ajusta LTV y tasa.",
      color: "#8BE9B0",
      border: "#8BE9B0",
    },
    {
      phase: "después",
      title: "colateral reducido",
      body: "historial probado desbloquea ratios de colateral progresivamente menores.",
      color: "#9AA3A0",
      border: "#2A2F35",
    },
    {
      phase: "destino",
      title: "crédito por reputación",
      body: "acceso a crédito justo basado en historial verificable, on-chain y off-chain.",
      color: "#6B7370",
      border: "#1C2126",
    },
  ],

  flowTitle: "proceso de entrada",
  flowSub: "de la whitelist a tu primer préstamo, en seis pasos.",
  flow: [
    { num: "01", title: "whitelist", body: "deja tu correo y reserva tu cupo del piloto.", optional: false },
    { num: "02", title: "wallet stellar", body: "crea o conecta tu wallet (p. ej. freighter).", optional: false },
    { num: "03", title: "deposita colateral", body: "USDC, XLM o RWA quedan en el contrato.", optional: false },
    { num: "04", title: "conecta datos", body: "ingreso o remesas para pre-calificar tu reputación.", optional: true },
    { num: "05", title: "pide prestado", body: "recibe stablecoins hasta tu límite de LTV.", optional: false },
    { num: "06", title: "repaga y sube", body: "cada repago puntual mejora tus condiciones.", optional: false },
  ],
  flowOptional: " · opcional",

  netTag: "LA RED DE REPUTACIÓN",
  netTitle: "cada repago es un bloque. cada bloque es reputación.",
  netSub: "vigente convierte el comportamiento financiero en un activo verificable sobre stellar. sin intermediarios que opinen — solo evidencia on-chain, criptográficamente comprobable.",
  netStats: [
    { value: "~5s", label: "liquidación en stellar" },
    { value: "<$0.01", label: "costo por transacción" },
    { value: "100%", label: "contratos verificables" },
  ],

  roadmapTitle: "roadmap",
  roadmap: [
    {
      phase: "fase 1",
      status: "completado",
      title: "primitivo de crédito en testnet",
      body: "oráculo de umbral 3-de-5, badge de reputación soulbound y vault de referencia gateado por crédito. contrato verificable en el explorador.",
      accent: "#8BE9B0",
    },
    {
      phase: "fase 2",
      status: "en curso",
      title: "pool colateralizado + whitelist",
      body: "pool de crédito compuesto sobre blend con oráculo redstone, capa reputación→LTV y piloto whitelisted (~50 usuarios).",
      accent: "#E9C98B",
    },
    {
      phase: "fase 3",
      status: "siguiente",
      title: "mainnet capado",
      body: "lanzamiento capado y whitelisted del primer pool en mainnet + conexión de datos verificados de ingreso/remesas.",
      accent: "#9AA3A0",
    },
    {
      phase: "fase 4",
      status: "visión",
      title: "glide-path",
      body: "reducción progresiva del colateral exigido para reputaciones consolidadas.",
      accent: "#6B7370",
    },
  ],

  faqTitle: "preguntas frecuentes",
  faqs: [
    {
      q: "¿es seguro?",
      a: "el pool se construye sobre blend, infraestructura auditada y en producción en stellar, con precios del oráculo redstone. todos los contratos son públicos y verificables. dicho con honestidad: hoy el MVP está en testnet, todo préstamo colateralizado tiene riesgos (volatilidad, contratos), y nunca deposites más de lo que puedes permitirte bloquear.",
    },
    {
      q: "¿qué colateral aceptan?",
      a: "al inicio del piloto: USDC, XLM y activos del mundo real tokenizados, como tesoros de EE. UU. la lista exacta se confirma antes del lanzamiento en mainnet.",
    },
    {
      q: "¿qué pasa si baja el precio de mi colateral?",
      a: "tu posición tiene un factor de salud visible en todo momento. si el precio cae y te acercas al límite, puedes añadir colateral o repagar parte del préstamo. si el factor de salud cae por debajo del umbral, la mecánica de liquidación del pool cubre la deuda vendiendo parte del colateral — nunca debes más de lo que depositaste.",
    },
    {
      q: "¿cómo mejora mi reputación?",
      a: "automáticamente, con cada repago puntual registrado on-chain. opcionalmente, puedes conectar datos verificados de ingreso o remesas — siempre con tu consentimiento explícito, revocable, y nunca publicados on-chain. mejor reputación = más LTV y mejor tasa; con el tiempo, menos colateral exigido.",
    },
    {
      q: "¿en qué países está disponible?",
      a: "el protocolo es global por diseño: solo necesitas una wallet de stellar. los corredores del piloto (con integración de datos de ingreso/remesas) se anunciarán según la demanda de la whitelist — apúntate e indícanos desde dónde nos escribes.",
    },
  ],

  footContact: "contacto",
  footApp: "app",
  footPassport: "pasaporte",
  footOnePager: "one-pager",
  footOnchain: "on-chain",
  footDisclaimer:
    "vigente protocol está en testnet. nada en esta página constituye asesoría financiera. los parámetros de LTV y tasa mostrados son ilustrativos y serán calibrados durante el piloto.",
};

export type LandingCopy = typeof es;

const en: LandingCopy = {
  navHow: "how it works",
  navWho: "who it's for",
  navTrust: "security",
  navFaq: "faq",
  navCta: "join the whitelist",

  heroCta: "join the whitelist",
  heroCta2: "view testnet contract",
  heroCta3: "check my payment capacity",
  heroFinePrint:
    "credit primitive live on stellar testnet · no native token · custody in verifiable contracts",
  heroVariants: [
    {
      title: "borrow against your assets, without selling them.",
      sub: "deposit USDC, XLM or tokenized treasuries as collateral and receive stablecoins instantly. every on-time repayment builds a reputation that raises your limit and lowers your rate.",
    },
    {
      title: "a good track record is worth more collateral.",
      sub: "a collateralized credit pool on stellar where reputation — on-chain and, with your consent, off-chain — increases how much you can borrow per dollar you deposit.",
    },
    {
      title: "liquidity today. your assets stay yours.",
      sub: "lock collateral, borrow stablecoins, and get everything back when you repay. without selling your position, without asking a bank for permission.",
    },
  ],

  demoTitle: "position simulator",
  demoCollateral: "collateral deposited",
  demoBorrow: "available to borrow",
  demoRate: "rate adjustment",
  demoNote:
    "illustrative parameters, subject to pilot calibration. your tier rises with on-time repayments and verified data you choose to connect.",
  tiers: [
    { label: "new", ltv: 0.5, rate: "base rate" },
    { label: "established", ltv: 0.65, rate: "−1.5 pt" },
    { label: "proven", ltv: 0.75, rate: "−3.0 pt" },
  ],

  strip1: "verifiable contracts · live testnet",
  strip2: "pool: composes on blend (audited)",
  strip3: "prices: redstone oracle",
  strip4: "stellar · soroban",

  howTitle: "how it works",
  howSub: "three steps. your collateral lives in a verifiable contract, not inside a company.",
  steps: [
    {
      num: "01",
      title: "deposit collateral",
      body: "USDC, XLM or tokenized real-world assets (e.g. treasuries). it's locked in a public stellar contract anyone can audit.",
    },
    {
      num: "02",
      title: "borrow stablecoins",
      body: "receive liquidity instantly, up to the limit set by your LTV. repay at your own pace and reclaim your collateral when you close the position.",
    },
    {
      num: "03",
      title: "your reputation improves your terms",
      body: "on-time repayments — and, if you authorize it, verified income or remittance data — raise your LTV and lower your rate over time.",
    },
  ],

  diffTitle: "not a generic CDP",
  diffColCdp: "typical CDP",
  diffBody1:
    "in a standard lending protocol everyone gets the same deal: same LTV, same rate, no matter how many times you've repaid well. your track record is worth nothing.",
  diffBody2:
    "vigente adds a reputation layer on top of the pool: your behavior — verifiable on-chain, enrichable with off-chain data you consent to — translates directly into more borrowing power per unit of collateral and a better rate.",
  diffRows: [
    { label: "LTV", cdp: "fixed, same for all", vig: "dynamic, reputation-based" },
    { label: "rate", cdp: "utilization only", vig: "improves with history" },
    { label: "your history", cdp: "doesn't count", vig: "is the core asset" },
    { label: "off-chain data", cdp: "not a thing", vig: "optional, consented" },
  ],

  whoTitle: "who it's for",
  segments: [
    {
      tag: "day 1",
      title: "you hold assets and need liquidity",
      body: "crypto or yield-bearing RWA holders who don't want to sell their position to cover an expense. deposit, borrow, repay, reclaim. your position stays intact.",
    },
    {
      tag: "bridge segment",
      title: "you have verifiable income",
      body: "if you receive or send remittances, or have verifiable income, you can connect it — with your consent — to pre-qualify your reputation and start with better terms from your first loan.",
    },
  ],

  ppTag: "financial passport",
  ppTitle: "check your payment capacity — no assets, no cost",
  ppSub: "anyone can generate their initial credit score today. answer four questions, save your passport, and when you deposit collateral you start with pre-qualified reputation instead of from zero.",
  ppIncome: "monthly income (USD)",
  ppRemit: "monthly remittances received (USD)",
  ppExpenses: "fixed monthly expenses (USD)",
  ppHistory: "have you repaid credit before?",
  ppHistoryOpts: [
    { v: "none", label: "never borrowed before" },
    { v: "always", label: "yes, always on time" },
    { v: "sometimes", label: "yes, with some delays" },
    { v: "late", label: "yes, with frequent delays" },
  ],
  ppCalc: "calculate my score",
  ppError: "enter at least one income or remittance greater than zero.",
  ppPrivacy: "the calculation happens in your browser. nothing is sent or published on-chain.",
  ppEmpty: "fill in the form and calculate your initial score. no wallet or assets needed.",
  ppScoreLabel: "initial credit score",
  ppTierLabel: "reputation tier",
  ppLtvLabel: "estimated LTV on deposit",
  ppNote:
    "this score is a local estimate. it becomes verified reputation when you connect data and repay on-chain. no assets yet? save your passport: when you deposit collateral later, you unlock your loan with these pre-qualified terms.",
  ppDownload: "download my passport",
  ppNext: "reserve a whitelist spot",
  ppBadgePreview: "preview",
  ppBadgeVerified: "wallet read on-chain",
  ppLockTag: "verify with your wallet",
  ppLockBody:
    "paste your stellar address and we read your state from the live reputation contract (get_score / is_defaulted — permissionless read, no signature). if you already hold a badge, your on-chain score appears next to the estimate.",
  ppWalletError: "invalid address. a stellar address starts with G and has 56 characters.",
  ppReadError: "we couldn't read the contract right now. try again in a few seconds.",
  ppVerify: "read my wallet on-chain",
  ppVerifying: "reading the contract…",
  ppVerifiedTag: "read from the live contract",
  ppOnchainScore: "on-chain score (badge)",
  ppOnchainNone: "no badge yet — issued during the pilot",
  ppTiers: ["new", "established", "proven"],
  ppFile: {
    title: "VIGENTE PROTOCOL — FINANCIAL PASSPORT (initial estimate)",
    date: "Date",
    score: "Initial score",
    tier: "Tier",
    ltv: "Estimated LTV on collateral deposit",
    income: "Monthly income",
    remit: "Monthly remittances",
    expenses: "Fixed expenses",
    history: "Declared history",
    onchain: "On-chain score (badge)",
    onchainNone: "no badge",
    note: "Estimate generated locally in the browser. Not a credit offer. Becomes verified reputation once data is connected and repayments happen on-chain. Parameters subject to pilot calibration.",
  },

  trustTitle: "built on proven infrastructure",
  trustSub: "we don't reinvent the lending pool: we compose over audited, verifiable pieces and add the reputation layer.",
  trustCards: [
    {
      name: "blend",
      body: "the lending-pool infrastructure, audited and in production on stellar. the pilot pool composes on top of it (orbit pattern) instead of rewriting it.",
    },
    {
      name: "redstone",
      body: "price oracle for collateral. the prices that trigger liquidations don't depend on a single party.",
    },
    {
      name: "stellar · soroban",
      body: "settlement in seconds with sub-cent fees. smart contracts on soroban.",
    },
    {
      name: "verifiable contracts",
      body: "every line of code that custodies your reputation and collateral is public and verifiable in the explorer. nothing opaque in the trust path.",
    },
    {
      name: "live primitive",
      body: "the credit primitive already runs on stellar testnet: 3-of-5 threshold oracle, reputation badge and reference vault. you can read it below, right now.",
    },
    {
      name: "no native token",
      body: "no governance token, no inflated emissions. the model sustains itself on credit fees, not speculation.",
    },
  ],
  liveTitle: "live on-chain",
  liveReading: "reading…",
  liveRead: "read from the contract just now",
  liveThreshold: "threshold",
  liveThresholdSub: "ed25519 quorum",
  liveKeys: "oracle keys",
  liveKeysSub: "independent signers",
  liveAge: "wallet age floor",
  liveAgeSub: "anti-sybil gate",
  liveContract: "contract",
  liveContractSub: "testnet · soroban",

  wlTitle: "join the pilot whitelist",
  wlSub: "limited spots for the first pool. we'll notify you when your access is ready — and if you connect your data, you start with pre-qualified reputation.",
  wlPlaceholder: "you@email.com",
  wlCheckbox:
    "i want to pre-qualify my reputation by connecting income or remittance data (optional, consented, revocable).",
  wlButton: "reserve my spot",
  wlError: "please enter a valid email.",
  wlPrivacy: "no spam. pilot updates only. we never publish your data on-chain.",
  wlSuccessTitle: "done — you're on the list.",
  wlSuccessBody: "to secure your spot while we wire up the registry, send us your email with one click:",
  wlSuccessMail: "confirm my spot by email",
  wlSuccessData: "you checked reputation pre-qualification: we'll contact you first to connect your data.",

  visionTag: "the vision",
  visionTitle: "less collateral over time",
  visionBody1:
    "today, every loan is backed by collateral. but every on-time repayment is evidence — and accumulated evidence should be worth something.",
  visionBody2:
    "the destination is a glide-path: as your reputation consolidates, the required collateral goes down. fair credit for anyone who builds a track record, even if no bank knows them. that's the goal — not a day-1 promise.",
  glidePath: [
    {
      phase: "today",
      title: "over-collateralized",
      body: "loans backed 100%+ by collateral. reputation adjusts LTV and rate.",
      color: "#8BE9B0",
      border: "#8BE9B0",
    },
    {
      phase: "next",
      title: "reduced collateral",
      body: "proven history unlocks progressively lower collateral ratios.",
      color: "#9AA3A0",
      border: "#2A2F35",
    },
    {
      phase: "destination",
      title: "reputation-based credit",
      body: "access to fair credit based on verifiable history, on-chain and off-chain.",
      color: "#6B7370",
      border: "#1C2126",
    },
  ],

  flowTitle: "getting started",
  flowSub: "from whitelist to your first loan, in six steps.",
  flow: [
    { num: "01", title: "whitelist", body: "leave your email and reserve your pilot spot.", optional: false },
    { num: "02", title: "stellar wallet", body: "create or connect your wallet (e.g. freighter).", optional: false },
    { num: "03", title: "deposit collateral", body: "USDC, XLM or RWA are locked in the contract.", optional: false },
    { num: "04", title: "connect data", body: "income or remittances to pre-qualify your reputation.", optional: true },
    { num: "05", title: "borrow", body: "receive stablecoins up to your LTV limit.", optional: false },
    { num: "06", title: "repay and climb", body: "every on-time repayment improves your terms.", optional: false },
  ],
  flowOptional: " · optional",

  netTag: "THE REPUTATION NETWORK",
  netTitle: "every repayment is a block. every block is reputation.",
  netSub: "vigente turns financial behavior into a verifiable asset on stellar. no intermediaries with opinions — only on-chain evidence, cryptographically provable.",
  netStats: [
    { value: "~5s", label: "settlement on stellar" },
    { value: "<$0.01", label: "cost per transaction" },
    { value: "100%", label: "verifiable contracts" },
  ],

  roadmapTitle: "roadmap",
  roadmap: [
    {
      phase: "phase 1",
      status: "done",
      title: "credit primitive on testnet",
      body: "3-of-5 threshold oracle, soulbound reputation badge and credit-gated reference vault. contract verifiable in the explorer.",
      accent: "#8BE9B0",
    },
    {
      phase: "phase 2",
      status: "in progress",
      title: "collateralized pool + whitelist",
      body: "credit pool composed on blend with the redstone oracle, reputation→LTV layer and whitelisted pilot (~50 users).",
      accent: "#E9C98B",
    },
    {
      phase: "phase 3",
      status: "next",
      title: "capped mainnet",
      body: "capped, whitelisted launch of the first pool on mainnet + verified income/remittance data connections.",
      accent: "#9AA3A0",
    },
    {
      phase: "phase 4",
      status: "vision",
      title: "glide-path",
      body: "progressive reduction of required collateral for consolidated reputations.",
      accent: "#6B7370",
    },
  ],

  faqTitle: "frequently asked questions",
  faqs: [
    {
      q: "is it safe?",
      a: "the pool is being built on blend, audited infrastructure in production on stellar, with prices from the redstone oracle. all contracts are public and verifiable. honestly stated: the MVP is on testnet today, every collateralized loan carries risk (volatility, smart contracts), and you should never deposit more than you can afford to lock.",
    },
    {
      q: "what collateral do you accept?",
      a: "at pilot launch: USDC, XLM and tokenized real-world assets such as US treasuries. the exact list is confirmed before mainnet launch.",
    },
    {
      q: "what if my collateral's price drops?",
      a: "your position has a health factor visible at all times. if the price falls and you approach the limit, you can add collateral or repay part of the loan. if the health factor drops below the threshold, the pool's liquidation mechanics cover the debt by selling part of the collateral — you never owe more than you deposited.",
    },
    {
      q: "how does my reputation improve?",
      a: "automatically, with every on-time repayment recorded on-chain. optionally, you can connect verified income or remittance data — always with your explicit, revocable consent, and never published on-chain. better reputation = higher LTV and better rate; over time, less collateral required.",
    },
    {
      q: "which countries is it available in?",
      a: "the protocol is global by design: you only need a stellar wallet. pilot corridors (with income/remittance data integration) will be announced based on whitelist demand — sign up and tell us where you're writing from.",
    },
  ],

  footContact: "contact",
  footApp: "app",
  footPassport: "passport",
  footOnePager: "one-pager",
  footOnchain: "on-chain",
  footDisclaimer:
    "vigente protocol is on testnet. nothing on this page is financial advice. LTV and rate parameters shown are illustrative and will be calibrated during the pilot.",
};

export const COPY: Record<Lang, LandingCopy> = { es, en };
