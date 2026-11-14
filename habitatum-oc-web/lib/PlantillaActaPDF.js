import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { EncabezadoPDF, COLOR_DORADO, COLOR_FONDO } from './EncabezadoPDF';
import { CONDICIONES_INICIO, DOCUMENTOS_ENTREGA, MODALIDAD } from './actasProyecto';

// 081 · Acta de inicio y Acta de entrega y recibo de obra (borradores aprobados el 13/11/2026).
const HUESO = '#f4efe8';
const e = StyleSheet.create({
  pagina: { padding: 32, paddingBottom: 48, fontSize: 9, fontFamily: 'Helvetica', color: '#2e2e2e', lineHeight: 1.35 },
  titulo: { fontSize: 15, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginBottom: 2 },
  sub: { fontSize: 9, textAlign: 'center', color: '#6b655d', marginBottom: 12 },
  seccion: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: COLOR_FONDO, borderBottomWidth: 1, borderBottomColor: COLOR_DORADO, paddingBottom: 2, marginTop: 12, marginBottom: 6 },
  fila: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#ddd6cc', paddingVertical: 3 },
  etq: { width: '34%', color: '#6b655d' },
  val: { width: '66%', fontFamily: 'Helvetica-Bold' },
  vacio: { color: '#b0a89c', fontFamily: 'Helvetica' },
  p: { marginBottom: 5, textAlign: 'justify' },
  th: { flexDirection: 'row', backgroundColor: COLOR_FONDO, color: 'white', padding: 4, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  tr: { flexDirection: 'row', padding: 4, borderBottomWidth: 0.5, borderBottomColor: '#ddd6cc', fontSize: 8.5 },
  caja: { backgroundColor: HUESO, padding: 8, marginTop: 4 },
  firmas: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 34 },
  firma: { width: '30%' },
  raya: { borderTopWidth: 1, borderTopColor: '#2e2e2e', paddingTop: 3, fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  nota: { fontSize: 7.5, color: '#6b655d' },
  pie: { position: 'absolute', bottom: 18, left: 32, right: 32, fontSize: 7, color: '#8a8278', flexDirection: 'row', justifyContent: 'space-between' },
  borrador: { position: 'absolute', top: 300, left: 60, fontSize: 70, color: '#b88a52', opacity: 0.08, transform: 'rotate(-30deg)', fontFamily: 'Helvetica-Bold' },
});
const n = (v) => Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;
const pesos = (v) => '$ ' + Math.round(n(v)).toLocaleString('es-CO');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fecha = (f) => { if (!f) return ''; const p = String(f).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
const V = (v) => (v ? String(v) : <Text style={e.vacio}>________________________</Text>);
const Dato = ({ k, v }) => <View style={e.fila} wrap={false}><Text style={e.etq}>{k}</Text><Text style={e.val}>{V(v)}</Text></View>;
// Casilla: marcada = rellena (la opción elegida en el formulario).
const Caja = ({ marcada }) => (
  <View style={{ width: 7, height: 7, borderWidth: 0.8, borderColor: '#2e2e2e', marginRight: 3, marginTop: 1, padding: 1 }}>
    {marcada && <View style={{ flex: 1, backgroundColor: '#2e2e2e' }} />}
  </View>
);
const Opc = ({ ops, w, valor }) => (
  <View style={{ width: w, flexDirection: 'row' }}>
    {ops.map(([k, t]) => <View key={k} style={{ flexDirection: 'row', marginRight: 10 }}><Caja marcada={valor === k} /><Text>{t}</Text></View>)}
  </View>
);
function lugarYFecha(d) {
  if (!d.fecha_acta) return `en ${d.ciudad || '__________'}, a los ____ días del mes de __________ de 20___`;
  const [a, m, dia] = String(d.fecha_acta).slice(0, 10).split('-');
  return `en ${d.ciudad || '__________'}, a los ${Number(dia)} días del mes de ${MESES[Number(m) - 1]} de ${a}`;
}

function Generales({ m }) {
  const d = m.d;
  return (
    <>
      <Text style={e.seccion}>1. Datos generales</Text>
      <Dato k="Proyecto" v={`${m.proyecto.nombre}${m.proyecto.codigo ? ` (código ${m.proyecto.codigo})` : ''}`} />
      <Dato k="Dirección de la obra" v={[d.direccion, d.ciudad].filter(Boolean).join(', ')} />
      <Dato k="Contratante" v={d.cliente} />
      <Dato k="NIT / C.C. del contratante" v={d.nit_cliente} />
      <Dato k="Representante del contratante" v={d.rep_cliente} />
      <Dato k="Contratista" v={[d.contratista, d.nit_contratista && `NIT ${d.nit_contratista}`].filter(Boolean).join(' · ')} />
      <Dato k="Representante del contratista" v={d.rep_contratista} />
      <Dato k="Contrato No. / fecha" v={d.contrato_no} />
      <Dato k="Modalidad" v={m.modalidad} />
      <Dato k="Objeto" v={d.objeto} />
      <Dato k="Valor del contrato" v={n(d.valor) ? pesos(d.valor) : ''} />
    </>
  );
}
function Firmas({ m }) {
  const d = m.d;
  return (
    <View style={e.firmas} wrap={false}>
      <View style={e.firma}><Text style={e.raya}>{d.rep_cliente || 'Nombre:'}</Text><Text style={e.nota}>EL CONTRATANTE{d.cliente ? ` · ${d.cliente}` : ''}</Text><Text style={e.nota}>C.C. / NIT: {d.nit_cliente || ''}</Text></View>
      <View style={e.firma}><Text style={e.raya}>{d.rep_contratista || 'Nombre:'}</Text><Text style={e.nota}>EL CONTRATISTA{d.contratista ? ` · ${d.contratista}` : ''}</Text><Text style={e.nota}>{d.nit_contratista ? `NIT ${d.nit_contratista}` : 'C.C. / NIT:'}</Text></View>
      <View style={e.firma}><Text style={e.raya}>{d.director || 'Director de obra'}</Text><Text style={e.nota}>Director de obra / Residente</Text><Text style={e.nota}>C.C.:</Text></View>
    </View>
  );
}
function Pie({ m, doc }) {
  return (
    <View style={e.pie} fixed>
      <Text>{[m.d.contratista, m.d.nit_contratista && `NIT ${m.d.nit_contratista}`].filter(Boolean).join(' · ')} · {doc} · {m.proyecto.nombre}</Text>
      <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  );
}

function ActaInicio({ m }) {
  const d = m.d;
  return (
    <Page size="LETTER" style={e.pagina}>
      {m.borrador && <Text style={e.borrador} fixed>BORRADOR</Text>}
      <EncabezadoPDF tituloDocumento="Acta de inicio de obra" nombreObra={m.proyecto.nombre} mostrarMarcaHabitatum={m.proyecto.mostrar_marca_habitatum} nombreEmisor={m.proyecto.nombre_emisor} />
      <Text style={e.titulo}>ACTA DE INICIO DE OBRA No. {d.numero || '01'}</Text>
      <Text style={e.sub}>Contrato de obra a {m.modalidad.toLowerCase()} · Fecha del acta: {fecha(d.fecha_acta) || '________________'}</Text>
      <Generales m={m} />
      <Text style={e.seccion}>2. Plazo y fechas</Text>
      <Dato k="Plazo de ejecución" v={d.plazo} />
      <Dato k="Fecha de inicio" v={fecha(d.inicio)} />
      <Dato k="Fecha prevista de terminación" v={fecha(d.fin)} />
      <Dato k="Horario de obra" v={d.horario} />
      <Dato k="Director de obra / residente" v={d.director} />
      <Text style={e.seccion}>3. Condiciones para el inicio</Text>
      <Text style={e.p}>Las partes dejan constancia de que, a la fecha de esta acta, se cumplen las condiciones para iniciar la obra:</Text>
      {CONDICIONES_INICIO.map((c) => {
        const t = c.k === 'anticipo' && n(d.anticipo_valor) ? `${c.t} (${pesos(d.anticipo_valor)}${d.anticipo_fecha ? ` el ${fecha(d.anticipo_fecha)}` : ''})` : c.t;
        return (
          <View key={c.k} style={e.tr} wrap={false}>
            <Text style={{ width: '62%' }}>{t}</Text>
            <Opc w="38%" valor={d.condiciones?.[c.k]} ops={c.na ? [['SI', 'Sí'], ['NO', 'No'], ['NA', 'No aplica']] : [['SI', 'Sí'], ['NO', 'No']]} />
          </View>
        );
      })}
      <Text style={e.seccion}>4. Observaciones</Text>
      <View style={[e.caja, { minHeight: 45 }]}>{d.observaciones ? <Text>{d.observaciones}</Text> : <Text style={e.vacio}>Sin observaciones.</Text>}</View>
      <View wrap={false}>
        <Text style={[e.p, { marginTop: 10 }]}>Para constancia, se firma por las partes {lugarYFecha(d)}, fecha a partir de la cual empieza a contar el plazo de ejecución del contrato.</Text>
        <Firmas m={m} />
      </View>
      <Pie m={m} doc="Acta de inicio" />
    </Page>
  );
}

function ActaEntrega({ m }) {
  const d = m.d;
  const w = [{ width: '8%' }, { width: '52%' }, { width: '14%', textAlign: 'center' }, { width: '26%' }];
  const valorFinal = n(d.valor) + n(d.adicionales) - n(d.deductivos);
  const pendientes = (d.pendientes || []).filter((x) => x.descripcion);
  const filasP = pendientes.length ? pendientes : [{}, {}, {}];
  return (
    <Page size="LETTER" style={e.pagina}>
      {m.borrador && <Text style={e.borrador} fixed>BORRADOR</Text>}
      <EncabezadoPDF tituloDocumento="Acta de entrega y recibo de obra" nombreObra={m.proyecto.nombre} mostrarMarcaHabitatum={m.proyecto.mostrar_marca_habitatum} nombreEmisor={m.proyecto.nombre_emisor} />
      <Text style={e.titulo}>ACTA DE ENTREGA Y RECIBO DE OBRA</Text>
      <Text style={e.sub}>Contrato de obra a {m.modalidad.toLowerCase()} · Fecha del acta: {fecha(d.fecha_acta) || '________________'}</Text>
      <Generales m={m} />
      <Text style={e.seccion}>2. Plazo</Text>
      <Dato k="Fecha de inicio (acta de inicio)" v={fecha(d.inicio)} />
      <Dato k="Fecha prevista de terminación" v={fecha(d.fin_prevista)} />
      <Dato k="Prórrogas / suspensiones" v={d.prorrogas} />
      <Dato k="Fecha real de terminación" v={fecha(d.fin_real)} />
      <Text style={e.seccion}>3. Obra entregada</Text>
      <Text style={e.p}>El contratista entrega y el contratante recibe las siguientes actividades del contrato, verificadas en el recorrido de entrega:</Text>
      <View style={e.th}><Text style={w[0]}>Cap.</Text><Text style={w[1]}>Capítulo</Text><Text style={w[2]}>% ejecutado</Text><Text style={w[3]}>Recibido</Text></View>
      {(d.capitulos || []).map((c, i) => (
        <View key={i} style={e.tr} wrap={false}>
          <Text style={w[0]}>{c.codigo}</Text><Text style={w[1]}>{c.nombre}</Text><Text style={w[2]}>{c.pct !== '' && c.pct !== undefined ? `${String(c.pct).replace('.', ',')} %` : ''}</Text>
          <Opc w={w[3].width} valor={c.estado} ops={[['CONFORME', 'Conforme'], ['PENDIENTES', 'Con pendientes']]} />
        </View>
      ))}
      <Text style={e.seccion}>4. Balance económico</Text>
      {[
        ['Valor inicial del contrato', pesos(d.valor)],
        ['(+) Adicionales aprobados', pesos(d.adicionales)],
        ['(-) Obras no ejecutadas / deductivos', pesos(d.deductivos)],
        ['Valor final del contrato', pesos(valorFinal), true],
        ['(-) Pagos recibidos del contratante', pesos(d.pagos)],
        [valorFinal - n(d.pagos) >= 0 ? 'Saldo a pagar por el contratante' : 'Saldo a favor del contratante', pesos(Math.abs(valorFinal - n(d.pagos))), true],
      ].map(([a, b, neg], i) => (
        <View key={i} style={e.fila} wrap={false}>
          <Text style={{ width: '70%', fontFamily: neg ? 'Helvetica-Bold' : 'Helvetica' }}>{a}</Text>
          <Text style={{ width: '30%', textAlign: 'right', fontFamily: neg ? 'Helvetica-Bold' : 'Helvetica' }}>{b}</Text>
        </View>
      ))}
      <Text style={e.seccion}>5. Pendientes por corregir</Text>
      <View style={e.th}><Text style={{ width: '6%' }}>#</Text><Text style={{ width: '54%' }}>Descripción del pendiente</Text><Text style={{ width: '20%' }}>Responsable</Text><Text style={{ width: '20%' }}>Fecha compromiso</Text></View>
      {filasP.map((x, i) => (
        <View key={i} style={[e.tr, { minHeight: 18 }]} wrap={false}>
          <Text style={{ width: '6%' }}>{i + 1}</Text><Text style={{ width: '54%' }}>{x.descripcion || ''}</Text>
          <Text style={{ width: '20%' }}>{x.responsable || ''}</Text><Text style={{ width: '20%' }}>{fecha(x.fecha)}</Text>
        </View>
      ))}
      <Text style={e.seccion}>6. Documentos que se entregan</Text>
      {DOCUMENTOS_ENTREGA.map((c) => (
        <View key={c.k} style={e.tr} wrap={false}><Text style={{ width: '76%' }}>{c.t}</Text>
          <Opc w="24%" valor={d.documentos?.[c.k]} ops={[['SI', 'Sí'], ['NA', 'No aplica']]} /></View>
      ))}
      {d.observaciones ? (<><Text style={e.seccion}>Observaciones</Text><View style={e.caja}><Text>{d.observaciones}</Text></View></>) : null}
      <View wrap={false}>
        <Text style={e.seccion}>7. Recibo a satisfacción y garantías</Text>
        <Text style={e.p}>Con la firma de esta acta el contratante recibe la obra a satisfacción{pendientes.length ? ', salvo los pendientes listados en el numeral 5, que el contratista se compromete a corregir en las fechas indicadas' : ''}. A partir de esta fecha el contratante asume la custodia, el uso y el mantenimiento del inmueble, y empiezan a correr las garantías: estabilidad de la obra según la ley, y garantía de acabados de {d.meses_garantia || '______'} meses frente a defectos de ejecución. Las garantías no cubren daños por uso indebido, falta de mantenimiento o intervenciones de terceros.</Text>
        <Text style={e.p}>Para constancia se firma {lugarYFecha(d)}.</Text>
        <Firmas m={m} />
      </View>
      <Pie m={m} doc="Acta de entrega" />
    </Page>
  );
}

export default function PlantillaActaPDF({ m }) {
  m = { ...m, modalidad: MODALIDAD[m.proyecto.modelo_contratacion] || 'Todo costo' };
  return (
    <Document title={m.tipo === 'INICIO' ? 'Acta de inicio' : 'Acta de entrega'}>
      {m.tipo === 'INICIO' ? <ActaInicio m={m} /> : <ActaEntrega m={m} />}
    </Document>
  );
}
