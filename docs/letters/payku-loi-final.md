# Carta de Intención Técnica · Letter of Technical Intent

**Payku SpA × Vigente Protocol**

> **Nota para el SCF (2026-05-31):** Esta carta describe una exploración técnica no vinculante. **Vigente Protocol NO depende de Payku para operar.** El motor de scoring sintético (`web/src/services/horizon-scoring.ts`) calcula tier crediticio leyendo únicamente la cadena Stellar vía Horizon, sin ninguna integración fintech requerida. Payku queda preservado en el código como adapter opcional de enriquecimiento — útil cuando exista relación comercial, prescindible cuando no. La firma de esta LOI no es un bloqueante para la submission ni un pre-requisito para que el protocolo funcione contra usuarios reales.
>
> *Note for SCF (2026-05-31):* This letter describes a non-binding technical exploration. **Vigente Protocol does NOT depend on Payku to operate.** The synthetic scoring engine reads only Stellar via Horizon. Payku is preserved as an optional enrichment adapter. This LOI is not a blocker for the submission.

---

## Versión en Español (para firma)

Santiago, Chile — [Fecha: ____________]

A quien corresponda en **Payku SpA** y a la **Stellar Development Foundation**:

Por medio de la presente, **Payku SpA** (en adelante "Payku") y **Vigente Protocol** (en adelante "Vigente") declaran su intención mutua, expresada de buena fe, de **explorar una integración técnica en el ambiente Sandbox de Payku** durante los próximos sesenta (60) días corridos.

### Objeto

El objeto de esta carta es:

1. **Lectura técnica del historial transaccional** de comercios pre-autorizados por Payku, con el propósito de calcular un puntaje crediticio (Credit Badge) que se emite como token no transferible en la red Stellar Soroban.
2. **Ejecución de pruebas técnicas de dispersión de fondos** en ambiente Sandbox, utilizando exclusivamente montos ficticios provistos por Payku.
3. **Establecer las bases preliminares para evaluar**, en caso de éxito técnico, un futuro piloto comercial que genere nuevo volumen transaccional para la pasarela de pagos de Payku mediante la habilitación de micro-liquidez a sus comercios.

### Alcance técnico inicial

La integración consiste en que Vigente Protocol consuma los siguientes endpoints oficiales de la API REST de Payku:

- `GET /api/transaction` — Lectura del historial transaccional descrito en el punto 1 del Objeto.
- `POST /api/wallet/payout` — Pruebas técnicas de dispersión descritas en el punto 2 del Objeto.
- **Fase 2 (Exploración Comercial)**: De ser exitosa la prueba técnica en Sandbox, las partes manifiestan su intención de evaluar de mutuo acuerdo la viabilidad de un piloto cerrado en entorno de producción (Mainnet). Dicho piloto buscaría validar el modelo de negocio conjunto, y su ejecución quedará estrictamente sujeta a la posterior negociación y firma de un contrato de servicios definitivo entre las partes.

Ambas partes acuerdan que la Fase 1 (Sandbox) se realizará **únicamente con datos de prueba**, sin acceso a información de comercios reales, y sin movimientos de fondos en producción.

### Carácter explícitamente no vinculante

Esta carta es **un documento técnico de exploración**. **No genera obligaciones comerciales, legales, financieras ni de exclusividad** para ninguna de las partes. No constituye un contrato de servicios, ni acuerdo de prestación, ni compromiso de continuidad. Cualquiera de las partes puede dar por terminada la exploración en cualquier momento mediante simple aviso por correo electrónico, sin penalidad alguna.

### Propósito de validación ante terceros

El propósito principal de esta carta es **acreditar ante la Stellar Development Foundation (SDF) y otros fondos de financiamiento técnico** que Payku y Vigente mantienen conversaciones activas sobre una posible integración. Vigente Protocol está postulando al **Stellar Community Fund — Build Award** para financiar las horas de ingeniería necesarias para construir esta integración. El programa SCF requiere evidencia documentada de viabilidad técnica con los partners de integración mencionados en la propuesta.

### Confidencialidad

Ambas partes acuerdan no divulgar credenciales, claves API, ni datos de comercios reales que pudieran intercambiarse durante la exploración técnica. Cualquier reporte técnico generado será compartido con el equipo de Payku antes de cualquier publicación.

### Vigencia

Esta carta tiene una vigencia de **sesenta (60) días corridos** desde la fecha de firma. Vencido este plazo sin renovación expresa, el documento queda automáticamente sin efecto.

---

### Firmas

**Por Payku SpA**

| Campo | Información |
|---|---|
| Nombre del representante | _________________________________ |
| Cargo | _________________________________ |
| RUT | _________________________________ |
| Email | _________________________________ |
| Firma | _________________________________ |
| Fecha | _________________________________ |

**Por Vigente Protocol**

| Campo | Información |
|---|---|
| Nombre del representante | Lucas Cifuentes Buigley    |
| Cargo | Founder / Tech Lead |
| RUT | [20.2444.452-0] |
| Email | [lcifuentes@usm.cl] |
| Firma | _________________________________ |
| Fecha | _________________________________ |

---

## English Summary (for Stellar Community Fund submission)

This document constitutes a **non-binding Letter of Technical Intent** between **Payku SpA** (Chilean payment processor) and **Vigente Protocol** (Stellar-based credit reputation infrastructure).

Both parties hereby express their mutual intent to **explore a technical integration** in Payku's Sandbox environment, specifically consuming the `GET /api/transaction` (read transactional history) and `POST /api/wallet/payout` (test fund dispersal) endpoints of Payku's REST API, for the development and validation of Vigente Protocol's credit-scoring product on the Stellar Soroban network.

**Scope of this letter:**

1. Technical reading of transactional history of Payku-authorized merchants, to calculate a credit score (Credit Badge) issued as a non-transferable token on Stellar Soroban.
2. Technical fund dispersal tests in the Sandbox environment using fictitious amounts provided by Payku.
3. **Preliminary basis to evaluate**, upon successful technical validation, a future **commercial pilot** that would generate new transactional volume for Payku's payment gateway through micro-liquidity enablement to its merchants.

**Phase 2 — Commercial exploration (Mainnet pilot):** If the Sandbox technical phase succeeds, the parties express their intent to mutually evaluate the viability of a **closed pilot in production (Mainnet)** to validate the joint business model. Execution of such pilot is strictly conditional upon further negotiation and the signing of a definitive service agreement between the parties.

**Key clarifications for SCF reviewers:**
- This document is explicitly **non-binding**. It does not create any commercial, legal, financial, or exclusivity obligations.
- It is intended as **evidence of active technical discussions and joint commercial exploration intent** between Payku and Vigente, to support Vigente's application to the Stellar Community Fund Build Award.
- Phase 1 (Sandbox) is limited to test data (no real merchant information, no production fund movements).
- Phase 2 (Mainnet pilot) is conditional, non-binding, and subject to a future commercial contract.
- The exploration period is **60 calendar days** from the signature date for Phase 1.
- Either party may terminate the exploration at any time by email notification, without penalty.

This document does **not** constitute a service agreement, exclusivity arrangement, or commercial contract. It is the standard format used to demonstrate technical integration feasibility and pre-commercial alignment for grant applications.

---

**Contact for verification (Stellar Community Fund reviewers may verify with Payku directly):**

- Payku SpA: [insertar email de contacto Payku]
- Vigente Protocol: [tu email]
- Stellar Testnet Contract ID: `CATE7NUICQNBSUKF3RMA2HQAJK2RWCHCYH4NCPTQDLFNWNUNSFTTUH4W`

---

*Documento de una página. No vinculante. Documento técnico de exploración con propósito de validación ante Stellar Community Fund.*
