import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Usa la SERVICE ROLE KEY (solo disponible en el servidor, nunca en el navegador)
// para poder crear usuarios e invitarlos por correo.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const { email, nombre, rol } = await request.json();

  if (!email || !nombre || !rol) {
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
