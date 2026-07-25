import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { generarContrasenaTemporal } from '@/lib/usuarioInterno';

// Usa la SERVICE ROLE KEY (solo disponible en el servidor) para poder
// cambiar la contraseña de cualquier usuario.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  // ---------- Verificar que quien llama es un admin autenticado ----------
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const { data: { user }, error: errUsuario } = await supabaseAdmin.auth.getUser(token);
  if (errUsuario || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const { data: perfilSolicitante } = await supabaseAdmin
    .from('usuarios')
    .select('rol')
    .eq('id', user.id)
    .single();

  if (perfilSolicitante?.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo un administrador puede restablecer contraseñas' }, { status: 403 });
  }

  // ---------- Restablecer la contraseña del usuario indicado ----------
  const { id, nuevaContrasena } = await request.json();
  if (!id) {
    return NextResponse.json({ error: 'Falta el usuario' }, { status: 400 });
  }

  if (nuevaContrasena && nuevaContrasena.length < 6) {
    return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 });
  }

  // Si el admin escribió una contraseña, se usa esa. Si no, se genera una aleatoria.
  const contrasenaFinal = nuevaContrasena || generarContrasenaTemporal();
  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { password: contrasenaFinal });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, contrasenaTemporal: contrasenaFinal });
}
