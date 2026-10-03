'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import { compartirOAbrirArchivo } from '@/lib/compartirArchivo';
import { construirSabana } from '@/lib/modeloSabana';
import { exportarSabanaCortes } from '@/lib/exportarSabanaCortes';
import SabanaCortes from '@/lib/SabanaCortes';
import NavBar from '@/components/NavBar';

// Sábana de cortes del contrato (réplica del Excel de cortes de obra) + descarga en Excel con marca.
export default function SabanaDeCortes() {
  const { id } = useParams();
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [d, setD] = useState(null);
  const [descargando, setDescargando] = useState(false);

  useEffect(() => {
    if (!usuario || !proyecto) return;
    (async () => {
      const s = crearClienteSupabase();
      const [{ data: contrato }, { data: items }, { data: cortes }, { data: anticipos }, { data: borr }] = await Promise.all([
        s.from('contratos').select('*, proveedores:contratista_id(nombre)').eq('id', id).single(),
        s.from('contrato_items').select('*').eq('contrato_id', id).order('orden'),
        s.from('cortes').select('*, ordenes_compra(folio, estado), corte_items(*)').eq('contrato_id', id).eq('estado', 'APROBADO').order('numero'),
        s.from('v_ordenes_compra_calculadas').select('id, folio, fecha, total').eq('contrato_id', id).eq('tipo_pago', 'ANTICIPO').neq('estado', 'ANULADA').order('fecha'),
        s.from('cortes').select('id, numero').eq('contrato_id', id).eq('estado', 'BORRADOR').limit(1),
      ]);
      setD({ contrato, items: items || [], cortes: cortes || [], anticipos: anticipos || [], borrador: borr?.[0] || null });
    })();
  }, [usuario, proyecto, id]);

  if (cargando || cargandoProyecto || !usuario || !proyecto) return null;
  const m = d ? construirSabana({ items: d.items, cortes: d.cortes, anticipos: d.anticipos, valorContrato: d.contrato?.valor_inicial }) : null;
  const puedeCrear = usuario.rol === 'admin' || usuario.rol === 'operativo';

  async function descargar() {
    setDescargando(true);
    try { await exportarSabanaCortes({ m, contrato: d.contrato, proyecto }); } finally { setDescargando(false); }
  }

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-6 space-y-4">
        <Link href={`/contratos/${id}`} className="text-sm text-neutral-500">← Volver al contrato</Link>
        {!d ? <p className="text-sm text-neutral-500">Cargando…</p> : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold">Cortes de obra · {d.contrato.numero_contrato}</h1>
                <p className="text-sm text-neutral-500">{d.contrato.proveedores?.nombre} · {d.contrato.concepto} · Valor del contrato {formatoPesos(d.contrato.valor_inicial)}</p>
              </div>
              <div className="flex gap-2">
                <button disabled={descargando} onClick={descargar} className="border border-dorado text-dorado px-4 py-2 rounded text-sm">{descargando ? 'Generando…' : 'Descargar Excel'}</button>
                {puedeCrear && d.items.length > 0 && (
                  <Link href={`/contratos/${id}/cortes/${d.borrador ? d.borrador.id : 'nuevo'}`} className="bg-carbon text-hueso px-4 py-2 rounded text-sm">
                    {d.borrador ? `Continuar corte ${d.borrador.numero}` : '+ Nuevo corte'}
                  </Link>
                )}
              </div>
            </div>
            {d.items.length === 0 ? (
              <p className="text-sm text-neutral-500 bg-white border rounded-lg p-6 text-center">Este contrato no tiene ítems cargados. Cárgalos desde el detalle del contrato para empezar a hacer cortes.</p>
            ) : (
              <SabanaCortes m={m} contrato={d.contrato}
                hrefCorte={(c) => `/contratos/${id}/cortes/${c.id}`}
                puedeEditarCorte={(c) => usuario.rol === 'admin' || (usuario.rol === 'operativo' && c.numero === Math.max(...d.cortes.map((k) => k.numero)))}
                onPdf={(c) => compartirOAbrirArchivo(`/api/cortes/${c.id}/pdf`, `Corte ${c.numero} ${d.contrato.numero_contrato}.pdf`)} />
            )}
            {d.cortes.some((k) => k.notas) && (
              <div className="bg-white border rounded-lg p-3 text-xs text-neutral-600 space-y-1">
                {d.cortes.filter((k) => k.notas).map((k) => <p key={k.id}><strong>Corte {k.numero}:</strong> {k.notas}</p>)}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
