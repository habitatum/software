// Guarda el proyecto elegido por el usuario en este navegador (localStorage),
// para que el resto de la App sepa en qué proyecto está trabajando.
const CLAVE = 'habitatum_proyecto_actual_id';

export function obtenerProyectoActualId() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(CLAVE);
}

export function guardarProyectoActualId(id) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CLAVE, id);
}

export function limpiarProyectoActual() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(CLAVE);
}
