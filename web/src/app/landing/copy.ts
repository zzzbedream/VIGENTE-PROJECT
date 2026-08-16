/**
 * Landing copy — bilingual ES/EN, pivot "reputation-powered collateralized
 * credit" (2026-07). Spanish is canonical (pilot corridor is LATAM); English
 * mirrors it. No unconfirmed partner names in public copy — infrastructure we
 * compose on (Blend, Reflector, Stellar) is named; data/RWA/wallet targets are
 * generic until an LOI is signed (see docs/private/partner-roster.md).
 *
 * Audience (2026-08): the buyer is a PLATFORM (wallet, fintech, RWA issuer)
 * integrating credit for its users — not the borrower directly. Hero, segments
 * and the primary CTA speak to integrators; the passport calculator and the
 * whitelist stay, explicitly labeled as a demo of the end-user experience an
 * integrated platform would ship.
 *
 * Honesty rules baked in:
 *  - What is live today = threshold oracle + reputation badge + our SEP-40
 *    aggregator + our own isolated Blend pool (status 0) with the margin
 *    controller on top, all on testnet. Evidence: audit/08_POOL_ACTIVATION.md.
 *    The `reference-vault` is ARCHIVED — never present it as live.
 *  - Demo parameters are labeled as pilot-calibration estimates.
 *  - RedStone is NOT in the stack: they have sent nothing. The pool's immutable
 *    oracle slot holds OUR aggregator, which routes to Reflector. Copy claiming
 *    a "RedStone oracle" was false and was removed on 2026-08-16 — do not
 *    reintroduce it without a signed relationship and an on-chain route.
 *  - Roadmap phase 5 ("the wallet, on chain") is vision, deliberately undated.
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
  navCta: "hablemos de integrar",

  heroCta: "hablemos de integrar",
  heroCta2: "ver contrato en testnet",
  heroCta3: "probar la demo de usuario",
  heroFinePrint:
    "primitivo de crédito en vivo en testnet de stellar · sin token propio · custodia en contratos verificables",
  heroVariants: [
    {
      title: "infraestructura de crédito para tu plataforma.",
      sub: "tus usuarios tienen activos tokenizados y necesitan liquidez sin venderlos. vigente pone el límite de préstamo de cada uno según su historial on-chain, sobre contratos que cualquiera puede auditar. tú no construyes un motor de crédito: lo integras.",
    },
    {
      title: "el mismo colateral no vale lo mismo para todos.",
      sub: "sobrecolateralizar al 150% trata igual al que nunca falló y al que llega hoy. vigente lee la reputación on-chain del prestatario y ajusta su LTV — 85%, 75% o 60% — sin que el mercado de préstamos tenga que enterarse del score.",
    },
    {
      title: "reputación de crédito, legible por cualquier contrato.",
      sub: "un badge soulbound emitido con umbral 3-de-5 verificado en cadena. tu plataforma lo lee sin pedir permiso, sin registrarse y sin token. los impagos quedan grabados de forma inmutable.",
    },
  ] as HeroVariant[],

  demoTitle: "simulador de posición",
  demoCollateral: "colateral depositado",
  demoBorrow: "préstamo disponible",
  demoRate: "ajuste de tasa",
  demoNote:
    "los LTV y los cortes de score son los que hoy devuelve get_tier_ltv en el margin controller desplegado en testnet. el ajuste de tasa sí es ilustrativo: la tasa la fija la utilización del pool, y calibrarla es parte del piloto.",
  tiers: [
    { label: "nuevo · score ≥300", ltv: 0.6, rate: "tasa base" },
    { label: "establecido · ≥550", ltv: 0.75, rate: "−1.5 pt" },
    { label: "probado · ≥800", ltv: 0.85, rate: "−3.0 pt" },
  ] as TierDef[],

  strip1: "contratos verificables · testnet en vivo",
  strip2: "pool: compone sobre blend (auditado)",
  strip3: "precios: agregador sep-40 propio",
  strip4: "stellar · soroban",

  howTitle: "cómo funciona",
  howSub: "tres pasos para el usuario de tu plataforma. el colateral vive en un contrato verificable, no en tu balance ni en el nuestro.",
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
      tag: "integrador · foco principal",
      title: "plataformas con usuarios que ya tienen activos",
      body: "wallets, fintechs y plataformas de RWA cuyos usuarios necesitan liquidez sin vender. tú tienes la relación con el usuario y el KYC; nosotros ponemos el motor de crédito, el límite por reputación y la custodia en contratos auditables. no hay token que adoptar ni permiso que pedir.",
    },
    {
      tag: "protocolo",
      title: "mercados de préstamo que quieren precio por riesgo",
      body: "cualquier contrato en soroban puede leer el badge de reputación y el LTV asociado, y usarlos para diferenciar condiciones. nuestro agregador sep-40 — el mismo que ocupa el slot de oráculo de nuestro pool — se publica como referencia abierta para la red.",
    },
    {
      tag: "usuario final",
      title: "quien pide el préstamo dentro de esa plataforma",
      body: "deposita colateral, recibe stablecoins y recupera todo al repagar. cada repago puntual sube su límite y baja su tasa. las secciones de abajo son una demo de esa experiencia — la que verían los usuarios de una plataforma integrada.",
    },
  ],

  ppTag: "demo · experiencia del usuario final",
  ppTitle: "así se ve la evaluación de crédito para tu usuario",
  ppSub: "esta es la misma evaluación que correría dentro de una plataforma integrada, abierta acá para que la pruebes tú. responde cuatro preguntas y obtén un puntaje inicial; si conectas una wallet, además leemos tu reputación real desde el contrato en vivo.",
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
  ppCapacityTitle: "conoce tu capacidad de pago on-chain",
  ppGlidepath:
    "hoy: lees tu reputación on-chain. pronto: esa reputación mejora las condiciones de tu crédito colateralizado.",
  ppLockBody:
    "conecta tu wallet o pega tu dirección de stellar y leemos tu estado en el contrato de reputación en vivo (get_score / is_defaulted — lectura permissionless, sin firma). si ya tienes badge, tu puntaje on-chain aparece junto a la estimación.",
  ppConnect: "conectar wallet",
  ppConnecting: "conectando…",
  ppConnectedAs: "conectado como {addr}",
  ppDisconnect: "desconectar",
  ppOnchainHint: "¿solo quieres leer tu badge on-chain?",
  ppFullPassport: "pasaporte crediticio completo",
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
      name: "agregador sep-40 propio",
      body: "el slot de oráculo de nuestro pool es inmutable y lo ocupa nuestro agregador, que hoy rutea a reflector y admite añadir más fuentes sin redesplegar el pool. incluye guarda de desviación contra saltos de precio anómalos.",
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
      body: "ya corre en testnet de stellar: oráculo de umbral 3-de-5, badge de reputación, nuestro propio feed de precio sep-40 y un pool de préstamo aislado montado encima. puedes leerlo abajo, ahora.",
    },
    {
      name: "sin token propio",
      body: "sin token de gobernanza, sin emisiones infladas. el plan es vivir del crédito y no de la especulación — el módulo de comisiones es roadmap, todavía no está construido.",
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

  wlTitle: "integra vigente o entra al piloto",
  wlSub: "si construyes una plataforma y quieres ofrecer crédito a tus usuarios, escríbenos: el piloto en mainnet parte capado y con pocos integradores. si eres usuario final, deja tu correo y te avisamos cuando haya cupo en el primer pool.",
  wlPlaceholder: "tu@correo.com",
  wlCheckbox:
    "quiero pre-calificar mi reputación conectando datos de ingreso o remesas (opcional, con consentimiento, revocable).",
  wlButton: "reservar mi lugar",
  wlSubmitting: "reservando…",
  wlError: "escribe un correo válido.",
  wlPrivacy: "sin spam. solo avisos del piloto. nunca publicamos tus datos on-chain.",
  wlSuccessTitle: "listo — estás en la lista.",
  wlSuccessBody: "registramos tu interés. si quieres reforzar el contacto, también puedes enviarnos tu correo con un clic:",
  wlSuccessMail: "enviar respaldo por correo",
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
  roadmapHere: "estamos aquí",
  roadmap: [
    {
      phase: "fase 1",
      status: "completado",
      here: false,
      title: "primitivo de crédito en testnet",
      body: "oráculo de umbral 3-de-5, badge de reputación soulbound y nuestro propio feed de precio sep-40. cada contrato verificable en el explorador.",
      accent: "#8BE9B0",
    },
    {
      phase: "fase 2",
      status: "completado",
      here: true,
      title: "pool colateralizado activo",
      body: "nuestro propio pool aislado sobre blend, con nuestro agregador sep-40 en el slot de oráculo — inmutable — ruteando a reflector. ciclo completo verificado en cadena: depósito, préstamo, repago y retiro, más la custodia probada bajo pausa adversarial. evidencia en audit/08.",
      accent: "#8BE9B0",
    },
    {
      phase: "fase 3",
      status: "siguiente",
      here: false,
      title: "endurecimiento + activos tokenizados + rampa",
      body: "liquidación proporcional, cap de exposición por usuario y fees on-chain; primer activo de renta fija tokenizado como colateral; rampa fiat conectada extremo a extremo.",
      accent: "#E9C98B",
    },
    {
      phase: "fase 4",
      status: "después",
      here: false,
      title: "mainnet capado + sdk público",
      body: "lanzamiento capado y whitelisted en mainnet bajo multifirma y timelock, con sdk e integración documentada para terceros.",
      accent: "#9AA3A0",
    },
    {
      phase: "fase 5",
      status: "visión · sin fecha",
      here: false,
      title: "la wallet, on chain",
      body: "que el usuario opere su crédito desde su propia wallet, sin intermediario custodio, con glide-path: menos colateral exigido a medida que la reputación se consolida. es la dirección del producto, no un compromiso con fecha.",
      accent: "#6B7370",
    },
  ],

  faqTitle: "preguntas frecuentes",
  faqs: [
    {
      q: "¿es seguro?",
      a: "el pool se compone sobre blend, infraestructura auditada y en producción en stellar, y los precios llegan por nuestro agregador sep-40 que rutea a reflector. todos los contratos son públicos y verificables. dicho con honestidad: hoy el MVP está en testnet, todo préstamo colateralizado tiene riesgos (volatilidad, contratos), y nunca deposites más de lo que puedes permitirte bloquear.",
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
  navCta: "let's talk integration",

  heroCta: "let's talk integration",
  heroCta2: "view testnet contract",
  heroCta3: "try the end-user demo",
  heroFinePrint:
    "credit primitive live on stellar testnet · no native token · custody in verifiable contracts",
  heroVariants: [
    {
      title: "credit infrastructure for your platform.",
      sub: "your users hold tokenized assets and need liquidity without selling them. vigente prices each borrower's limit from their on-chain history, on contracts anyone can audit. you don't build a credit engine — you integrate one.",
    },
    {
      title: "the same collateral isn't worth the same for everyone.",
      sub: "flat 150% over-collateralization treats a borrower who never defaulted like one who showed up today. vigente reads on-chain reputation and sets the LTV — 85%, 75% or 60% — without the lending market ever seeing the score.",
    },
    {
      title: "credit reputation any contract can read.",
      sub: "a soulbound badge issued under a 3-of-5 threshold verified on-chain. your platform reads it without permission, without registration and without a token. defaults are recorded immutably.",
    },
  ],

  demoTitle: "position simulator",
  demoCollateral: "collateral deposited",
  demoBorrow: "available to borrow",
  demoRate: "rate adjustment",
  demoNote:
    "the LTVs and score cutoffs are what get_tier_ltv returns today on the margin controller deployed to testnet. the rate adjustment is illustrative: the rate comes from pool utilization, and calibrating it is part of the pilot.",
  tiers: [
    { label: "new · score ≥300", ltv: 0.6, rate: "base rate" },
    { label: "established · ≥550", ltv: 0.75, rate: "−1.5 pt" },
    { label: "proven · ≥800", ltv: 0.85, rate: "−3.0 pt" },
  ],

  strip1: "verifiable contracts · live testnet",
  strip2: "pool: composes on blend (audited)",
  strip3: "prices: our own sep-40 aggregator",
  strip4: "stellar · soroban",

  howTitle: "how it works",
  howSub: "three steps for your platform's user. collateral lives in a verifiable contract — not on your balance sheet, and not on ours.",
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
      tag: "integrator · primary focus",
      title: "platforms whose users already hold assets",
      body: "wallets, fintechs and RWA platforms whose users need liquidity without selling. you own the user relationship and the KYC; we provide the credit engine, the reputation-priced limit and custody in auditable contracts. no token to adopt, no permission to ask for.",
    },
    {
      tag: "protocol",
      title: "lending markets that want risk-priced terms",
      body: "any soroban contract can read the reputation badge and its associated LTV, and use them to differentiate terms. our sep-40 aggregator — the same one occupying our pool's oracle slot — is published as an open reference for the network.",
    },
    {
      tag: "end user",
      title: "whoever borrows inside that platform",
      body: "deposit collateral, receive stablecoins, reclaim everything on repayment. every on-time repayment raises the limit and lowers the rate. the sections below are a demo of that experience — what users of an integrated platform would see.",
    },
  ],

  ppTag: "demo · end-user experience",
  ppTitle: "this is what credit assessment looks like for your user",
  ppSub: "this is the same assessment that would run inside an integrated platform, opened up here so you can try it yourself. answer four questions for an initial score; connect a wallet and we also read your real reputation from the live contract.",
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
  ppCapacityTitle: "know your on-chain payment capacity",
  ppGlidepath:
    "today: read your on-chain reputation. soon: it improves your collateralized credit terms.",
  ppLockBody:
    "connect your wallet or paste your stellar address and we read your state from the live reputation contract (get_score / is_defaulted — permissionless read, no signature). if you already hold a badge, your on-chain score appears next to the estimate.",
  ppConnect: "connect wallet",
  ppConnecting: "connecting…",
  ppConnectedAs: "connected as {addr}",
  ppDisconnect: "disconnect",
  ppOnchainHint: "just want to read your on-chain badge?",
  ppFullPassport: "full credit passport",
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
      name: "our own sep-40 aggregator",
      body: "our pool's oracle slot is immutable and holds our aggregator, which today routes to reflector and can take on more sources without redeploying the pool. includes a deviation guard against anomalous price jumps.",
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
      body: "it already runs on stellar testnet: 3-of-5 threshold oracle, reputation badge, our own sep-40 price feed and an isolated lending pool built on it. you can read it below, right now.",
    },
    {
      name: "no native token",
      body: "no governance token, no inflated emissions. the plan is to earn from credit, not from speculation — the fee module is roadmap, not shipped.",
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

  wlTitle: "integrate vigente or join the pilot",
  wlSub: "if you're building a platform and want to offer credit to your users, get in touch: the mainnet pilot starts capped and with few integrators. if you're an end user, leave your email and we'll tell you when there's room in the first pool.",
  wlPlaceholder: "you@email.com",
  wlCheckbox:
    "i want to pre-qualify my reputation by connecting income or remittance data (optional, consented, revocable).",
  wlButton: "reserve my spot",
  wlSubmitting: "reserving…",
  wlError: "please enter a valid email.",
  wlPrivacy: "no spam. pilot updates only. we never publish your data on-chain.",
  wlSuccessTitle: "done — you're on the list.",
  wlSuccessBody: "we registered your interest. if you want a manual backup, you can also send us your email with one click:",
  wlSuccessMail: "send email backup",
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
  roadmapHere: "we are here",
  roadmap: [
    {
      phase: "phase 1",
      status: "done",
      here: false,
      title: "credit primitive on testnet",
      body: "3-of-5 threshold oracle, soulbound reputation badge and our own sep-40 price feed. every contract verifiable in the explorer.",
      accent: "#8BE9B0",
    },
    {
      phase: "phase 2",
      status: "done",
      here: true,
      title: "collateralized pool live",
      body: "our own isolated pool on blend, with our sep-40 aggregator in the oracle slot — immutable — routing to reflector. full cycle verified on-chain: deposit, borrow, repay and withdraw, plus custody proven under an adversarial pause. evidence in audit/08.",
      accent: "#8BE9B0",
    },
    {
      phase: "phase 3",
      status: "next",
      here: false,
      title: "hardening + tokenized assets + ramp",
      body: "proportional liquidation, per-user exposure cap and on-chain fees; first tokenized fixed-income asset as collateral; fiat ramp connected end to end.",
      accent: "#E9C98B",
    },
    {
      phase: "phase 4",
      status: "after that",
      here: false,
      title: "capped mainnet + public sdk",
      body: "capped, whitelisted mainnet launch under multisig and timelock, with an sdk and integration docs for third parties.",
      accent: "#9AA3A0",
    },
    {
      phase: "phase 5",
      status: "vision · no date",
      here: false,
      title: "the wallet, on chain",
      body: "users operating their own credit from their own wallet, with no custodial intermediary, on a glide-path: less collateral required as reputation consolidates. this is the product direction, not a dated commitment.",
      accent: "#6B7370",
    },
  ],

  faqTitle: "frequently asked questions",
  faqs: [
    {
      q: "is it safe?",
      a: "the pool composes on blend, audited infrastructure in production on stellar, and prices arrive through our own sep-40 aggregator routing to reflector. all contracts are public and verifiable. honestly stated: the MVP is on testnet today, every collateralized loan carries risk (volatility, smart contracts), and you should never deposit more than you can afford to lock.",
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
