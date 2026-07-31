'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import { TIPOS_CONTRATO, NOMBRES_TIPO_CONTRATO, plantillaClausulas } from '@/lib/plantillasContrato';
import NavBar from '@/components/NavBar';

const ANIO_ACTUAL = new Date().getFullYear();
const VACIO_LEGAL = {
  tipo_contrato: 'SUMINISTRO_E_INSTALACION',
  clausulas: plantillaClausulas('SUMINISTRO_E_INSTALACION'),
  alcance_detallado: '',
  fecha_contrato: '',
  fecha_inicio: '',
  plazo_valor: '',
  plazo_unidad: 'días calendario',
  garantia_meses: '',
  incluye_anticipo: false,
  pct_anticipo: 0,
  incluye_poliza_cumplimiento: false,
  incluye_poliza_responsabilidad_civil: false,
  incluye_poliza_estabilidad: false,
  incluye_poliza_garantia: false,
  incluye_poliza_calidad: false,
  items_excel: [],
};
const VACIO = { anio: ANIO_ACTUAL, consecutivo: 1, contratista_id: '', concepto: '', valor_inicial: 0, ...VACIO_LEGAL };

// Nombres de columnas que se aceptan en el Excel importado (sin distinguir mayúsculas/tildes) —
// la idea es que el Excel siempre traiga las mismas 4 columnas, pero si alguien usa un nombre
// parecido (ej. "Precio unitario" en vez de "Valor unitario") igual se reconoce.
const ALIAS_COLUMNAS = {
  descripcion: ['descripcion', 'descripción', 'item', 'ítem', 'concepto'],
  unidad: ['unidad', 'und', 'un'],
  cantidad: ['cantidad', 'cant'],
  valorUnitario: ['valor unitario', 'valor_unitario', 'precio unitario', 'precio_unitario', 'vr unitario', 'vr. unitario'],
};
function normalizar(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function encontrarColumna(headers, alias) {
  const normalizados = headers.map(normalizar);
  for (const a of alias) {
    const idx = normalizados.indexOf(normalizar(a));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

export default function Contratos() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [contratos, setContratos] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [form, setForm] = useState(VACIO);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorExcel, setErrorExcel] = useState('');

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
    setErrorExcel('');
    setMostrarForm(true);
  }

  function cambiarAnio(valor) {
    const disponibles = consecutivosDisponibles(valor);
    setForm({ ...form, anio: valor, consecutivo: disponibles[0] || 1 });
  }

  function cambiarTipoContrato(tipo) {
    setForm({ ...form, tipo_contrato: tipo, clausulas: plantillaClausulas(tipo) });
  }

  function cambiarClausula(idx, campo, valor) {
    const nuevas = form.clausulas.map((c, i) => (i === idx ? { ...c, [campo]: valor } : c));
    setForm({ ...form, clausulas: nuevas });
  }

  // Importa el cuadro de ítems desde un archivo Excel (.xlsx/.xls/.csv). Es puramente
  // informativo (se guarda en la columna items_excel y se muestra en el PDF del contrato) —
  // no participa en ningún cálculo del software. Si el archivo no trae las columnas esperadas
  // (Descripción, Cantidad, Valor unitario — Unidad es opcional), se avisa con un mensaje claro
  // en vez de fallar en silencio.
  function importarExcel(e) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setErrorExcel('');
    const lector = new FileReader();
    lector.onload = (evento) => {
      try {
        const libro = XLSX.read(evento.target.result, { type: 'array' });
        const hoja = libro.Sheets[libro.SheetNames[0]];
        const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });
        if (!filas.length) throw new Error('El archivo no tiene filas de datos.');
        const headers = Object.keys(filas[0]);
        const colDescripcion = encontrarColumna(headers, ALIAS_COLUMNAS.descripcion);
        const colUnidad = encontrarColumna(headers, ALIAS_COLUMNAS.unidad);
        const colCantidad = encontrarColumna(headers, ALIAS_COLUMNAS.cantidad);
        const colValorUnitario = encontrarColumna(headers, ALIAS_COLUMNAS.valorUnitario);
        if (!colDescripcion || !colCantidad || !colValorUnitario) {
          throw new Error(
            'No se encontraron las columnas esperadas (Descripción, Cantidad, Valor unitario). ' +
            'Columnas encontradas en el archivo: ' + headers.join(', ')
          );
        }
        const items = filas
          .map((f) => {
            const cantidad = Number(f[colCantidad]) || 0;
            const valorUnitario = Number(f[colValorUnitario]) || 0;
            return {
              descripcion: String(f[colDescripcion] || '').trim(),
              unidad: colUnidad ? String(f[colUnidad] || '').trim() : '',
              cantidad,
              valorUnitario,
              total: cantidad * valorUnitario,
            };
          })
          .filter((it) => it.descripcion);
        if (!items.length) throw new Error('No se encontraron filas con descripción para importar.');
        setForm((f) => ({ ...f, items_excel: items }));
      } catch (err) {
        setErrorExcel(err.message || 'No se pudo leer el archivo.');
      }
    };
    lector.readAsArrayBuffer(archivo);
    e.target.value = '';
  }

  function quitarItemsExcel() {
    setForm((f) => ({ ...f, items_excel: [] }));
    setErrorExcel('');
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
        valor_inicial: form.valor_inicial,
        proyecto_id: proyecto.id,
        codigo_proyecto: proyecto.codigo,
        tipo_contrato: form.tipo_contrato,
        clausulas: form.clausulas,
        alcance_detallado: form.alcance_detallado || null,
        fecha_contrato: form.fecha_contrato || null,
        fecha_inicio: form.fecha_inicio || null,
        plazo_valor: form.plazo_valor || null,
        plazo_unidad: form.plazo_unidad || null,
        garantia_meses: form.garantia_meses || null,
        incluye_anticipo: form.incluye_anticipo,
        pct_anticipo: form.pct_anticipo || 0,
        incluye_poliza_cumplimiento: form.incluye_poliza_cumplimiento,
        incluye_poliza_responsabilidad_civil: form.incluye_poliza_responsabilidad_civil,
        incluye_poliza_estabilidad: form.incluye_poliza_estabilidad,
        incluye_poliza_garantia: form.incluye_poliza_garantia,
        incluye_poliza_calidad: form.incluye_poliza_calidad,
        items_excel: form.items_excel,
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
  const totalItemsExcel = (form.items_excel || []).reduce((acc, it) => acc + (it.total || 0), 0);

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-8 max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
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
                <label className="block text-xs text-neutral-500 mb-1">Valor inicial</label>
                <input type="number" placeholder="Valor inicial" value={form.valor_inicial} onChange={(e) => setForm({ ...form, valor_inicial: e.target.value })} className="border rounded px-3 py-2 text-sm w-full" />
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
              <label className="block text-xs text-neutral-500 mb-1">Tipo de contrato</label>
              <select
                value={form.tipo_contrato}
                onChange={(e) => cambiarTipoContrato(e.target.value)}
                className="border rounded px-3 py-2 text-sm w-full"
              >
                {TIPOS_CONTRATO.map((t) => <option key={t} value={t}>{NOMBRES_TIPO_CONTRATO[t]}</option>)}
              </select>
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
              <div className="flex gap-2">
                <input type="number" placeholder="Plazo" value={form.plazo_valor} onChange={(e) => setForm({ ...form, plazo_valor: e.target.value })} className="border rounded px-3 py-2 text-sm w-1/2" />
                <select value={form.plazo_unidad} onChange={(e) => setForm({ ...form, plazo_unidad: e.target.value })} className="border rounded px-3 py-2 text-sm w-1/2">
                  <option value="días calendario">días calendario</option>
                  <option value="días hábiles">días hábiles</option>
                  <option value="semanas">semanas</option>
                  <option value="meses">meses</option>
                </select>
              </div>
              <input type="number" placeholder="Garantía (meses)" value={form.garantia_meses} onChange={(e) => setForm({ ...form, garantia_meses: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            </div>

            <div className="border-t pt-3">
              <label className="block text-xs text-neutral-500 mb-1">Alcance detallado (opcional — si se deja vacío, el PDF usa el "Concepto")</label>
              <textarea value={form.alcance_detallado} onChange={(e) => setForm({ ...form, alcance_detallado: e.target.value })} rows={3} className="border rounded px-3 py-2 text-sm w-full" />
            </div>

            <div className="border-t pt-3 space-y-2">
              <p className="text-xs text-neutral-500 font-medium">Pólizas y anticipo</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.incluye_anticipo} onChange={(e) => setForm({ ...form, incluye_anticipo: e.target.checked })} />
                Anticipo
                {form.incluye_anticipo && (
                  <input type="number" placeholder="% del valor" value={form.pct_anticipo} onChange={(e) => setForm({ ...form, pct_anticipo: e.target.value })} className="border rounded px-2 py-1 text-sm w-24 ml-2" />
                )}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.incluye_poliza_cumplimiento} onChange={(e) => setForm({ ...form, incluye_poliza_cumplimiento: e.target.checked })} />
                Póliza de cumplimiento
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.incluye_poliza_responsabilidad_civil} onChange={(e) => setForm({ ...form, incluye_poliza_responsabilidad_civil: e.target.checked })} />
                Póliza de responsabilidad civil
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.incluye_poliza_estabilidad} onChange={(e) => setForm({ ...form, incluye_poliza_estabilidad: e.target.checked })} />
                Póliza de estabilidad
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.incluye_poliza_garantia} onChange={(e) => setForm({ ...form, incluye_poliza_garantia: e.target.checked })} />
                Póliza de garantía
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.incluye_poliza_calidad} onChange={(e) => setForm({ ...form, incluye_poliza_calidad: e.target.checked })} />
                Póliza de calidad
              </label>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs text-neutral-500 font-medium mb-1">Cuadro de ítems (importado de Excel — informativo, aparece en el PDF)</p>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={importarExcel} className="text-sm" />
              <p className="text-[11px] text-neutral-400 mt-1">
                Columnas esperadas: Descripción, Unidad (opcional), Cantidad, Valor unitario.
              </p>
              {errorExcel && <p className="text-red-600 text-xs mt-1">{errorExcel}</p>}
              {form.items_excel.length > 0 && (
                <div className="mt-2 border rounded overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gris-calido/30 text-left">
                      <tr><th className="p-2">Descripción</th><th className="p-2">Unidad</th><th className="p-2 text-right">Cantidad</th><th className="p-2 text-right">Valor unitario</th><th className="p-2 text-right">Total</th></tr>
                    </thead>
                    <tbody>
                      {form.items_excel.map((it, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-2">{it.descripcion}</td>
                          <td className="p-2">{it.unidad}</td>
                          <td className="p-2 text-right">{it.cantidad}</td>
                          <td className="p-2 text-right">{formatoPesos(it.valorUnitario)}</td>
                          <td className="p-2 text-right">{formatoPesos(it.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t font-medium">
                        <td className="p-2" colSpan={4}>Total</td>
                        <td className="p-2 text-right">{formatoPesos(totalItemsExcel)}</td>
                      </tr>
                    </tfoot>
                  </table>
                  <button type="button" onClick={quitarItemsExcel} className="text-xs text-red-600 underline p-2">Quitar cuadro importado</button>
                </div>
              )}
            </div>

            <details className="border-t pt-3">
              <summary className="text-xs text-neutral-500 font-medium cursor-pointer">Cláusulas del contrato (editable, precargadas según el tipo elegido)</summary>
              <div className="space-y-3 mt-3">
                {form.clausulas.map((cl, i) => (
                  <div key={cl.id}>
                    <input
                      value={cl.titulo}
                      onChange={(e) => cambiarClausula(i, 'titulo', e.target.value)}
                      className="border rounded px-2 py-1 text-xs font-medium w-full mb-1"
                    />
                    <textarea
                      value={cl.texto}
                      onChange={(e) => cambiarClausula(i, 'texto', e.target.value)}
                      rows={2}
                      className="border rounded px-2 py-1 text-xs w-full"
                    />
                  </div>
                ))}
              </div>
            </details>

            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button disabled={guardando} className="bg-carbon text-hueso px-4 py-2 rounded text-sm disabled:opacity-50">
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </form>
        )}

        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gris-calido/30 text-left">
              <tr><th className="p-3">N° Contrato</th><th className="p-3">Contratista</th><th className="p-3 text-right">Valor inicial</th></tr>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
