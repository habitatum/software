'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { calcularOrdenCompra, formatoPesos } from '@/lib/calculosOC';
import NavBar from '@/components/NavBar';

const OC_VACIA = {
  tipo_orden: 'COMPRA', contrato_id: '', fecha: new Date().toISOString().slice(0, 10),
  proveedor_id: '', capitulo: '', descripcion: '', tipo_pago: 'NORMAL',
  referencia_anticipo_id: '', porcentaje_anticipo: 0, porcentaje_amortizacion: 0,
  responsable: '', descuento: 0, tipo_impuesto: 'SIN_IVA',
  porcentaje_iva: 19, porcentaje_administracion: 0, porcentaje_imprevistos: 0,
  porcentaje_utilidad: 0, porcentaje_retencion: 0, devolucion_retenido: 0, notas: '',
};

export default function NuevaOrdenCompra() {
  const { usuario, cargando } = useUsuarioActual(['admin', 'operativo']);
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const router = useRouter();

  const [oc, setOc] = useState(OC_VACIA);
  const [items, setItems] = useState([{ descripcion: '', cantidad: 1, valor_unitario: 0 }]);
  const [proveedores, setProveedores] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [anticipos, setAnticipos] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!usuario || !proyecto) return;
    async function cargarCatalogos() {
      const supabase = crearClienteSupabase();
      // Los Proveedores son globales: se muestran todos, sin filtrar por proyecto.
      const [{ data: prov }, { data: cont }, { data: ant }] = await Promise.all([
        supabase.from('proveedores').select('id, nombre').order('nombre'),
        supabase.from('contratos').select('id, numero_contrato').eq('proyecto_id', proyecto.id).order('numero_contrato'),
        supabase.from('ordenes_compra').select('id, folio, contrato_id').eq('proyecto_id', proyecto.id).eq('tipo_pago', 'ANTICIPO'),
      ]);
      setProveedores(prov || []);
      setContratos(cont || []);
      setAnticipos(ant || []);
    }
    cargarCatalogos();
  }, [usuario, proyecto]);

  const calculo = useMemo(() => calcularOrdenCompra(oc, items), [oc, items]);

  function actualizarItem(i, campo, valor) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it)));
  }
  function agregarItem() {
    setItems((prev) => [...prev, { descripcion: '', cantidad: 1, valor_unitario: 0 }]);
  }
  function quitarItem(i) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function guardar(e) {
    e.preventDefault();
    setError('');
    if (!oc.proveedor_id) { setError('Selecciona un proveedor.'); return; }
    if (items.length === 0 || items.every((it) => !it.descripcion)) { setError('Agrega al menos un ítem.'); return; }

    setGuardando(true);
    const supabase = crearClienteSupabase();

    const { data: nuevaOC, error: errOC } = await supabase
      .from('ordenes_compra')
      .insert({
        ...oc,
        proyecto_id: proyecto.id,
        contrato_id: oc.contrato_id || null,
        referencia_anticipo_id: oc.referencia_anticipo_id || null,
        creado_por: usuario.id,
      })
      .select()
      .single();

    if (errOC) { setError(errOC.message); setGuardando(false); return; }

    const filasItems = items
      .filter((it) => it.descripcion)
      .map((it) => ({ ...it, orden_compra_id: nuevaOC.id }));

    const { error: errItems } = await supabase.from('items_oc').insert(filasItems);
    if (errItems) { setError(errItems.message); setGuardando(false); return; }

    router.push(`/ordenes-compra/${nuevaOC.id}`);
  }

  if (cargando || !usuario || cargandoProyecto || !proyecto) return null;

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-8 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold mb-1">Nueva Orden de Compra</h1>
        <p className="text-sm text-neutral-500 mb-6">{proyecto.nombre}</p>

        <form onSubmit={guardar} className="space-y-6">
          {/* Datos generales */}
          <Seccion titulo="Datos generales">
            <div className="grid grid-cols-2 gap-4">
              <Campo label="Tipo de orden">
                <select value={oc.tipo_orden} onChange={(e) => setOc({ ...oc, tipo_orden: e.target.value })} className="input">
                  <option value="COMPRA">Compra</option>
                  <option value="SERVICIO">Servicio</option>
                  <option value="CONTRATO">Contrato</option>
                </select>
              </Campo>
              <Campo label="Contrato (opcional)">
                <select value={oc.contrato_id} onChange={(e) => setOc({ ...oc, contrato_id: e.target.value })} className="input">
                  <option value="">— Sin contrato —</option>
                  {contratos.map((c) => <option key={c.id} value={c.id}>{c.numero_contrato}</option>)}
                </select>
              </Campo>
              <Campo label="Proveedor">
                <select required value={oc.proveedor_id} onChange={(e) => setOc({ ...oc, proveedor_id: e.target.value })} className="input">
                  <option value="">Selecciona...</option>
                  {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </Campo>
              <Campo label="Fecha">
                <input type="date" value={oc.fecha} onChange={(e) => setOc({ ...oc, fecha: e.target.value })} className="input" />
              </Campo>
              <Campo label="Capítulo">
                <input value={oc.capitulo} onChange={(e) => setOc({ ...oc, capitulo: e.target.value })} className="input" />
              </Campo>
              <Campo label="Responsable">
                <input value={oc.responsable} onChange={(e) => setOc({ ...oc, responsable: e.target.value })} className="input" />
              </Campo>
            </div>
            <Campo label="Descripción">
              <textarea value={oc.descripcion} onChange={(e) => setOc({ ...oc, descripcion: e.target.value })} className="input" rows={2} />
            </Campo>
          </Seccion>

          {/* Ítems */}
          <Seccion titulo="Ítems">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-center">
                <input placeholder="Descripción" value={it.descripcion}
                  onChange={(e) => actualizarItem(i, 'descripcion', e.target.value)}
                  className="input col-span-6" />
                <input type="number" placeholder="Cant." value={it.cantidad}
                  onChange={(e) => actualizarItem(i, 'cantidad', e.target.value)}
                  className="input col-span-2" />
                <input type="number" placeholder="Valor unitario" value={it.valor_unitario}
                  onChange={(e) => actualizarItem(i, 'valor_unitario', e.target.value)}
                  className="input col-span-3" />
                <button type="button" onClick={() => quitarItem(i)} className="col-span-1 text-red-600 text-sm">✕</button>
              </div>
            ))}
            <button type="button" onClick={agregarItem} className="text-sm text-blue-700">+ Agregar ítem</button>
            <p className="text-right font-medium mt-2">Subtotal: {formatoPesos(calculo.subtotal)}</p>
          </Seccion>

          {/* Impuestos */}
          <Seccion titulo="Impuestos">
            <Campo label="Tipo de impuesto">
              <select value={oc.tipo_impuesto} onChange={(e) => setOc({ ...oc, tipo_impuesto: e.target.value })} className="input">
                <option value="SIN_IVA">Sin IVA</option>
                <option value="CON_IVA">Con IVA</option>
                <option value="CON_AIU">Con AIU</option>
              </select>
            </Campo>

            {oc.tipo_impuesto === 'CON_IVA' && (
              <Campo label="% IVA">
                <input type="number" value={oc.porcentaje_iva} onChange={(e) => setOc({ ...oc, porcentaje_iva: e.target.value })} className="input" />
              </Campo>
            )}

            {oc.tipo_impuesto === 'CON_AIU' && (
              <div className="grid grid-cols-3 gap-4">
                <Campo label="% Administración">
                  <input type="number" value={oc.porcentaje_administracion} onChange={(e) => setOc({ ...oc, porcentaje_administracion: e.target.value })} className="input" />
                </Campo>
                <Campo label="% Imprevistos">
                  <input type="number" value={oc.porcentaje_imprevistos} onChange={(e) => setOc({ ...oc, porcentaje_imprevistos: e.target.value })} className="input" />
                </Campo>
                <Campo label="% Utilidad">
                  <input type="number" value={oc.porcentaje_utilidad} onChange={(e) => setOc({ ...oc, porcentaje_utilidad: e.target.value })} className="input" />
                </Campo>
                <Campo label="% IVA (solo sobre Utilidad)">
                  <input type="number" value={oc.porcentaje_iva} onChange={(e) => setOc({ ...oc, porcentaje_iva: e.target.value })} className="input" />
                </Campo>
              </div>
            )}

            <div className="text-sm text-neutral-600 mt-2 space-y-1">
              {oc.tipo_impuesto === 'CON_AIU' && (
                <>
                  <p>Valor Administración: {formatoPesos(calculo.valor_administracion)}</p>
                  <p>Valor Imprevistos: {formatoPesos(calculo.valor_imprevistos)}</p>
                  <p>Valor Utilidad: {formatoPesos(calculo.valor_utilidad)}</p>
                  <p>Valor AIU total: {formatoPesos(calculo.valor_aiu)}</p>
                </>
              )}
              <p>Valor IVA: {formatoPesos(calculo.valor_iva)}</p>
            </div>
          </Seccion>

          {/* Anticipo / Amortización */}
          <Seccion titulo="Anticipo y amortización">
            <div className="grid grid-cols-2 gap-4">
              <Campo label="Tipo de pago">
                <select value={oc.tipo_pago} onChange={(e) => setOc({ ...oc, tipo_pago: e.target.value })} className="input">
                  <option value="NORMAL">Normal</option>
                  <option value="ANTICIPO">Anticipo</option>
                </select>
              </Campo>
              {oc.tipo_pago === 'ANTICIPO' && (
                <Campo label="% que representa del contrato">
                  <input type="number" value={oc.porcentaje_anticipo} onChange={(e) => setOc({ ...oc, porcentaje_anticipo: e.target.value })} className="input" />
                </Campo>
              )}
            </div>
            {oc.tipo_pago === 'NORMAL' && (
              <div className="grid grid-cols-2 gap-4">
                <Campo label="Referencia a anticipo (opcional)">
                  <select value={oc.referencia_anticipo_id} onChange={(e) => setOc({ ...oc, referencia_anticipo_id: e.target.value })} className="input">
                    <option value="">— Ninguna —</option>
                    {anticipos.map((a) => <option key={a.id} value={a.id}>{a.folio}</option>)}
                  </select>
                </Campo>
                <Campo label="% Amortización">
                  <input type="number" value={oc.porcentaje_amortizacion} onChange={(e) => setOc({ ...oc, porcentaje_amortizacion: e.target.value })} className="input" />
                </Campo>
              </div>
            )}
            <p className="text-sm text-neutral-600">Valor amortización: {formatoPesos(calculo.valor_amortizacion)}</p>
          </Seccion>

          {/* Retención / descuento */}
          <Seccion titulo="Retención y descuento">
            <div className="grid grid-cols-3 gap-4">
              <Campo label="Descuento">
                <input type="number" value={oc.descuento} onChange={(e) => setOc({ ...oc, descuento: e.target.value })} className="input" />
              </Campo>
              <Campo label="% Retención">
                <input type="number" value={oc.porcentaje_retencion} onChange={(e) => setOc({ ...oc, porcentaje_retencion: e.target.value })} className="input" />
              </Campo>
              <Campo label="Devolución retenido">
                <input type="number" value={oc.devolucion_retenido} onChange={(e) => setOc({ ...oc, devolucion_retenido: e.target.value })} className="input" />
              </Campo>
            </div>
            <p className="text-sm text-neutral-600">Valor retenido: {formatoPesos(calculo.valor_retenido)}</p>
          </Seccion>

          <Campo label="Notas">
            <textarea value={oc.notas} onChange={(e) => setOc({ ...oc, notas: e.target.value })} className="input" rows={2} />
          </Campo>

          {/* Totales en vivo */}
          <div className="bg-carbon text-hueso rounded-lg p-5 flex justify-between items-center">
            <div>
              <p className="text-sm text-neutral-300">Total</p>
              <p className="text-2xl font-semibold">{formatoPesos(calculo.total)}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-neutral-300">Neto a pagar</p>
              <p className="text-2xl font-semibold">{formatoPesos(calculo.neto_a_pagar)}</p>
            </div>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <button type="submit" disabled={guardando} className="bg-carbon text-hueso px-6 py-3 rounded font-medium disabled:opacity-50">
            {guardando ? 'Guardando...' : 'Guardar Orden de Compra'}
          </button>
        </form>
      </main>

      <style jsx global>{`
        .input { @apply border rounded px-3 py-2 w-full text-sm; }
      `}</style>
    </div>
  );
}

function Seccion({ titulo, children }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border p-5 space-y-3">
      <h2 className="font-medium text-neutral-800">{titulo}</h2>
      {children}
    </div>
  );
}
function Campo({ label, children }) {
  return (
    <div className="mb-2">
      <label className="block text-xs font-medium text-neutral-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
