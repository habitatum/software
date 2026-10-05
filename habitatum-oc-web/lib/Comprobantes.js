'use client';
import { useEffect, useState } from 'react';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';

// Comprobantes que llegan por el bot de Telegram: se guardan en el almacenamiento
// privado `soportes-oc` (obra/AAAA-MM/archivo) y se abren con un enlace firmado
// de 10 minutos. Los ve cualquier usuario con sesión.

// Abre el comprobante en otra pestaña. La ventana se abre en el clic para que
// el iPhone no la bloquee y luego se le carga el enlace firmado.
export async function abrirComprobante(ruta) {
  if (!ruta) return;
  const ventana = window.open('', '_blank');
  const { data, error } = await crearClienteSupabase().storage.from('soportes-oc').createSignedUrl(ruta, 600);
  if (error || !data?.signedUrl) {
    if (ventana) ventana.close();
    window.alert(`No se pudo abrir el comprobante: ${error?.message || 'archivo no encontrado'}`);
    return;
  }
  if (ventana) ventana.location.href = data.signedUrl; else window.location.href = data.signedUrl;
}

export function BotonComprobante({ ruta, texto = 'Ver comprobante', className = '' }) {
  if (!ruta) return null;
  return (
    <button type="button" onClick={() => abrirComprobante(ruta)}
      className={`text-xs underline text-neutral-600 hover:text-carbon whitespace-nowrap ${className}`}>
      {texto}
    </button>
  );
}

function fecha(f) {
  if (!f) return '';
  const p = String(f).slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(f);
}

// Lista de gastos de caja menor con su comprobante.
// - ocId: gastos legalizados en esa OC.
// - proyecto (sin ocId): gastos pendientes de legalizar de la obra, contra su tope.
export function GastosCajaMenor({ proyecto, ocId = null, plegable = false }) {
  const [gastos, setGastos] = useState(null);
  const [abierto, setAbierto] = useState(!plegable);

  useEffect(() => {
    (async () => {
      const s = crearClienteSupabase();
      let q = s.from('caja_menor_gastos').select('id, fecha, valor, concepto, remitente, soporte_path').order('fecha').order('creado_en');
      q = ocId ? q.eq('oc_id', ocId) : q.eq('proyecto_id', proyecto.id).is('oc_id', null);
      const { data } = await q;
      setGastos(data || []);
    })();
  }, [ocId, proyecto?.id]);

  if (gastos === null) return null;
  if (ocId && gastos.length === 0) return null;
  const total = gastos.reduce((a, g) => a + Number(g.valor || 0), 0);
  const tope = Number(proyecto?.tope_caja_menor || 0);
  const pct = tope > 0 ? Math.min(100, (total / tope) * 100) : 0;

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4 sm:p-5 space-y-3 text-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <p className="font-medium">{ocId ? 'Gastos de caja menor legalizados en esta orden' : 'Caja menor pendiente de legalizar'}</p>
          <p className="text-xs text-neutral-500">
            {gastos.length} {gastos.length === 1 ? 'gasto' : 'gastos'} · {formatoPesos(total)}
            {!ocId && tope > 0 && ` de ${formatoPesos(tope)} (al llegar al tope, el bot genera la OC de legalización)`}
          </p>
        </div>
        {plegable && gastos.length > 0 && (
          <button type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}
            className="border border-neutral-300 px-3 py-1.5 rounded text-xs whitespace-nowrap hover:bg-neutral-50 self-start">
            {abierto ? 'Ocultar gastos' : 'Ver gastos y comprobantes'}
          </button>
        )}
      </div>
      {!ocId && tope > 0 && (
        <div className="h-1.5 bg-hueso rounded overflow-hidden" aria-hidden="true">
          <div className={`h-full ${pct >= 90 ? 'bg-amber-500' : 'bg-dorado'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {abierto && (gastos.length === 0 ? (
        <p className="text-xs text-neutral-400 italic">No hay gastos pendientes.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead><tr className="text-left text-xs text-neutral-500 border-b">
              <th className="p-2 font-medium w-24">Fecha</th><th className="p-2 font-medium">Concepto</th>
              <th className="p-2 font-medium">Envió</th><th className="p-2 font-medium text-right">Valor</th><th className="p-2 w-28" />
            </tr></thead>
            <tbody>
              {gastos.map((g) => (
                <tr key={g.id} className="border-b last:border-0">
                  <td className="p-2 whitespace-nowrap">{fecha(g.fecha)}</td>
                  <td className="p-2">{g.concepto}</td>
                  <td className="p-2 text-neutral-500">{g.remitente || '—'}</td>
                  <td className="p-2 text-right whitespace-nowrap">{formatoPesos(g.valor)}</td>
                  <td className="p-2 text-right">{g.soporte_path ? <BotonComprobante ruta={g.soporte_path} /> : <span className="text-xs text-neutral-400">sin soporte</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
