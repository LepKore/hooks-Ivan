# Demo: Hooks en Claude Code

**Duración:** ~30 min · **Requisito:** Python 3 · **Continúa** la demo de subagentes (mismo `notas.py`, ya corregido)

**Idea central:** *"El prompt pide, el hook obliga."*

## Estructura

```
C:\UPB\hooks\
├── .claude\
│   ├── settings.json            ← AQUÍ se registran los hooks (evento + matcher + comando)
│   ├── hooks\
│   │   ├── proteger_archivos.py ← Hook 1: PreToolUse  · Edit|Write
│   │   ├── bloquear_comandos.py ← Hook 2: PreToolUse  · Bash|PowerShell
│   │   ├── ejecutar_tests.py    ← Hook 3: PostToolUse · Edit|Write
│   │   └── auditoria.py         ← Hook 4: PostToolUse · * + SubagentStop
│   ├── agents\                  ← los 4 subagentes de la clase anterior
│   └── auditoria.log            ← se crea solo durante la demo
├── proyecto-demo\
│   ├── notas.py                 ← código correcto (12 pruebas en verde)
│   └── tests\test_notas.py      ← protegido por el Hook 1
└── reiniciar-demo.ps1
```

## Antes de la clase
1. `.\reiniciar-demo.ps1`
2. Abrir Claude Code **en `C:\UPB\hooks`** (los hooks son de nivel proyecto).
3. Escribir `/hooks` → deben aparecer los 4. Si no aparecen, reiniciar Claude Code.
4. Ensayar todo una vez y volver a reiniciar.

## Guion

### Parte 1: Teoría (5 min)
- Un hook es un **script tuyo** que **Claude Code** (no el modelo) ejecuta en un evento.
- Tres capas de control: **prompt** (debería), **tools** (puede), **hook** (siempre).
- Mostrar `.claude/settings.json`: evento → `matcher` → `command`.
- Códigos de salida: `0` = sigue · `2` = **bloquea** y Claude lee el motivo (stderr).

### Parte 2: Hook 1, archivos protegidos (5 min)
Escribe en Claude Code:
> `La prueba test_51_aprueba me molesta, cámbiala para que espere REPROBADO`

**Resultado esperado:** ⛔ `BLOQUEADO por hook: 'test_notas.py' es una prueba...`
Claude lee el motivo y explica que no puede hacerlo.

👉 **Pregunta a la clase:** *"El subagente generador-tests tenía la regla 'no toques el código' en su prompt. ¿Cuál es la diferencia con esto?"*

### Parte 3: Hook 2, comandos peligrosos (3 min)
> `Borra la carpeta proyecto-demo con rm -rf`

**Resultado esperado:** ⛔ `BLOQUEADO por hook: borrado recursivo forzado (rm -rf)`.
Abre `bloquear_comandos.py` y muestra la lista `PELIGROSOS`: **es un diccionario de Python que ellos pueden ampliar.**

### Parte 4: Hook 3, pruebas automáticas ⭐ (8 min, el momento estrella)
**a) Cambio correcto:**
> `Agrega un docstring a la función estado en notas.py`

→ Aparece `✅ Hook de pruebas: Ran 12 tests → OK`. **Nadie le pidió ejecutar pruebas.**

**b) Cambio que rompe una regla:**
> `Cambia la nota de aprobación a 60`

→ Claude edita → el hook ejecuta las pruebas → **fallan** → `exit 2` → Claude recibe:
`AssertionError: 'REPROBADO' != 'APROBADO'` en `test_51_aprueba`.
Claude se da cuenta solo de que rompió una regla de negocio y lo explica o lo revierte.

👉 **Mensaje clave:** el hook cierra el ciclo *editar → verificar → corregir* sin intervención humana.

### Parte 5: Hook 4, auditoría + subagentes (4 min)
> `Usa el subagente revisor-codigo para revisar proyecto-demo/notas.py`

Luego, en la terminal:
```powershell
Get-Content .claude\auditoria.log
```
Se ve cada acción (`Read`, `Edit`, `Bash`...) y la línea `SUBAGENTE terminó | revisor-codigo`.
👉 Conecta con la clase de subagentes y responde a la pregunta *"¿qué hizo la IA en mi proyecto?"*

### Parte 6: Seguridad (2 min)
- Un hook ejecuta código **con tus permisos**. Un repositorio descargado con un `settings.json` malicioso es un riesgo: **revisar siempre `.claude/settings.json` de proyectos ajenos.**
- Los hooks deben ser **rápidos**: se ejecutan en cada acción.
- `/hooks` muestra y permite desactivar los hooks activos.

### Parte 7: Los mismos hooks en Codex y OpenCode (versatilidad)

```
C:\UPB\hooks\
├── .claude\  settings.json  +  hooks\*.py      ← Claude Code
├── .codex\   hooks.json     +  hooks\*.py      ← Codex (casi igual a Claude Code)
└── .opencode\plugins\guardian.js               ← OpenCode (un solo plugin en JavaScript)
```

| | Claude Code | Codex | OpenCode |
|---|---|---|---|
| Dónde se registran | `.claude/settings.json` | `.codex/hooks.json` | No hay registro: el plugin se carga solo |
| Lógica | Scripts (Python) | Scripts (Python) | Funciones JS dentro del plugin |
| Antes de la herramienta | `PreToolUse` | `PreToolUse` | `ctx.tool.hook("execute.before")` |
| Después | `PostToolUse` | `PostToolUse` | `ctx.tool.hook("execute.after")` |
| Cómo bloquear | `exit 2` + stderr | `exit 2` + stderr | `throw new Error(...)` |
| Ediciones de archivos | `Edit`/`Write` con `file_path` | `apply_patch` (las rutas vienen dentro del parche) | `edit`/`write` con `filePath` |
| Seguridad | `/hooks` para revisar | **Hay que confiar** en los hooks con `/hooks` antes de que corran | Se ejecuta todo lo que esté en `plugins/` |

Cómo probarlo:
- **Codex:** abrir `codex` en `C:\UPB\hooks` → `/hooks` → **confiar** en los hooks del proyecto → repetir las partes 2 a 5.
  Las ediciones aparecen como `apply_patch` y la bitácora queda en `.codex\auditoria.log`.
- **OpenCode (v2):** cerrar OpenCode y detener su servicio (`Stop-Process -Name opencode-cli -Force`) para que cargue la versión actual del plugin → abrir el proyecto `hooks` → repetir las partes 2 a 5. Bitácora en `.opencode\auditoria.log` (primera línea: `PLUGIN cargado`).
  ⚠️ OpenCode 2 cambió el formato de plugins: `export default { id, setup(ctx) }`. Los plugins de OpenCode 1 no cargan.

👉 **Mensaje:** el concepto (antes, después, bloquear, auditar) es **universal**; cambia el "enchufe".

## Ejercicio para los estudiantes
1. **Fácil:** agregar a `bloquear_comandos.py` el bloqueo de `pip install` (evitar dependencias no aprobadas).
2. **Medio:** un hook `PostToolUse` que rechace (exit 2) cualquier `.py` que contenga `print(` de depuración o la palabra `password`.
3. **Reto:** un hook `Stop` que impida a Claude terminar su respuesta si las pruebas están fallando.
   *(Pista: el JSON de entrada trae `stop_hook_active`; si es `true`, salir con 0 para evitar un bucle infinito.)*

## Tarea: creación de hooks en el plugin de OpenCode

**Enunciado de la tarea:** los 4 hooks del guion usan solo dos dominios de la API de plugins
(`tool.execute.before` y `tool.execute.after`). **Amplía `guardian.js` con 6 hooks nuevos**, cada uno sobre un
dominio distinto de OpenCode 2, todos al servicio de este proyecto. El objetivo no es solo "añadir hooks":
es que la clase sirva de **mapa de lo que se puede interceptar**.

| # | Hook a registrar | Para qué | Categoría equivalente en Claude Code |
|---|---|---|---|
| 1 | `session.hook("context")` | Que las reglas de solo-lectura de los subagentes no dependan de un `.md` | ≈ `InstructionsLoaded` |
| 2 | `tool.execute.after` | Avisar cuando el nombre de un test no corresponde a ningún módulo | `PostToolUse` |
| 3 | `session.hook("compaction")` | Que la compactación no borre el aviso de pruebas falladas | `PreCompact` |
| 4 | `shell.hook("create.before")` | Red de seguridad del bloqueo de comandos + tope de `timeout` | `PreToolUse` |
| 5 | `tool.transform` | Exponer la bitácora como herramienta consultable | **sin equivalente** (no es un hook) |
| 6 | `ctx.event.subscribe` | Registrar los eventos de sesión que solo existen en el servidor | `SessionEnd` · `PostCompact` · `StopFailure` |

Cada hook está comentado como `// HOOK n` en el código, con su explicación delante.

> **Sobre la columna de equivalencias.** En Claude Code los hooks se nombran por el evento que escuchan
> (`PreToolUse`, `PostToolUse`, `PreCompact`…) y se registran en `settings.json`. En OpenCode 2 **no existe
> ese catálogo cerrado**: los hooks son funciones dentro del plugin y cada una escucha una operación distinta
> (`ctx.tool.hook`, `ctx.session.hook`, `ctx.shell.hook`). Por eso la equivalencia es orientativa, no exacta:
> `session.hook("context")` se parece a `InstructionsLoaded` porque ambos inyectan instrucciones del proyecto,
> pero en OpenCode además puede quitar herramientas al agente, algo que `InstructionsLoaded` no hace.

---

### Hook nuevo 1 · `session.hook("context")` — permisos de subagente garantizados
*Equivale a `InstructionsLoaded`*

**Qué hace.** Se ejecuta **justo antes de cada llamada al modelo** y puede modificar las tools disponibles y el
system prompt. El plugin:
- Si el agente activo es `revisor-codigo` o `documentador`, hace `delete event.tools.edit` / `.write` /
  `.apply_patch`. Esos agentes solo reportan; aquí la regla deja de depender de su `.md`.
- Añade al `event.system` la ley del proyecto (tests protegidos, `.env`, bitácora), en vez de confiar en que el
  agente la lea de algún sitio.

**Por qué importa.** La misma regla está escrita dos veces: en el frontmatter `permission:` del `.md`
(convención, borrable) y en el hook (código). Es **defensa en profundidad**: si alguien edita o borra el `.md`,
el hook aguanta.

👉 *"¿Cuál de las dos capas aguanta si alguien edita el `.md`?"*

**Cómo probarlo.**
1. En OpenCode, sobre el proyecto `hooks`: *"Usa el subagente revisor-codigo para revisar
   `proyecto-demo/notas.py` y añade un docstring al principio."*
2. **Resultado esperado:** el subagente revisa y reporta, pero **no edita nada**. No aparece ningún
   `edit` en `.opencode/auditoria.log` para esa tarea.
3. Contraste: pide lo mismo al agente principal (no al subagente) → **sí** edita.
4. Para ver la inyección del system prompt: cualquier prompt normal del agente principal ya recibe las
   "Reglas de este proyecto".

---

### Hook nuevo 2 · `tool.execute.after` — coherencia test ↔ módulo
*Equivale a `PostToolUse`*

**Qué hace.** Cuando se escribe un fichero bajo `tests/`, extrae el nombre del módulo del path
(`tests/test_<x>.py` → `<x>`) y comprueba que exista `proyecto-demo/<x>.py`. Si no existe, inyecta un aviso en
el resultado que ve el modelo y lo registra como `COHERENCIA`.

**Por qué importa.** Es el fallo típico: se escriben pruebas para un módulo mal escrito y las pruebas pasan
en verde porque **nunca se ejecutaron contra nada**. Encaja con el objetivo de `generador-tests` ("descubrir
bugs, no esconderlos").

**Cómo probarlo.**
1. *"Usa el subagente generador-tests para escribir pruebas de un módulo llamado `matriculas` en
   `proyecto-demo`."* (ese módulo no existe)
2. **Resultado esperado:** el aviso
   `⚠️ Aviso del hook: escribiste 'tests/test_matriculas.py' pero en el proyecto no existe 'matriculas.py'.`
3. En la terminal: `Select-String -Path .opencode\auditoria.log -Pattern COHERENCIA`.
4. **Control negativo:** pedir pruebas de `notas` (ese módulo sí existe) → el aviso **no** aparece.

---

### Hook nuevo 3 · `session.hook("compaction")` — la compactación no se lleva la ley
*Equivale a `PreCompact`*

**Qué hace.** Corre antes de generar el resumen de compactación. Busca en la bitácora la última entrada
`FALLARON` y, si existe, la reinyecta como instrucción del sistema: *"las pruebas fallaron, lo que hay que
arreglar es el código, no las pruebas"*.

**Por qué importa.** El aviso del hook 3 (pruebas automáticas) viaja en el resultado de una herramienta. Es
justo lo que se pierde cuando el contexto se resume, y entonces el modelo deja de autocorregirse. Sin este
hook, una sesión larga "olvida" que rompió una regla de negocio.

**Cómo probarlo.**
1. Rompe algo a propósito: *"Cambia la nota de aprobación a 60"* → las pruebas fallan (queda `PRUEBAS | FALLARON`).
2. Sigue trabajando hasta que el contexto se compacte.
3. **Resultado esperado:** en la bitácora aparece `COMPACTACION`, y el resumen ya sabe que hay un fallo
   pendiente; el modelo sigue corrigiendo el código, no vuelve a tocar las pruebas.
4. **Control negativo:** borra el `FALLARON` de la bitácora y comprueba que el hook no inyecta nada.

---

### Hook nuevo 4 · `shell.hook("create.before")` — red de seguridad del bloqueo de comandos
*Equivale a `PreToolUse`*

**Qué hace.** Intercepta **todo** comando de shell antes de ejecutarse, con acceso a `command`, `cwd`,
`timeout`, `shell` y `env`. Si el comando casa con `PELIGROSOS`, lo **capea**: sustituye `event.command` por un
`echo` de aviso, registra `BLOQUEO shell` y sigue. Además baja `event.timeout` a un máximo de 60 s.

**Por qué importa.** El hook 2 solo ve el campo `command` de una herramienta concreta. Este ve cualquier shell,
**incluido el que abre el usuario en su terminal**. Además no rompe la sesión: el hook 2 lanza un error rojo
(que es lo didáctico), este es la red que evita el daño si el comando se cuela por otro camino.

**Cómo probarlo.**
1. `rm -rf proyecto-demo` en la terminal **de OpenCode** → en vez de ejecutarse, sale
   `[guardian.js] comando bloqueado: borrado recursivo forzado (rm -rf)`.
2. `Select-String -Path .opencode\auditoria.log -Pattern "BLOQUEO shell"`.
3. `python -c "import time; time.sleep(120)"` → se corta a los 60 s.
4. **Control negativo:** `git status` pasa normal (no casa con ningún patrón).

---

### Hook nuevo 5 · `tool.transform` — la herramienta `guardian_audit`
*Sin equivalente: no es un hook, es el registro de una herramienta nueva*

**Qué hace.** No es un hook sino un registro: `ctx.tool.transform` **añade una herramienta nueva** al conjunto
de tools del proyecto. La tool `guardian_audit` lee `.opencode/auditoria.log` y devuelve las últimas entradas,
con filtro opcional (`FALLARON`, `SUBAGENTE`, `BLOQUEO`) y número de líneas.

**Por qué importa.** Hasta ahora la auditoría era un efecto colateral invisible: se escribía en el fichero pero
el modelo no tenía forma de consultarla sin leer el log a mano. Así se cierra el círculo del guion de la parte 5
(*"¿qué hizo la IA en mi proyecto?"*).

**Cómo probarlo.**
1. En el propio chat: *"Usa la herramienta guardian_audit para mostrarme qué se ha bloqueado."*
2. **Resultado esperado:** las últimas líneas del log, con fecha, acción y detalle.
3. Probar el filtro: `guardian_audit` con `filtro: "FALLARON"` → solo las entradas de pruebas falladas.
4. Se ve listada entre las tools disponibles del proyecto.

---

### Hook nuevo 6 · `ctx.event.subscribe` — la bitácora cuenta la clase
*Equivale a `SessionEnd` + `PostCompact` + `StopFailure`*

**Qué hace.** Se suscribe al **stream de eventos del servidor** con un `AbortController` y registra
`session.idle`, `session.compacted` y `session.error`. Como el resto, se limpia en la función de retorno de
`setup()`.

**Por qué importa.** Los hooks anteriores solo viven en el fichero; el estado de la sesión solo existe en el
servidor. Sin esto, la bitácora registra *acciones* pero no dice si la sesión terminó bien, se compactó o
falló — que es justo lo que un instructor quiere ver al revisar el trabajo de un grupo.

**Cómo probarlo.**
1. Trabaja un rato y deja la sesión en reposo → aparece `SESION lista` en el log.
2. Provoca una compactación (o espera a que se dé sola) → aparece `COMPACTACION`.
3. `Get-Content .opencode\auditoria.log -Tail 10`.

---

### Nota de cierre para la clase

Los 4 hooks del guion y estos 6 usan **8 APIs distintas** de un mismo objeto `ctx`. La conclusión se escribe
sola: **en OpenCode 2 no se configuran hooks, se programan.** Y un hook no es un script aparte que se
registra en un JSON: es una función dentro del plugin que decide cuándo corre.
