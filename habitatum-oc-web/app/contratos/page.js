'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import NavBar from '@/components/NavBar';

const ANIO_ACTUAL = new Date().getFullYear();
const VACIO = { anio: ANIO_ACTUAL, consecutivo: 1, contratista_id: '', concepto: '', valor_inicial: 0 };

export default function Contratos() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [contratos, setContratos] = useState([]);
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
      .insert({ ...form, proyecto_id: proyecto.id, codigo_proyecto: proyecto.codigo });
    setGuardando(false);
    if (err) {
      setError(
        err.message.includes('duplicate')
          ? 'Ese consecutivo ya se usó para este proyecto y año. Elige otro.'
          : err.message
      );
      cargar(); // por si el desplegable quedó desactualizado (ej. otra persona creó un contrato al mismo tiempo)
      return;
    }
    setForm(VACIO);
    setMostrarForm(false);
    cargar();
  }

  if (cargando || !usuario || cargandoProyecto || !proyecto) return null;

  const disponiblesParaElAnio = consecutivosDisponibles(form.anio);

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
          <form onSubmit={guardar} className="bg-white border rounded-lg p-5 grid grid-cols-3 gap-3 mb-6">
            <p className="col-span-3 text-xs text-neutral-500">
              Proyecto: <span className="font-medium text-neutral-700">{proyecto.nombre} ({proyecto.codigo})</span>
            </p>
            <input
              required
              type="number"
              placeholder="Año"
              value={form.anio}
              onChange={(e) => cambiarAnio(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            />
            <select
              required
              value={form.consecutivo}
              onChange={(e) => setForm({ ...form, consecutivo: Number(e.target.value) })}
              className="border rounded px-3 py-2 text-sm"
            >
              {disponiblesParaElAnio.map((n) => (
                <option key={n} value={n}>{String(n).padStart(2, '0')}</option>
              ))}
            </select>
            <input type="number" placeholder="Valor inicial" value={form.valor_inicial} onChange={(e) => setForm({ ...form, valor_inicial: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            <p className="col-span-3 text-xs text-neutral-400 -mt-1">
              N° de contrato: {proyecto.codigo}-{form.anio}-{String(form.consecutivo).padStart(2, '0')}
            </p>
            <select required value={form.contratista_id} onChange={(e) => setForm({ ...form, contratista_id: e.target.value })} className="border rounded px-3 py-2 text-sm col-span-3">
              <option value="">Contratista...</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            <input placeholder="Concepto" value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} className="border rounded px-3 py-2 text-sm col-span-3" />
            {error && <p className="col-span-3 text-red-600 text-sm">{error}</p>}
            <button disabled={guardando} className="bg-carbon text-hueso px-4 py-2 rounded text-sm col-span-3 disabled:opacity-50">
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
                <tr key={c.id} className="border-t hover:bg-hueso">
                  <td className="p-3"><Link href={`/contratos/${c.id}`} className="text-blue-700 hover:underline">{c.numero_contrato}</Link></td>
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
