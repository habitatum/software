// Dominio "falso" usado para usuarios que no tienen un correo real.
// Nunca se envía correo a estas direcciones: Supabase Auth solo las usa
// internamente como identificador único de la cuenta.
export const DOMINIO_USUARIO_INTERNO = 'habitatum-oc.internal';

// Convierte un nombre de usuario (ej. "residente1") en el correo sintético
// que se guarda en Supabase Auth (ej. "residente1@habitatum-oc.internal").
export function correoSinteticoDeUsuario(usuario) {
  return `${usuario.trim().toLowerCase()}@${DOMINIO_USUARIO_INTERNO}`;
}

// Dado lo que la persona escribió en el campo de login, decide si es un
// correo real (tiene "@") o un nombre de usuario, y devuelve el correo
// que hay que pasarle a Supabase Auth en signInWithPassword.
export function correoParaLogin(valorIngresado) {
  const valor = valorIngresado.trim();
  if (valor.includes('@')) return valor;
  return correoSinteticoDeUsuario(valor);
}

// Genera una contraseña temporal legible (letras + números), para
// mostrarla una sola vez al administrador cuando crea un usuario sin correo.
export function generarContrasenaTemporal() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let resultado = '';
  for (let i = 0; i < 10; i++) {
    resultado += chars[Math.floor(Math.random() * chars.length)];
  }
  return resultado;
}
