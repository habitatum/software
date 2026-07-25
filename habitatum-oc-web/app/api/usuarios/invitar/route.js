import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { correoSinteticoDeUsuario, generarContrasenaTemporal } from '@/lib/usuarioInterno';

// Usa la SERVICE ROLE KEY (solo disponible en el servidor, nunca en el navegador)
// para poder crear usuarios e invitarlos por correo.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const { modo, email, usuario, nombre, rol } = await request.json();

  if (!nombre || !rol) {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  }

  // ---------- Modo "usuario" (sin correo real) ----------
  if (modo === 'usuario') {
    if (!usuario) {
      return NextResponse.json({ error: 'Falta el nombre de usuario' }, { status: 400 });
    }

    const correoInterno = correoSinteticoDeUsuario(usuario);
    const contrasenaTemporal = generarContrasenaTemporal();

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: correoInterno,
      password: contrasenaTemporal,
      email_confirm: true, // no hay correo real que confirmar
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const { error: errPerfil } = await supabaseAdmin
      .from('usuarios')
      .insert({ id: data.user.id, nombre, email: correoInterno, usuario, rol, activo: true });

    if (errPerfil) {
      return NextResponse.json({ error: errPerfil.message }, { status: 400 });
    }

    // Devolvemos la contraseña temporal UNA sola vez: no hay correo al que mandarla,
    // así que el administrador debe copiarla y dársela directamente a la persona.
    return NextResponse.json({ ok: true, usuario, contrasenaTemporal });
  }

  // ---------- Modo "correo" (flujo original, invitación real) ----------
  if (!email) {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { error: errPerfil } = await supabaseAdmin
    .from('usuarios')
    .insert({ id: data.user.id, nombre, email, rol, activo: true });

  if (errPerfil) {
    return NextResponse.json({ error: errPerfil.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
