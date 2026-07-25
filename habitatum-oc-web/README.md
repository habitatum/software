# HABITATUM · Sistema de Contratos, Proveedores y Órdenes de Compra

Fase 1 (diseño + código) del sistema aprobado. Este README es la Fase 2 y 3 del plan:
crear las cuentas gratuitas y desplegar la app en una URL real.

## Qué incluye esta entrega

- `supabase/schema.sql` — toda la base de datos (tablas, cálculos, seguridad por rol).
- `app/` — la aplicación completa: login, dashboard, Órdenes de Compra (listado, crear
  con cálculo en vivo, detalle con pagos y PDF), Contratos, Proveedores, Usuarios.
- `lib/calculosOC.js` — la lógica de impuestos/AIU/anticipos/retención, igual a la de
  tu sistema en Sheets.

## Puesta en marcha (gratis, paso a paso)

### 1. Crear el proyecto en Supabase (base de datos + autenticación)
1. Entra a **supabase.com** → "Start your project" → crea cuenta gratis (con tu correo
   de Google es lo más rápido, no pide tarjeta).
2. "New Project" → nómbralo `habitatum-oc` → elige una contraseña de base de datos
   (guárdala) → región más cercana (ej. São Paulo o US East).
3. Cuando cargue el proyecto: menú izquierdo → **SQL Editor** → pega TODO el contenido
   de `supabase/schema.sql` → Run. Esto crea todas las tablas de una sola vez.
4. Menú izquierdo → **Project Settings → API**: copia `Project URL`, `anon public key`
   y `service_role key` (los tres los necesitas en el paso 3).

### 2. Crear tu primer usuario administrador
1. Menú izquierdo → **Authentication → Users → Add user** → tu correo y una contraseña.
2. Menú izquierdo → **Table Editor → usuarios → Insert row**: pon el mismo `id` que
   te generó el usuario en el paso anterior (lo ves en la lista de Authentication),
   tu nombre, tu correo, `rol = admin`, `activo = true`.

### 3. Subir el código a GitHub (gratis)
1. Crea cuenta en **github.com** si no tienes.
2. Crea un repositorio nuevo (puede ser privado) y sube esta carpeta completa.

### 4. Desplegar en Vercel (gratis)
1. Entra a **vercel.com** → "Sign up" → conecta tu cuenta de GitHub.
2. "Add New Project" → elige el repositorio que acabas de subir.
3. En "Environment Variables" agrega las tres que copiaste de Supabase:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy. En 1-2 minutos tienes una URL tipo `habitatum-oc.vercel.app` ya funcionando.

### 5. Conectar tu dominio (opcional, también gratis)
En Vercel → tu proyecto → **Settings → Domains** → agrega `oc.infohabitatum.com`
(o el subdominio que prefieras) y sigue las instrucciones para apuntar el DNS desde
donde administras `infohabitatum.com`.

## Después de desplegado

- Entra con tu usuario admin → módulo **Usuarios** → invita a tu equipo (máximo 10,
  como acordamos), asignando el rol de cada uno.
- Carga tus **Proveedores** y **Contratos** reales.
- Fase 4 pendiente (según lo acordado): migrar el histórico de Contratos/Proveedores/
  Órdenes de Compra desde tu Google Sheet actual — lo hacemos en la siguiente sesión
  cuando tengas la app desplegada y probada.

## Nota sobre el membrete del PDF

En `lib/PlantillaPDF.js` dejé colores de ejemplo (`COLOR_FONDO`, `COLOR_DORADO`) marcados
con un comentario `EJEMPLO — AJUSTAR`. Pásame los colores/logo reales de HABITATUM y los
dejamos calibrados antes de usar el sistema con clientes.
