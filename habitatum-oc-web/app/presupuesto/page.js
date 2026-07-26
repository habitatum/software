'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import { parsearPresupuesto } from '@/lib/parsePresupuesto';
import NavBar from '@/components/NavBar';

export default function Presupuesto() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [presupuesto, setPresupuesto] = useState(null);
  const [capitulos, setCapitulos] = useState([]);
  const [ejecutados, setEjecutados] = useState({}); // presupuesto_item_id -> ejecutado
  const [expandidos, setExpandidos] = useState({});
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  async function cargar() {
    setCargandoDatos(true);
    const supabase = crearClienteSupabase();
    const { data: p } = await supabase.from('presupuestos').select('*, usuarios(nombre)').eq('proyecto_id', proyecto.id).maybeSingle();
    setPresupuesto(p || null);

    if (p) {
      const { data: caps } = await supabase
        .from('presupuesto_capitulos')
        .select('*, presupuesto_items(*)')
        .eq('presupuesto_id', p.id)
        .order('orden');
      const capsOrdenados = (caps || []).map((c) => ({
        ...c,
        presupuesto_items: (c.presupuesto_items || []).slice().sort((a, b) => a.orden - b.orden),
      }));
      setCapitulos(capsOrdenados);

      const { data: ejec } = await supabase.from('v_presupuesto_ejecutado').select('*');
      const mapa = {};
      (ejec || []).forEach((e) => { mapa[e.presupuesto_item_id] = Number(e.ejecutado) || 0; });
      setEjecutados(mapa);
    } else {
      setCapitulos([]);
      setEjecutados({});
    }
    setCargandoDatos(false);
  }

  useEffect(() => { if (usuario && proyecto) cargar(); }, [usuario, proyecto]); // eslint-disable-line

  function toggleCapitulo(id) {
    setExpandidos((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function subirArchivo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (presupuesto && !window.confirm('Ya existe un presupuesto cargado para este proyecto. Subir uno nuevo REEMPLAZARÁ todos los capítulos e ítems actuales (y se perderán los vínculos con Órdenes de Compra ya guardados). ¿Continuar?')) {
      e.target.value = '';
      return;
    }
    setError('');
    setSubiendo(true);
    try {
      const buffer = await file.arrayBuffer();
      const datos = parsearPresupuesto(buffer);

      const supabase = crearClienteSupabase();
      const { data: { session } } = await supabase.auth.getSession();

      // Reemplaza todo: borra el presupuesto anterior del proyecto (cascada
      // borra capítulos e ítems) y crea uno nuevo.
      await supabase.from('presupuestos').delete().eq('proyecto_id', proyecto.id);

      const { data: nuevoPresupuesto, error: errP } = await supabase
        .from('presupuestos')
        .insert({
          proyecto_id: proyecto.id,
          nombre_archivo: file.name,
          total_costos_directos: datos.totales.totalCostosDirectos,
          total_costos_indirectos: datos.totales.totalCostosIndirectos,
          valor_total: datos.totales.valorTotal,
          cargado_por: session?.user?.id || null,
        })
        .select()
        .single();
      if (errP) throw errP;

      const filasCapitulos = datos.capitulos.map((c) => ({
        presupuesto_id: nuevoPresupuesto.id,
        codigo: c.codigo,
        nombre: c.nombre,
        categoria: c.categoria,
        valor_presupuestado: c.valor_presupuestado,
        orden: c.orden,
      }));
      const { data: capsInsertados, error: errCaps } = await supabase
        .from('presupuesto_capitulos')
        .insert(filasCapitulos)
        .select('id, codigo');
      if (errCaps) throw errCaps;

      const idPorCodigo = {};
      capsInsertados.forEach((c) => { idPorCodigo[c.codigo] = c.id; });

      const filasItems = [];
      datos.capitulos.forEach((c) => {
        c.items.forEach((it) => {
          filasItems.push({
            capitulo_id: idPorCodigo[c.codigo],
            codigo: it.codigo,
            descripcion: it.descripcion,
            unidad: it.unidad,
            cantidad: it.cantidad,
            valor_unitario: it.valor_unitario,
            valor_parcial: it.valor_parcial,
            orden: it.orden,
          });
        });
      });
      if (filasItems.length > 0) {
        const { error: errItems } = await supabase.from('presupuesto_items').insert(filasItems);
        if (errItems) throw errItems;
      }

      await cargar();
    } catch (err) {
      setError(err.message || 'No se pudo cargar el presupuesto.');
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  if (cargando || !usuario || cargandoProyecto || !proyecto) return null;

  const totalPresupuestado = capitulos.reduce((acc, c) => acc + Number(c.valor_presupuestado || 0), 0);
  const totalEjecutado = capitulos.reduce((acc, c) => acc + sumaEjecutadoCapitulo(c, ejecutados), 0);

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-8 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Presupuesto</h1>
            <p className="text-sm text-neutral-500">{proyecto.nombre}</p>
          </div>
          {usuario.rol === 'admin' && (
            <div>
              <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" id="input-presupuesto" onChange={subirArchivo} />
              <label htmlFor="input-presupuesto"
                className="bg-carbon text-hueso px-4 py-2 rounded text-sm cursor-pointer inline-block disabled:opacity-50">
                {subiendo ? 'Cargando...' : presupuesto ? 'Reemplazar presupuesto (Excel)' : 'Cargar presupuesto (Excel)'}
              </label>
            </div>
          )}
        </div>

        {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</p>}

        {cargandoDatos ? null : !presupuesto ? (
          <div className="bg-white rounded-lg shadow-sm border p-8 text-center text-neutral-500">
            <p>Este proyecto todavía no tiene un presupuesto cargado.</p>
            {usuario.rol !== 'admin' && <p className="text-sm mt-1">Pídele a un administrador que cargue el Excel del presupuesto (pestaña &quot;FORMULARIO DE PRECIOS&quot;).</p>}
          </div>
        ) : (
          <>
            <div className="bg-white rounded-lg shadow-sm border p-5 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Dato label="Archivo cargado" valor={presupuesto.nombre_archivo} />
              <Dato label="Cargado por" valor={presupuesto.usuarios?.nombre} />
              <Dato label="Fecha de carga" valor={new Date(presupuesto.cargado_en).toLocaleString('es-CO')} />
              <Dato label="Valor total presupuesto" valor={formatoPesos(presupuesto.valor_total)} />
            </div>

            <div className="bg-carbon text-hueso rounded-lg p-5 grid grid-cols-3 gap-4 text-sm">
              <FilaResumenGrande label="Presupuestado" valor={totalPresupuestado} />
              <FilaResumenGrande label="Ejecutado" valor={totalEjecutado} />
              <FilaResumenGrande label="Saldo" valor={totalPresupuestado - totalEjecutado} />
            </div>

            <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gris-calido/30 text-left">
                  <tr>
                    <th className="p-3 w-24">Ítem</th>
                    <th className="p-3">Descripción</th>
                    <th className="p-3 text-right">Presupuestado</th>
                    <th className="p-3 text-right">Ejecutado</th>
                    <th className="p-3 text-right">Saldo</th>
                    <th className="p-3 text-right w-20">% Usado</th>
                    <th className="p-3 w-32">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {capitulos.map((cap) => {
                    const ejecutadoCap = sumaEjecutadoCapitulo(cap, ejecutados);
                    const presupuestadoCap = Number(cap.valor_presupuestado || 0);
                    const saldoCap = presupuestadoCap - ejecutadoCap;
                    const pctCap = presupuestadoCap > 0 ? (ejecutadoCap / presupuestadoCap) * 100 : 0;
                    const estado = estadoDe(presupuestadoCap, ejecutadoCap);
                    const abierto = !!expandidos[cap.id];
                    return (
                      <Fragment key={cap.id}>
                        <tr className="border-t bg-gris-calido/20 font-semibold cursor-pointer hover:bg-gris-calido/30" onClick={() => toggleCapitulo(cap.id)}>
                          <td className="p-3">{abierto ? '▾' : '▸'} {cap.codigo}</td>
                          <td className="p-3">{cap.nombre}</td>
                          <td className="p-3 text-right">{formatoPesos(presupuestadoCap)}</td>
                          <td className="p-3 text-right">{formatoPesos(ejecutadoCap)}</td>
                          <td className="p-3 text-right">{formatoPesos(saldoCap)}</td>
                          <td className="p-3 text-right">{pctCap.toFixed(0)}%</td>
                          <td className="p-3"><Estado estado={estado} /></td>
                        </tr>
                        {abierto && cap.presupuesto_items.map((it) => {
                          const ej = ejecutados[it.id] || 0;
                          const pres = Number(it.valor_parcial || 0);
                          return (
                            <tr key={it.id} className="border-t text-neutral-600">
                              <td className="p-3 pl-6">{it.codigo}</td>
                              <td className="p-3">{it.descripcion}</td>
                              <td className="p-3 text-right">{formatoPesos(pres)}</td>
                              <td className="p-3 text-right">{formatoPesos(ej)}</td>
                              <td className="p-3 text-right">{formatoPesos(pres - ej)}</td>
                              <td className="p-3 text-right">{pres > 0 ? ((ej / pres) * 100).toFixed(0) : 0}%</td>
                              <td className="p-3"></td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function sumaEjecutadoCapitulo(cap, ejecutados) {
  return (cap.presupuesto_items || []).reduce((acc, it) => acc + (ejecutados[it.id] || 0), 0);
}

function estadoDe(presupuestado, ejecutado) {
  if (presupuestado <= 0) return null;
  const pct = ejecutado / presupuestado;
  if (pct > 1) return 'SOBREGIRO';
  if (pct >= 0.9) return 'ALERTA';
  return 'OK';
}

function Estado({ estado }) {
  if (!estado) return <span className="text-neutral-400">—</span>;
  const estilos = {
    OK: 'bg-green-100 text-green-700',
    ALERTA: 'bg-amber-100 text-amber-700',
    SOBREGIRO: 'bg-red-100 text-red-700',
  };
  const etiquetas = { OK: '🟢 OK', ALERTA: '🟠 ALERTA', SOBREGIRO: '🔴 SOBREGIRO' };
  return <span className={`text-xs px-2 py-1 rounded font-medium ${estilos[estado]}`}>{etiquetas[estado]}</span>;
}

function Dato({ label, valor }) {
  return <div><span className="text-neutral-500 block text-xs">{label}</span><span className="font-medium">{valor ?? '—'}</span></div>;
}

function FilaResumenGrande({ label, valor }) {
  return (
    <div>
      <p className="text-gris-calido text-xs mb-1">{label}</p>
      <p className="text-lg font-semibold">{formatoPesos(valor)}</p>
    </div>
  );
}
