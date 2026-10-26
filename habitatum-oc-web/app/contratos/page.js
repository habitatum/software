'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import NavBar from '@/components/NavBar';
import DevolverRetenido from '@/lib/DevolverRetenido';
import { compartirOAbrirArchivo } from '@/lib/compartirArchivo';
import RegimenContrato, { etiquetaValor } from '@/lib/RegimenContrato';

const ANIO_ACTUAL = new Date().getFullYear();
// 059: el texto del contrato, las garantías y el PDF ahora viven en "Documento del contrato".
const VACIO_LEGAL = {
  alcance_detallado: '',
  fecha_contrato: '',
  fecha_inicio: '',
  incluye_anticipo: false,
  pct_anticipo: 0,
};
const VACIO = { anio: ANIO_ACTUAL, consecutivo: 1, contratista_id: '', concepto: '', valor_base: 0, regimen_impuesto: '', pct_a: 0, pct_i: 0, pct_u: 0, pct_iva: 19, ...VACIO_LEGAL };

export default function Contratos() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [contratos, setContratos] = useState([]);
  // Estado de cortes por contrato: ¿tiene ítems cargados? ¿tiene un corte en borrador?
  const [infoCortes, setInfoCortes] = useState({});
  const [generandoEstadoId, setGenerandoEstadoId] = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const [form, setForm] = useState(VACIO);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const supabase = crearClienteSupabase();
    const { data: cont } = await supabase
      .from('contratos')
      .select('*, proveedores(nombre)')
      .eq('proyecto_id', proyecto.id)
      .order('numero_contrato');
    // Los Proveedores son globales: se muestran todos, sin filtrar por proyecto.
    const { data: prov } = await supabase.from('proveedores').select('id, nombre').order('nombre');
    setContratos(cont || []);
    setProveedores(prov || []);
    const ids = (cont || []).map((c) => c.id);
    if (ids.length) {
      const [{ data: its }, { data: borr }] = await Promise.all([
        supabase.from('contrato_items').select('contrato_id').in('contrato_id', ids),
        supabase.from('cortes').select('id, contrato_id, numero').in('contrato_id', ids).eq('estado', 'BORRADOR'),
      ]);
      const info = {};
      (its || []).forEach((x) => { info[x.contrato_id] = { ...(info[x.contrato_id] || {}), conItems: true }; });
      (borr || []).forEach((b) => { info[b.contrato_id] = { ...(info[b.contrato_id] || {}), borrador: b }; });
      setInfoCortes(info);
    }
  }
  useEffect(() => { if (usuario && proyecto) cargar(); }, [usuario, proyecto]); // eslint-disable-line

  // Consecutivos ya usados para un año dado, dentro de este proyecto. Se
  // calcula a partir de los contratos que ya cargamos, sin pedir nada extra
  // al servidor.
  function consecutivosUsados(anio) {
    return contratos.filter((c) => c.anio === Number(anio)).map((c) => c.consecutivo);
  }

  // Lista de consecutivos disponibles para el año: todos los huecos que
  // hayan quedado libres, más el siguiente número después del más alto ya
  // usado. Así el desplegable de "+ Nuevo contrato" nunca deja elegir un
  // consecutivo repetido para el mismo proyecto + año.
  function consecutivosDisponibles(anio) {
    const usados = consecutivosUsados(anio);
    const maxUsado = usados.length ? Math.max(...usados) : 0;
    const disponibles = [];
    for (let i = 1; i <= maxUsado + 1; i++) {
      if (!usados.includes(i)) disponibles.push(i);
    }
    return disponibles;
  }

  function abrirFormulario() {
    const disponibles = consecutivosDisponibles(ANIO_ACTUAL);
    setForm({ ...VACIO, consecutivo: disponibles[0] || 1 });
    setError('');
    setMostrarForm(true);
  }

  function cambiarAnio(valor) {
    const disponibles = consecutivosDisponibles(valor);
    setForm({ ...form, anio: valor, consecutivo: disponibles[0] || 1 });
  }

  async function guardar(e) {
    e.preventDefault();
    setError('');
    setGuardando(true);
    const supabase = crearClienteSupabase();
    const { error: err } = await supabase
      .from('contratos')
      .insert({
        anio: form.anio,
        consecutivo: form.consecutivo,
        contratista_id: form.contratista_id,
        concepto: form.concepto,
        valor_inicial: Number(form.valor_base) || 0, valor_antes_impuestos: Number(form.valor_base) || 0, // 072: la BD calcula el valor con impuestos
        proyecto_id: proyecto.id,
        codigo_proyecto: proyecto.codigo,
        alcance_detallado: form.alcance_detallado || null,
        fecha_contrato: form.fecha_contrato || null,
        fecha_inicio: form.fecha_inicio || null,
        incluye_anticipo: form.incluye_anticipo,
        pct_anticipo: form.pct_anticipo || 0,
        regimen_impuesto: form.regimen_impuesto || 'SIN_IVA',
        pct_a: Number(form.pct_a) || 0, pct_i: Number(form.pct_i) || 0, pct_u: Number(form.pct_u) || 0, pct_iva: Number(form.pct_iva) || 0,
      });
    setGuardando(false);
    if (err) {
      setError(err.message.includes('duplicate') ? 'Ese consecutivo ya se usó para este proyecto y año. Elige otro.' : err.message);
      cargar(); // por si el desplegable quedó desactualizado (ej. otra persona creó un contrato al mismo tiempo)
      return;
    }
    setForm(VACIO);
    setMostrarForm(false);
    cargar();
  }

  if (cargando || !usuario || cargandoProyecto || !proyecto) return null;

  const disponiblesParaElAnio = consecutivosDisponibles(form.anio);


  // Estado de cuenta en PDF de un contrato, directo desde el listado.
  async function descargarEstadoCuenta(c) {
    setGenerandoEstadoId(c.id);
    const hoy = new Date().toISOString().slice(0, 10);
    await compartirOAbrirArchivo(`/api/contratos/${c.id}/estado-cuenta`, `Estado de cuenta ${c.numero_contrato} ${hoy}.pdf`);
    setGenerandoEstadoId(null);
  }

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-8 max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Contratos</h1>
            <p className="text-sm text-neutral-500">{proyecto.nombre}</p>
          </div>
          {usuario.rol !== 'lectura' && (
            <button
              onClick={() => (mostrarForm ? setMostrarForm(false) : abrirFormulario())}
              className="bg-carbon text-hueso px-4 py-2 rounded text-sm"
            >
              {mostrarForm ? 'Cancelar' : '+ Nuevo contrato'}
            </button>
          )}
        </div>

        {mostrarForm && (
          <form onSubmit={guardar} className="bg-white border rounded-lg p-5 space-y-4 mb-6">
            <p className="text-xs text-neutral-500">
              Proyecto: <span className="font-medium text-neutral-700">{proyecto.nombre} ({proyecto.codigo})</span>
            </p>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Año</label>
                <input
                  required
                  type="number"
                  placeholder="Año"
                  value={form.anio}
                  onChange={(e) => cambiarAnio(e.target.value)}
                  className="border rounded px-3 py-2 text-sm w-full"
                />
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Consecutivo</label>
                <select
                  required
                  value={form.consecutivo}
                  onChange={(e) => setForm({ ...form, consecutivo: Number(e.target.value) })}
                  className="border rounded px-3 py-2 text-sm w-full"
                >
                  {disponiblesParaElAnio.map((n) => (
                    <option key={n} value={n}>{String(n).padStart(2, '0')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">{etiquetaValor(form.regimen_impuesto)}</label>
                <input type="number" placeholder="Valor inicial" value={form.valor_base} onChange={(e) => setForm({ ...form, valor_base: e.target.value })} className="border rounded px-3 py-2 text-sm w-full" />
              </div>
              <p className="col-span-3 text-xs text-neutral-400 -mt-1">
                N° de contrato: {proyecto.codigo}-{form.anio}-{String(form.consecutivo).padStart(2, '0')}
              </p>
              <div className="col-span-3">
                <label className="block text-xs text-neutral-500 mb-1">Contratista</label>
                <select required value={form.contratista_id} onChange={(e) => setForm({ ...form, contratista_id: e.target.value })} className="border rounded px-3 py-2 text-sm w-full">
                  <option value="">Contratista...</option>
                  {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <div className="col-span-3">
                <label className="block text-xs text-neutral-500 mb-1">Concepto</label>
                <input placeholder="Concepto" value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} className="border rounded px-3 py-2 text-sm w-full" />
              </div>
            </div>

            <div className="border-t pt-3">
              <RegimenContrato form={form} setForm={setForm} exigir />
            </div>

            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Fecha del contrato</label>
                <input type="date" value={form.fecha_contrato} onChange={(e) => setForm({ ...form, fecha_contrato: e.target.value })} className="border rounded px-3 py-2 text-sm w-full" />
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Fecha de inicio</label>
                <input type="date" value={form.fecha_inicio} onChange={(e) => setForm({ ...form, fecha_inicio: e.target.value })} className="border rounded px-3 py-2 text-sm w-full" />
              </div>
            </div>

            <div className="border-t pt-3">
              <label className="block text-xs text-neutral-500 mb-1">Alcance detallado (opcional — se precarga en el Documento del contrato)</label>
              <textarea value={form.alcance_detallado} onChange={(e) => setForm({ ...form, alcance_detallado: e.target.value })} rows={3} className="border rounded px-3 py-2 text-sm w-full" />
            </div>

            <div className="border-t pt-3 space-y-2">
              <p className="text-xs text-neutral-500 font-medium">Anticipo (las garantías y el texto del contrato se definen en Documento del contrato)</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.incluye_anticipo} onChange={(e) => setForm({ ...form, incluye_anticipo: e.target.checked })} />
                Anticipo
                {form.incluye_anticipo && (
                  <input type="number" placeholder="% del valor" value={form.pct_anticipo} onChange={(e) => setForm({ ...form, pct_anticipo: e.target.value })} className="border rounded px-2 py-1 text-sm w-24 ml-2" />
                )}
              </label>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button disabled={guardando} className="bg-carbon text-hueso px-4 py-2 rounded text-sm disabled:opacity-50">
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </form>
        )}

        <div className="bg-white rounded-lg shadow-sm border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gris-calido/30 text-left">
              <tr><th className="p-3">N° Contrato</th><th className="p-3">Contratista</th><th className="p-3 text-right">Valor inicial</th><th className="p-3 text-right"></th></tr>
            </thead>
            <tbody>
              {contratos.map((c) => (
                <tr key={c.id} className={`border-t hover:bg-hueso ${c.estado === 'ANULADO' ? 'opacity-60' : ''}`}>
                  <td className="p-3">
                    <Link href={`/contratos/${c.id}`} className="text-blue-700 hover:underline">{c.numero_contrato}</Link>
                    {c.estado === 'ANULADO' && (
                      <span className="ml-2 bg-red-100 text-red-700 text-[10px] font-semibold px-1.5 py-0.5 rounded align-middle">ANULADO</span>
                    )}
                  </td>
                  <td className="p-3">{c.proveedores?.nombre}</td>
                  <td className="p-3 text-right">{formatoPesos(c.valor_inicial)}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {infoCortes[c.id]?.conItems && (
                      <Link href={`/contratos/${c.id}/cortes`} className="inline-block border border-carbon text-carbon px-3 py-1.5 rounded text-xs whitespace-nowrap mr-2 align-middle hover:bg-hueso">
                        Ver cortes
                      </Link>
                    )}
                    {(usuario.rol === 'admin' || usuario.rol === 'operativo') && infoCortes[c.id]?.conItems && c.estado !== 'ANULADO' && (
                      <Link
                        href={infoCortes[c.id]?.borrador ? `/contratos/${c.id}/cortes/${infoCortes[c.id].borrador.id}` : `/contratos/${c.id}/cortes/nuevo`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-block bg-carbon text-hueso px-3 py-1.5 rounded text-xs whitespace-nowrap mr-2 align-middle"
                      >
                        {infoCortes[c.id]?.borrador ? `Continuar corte ${infoCortes[c.id].borrador.numero}` : '+ Nuevo corte'}
                      </Link>
                    )}
                    {/* Junto a "+ Nuevo corte": solo admin y solo si hay retenido por devolver (047). */}
                    {infoCortes[c.id]?.conItems && <DevolverRetenido contrato={c} usuario={usuario} onHecho={cargar} compacto />}
                    {/* Sin ítems no hay cortes: se ofrece cargarlos (se pueden importar del
                        cuadro del contrato). Antes no se mostraba ningún botón. */}
                    {(usuario.rol === 'admin' || usuario.rol === 'operativo') && !infoCortes[c.id]?.conItems && c.estado !== 'ANULADO' && (
                      <Link
                        href={`/contratos/${c.id}/items`}
                        className="inline-block border border-carbon text-carbon px-3 py-1.5 rounded text-xs whitespace-nowrap mr-2 align-middle hover:bg-hueso"
                      >
                        Cargar ítems para cortes
                      </Link>
                    )}
                    <button
                      onClick={() => descargarEstadoCuenta(c)}
                      disabled={generandoEstadoId === c.id}
                      className="border border-dorado text-dorado px-3 py-1.5 rounded text-xs whitespace-nowrap hover:bg-hueso disabled:opacity-50"
                    >
                      {generandoEstadoId === c.id ? 'Generando...' : 'Estado de cuenta'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
