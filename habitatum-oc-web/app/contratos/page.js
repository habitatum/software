'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import NavBar from '@/components/NavBar';

const VACIO = { codigo_proyecto: '', anio: new Date().getFullYear(), consecutivo: 1, contratista_id: '', concepto: '', valor_inicial: 0 };

export default function Contratos() {
  const { usuario, cargando } = useUsuarioActual();
  const [contratos, setContratos] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [form, setForm] = useState(VACIO);
  const [mostrarForm, setMostrarForm] = useState(false);

  async function cargar() {
    const supabase = crearClienteSupabase();
    const { data: cont } = await supabase.from('contratos').select('*, proveedores(nombre)').order('numero_contrato');
    const { data: prov } = await supabase.from('proveedores').select('id, nombre').order('nombre');
    setContratos(cont || []);
    setProveedores(prov || []);
  }
  useEffect(() => { if (usuario) cargar(); }, [usuario]); // eslint-disable-line

  async function guardar(e) {
    e.preventDefault();
    const supabase = crearClienteSupabase();
    await supabase.from('contratos').insert(form);
    setForm(VACIO);
    setMostrarForm(false);
    cargar();
  }

  if (cargando || !usuario) return null;

  return (
    <div>
      <NavBar usuario={usuario} />
      <main className="p-8 max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">Contratos</h1>
          {usuario.rol !== 'lectura' && (
            <button onClick={() => setMostrarForm(!mostrarForm)} className="bg-carbon text-hueso px-4 py-2 rounded text-sm">
              {mostrarForm ? 'Cancelar' : '+ Nuevo contrato'}
            </button>
          )}
        </div>

        {mostrarForm && (
          <form onSubmit={guardar} className="bg-white border rounded-lg p-5 grid grid-cols-3 gap-3 mb-6">
            <input required placeholder="Código proyecto" value={form.codigo_proyecto} onChange={(e) => setForm({ ...form, codigo_proyecto: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            <input required type="number" placeholder="Año" value={form.anio} onChange={(e) => setForm({ ...form, anio: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            <input required type="number" placeholder="Consecutivo" value={form.consecutivo} onChange={(e) => setForm({ ...form, consecutivo: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            <select required value={form.contratista_id} onChange={(e) => setForm({ ...form, contratista_id: e.target.value })} className="border rounded px-3 py-2 text-sm col-span-2">
              <option value="">Contratista...</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            <input type="number" placeholder="Valor inicial" value={form.valor_inicial} onChange={(e) => setForm({ ...form, valor_inicial: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            <input placeholder="Concepto" value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} className="border rounded px-3 py-2 text-sm col-span-3" />
            <button className="bg-carbon text-hueso px-4 py-2 rounded text-sm col-span-3">Guardar</button>
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
