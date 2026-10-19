/**
 * Vigente Protocol — End-to-End contra testnet (Fase C del piloto)
 *
 * Que es y que NO es:
 *   - Es el unico camino que ESCRIBE transacciones reales de deposito, prestamo,
 *     repago y liquidacion. Hasta ahora eso solo existia como comandos CLI sueltos
 *     en audit/07, audit/08 y docs/DEMO_INTERNAL_RUNBOOK.md.
 *   - NO es un test unitario. Si falla, falla contra la red, y eso es el resultado.
 *
 * Principio: un error exacto vale tanto como un exito. Nada se traga, nada se
 * resume. Cada invocacion va al transcript con su comando, su stdout y su stderr
 * literales.
 *
 * Las escrituras se hacen con el CLI de stellar, que ya tiene el keystore. Asi
 * ningun secreto pasa por este proceso ni por el repo. La unica excepcion es el
 * minteo del badge, que necesita firmas de oraculo y la mother account.
 *
 * Uso:
 *   cd web && npx tsx scripts/e2e-testnet.ts <paso>
 *   pasos: state | t01 | t02 | t03 | t04 | t05 | t06 | t07 | t08 | t09 | t13 | all
 *
 * Salida: docs/private/pilot/e2e-transcript.log  (carpeta en .gitignore)
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(REPO, "docs", "private", "pilot");
const TRANSCRIPT = path.join(OUT_DIR, "e2e-transcript.log");
const STATE_FILE = path.join(OUT_DIR, ".e2e-state.json");

// --------------------------------------------------------------------------
// Direcciones. Verificadas on-chain el 2026-10-18, ver 00_STATE.md.
// --------------------------------------------------------------------------
const NETWORK = "testnet";
const CTRL = "CAH2BHAEBYUCVQ4UQGNZKCLDD2KLP7GY3F2PWMNMXOZ7S54WLHG3C75W";
const BADGE = "CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD";
const POOL = "CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI";
const XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const USDC = "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU";

/** Admin del controller y del pool. El del badge es la mother account (.env.local). */
const ADMIN = "admin-v2";
/** Cuenta sin privilegios, solo para lecturas simuladas. */
const READER = "dev";

/** Constantes del contrato, para la aritmetica escrita de T08. */
const CLOSE_FACTOR_BPS = 5_000;
const LIQUIDATION_PENALTY_BPS = 800;
const PROTOCOL_PENALTY_SHARE_BPS = 2_000;
const STROOP = 10_000_000; // 7 decimales

interface Actor {
  key: string;
  addr: string;
  score: number | null;
  tierBps: number;
}

/** Se completa en runtime con `stellar keys address`. */
const ACTORS: Record<string, Actor> = {
  gold: { key: "vigente-gold", addr: "", score: 850, tierBps: 8500 },
  silver: { key: "vigente-silver", addr: "", score: 650, tierBps: 7500 },
  bronze: { key: "vigente-borrower", addr: "", score: 400, tierBps: 6000 },
};

// --------------------------------------------------------------------------
// Transcript
// --------------------------------------------------------------------------

fs.mkdirSync(OUT_DIR, { recursive: true });

function log(line: string): void {
  fs.appendFileSync(TRANSCRIPT, line + "\n");
  console.log(line);
}

function banner(title: string): void {
  const stamp = new Date().toISOString();
  log("");
  log("=".repeat(78));
  log(`${stamp}  ${title}`);
  log("=".repeat(78));
}

interface ShResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Corre el CLI de stellar y deja constancia literal. No lanza excepcion: el
 * fallo es un resultado, y hay tests cuyo exito ES el fallo (T04, T05).
 */
function stellar(args: string[]): ShResult {
  const printable = `stellar ${args.join(" ")}`;
  log(`\n$ ${printable}`);
  const r = spawnSync("stellar", args, {
    encoding: "utf8",
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = (r.stdout || "").trim();
  const stderr = (r.stderr || "").trim();
  const code = r.status ?? -1;
  if (stdout) log(stdout);
  if (stderr) log(`[stderr] ${stderr}`);
  log(`[exit ${code}]`);
  return { ok: code === 0, code, stdout, stderr };
}

/** Lectura simulada: no firma, no envia, no gasta. */
function read(contract: string, fn: string, args: string[] = []): ShResult {
  return stellar([
    "contract", "invoke",
    "--id", contract,
    "--source-account", READER,
    "--network", NETWORK,
    "--send=no",
    "--", fn, ...args,
  ]);
}

/** Escritura real. Firma con `source` del keystore del CLI. */
function write(contract: string, source: string, fn: string, args: string[] = []): ShResult {
  return stellar([
    "contract", "invoke",
    "--id", contract,
    "--source-account", source,
    "--network", NETWORK,
    "--", fn, ...args,
  ]);
}

function num(r: ShResult): bigint | null {
  if (!r.ok) return null;
  const m = r.stdout.trim().replace(/^"|"$/g, "");
  try {
    return BigInt(m);
  } catch {
    return null;
  }
}

function usdc(v: bigint | number): string {
  const n = typeof v === "bigint" ? Number(v) : v;
  return (n / STROOP).toFixed(7).replace(/0+$/, "").replace(/\.$/, "") + " USDC";
}

// --------------------------------------------------------------------------
// Estado entre pasos
// --------------------------------------------------------------------------

type State = Record<string, unknown>;

function loadState(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    return {};
  }
}

function saveState(patch: State): void {
  const s = { ...loadState(), ...patch };
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function resolveActors(): void {
  for (const a of Object.values(ACTORS)) {
    const r = spawnSync("stellar", ["keys", "address", a.key], { encoding: "utf8" });
    a.addr = (r.stdout || "").trim();
    if (!/^G[A-Z2-7]{55}$/.test(a.addr)) {
      throw new Error(`no pude resolver la direccion de ${a.key}: "${a.addr}"`);
    }
  }
}

// --------------------------------------------------------------------------
// Pasos
// --------------------------------------------------------------------------

/** Foto del estado. No escribe nada. */
function stepState(): void {
  banner("ESTADO — lectura previa, cero escrituras");
  read(POOL, "get_config");
  for (const [name, a] of Object.entries(ACTORS)) {
    log(`\n--- ${name} (${a.key}) ${a.addr} ---`);
    read(BADGE, "get_score", ["--borrower", a.addr]);
    read(CTRL, "get_collateral", ["--user", a.addr, "--asset", XLM]);
    read(CTRL, "get_debt", ["--user", a.addr]);
    read(CTRL, "max_borrow", ["--user", a.addr]);
    read(CTRL, "health", ["--user", a.addr]);
  }
  read(CTRL, "get_total_debt");
  read(POOL, "get_positions", ["--address", CTRL]);
}

/**
 * T01 — badge del tier bronze.
 * El minteo necesita 3 de 5 firmas de oraculo, asi que no pasa por el CLI:
 * se delega al camino que ya existe y esta probado.
 */
function stepT01(): void {
  banner("T01 — emitir badge bronze y leer score");
  const a = ACTORS.bronze;
  const before = read(BADGE, "get_score", ["--borrower", a.addr]);
  log(`[T01] score antes: ${before.stdout}`);

  log(
    `\n[T01] El minteo requiere firmas de oraculo (umbral 3 de 5) y la mother\n` +
    `      account, que no esta en el keystore del CLI sino en web/.env.local.\n` +
    `      OJO: scripts/mint-onchain.ts apunta al badge v2 (CCD7KNYI...), no al\n` +
    `      v3 activo (CDLLO7QE...). Hay que pasarle el contrato correcto.`,
  );
  log(`[T01] comando: npm run mint:onchain -- ${a.addr} ${a.score}`);
  log(`[T01] PENDIENTE de ejecucion manual verificada — ver informe.`);
}

/** T02 — depositar colateral. */
function stepT02(): void {
  banner("T02 — depositar colateral via controller");
  const a = ACTORS.bronze;
  const amount = String(100 * STROOP); // 100 XLM
  const before = num(read(CTRL, "get_collateral", ["--user", a.addr, "--asset", XLM]));
  const r = write(CTRL, a.key, "deposit_collateral", [
    "--user", a.addr, "--asset", XLM, "--amount", amount,
  ]);
  const after = num(read(CTRL, "get_collateral", ["--user", a.addr, "--asset", XLM]));
  log(`\n[T02] esperado: colateral +${amount}`);
  log(`[T02] obtenido: ${before} -> ${after}  (${r.ok ? "OK" : "FALLO"})`);
  saveState({ t02: { before: String(before), after: String(after), ok: r.ok } });
}

/** T03 — prestamo en cada tier. La prueba central de la tesis de reputacion. */
function stepT03(): void {
  banner("T03 — max_borrow por tier: mismo colateral, distinto score");
  const rows: string[] = [];
  for (const [name, a] of Object.entries(ACTORS)) {
    const col = num(read(CTRL, "get_collateral", ["--user", a.addr, "--asset", XLM]));
    const mb = num(read(CTRL, "max_borrow", ["--user", a.addr]));
    const ltv = num(read(CTRL, "ltv_bps_for", ["--user", a.addr]));
    rows.push(
      `${name.padEnd(8)} score=${String(a.score).padEnd(4)} ltv=${String(ltv).padEnd(5)} ` +
      `colateral=${col} max_borrow=${mb}`,
    );
  }
  log("");
  rows.forEach((r) => log(`[T03] ${r}`));
  log(
    `\n[T03] El control que importa: con colateral identico, la razon entre dos\n` +
    `      max_borrow debe ser exactamente la razon entre sus LTV. Si no lo es,\n` +
    `      el precio se movio entre lecturas o algo esta mal.`,
  );
}

/** T04 — pedir por encima del LTV del tier. El exito es que falle. */
function stepT04(): void {
  banner("T04 — borrow sobre el LTV del tier (DEBE fallar)");
  const a = ACTORS.bronze;
  const mb = num(read(CTRL, "max_borrow", ["--user", a.addr]));
  if (mb === null) {
    log("[T04] no pude leer max_borrow; no se puede construir el caso. NO PROBADO.");
    return;
  }
  const over = mb + 1n;
  log(`\n[T04] max_borrow=${mb}, pidiendo ${over} (justo 1 unidad por encima).`);
  const r = write(CTRL, a.key, "borrow", ["--user", a.addr, "--amount", String(over)]);
  log(`\n[T04] esperado: FALLO`);
  log(`[T04] obtenido: ${r.ok ? "EXITO — esto es un problema" : "FALLO (correcto)"}`);
  if (!r.ok) log(`[T04] error exacto: ${r.stderr.split("\n").slice(0, 6).join(" | ")}`);
}

/** T05 — tope por usuario. Requiere set_user_cap: init nunca lo escribe. */
function stepT05(): void {
  banner("T05 — superar el tope por usuario (DEBE fallar)");
  log(
    `\n[T05] Nota de diseño: UserCap NO lo escribe init. Por defecto es 0, que el\n` +
    `      contrato interpreta como SIN TOPE. La mitigacion de M-04 solo existe si\n` +
    `      alguien corre set_user_cap despues de cada despliegue.`,
  );
  const a = ACTORS.bronze;
  const current = read(CTRL, "get_user_cap", ["--asset", XLM]);
  log(`[T05] cap actual para XLM: ${current.stdout}`);
  // Prueba de borde, no de brocha gorda: el usuario ya tiene 100 XLM. Con el
  // cap en 150, depositar 40 mas debe pasar (140 <= 150) y 60 mas debe fallar
  // (160 > 150). Asi se prueba el limite, no simplemente "un numero grande".
  const held = num(read(CTRL, "get_collateral", ["--user", a.addr, "--asset", XLM])) ?? 0n;
  const cap = held + BigInt(50 * STROOP);
  write(CTRL, ADMIN, "set_user_cap", ["--asset", XLM, "--cap", String(cap)]);
  log(`\n[T05] tenencia=${held}  cap=${cap}  (margen 50 XLM)`);

  log(`\n[T05] (a) depositar 40 XLM -> ${held + BigInt(40 * STROOP)} <= ${cap}: debe PASAR`);
  const under = write(CTRL, a.key, "deposit_collateral", [
    "--user", a.addr, "--asset", XLM, "--amount", String(40 * STROOP),
  ]);
  log(`[T05] (a) obtenido: ${under.ok ? "EXITO (correcto)" : "FALLO — inesperado"}`);

  log(`\n[T05] (b) depositar 20 XLM mas -> por encima del cap: debe FALLAR`);
  const r = write(CTRL, a.key, "deposit_collateral", [
    "--user", a.addr, "--asset", XLM, "--amount", String(20 * STROOP),
  ]);
  log(`\n[T05] esperado: FALLO (UserCapExceeded)`);
  log(`[T05] obtenido: ${r.ok ? "EXITO — esto es un problema" : "FALLO (correcto)"}`);
  if (!r.ok) log(`[T05] error exacto: ${r.stderr.split("\n").slice(0, 6).join(" | ")}`);
  log(`\n[T05] El cap queda PUESTO a proposito: es mas seguro que dejarlo en 0.`);
}

/** T06 — repago parcial y total. */
function stepT06(): void {
  banner("T06 — repago parcial y total");
  // Se corre sobre SILVER, no sobre bronze: bronze queda reservado para la
  // liquidacion (T07/T08), y un repago total cerraria la posicion que T08
  // necesita. Dos pruebas que compiten por el mismo estado no son dos pruebas.
  const a = ACTORS.silver;
  let d0 = num(read(CTRL, "get_debt", ["--user", a.addr]));

  if (d0 === 0n) {
    // Monto pequeño y deliberado: lo justo para que el repago parcial y el
    // total sean distinguibles, sin mover la posicion que sostiene T03.
    const amount = String(2 * STROOP); // 2 USDC
    log(`\n[T06] sin deuda previa; pidiendo ${amount} para tener que repagar.`);
    write(CTRL, a.key, "borrow", ["--user", a.addr, "--amount", amount]);
    d0 = num(read(CTRL, "get_debt", ["--user", a.addr]));
  }

  if (d0 === null || d0 === 0n) {
    log(`[T06] deuda actual ${d0}. No se pudo construir el caso. NO PROBADO.`);
    return;
  }
  const half = d0 / 2n;
  write(CTRL, a.key, "repay", ["--user", a.addr, "--amount", String(half)]);
  const d1 = num(read(CTRL, "get_debt", ["--user", a.addr]));
  log(`\n[T06] parcial: ${d0} -> ${d1} (esperado ${d0 - half})`);
  if (d1 && d1 > 0n) {
    write(CTRL, a.key, "repay", ["--user", a.addr, "--amount", String(d1)]);
  }
  const d2 = num(read(CTRL, "get_debt", ["--user", a.addr]));
  log(`[T06] total: ${d1} -> ${d2} (esperado 0)`);
  read(BADGE, "get_score", ["--borrower", a.addr]);
}

/**
 * T07 — dejar la posicion liquidable.
 *
 * No controlamos Reflector y re-rutear cuesta 48 h de gracia, asi que no se
 * fabrica el precio: se usa el borde. health = capacity*100/debt, y liquidate
 * exige health < 100. Pedir EXACTAMENTE max_borrow deja health en 100 clavado.
 * A partir de ahi cualquier tick a la baja de XLM cruza el umbral.
 *
 * La liquidacion resultante la dispara un movimiento real de mercado, no un
 * precio inventado. Como evidencia es mas fuerte, no mas debil.
 */
function stepT07(): void {
  banner("T07 — llevar la posicion al borde y esperar un tick real");
  const a = ACTORS.bronze;
  const h = num(read(CTRL, "health", ["--user", a.addr]));
  const debt = num(read(CTRL, "get_debt", ["--user", a.addr]));
  log(`\n[T07] salud=${h} deuda=${debt}`);

  if (debt === 0n) {
    const mb = num(read(CTRL, "max_borrow", ["--user", a.addr]));
    if (mb === null || mb <= 0n) {
      log("[T07] sin capacidad de prestamo; falta colateral. NO PROBADO.");
      return;
    }
    log(`[T07] pidiendo el maximo exacto: ${mb} (${usdc(mb)}) -> health deberia quedar en 100`);
    write(CTRL, a.key, "borrow", ["--user", a.addr, "--amount", String(mb)]);
    read(CTRL, "health", ["--user", a.addr]);
    log(
      `\n[T07] La posicion queda en el borde. Correr este paso de nuevo mas tarde:\n` +
      `      en cuanto XLM baje aunque sea una fraccion, health cae por debajo de\n` +
      `      100 y T08 puede ejecutarse. Si sube, se espera. No se fuerza.`,
    );
    saveState({ t07: { borrowed: String(mb), at: new Date().toISOString() } });
    return;
  }

  if (h !== null && h < 100) {
    log(`[T07] LIQUIDABLE: health=${h} < 100. Listo para T08.`);
    saveState({ t07_liquidable: true, health: Number(h) });
  } else {
    log(`[T07] todavia sana (health=${h}). Repetir mas tarde; no se fuerza el precio.`);
  }
}

/** T08 — liquidacion parcial con la aritmetica escrita, no "se ve bien". */
function stepT08(): void {
  banner("T08 — liquidacion parcial: close factor 50 %, penalidad 8 %, 20 % al protocolo");
  const a = ACTORS.bronze;
  const h = num(read(CTRL, "health", ["--user", a.addr]));
  const debt = num(read(CTRL, "get_debt", ["--user", a.addr]));
  if (h === null || debt === null || h >= 100n) {
    log(`[T08] health=${h}: la posicion no es liquidable. Correr T07 primero. NO PROBADO.`);
    return;
  }

  const maxRepay = (debt * BigInt(CLOSE_FACTOR_BPS)) / 10_000n;
  const penalty = (maxRepay * BigInt(LIQUIDATION_PENALTY_BPS)) / 10_000n;
  const protocolCut = (penalty * BigInt(PROTOCOL_PENALTY_SHARE_BPS)) / 10_000n;
  const liquidatorBonus = penalty - protocolCut;
  const seizeValue = maxRepay + penalty;

  log(`\n[T08] Aritmetica declarada ANTES de ejecutar:`);
  log(`[T08]   deuda                = ${debt} (${usdc(debt)})`);
  log(`[T08]   repago max (CF 50 %)  = ${maxRepay} (${usdc(maxRepay)})`);
  log(`[T08]   penalidad (8 %)       = ${penalty} (${usdc(penalty)})`);
  log(`[T08]   -> al protocolo (20 %) = ${protocolCut}`);
  log(`[T08]   -> al liquidador       = ${liquidatorBonus}`);
  log(`[T08]   valor incautado       = ${seizeValue} (${usdc(seizeValue)})`);

  log(`\n[T08] El liquidador debe tener USDC: en Modelo A paga la deuda y recibe`);
  log(`      colateral con descuento. No hay swap, asi que no hay slippage.`);
  // El liquidador firma: `liquidator.require_auth()`. Cuenta origen y
  // liquidador tienen que ser la misma, o la invocacion no autoriza.
  const liqAddr = (spawnSync("stellar", ["keys", "address", ADMIN], { encoding: "utf8" })
    .stdout || "").trim();
  const r = write(CTRL, ADMIN, "liquidate", [
    "--liquidator", liqAddr,
    "--user", a.addr,
    "--collateral_asset", XLM,
    "--repay_amount", String(maxRepay),
  ]);
  log(`\n[T08] resultado: ${r.ok ? "EXITO" : "FALLO"}`);
  read(CTRL, "get_debt", ["--user", a.addr]);
  read(CTRL, "health", ["--user", a.addr]);
  read(CTRL, "get_seized", ["--asset", XLM]);
  read(BADGE, "get_score", ["--borrower", a.addr]);
}

/** T09 — settle_seized solo en el activo de deuda. */
function stepT09(): void {
  banner("T09 — settle_seized: liquidar lo incautado solo en el activo de deuda");
  read(CTRL, "get_seized", ["--asset", XLM]);
  read(CTRL, "get_seized", ["--asset", USDC]);
  read(CTRL, "get_pending_settlement");
  const r = write(CTRL, ADMIN, "settle_seized", ["--asset", XLM]);
  log(`\n[T09] resultado: ${r.ok ? "EXITO" : "FALLO"}`);
  read(CTRL, "get_seized", ["--asset", XLM]);
  read(CTRL, "get_pending_settlement");
}

/**
 * T12 — pausa. El invariante no es que la pausa bloquee: es QUE NO BLOQUEA.
 *
 * `pause` solo congela la ENTRADA de riesgo nuevo (deposit, borrow). Nunca
 * puede congelar repay, withdraw ni liquidate: el usuario siempre puede salir
 * y desapalancarse, y la gestion de riesgo sigue corriendo. Esa es la promesa
 * no custodial, y es la que hay que probar.
 */
function stepT12(): void {
  banner("T12 — pausa: que bloquea y, sobre todo, que NO bloquea");
  const s = ACTORS.silver;

  // Deuda pequeña ANTES de pausar, para poder probar el repago estando pausado.
  const pre = num(read(CTRL, "get_debt", ["--user", s.addr])) ?? 0n;
  if (pre === 0n) {
    log(`\n[T12] preparando: 1 USDC de deuda en silver antes de pausar.`);
    write(CTRL, s.key, "borrow", ["--user", s.addr, "--amount", String(1 * STROOP)]);
  }

  log(`\n[T12] --- pausando ---`);
  const p = write(CTRL, ADMIN, "pause");
  if (!p.ok) {
    log(`[T12] no se pudo pausar; se aborta sin dejar el contrato en estado raro.`);
    return;
  }

  try {
    log(`\n[T12] (a) deposit estando pausado -> debe FALLAR`);
    const dep = write(CTRL, s.key, "deposit_collateral", [
      "--user", s.addr, "--asset", XLM, "--amount", String(1 * STROOP),
    ]);
    log(`[T12] (a) obtenido: ${dep.ok ? "EXITO — INVARIANTE ROTO" : "FALLO (correcto)"}`);

    log(`\n[T12] (b) borrow estando pausado -> debe FALLAR`);
    const bor = write(CTRL, s.key, "borrow", ["--user", s.addr, "--amount", String(1 * STROOP)]);
    log(`[T12] (b) obtenido: ${bor.ok ? "EXITO — INVARIANTE ROTO" : "FALLO (correcto)"}`);

    log(`\n[T12] (c) repay estando pausado -> debe FUNCIONAR (esto es lo que importa)`);
    const debt = num(read(CTRL, "get_debt", ["--user", s.addr])) ?? 0n;
    const rep = debt > 0n
      ? write(CTRL, s.key, "repay", ["--user", s.addr, "--amount", String(debt)])
      : { ok: false } as ShResult;
    log(`[T12] (c) obtenido: ${rep.ok ? "EXITO (correcto — la salida nunca se bloquea)" : "FALLO — INVARIANTE ROTO"}`);
  } finally {
    log(`\n[T12] --- despausando (pase lo que pase) ---`);
    write(CTRL, ADMIN, "unpause");
  }
}

/** T13 — el keeper de TTL, una pasada real. */
function stepT13(): void {
  banner("T13 — keeper de TTL, pasada real");
  const r = spawnSync("npx", ["tsx", path.join(__dirname, "ttl-check.ts")], {
    encoding: "utf8",
    cwd: path.join(REPO, "web"),
    shell: true,
  });
  log((r.stdout || "").trim());
  if (r.stderr) log(`[stderr] ${r.stderr.trim()}`);
  log(`[exit ${r.status}]`);
}

// --------------------------------------------------------------------------

const STEPS: Record<string, () => void> = {
  state: stepState,
  t01: stepT01,
  t02: stepT02,
  t03: stepT03,
  t04: stepT04,
  t05: stepT05,
  t06: stepT06,
  t07: stepT07,
  t08: stepT08,
  t09: stepT09,
  t12: stepT12,
  t13: stepT13,
};

function main(): void {
  const step = (process.argv[2] || "").toLowerCase();
  if (!step || (!STEPS[step] && step !== "all")) {
    console.error(`uso: npx tsx scripts/e2e-testnet.ts <${Object.keys(STEPS).join(" | ")} | all>`);
    process.exitCode = 2;
    return;
  }
  resolveActors();
  log(`\n\n######## corrida ${new Date().toISOString()} — paso "${step}" ########`);
  const toRun = step === "all" ? Object.keys(STEPS) : [step];
  for (const s of toRun) {
    try {
      STEPS[s]();
    } catch (err) {
      log(`\n[${s}] EXCEPCION: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }
  log(`\n[fin] transcript en ${TRANSCRIPT}`);
}

main();
