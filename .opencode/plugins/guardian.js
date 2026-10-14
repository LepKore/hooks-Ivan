// Hooks de OpenCode 2 en UN solo plugin de JavaScript.
//
// Diferencia clave con Claude Code y Codex: no hay settings.json/hooks.json.
// El mismo archivo REGISTRA el evento y CONTIENE la lógica.
//   - ctx.tool.hook("execute.before")     = PreToolUse  → lanzar un Error BLOQUEA la herramienta
//   - ctx.tool.hook("execute.after")      = PostToolUse → se puede modificar el resultado que ve el modelo
//
// Además del par before/after, OpenCode 2 expone otros dominios de hooks que este
// proyecto aprovecha: session (context/compaction), shell, permission y el stream
// de eventos del servidor. Cada uno está comentado como HOOK n.
//
// Formato OpenCode 2: export default { id, setup(ctx) }  (en OpenCode 1 era una función que devolvía los hooks)
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { execFile } from "node:child_process"

const PELIGROSOS = [
  [/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, "borrado recursivo forzado (rm -rf)"],
  [/Remove-Item\b.*-Recurse/i, "borrado recursivo en PowerShell"],
  [/git\s+push\b.*(--force|-f\b)/i, "git push --force (reescribe la historia del equipo)"],
  [/git\s+reset\s+--hard/i, "git reset --hard (pierde cambios sin confirmar)"],
  [/DROP\s+(TABLE|DATABASE)/i, "eliminar tablas o bases de datos"],
  [/\bdel\s+\/[sq]/i, "borrado masivo en Windows"],
]

// Herramientas que modifican archivos. Lista explícita: una regex sobre el nombre
// ("/edit|write|patch/i") daba falsos positivos con cualquier tool que contenga esas letras.
const TOOLS_QUE_ESCRIBEN = new Set(["edit", "write", "apply_patch", "patch"])

// ¿La herramienta modifica archivos?
const editaArchivos = (tool) => TOOLS_QUE_ESCRIBEN.has(String(tool))

// Subagentes del proyecto que SOLO reportan: nunca deben escribir.
const SIN_ESCRITURA = new Set(["revisor-codigo", "documentador"])

// Rutas que toca una herramienta: campo directo o, si es un parche, las líneas "*** Update File: ruta"
const rutasDe = (input = {}) => {
  const rutas = [input.filePath, input.path, input.file_path].filter(Boolean).map(String)
  for (const valor of Object.values(input)) {
    if (typeof valor === "string") {
      for (const m of valor.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) rutas.push(m[1].trim())
    }
  }
  return rutas.map((r) => r.replace(/\\/g, "/"))
}

// Ejecuta las pruebas y devuelve { ok, reporte }
const ejecutarPruebas = (proyecto) =>
  new Promise((resolve) => {
    execFile("python", ["-m", "unittest", "discover", "-s", "tests"], { cwd: proyecto, timeout: 50_000 }, (error, _stdout, stderr) =>
      resolve({ ok: !error, reporte: String(stderr).trim() }), // unittest escribe su reporte en stderr
    )
  })

// Última línea del log que cumple un filtro (null si no hay ninguna)
const ultimaLinea = (log, filtro) => {
  try {
    return readFileSync(log, "utf8").split("\n").filter((l) => l.includes(filtro)).pop() ?? null
  } catch {
    return null
  }
}

// Últimas N líneas del log, opcionalmente filtradas (para la tool guardian_audit)
const ultimasLineas = (log, filtro = "", lineas = 40) => {
  try {
    const todas = readFileSync(log, "utf8").split("\n").filter((l) => l.trim() && (!filtro || l.includes(filtro)))
    const cola = todas.slice(-Math.max(1, lineas)).join("\n")
    return cola || "(la auditoría está vacía)"
  } catch {
    return "(aún no hay entradas en la bitácora)"
  }
}

export default {
  id: "upb.guardian",
  async setup(ctx) {
    const directorio = ctx.location.directory
    const PROYECTO = join(directorio, ctx.options.proyecto ?? "proyecto-demo")
    const BITACORA = join(directorio, ".opencode", "auditoria.log")

    // Las registrations de los hooks y el AbortController del stream de eventos,
    // para poder soltarlos todo al descargar el plugin.
    const registrations = []
    const ctrl = new AbortController()

    const auditar = (accion, detalle) => {
      const fecha = new Date().toLocaleString("sv-SE") // formato local AAAA-MM-DD HH:MM:SS
      const texto = String(detalle ?? "").replace(/\n/g, " ").slice(0, 120)
      mkdirSync(join(directorio, ".opencode"), { recursive: true }) // el log puede no existir todavía
      appendFileSync(BITACORA, `${fecha} | ${accion.padEnd(18)} | ${texto}\n`)
    }

    // execute.after entrega resultados con formas distintas (bloques de contenido o texto).
    // Este helper añade el aviso al formato que llegue, sin duplicarlo.
    const anexarTexto = (event, texto) => {
      const r = event.result ?? {}
      if (Array.isArray(r.content)) {
        event.result = { ...r, content: [...r.content, { type: "text", text: texto }] }
      } else {
        event.result = { ...r, content: `${r.content ?? ""}\n\n${texto}` }
      }
    }

    auditar("PLUGIN cargado", "guardian.js está activo") // prueba de que OpenCode cargó el plugin

    // ── HOOK 1 y 2 · ANTES de usar una herramienta ─────────────────────────
    registrations.push(
      await ctx.tool.hook("execute.before", (event) => {
        const input = event.input ?? {}

        // HOOK 1: archivos protegidos
        if (editaArchivos(event.tool)) {
          for (const ruta of rutasDe(input)) {
            const nombre = basename(ruta)
            if (ruta.includes("tests/")) {
              throw new Error(
                `⛔ BLOQUEADO por hook: '${nombre}' es una prueba y las pruebas están protegidas. ` +
                  "Si a una falla, corrige el código, no la prueba.",
              )
            }
            if (nombre.startsWith(".env")) {
              throw new Error(`⛔ BLOQUEADO por hook: '${nombre}' contiene secretos y no se puede modificar.`)
            }
          }
        }

        // HOOK 2: comandos peligrosos (cualquier herramienta que reciba un "command")
        if (typeof input.command === "string") {
          for (const [patron, motivo] of PELIGROSOS) {
            if (patron.test(input.command)) {
              throw new Error(`⛔ BLOQUEADO por hook: ${motivo}. Comando: ${input.command}`)
            }
          }
        }
      }),
    )

    // ── HOOK 3 y 4 · DESPUÉS de usar una herramienta ───────────────────────
    registrations.push(
      await ctx.tool.hook("execute.after", async (event) => {
        const input = event.input ?? {}

        // HOOK 4: auditoría (los subagentes se lanzan con una herramienta que recibe el tipo de agente)
        const subagente = input.subagent_type ?? input.agent
        if (subagente) auditar("SUBAGENTE terminó", subagente)
        else auditar(event.tool ?? "?", rutasDe(input)[0] ?? input.command ?? input.pattern ?? "")

        const rutas = rutasDe(input)
        if (event.status !== "completed" || !editaArchivos(event.tool)) return

        // HOOK 3: pruebas automáticas después de editar código Python
        const tocaPython = rutas.some((r) => r.endsWith(".py"))
        if (tocaPython) {
          const { ok, reporte } = await ejecutarPruebas(PROYECTO)
          const aviso = ok
            ? `✅ Hook de pruebas: ${reporte.split("\n").find((l) => l.startsWith("Ran ")) ?? ""} → OK`
            : `❌ El hook ejecutó las pruebas y FALLARON. Corrige el código (no las pruebas):\n${reporte.slice(-3000)}`
          auditar("PRUEBAS", ok ? "OK" : "FALLARON")

          // Se agrega el aviso al resultado que ve el modelo para que se corrija solo
          anexarTexto(event, aviso)
        }

        // HOOK 6: coherencia test↔módulo. Si se escribe tests/test_x.py pero no existe
        // proyecto-demo/x.py, el nombre del módulo no cuadra con el código real.
        const modulo = rutas
          .map((r) => /tests\/test_(.+)\.py$/.exec(r)?.[1])
          .find(Boolean)
        if (modulo && !existsSync(join(PROYECTO, `${modulo}.py`))) {
          const aviso =
            `⚠️ Aviso del hook: escribiste 'tests/test_${modulo}.py' pero en el proyecto no existe ` +
            `'${modulo}.py'. Las pruebas no se van a ejecutar contra nada. Revisa el nombre del módulo.`
          auditar("COHERENCIA", `test_${modulo}.py sin ${modulo}.py`)
          anexarTexto(event, aviso)
        }
      }),
    )

    // ── HOOK 5 · session.hook("context") ──────────────────────────────────
    // Los "no toques código" de revisor-codigo.md y documentador.md viven hoy solo en el
    // frontmatter `permission:` de cada agente. Eso es una convención: si alguien edita el
    // .md o invoca el agente de otra forma, la regla desaparece. Este hook la vuelve
    // estructural. Es defensa en profundidad: la misma regla está escrita dos veces.
    registrations.push(
      await ctx.session.hook("context", (event) => {
        if (SIN_ESCRITURA.has(event.agent)) {
          delete event.tools.edit
          delete event.tools.write
          delete event.tools.apply_patch
          delete event.tools.patch
        }

        // La ley del proyecto, en el system prompt en vez de confiar en que el agente la lea.
        event.system.push({
          type: "text",
          text:
            "Reglas de este proyecto: los archivos bajo proyecto-demo/tests/ son pruebas protegidas y no se " +
            "modifican; los .env contienen secretos; toda acción queda registrada en .opencode/auditoria.log " +
            "y se puede consultar con la tool guardian_audit.",
        })
      }),
    )

    // ── HOOK 7 · session.hook("compaction") ───────────────────────────────
    // El aviso "las pruebas fallaron, corrige el código" que inyecta el HOOK 3 vive en el
    // resultado de una herramienta. Cuando la sesión compacta, eso es justo lo que se
    // pierde, y el modelo deja de autocorregirse. Aquí se reinyecta antes del resumen.
    registrations.push(
      await ctx.session.hook("compaction", (event) => {
        const pendiente = ultimaLinea(BITACORA, "FALLARON")
        if (!pendiente) return
        event.system.push({
          type: "text",
          text:
            `Pendiente de esta sesión antes de compactar: ${pendiente}. ` +
            "Las pruebas de proyecto-demo fallaron y el código, no las pruebas, es lo que hay que arreglar.",
        })
      }),
    )

    // ── HOOK 8 · shell.hook("create.before") ──────────────────────────────
    // Red de seguridad silenciosa del HOOK 2. El throw de arriba da el mensaje rojo al
    // modelo; aquí, si el comando se cuela por otro camino, se capea sin romper la sesión.
    registrations.push(
      await ctx.shell.hook("create.before", (event) => {
        event.timeout = Math.min(event.timeout ?? 60_000, 60_000) // nada de comandos eternos colgados
        for (const [patron, motivo] of PELIGROSOS) {
          if (patron.test(event.command)) {
            auditar("BLOQUEO shell", motivo)
            event.command = `echo "[guardian.js] comando bloqueado: ${motivo}"`
          }
        }
      }),
    )

    // ── HOOK 9 · tool.transform ───────────────────────────────────────────
    // La auditoría era un efecto colateral invisible; esto la vuelve consultable y
    // responde a la pregunta "¿qué me bloqueó el guardian hace un rato?".
    registrations.push(
      await ctx.tool.transform((editor) => {
        editor.add({
          name: "guardian_audit",
          description:
            "Consulta la bitácora .opencode/auditoria.log de este proyecto: qué se bloqueó, " +
            "qué pruebas corrieron y qué subagentes terminaron.",
          input: {
            type: "object",
            properties: {
              filtro: { type: "string", description: "texto a buscar, ej. FALLARON o SUBAGENTE" },
              lineas: { type: "number", description: "cuántas entradas recientes devolver (por defecto 40)" },
            },
          },
          execute: async (input = {}) => ({
            content: ultimasLineas(BITACORA, String(input.filtro ?? ""), Number(input.lineas ?? 40)),
          }),
        })
      }),
    )

    // ── HOOK 10 · ctx.event.subscribe ─────────────────────────────────────
    // Los hooks viven en el fichero; el estado de la sesión solo existe en el servidor.
    // Esto hace que la bitácora cuente la historia completa de la clase.
    void (async () => {
      for await (const ev of ctx.event.subscribe({ signal: ctrl.signal })) {
        if (ev.type === "session.idle") auditar("SESION lista", "")
        else if (ev.type === "session.compacted") auditar("COMPACTACION", "contexto resumido por el HOOK 7")
        else if (ev.type === "session.error") auditar("SESION error", ev.properties?.error?.name ?? ev.properties?.message ?? "")
      }
    })()

    // Limpieza: OpenCode llama a esto al descargar el plugin.
    return () => {
      ctrl.abort()
      for (const r of registrations) r.dispose()
    }
  },
}