'use client';
import { useRouter } from 'next/navigation';

// Vuelve a la pantalla anterior de la app (listado, contrato, presupuesto…).
// Si no hay historial (enlace abierto en una pestaña nueva) va a `respaldo`.
// En formularios, si hay cambios sin guardar, pregunta antes de salir.
export default function BotonVolver({ respaldo = '/ordenes-compra', hayCambios = false }) {
  const router = useRouter();
  function volver() {
    if (hayCambios && !window.confirm('Tienes cambios sin guardar. ¿Salir sin guardarlos?')) return;
    if (window.history.length > 1) router.back();
    else router.push(respaldo);
  }
  return (
    <button
      type="button"
      onClick={volver}
      className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-carbon mb-3 -ml-1 px-1 py-1 rounded"
      aria-label="Volver a la pantalla anterior"
    >
      <span aria-hidden="true">←</span> Volver
    </button>
  );
}
