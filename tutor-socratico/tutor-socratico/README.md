# Tutor Socrático de Matemáticas

Aplicación web completa (backend + frontend) que implementa un tutor
socrático basado en IA generativa (Claude) para desarrollar la
**creatividad matemática** de estudiantes de bachillerato del sistema
educativo colombiano. Guarda cada conversación en una base de datos para
su análisis posterior por parte del docente.

## ¿Cómo funciona?

- El **docente** entra a `/admin` con una contraseña y publica los
  problemas que los estudiantes van a trabajar (pestaña "Banco de
  problemas": título, enunciado y grado/curso opcional). Solo los
  problemas que el docente publica quedan disponibles — los estudiantes
  no pueden inventar su propio tema.
- El **estudiante** entra a la página principal, escribe su nombre y
  curso, elige uno de los problemas publicados por el docente, y
  conversa con el tutor sobre ese problema. El tutor **nunca da la
  respuesta directa**: guía mediante preguntas socráticas diseñadas para
  estimular fluidez (varias ideas), flexibilidad (varios enfoques/
  representaciones) y originalidad (generalización, invención,
  justificación) — ver `src/socraticPrompt.js`.
- El tutor está instruido para **conversar únicamente sobre el problema
  asignado en esa sesión**: si el estudiante pregunta algo personal,
  fuera de matemáticas, o sobre otro problema, el tutor lo redirige de
  inmediato con una frase breve, sin sostener esa conversación.
- Cada mensaje se guarda en una base de datos SQLite local
  (`data/tutor.db`), organizada por estudiante → problema → sesión →
  mensajes.
- El docente también ve, en la pestaña "Conversaciones", el listado de
  todas las conversaciones, puede abrir el detalle de cada una,
  registrar una evaluación cualitativa (fluidez / flexibilidad /
  originalidad, 1–5) y exportar todo en CSV o JSON para analizarlo en
  Excel, SPSS, R, Python, etc.

## Estructura del proyecto

```
tutor-socratico/
├── server.js              # servidor Express y rutas de la API
├── src/
│   ├── db.js               # acceso a SQLite (better-sqlite3)
│   ├── claude.js            # llamadas a la API de Claude
│   └── socraticPrompt.js    # el "cerebro pedagógico" del tutor
├── public/
│   ├── index.html, js/chat.js, css/style.css     # interfaz del estudiante
│   └── admin.html, js/admin.js, css/admin.css    # panel docente
├── .env.example
└── package.json
```

## Puesta en marcha local

Requiere [Node.js](https://nodejs.org/) 18 o superior.

```bash
npm install
cp .env.example .env
```

Edita `.env` y completa:

- `ANTHROPIC_API_KEY`: tu clave de la API de Claude. Se obtiene en
  [console.anthropic.com](https://console.anthropic.com/) (requiere crear
  una cuenta y cargar crédito; el uso de este tutor consume créditos de
  la API por cada mensaje).
- `ADMIN_PASSWORD`: la contraseña que usarás para entrar al panel docente.

Luego:

```bash
npm start
```

Abre `http://localhost:3000` (interfaz de estudiante) y
`http://localhost:3000/admin` (panel docente).

## Desplegarlo en internet (para que los estudiantes lo usen desde el colegio o su casa)

La forma más sencilla, sin necesidad de administrar un servidor, es usar
un servicio de hosting gratuito o económico como **Render** o
**Railway**:

1. Sube esta carpeta a un repositorio de GitHub.
2. En [render.com](https://render.com) crea un "Web Service" nuevo
   apuntando a ese repositorio.
   - Build command: `npm install`
   - Start command: `npm start`
3. En la sección de variables de entorno del servicio, agrega
   `ANTHROPIC_API_KEY` y `ADMIN_PASSWORD` (los mismos valores que
   pusiste en tu `.env` local).
4. **Importante — persistencia de datos**: por defecto Render/Railway
   usan almacenamiento efímero, es decir, el archivo `data/tutor.db` se
   perdería si el servicio se reinicia. Para conservar las
   conversaciones, agrega un "disco persistente" (Persistent Disk en
   Render, Volume en Railway) montado en la carpeta `data/`, o cambia a
   una base de datos gestionada (ver "Ir más allá" abajo) si esperas
   mucho volumen de uso.

## Notas importantes sobre datos y privacidad de estudiantes

- Los estudiantes son, en su mayoría, **menores de edad**. Antes de usar
  esta herramienta con un curso, verifica los requisitos de tu colegio y
  de la Ley 1581 de 2012 (protección de datos personales en Colombia)
  sobre consentimiento informado de acudientes para el tratamiento de
  datos de menores, y considera informar a estudiantes y familias sobre
  qué se guarda y para qué (análisis pedagógico/investigativo) — no
  compartas los archivos exportados fuera de ese propósito ni con
  terceros no involucrados en el análisis.
- La contraseña del panel docente es una protección básica (una sola
  contraseña compartida); no está pensada para manejar datos altamente
  sensibles. Si vas a usar este tutor a mayor escala o con datos
  sensibles adicionales, conviene reforzar la autenticación (por
  ejemplo, autenticación por usuario individual).
- El nombre del estudiante se guarda tal como lo escribe él mismo, sin
  verificación. Si prefieres anonimizar el análisis, puedes pedirles
  que usen un código en vez de su nombre real.

## Ir más allá (ideas para siguientes versiones)

- Cambiar SQLite por PostgreSQL si el volumen de estudiantes/conversaciones
  crece mucho (facilita además el análisis con herramientas como
  Metabase o consultas SQL directas).
- Autenticación individual de docentes (en vez de una sola contraseña
  compartida).
- Panel de estadísticas agregadas (promedios de fluidez/flexibilidad/
  originalidad por curso, evolución en el tiempo) a partir de los datos
  ya guardados.
- Adaptar el prompt de `src/socraticPrompt.js` para un tema o unidad
  específica del plan de área, si se quiere enfocar una sesión de clase
  puntual en vez de dejarlo abierto.

## Costos

Cada mensaje del estudiante genera una llamada a la API de Claude
(modelo configurado en `ANTHROPIC_MODEL`, por defecto
`claude-sonnet-4-5`). Revisa los precios vigentes en
[anthropic.com/pricing](https://www.anthropic.com/pricing) y considera
un modelo más económico si el volumen de estudiantes es alto.
