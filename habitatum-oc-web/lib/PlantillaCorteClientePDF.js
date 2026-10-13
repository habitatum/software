import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { formatoPesos } from './calculosOC';
import { EncabezadoPDF, COLOR_DORADO, COLOR_FONDO } from './EncabezadoPDF';
import { fechaCC, cantCC, tituloCorte } from './cortesCliente';

// Acta de CORTE / LIQUIDACIÓN AL CLIENTE (todo costo) — misma línea gráfica del corte de obra.
const HUESO = '#efece6';
const HUESO_CLARO = '#f7f5f1';
const GRIS_CALIDO = '#cdc5ba';
const TEXTO_SUAVE = '#6b655d';
const ROJO = '#9b2c2c';
const VERDE = '#1e6b2e';
const CAFE = '#f3e9dc';

const e = StyleSheet.create({
  pagina: { paddingTop: 30, paddingHorizontal: 26, paddingBottom: 46, fontSize: 7.5, fontFamily: 'Helvetica', color: '#2e2e2e' },
  titulo: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  sub: { fontSize: 8.5, color: TEXTO_SUAVE, marginTop: 2 },
  filaTitulo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 },
  datos: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  bloque: { flex: 1, borderWidth: 0.5, borderColor: GRIS_CALIDO, borderRadius: 3 },
  bloqueT: { backgroundColor: HUESO, padding: 4, fontFamily: 'Helvetica-Bold', fontSize: 8, borderBottomWidth: 1, borderBottomColor: COLOR_DORADO },
  dato: { flexDirection: 'row', paddingVertical: 2, paddingHorizontal: 5 },
  et: { width: '38%', color: TEXTO_SUAVE },
  va: { width: '62%' },
  seccion: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 8, marginBottom: 4, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: COLOR_DORADO },
  th: { flexDirection: 'row', backgroundColor: COLOR_FONDO, color: 'white', paddingVertical: 4, paddingHorizontal: 2, fontFamily: 'Helvetica-Bold', fontSize: 6.8 },
  tr: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 2, borderBottomWidth: 0.5, borderBottomColor: HUESO },
  trAlt: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 2, borderBottomWidth: 0.5, borderBottomColor: HUESO, backgroundColor: HUESO_CLARO },
  grupo: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 2, backgroundColor: HUESO, fontFamily: 'Helvetica-Bold', color: '#6b4a22' },
  tt: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 2, backgroundColor: HUESO, fontFamily: 'Helvetica-Bold', borderTopWidth: 1, borderTopColor: COLOR_DORADO },
  ttGeneral: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 2, backgroundColor: COLOR_FONDO, color: 'white', fontFamily: 'Helvetica-Bold' },
  corte: { backgroundColor: CAFE, fontFamily: 'Helvetica-Bold' },
  resumen: { flexDirection: 'row', gap: 8, marginTop: 8 },
  resFila: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 6 },
  resNeto: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 6, backgroundColor: COLOR_FONDO, color: 'white', fontFamily: 'Helvetica-Bold', fontSize: 10.5 },
  nota: { fontSize: 7, color: TEXTO_SUAVE, lineHeight: 1.35 },
  firmas: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 34 },
  firma: { width: '34%' },
  raya: { borderTopWidth: 0.5, borderTopColor: '#2e2e2e', paddingTop: 3, fontFamily: 'Helvetica-Bold', fontSize: 7.5 },
  pie: { position: 'absolute', bottom: 18, left: 26, right: 26, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.5, color: TEXTO_SUAVE, borderTopWidth: 0.5, borderTopColor: GRIS_CALIDO, paddingTop: 4 },
});

const pesos = (v) => formatoPesos(Math.round(Number(v) || 0));
const pct = (v) => `${(Math.round((Number(v) || 0) * 10) / 10).toLocaleString('es-CO')}%`;

function Dato({ et, va }) {
  return <View style={e.dato}><Text style={e.et}>{et}</Text><Text style={e.va}>{va || '-'}</Text></View>;
}

// Resumen por capítulo (columnas en %).
function TablaCapitulos({ grupos, final }) {
  const w = final
    ? { cap: '30%', modo: '8%', n: '11%', av: '7%' }
    : { cap: '35%', modo: '9%', n: '12%', av: '8%' };
  const N = { width: w.n, textAlign: 'right' };
  const filaCap = (c, i) => (
    <View key={c.id} style={i % 2 ? e.trAlt : e.tr} wrap={false}>
      <Text style={{ width: w.cap, paddingRight: 3 }}>{c.codigo} · {c.nombre}</Text>
      <Text style={{ width: w.modo, color: TEXTO_SUAVE }}>{c.modo === 'GLOBAL' ? 'Global' : 'Cantidades'}</Text>
      <Text style={N}>{pesos(c.contratado)}</Text>
      <Text style={N}>{pesos(c.anterior)}</Text>
      <Text style={[N, e.corte]}>{pesos(c.este)}</Text>
      <Text style={[N, { fontFamily: 'Helvetica-Bold' }]}>{pesos(c.acumulado)}</Text>
      <Text style={{ width: w.av, textAlign: 'right' }}>{pct(c.avance)}</Text>
      {final && <Text style={[N, { color: c.diferencia > 0 ? ROJO : c.diferencia < 0 ? VERDE : TEXTO_SUAVE }]}>{c.diferencia ? pesos(c.diferencia) : '—'}</Text>}
    </View>
  );
  return (
    <View>
      <View style={e.th} fixed>
        <Text style={{ width: w.cap }}>Capítulo</Text><Text style={{ width: w.modo }}>Modo</Text>
        <Text style={N}>Contratado</Text><Text style={N}>Anterior</Text><Text style={N}>Este corte</Text><Text style={N}>Acumulado</Text>
        <Text style={{ width: w.av, textAlign: 'right' }}>Avance</Text>
        {final && <Text style={N}>Diferencia</Text>}
      </View>
      {grupos.map((g) => (
        <View key={g.clave}>
          <View wrap={false}>
            <View style={e.grupo}><Text>{g.titulo.toUpperCase()}</Text></View>
            {g.capitulos[0] && filaCap(g.capitulos[0], 0)}
          </View>
          {g.capitulos.slice(1).map((c, j) => filaCap(c, j + 1))}
          <View style={e.tt} wrap={false}>
            <Text style={{ width: `${parseFloat(w.cap) + parseFloat(w.modo)}%` }}>Subtotal {g.titulo.toLowerCase()}</Text>
            <Text style={N}>{pesos(g.contratado)}</Text><Text style={N}>{pesos(g.anterior)}</Text>
            <Text style={N}>{pesos(g.este)}</Text><Text style={N}>{pesos(g.acumulado)}</Text>
            <Text style={{ width: w.av }} />
            {final && <Text style={N}>{pesos(g.acumulado - g.contratado)}</Text>}
          </View>
        </View>
      ))}
    </View>
  );
}

function TablaItems({ cap }) {
  const filas = cap.items.filter((it) => Number(it.contratado) || Number(it.acumulado));
  if (!filas.length) return null;
  const N = { width: '7.5%', textAlign: 'right' };
  const V = { width: '10%', textAlign: 'right' };
  return (
    <View style={{ marginBottom: 6 }}>
      <View style={e.grupo} wrap={false} minPresenceAhead={60}><Text>{cap.codigo} · {cap.nombre}{cap.grupo === 'PAGO_DIRECTO_CLIENTE' ? ' (informativo)' : ''}</Text></View>
      <View style={e.th} wrap={false}>
        <Text style={{ width: '5%' }}>Ítem</Text><Text style={{ width: '29%' }}>Descripción</Text><Text style={{ width: '4%' }}>Und</Text>
        <Text style={N}>Contratado</Text><Text style={N}>Anterior</Text><Text style={N}>Este corte</Text><Text style={N}>Acumulado</Text>
        <Text style={V}>Vr. unit.</Text><Text style={V}>Valor corte</Text><Text style={V}>Valor acum.</Text>
      </View>
      {filas.map((it, i) => (
        <View key={it.id} style={i % 2 ? e.trAlt : e.tr} wrap={false}>
          <Text style={{ width: '5%' }}>{it.codigo}</Text>
          <Text style={{ width: '29%', paddingRight: 3 }}>{it.descripcion.length > 130 ? it.descripcion.slice(0, 130) + '…' : it.descripcion}</Text>
          <Text style={{ width: '4%' }}>{it.unidad || ''}</Text>
          <Text style={N}>{cantCC(it.contratado)}</Text>
          <Text style={N}>{cantCC(it.anterior)}</Text>
          <Text style={[N, e.corte]}>{cantCC(it.este)}</Text>
          <Text style={[N, it.excede ? { color: ROJO, fontFamily: 'Helvetica-Bold' } : null]}>{cantCC(it.acumulado)}</Text>
          <Text style={V}>{pesos(it.valor_unitario)}</Text>
          <Text style={[V, { fontFamily: 'Helvetica-Bold' }]}>{pesos(it.valor_este)}</Text>
          <Text style={V}>{pesos(it.valor_acumulado)}</Text>
        </View>
      ))}
    </View>
  );
}

export default function PlantillaCorteClientePDF({ calc }) {
  const { corte, proyecto, grupos, tot, pagos } = calc;
  const marca = proyecto?.mostrar_marca_habitatum !== false;
  const contratista = marca ? 'HABITATUM S.A.S.' : (proyecto?.nombre_emisor || 'Contratista');
  const titulo = tituloCorte(corte);
  const estado = corte.estado === 'CERRADO' ? 'Cerrado' : 'BORRADOR (sin cerrar)';
  const info = grupos.find((g) => !g.suma);
  const capsCant = calc.capitulos.filter((c) => c.modo === 'CANTIDAD' && c.items.some((it) => Number(it.contratado) || Number(it.acumulado)));
  const aFavor = tot.saldo < 0;

  return (
    <Document title={`${titulo} ${proyecto?.nombre || ''}`} author={contratista}>
      <Page size="A4" orientation="landscape" style={e.pagina}>
        <EncabezadoPDF tituloDocumento={`${titulo} · Cobro al cliente`} nombreObra={proyecto?.nombre} mostrarMarcaHabitatum={marca} nombreEmisor={proyecto?.nombre_emisor} />
        <View style={e.filaTitulo}>
          <View>
            <Text style={e.titulo}>{titulo}</Text>
            <Text style={e.sub}>{corte.es_final ? `Corte No. ${corte.numero} · liquidación del contrato y sus adicionales` : 'Avance de obra liquidado al cliente'}</Text>
          </View>
          <View>
            <Text style={[e.sub, { textAlign: 'right' }]}>Fecha del corte</Text>
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: COLOR_DORADO, textAlign: 'right' }}>{fechaCC(corte.fecha)}</Text>
            <Text style={[e.sub, { textAlign: 'right', color: corte.estado === 'CERRADO' ? '#2f6b3a' : ROJO }]}>{estado}</Text>
          </View>
        </View>

        <View style={e.datos}>
          <View style={e.bloque}>
            <Text style={e.bloqueT}>Cliente y obra</Text>
            <Dato et="Cliente" va={proyecto?.cliente} />
            <Dato et="Obra" va={proyecto?.nombre} />
            <Dato et="Dirección" va={[proyecto?.direccion_obra, proyecto?.ciudad].filter(Boolean).join(' · ')} />
          </View>
          <View style={e.bloque}>
            <Text style={e.bloqueT}>Contrato</Text>
            <Dato et="Valor contratado" va={pesos(tot.contratado)} />
            <Dato et="Corte anterior" va={calc.numero_anterior ? `No. ${calc.numero_anterior}` : 'Primer corte'} />
            <Dato et="Avance liquidado" va={tot.contratado > 0 ? pct((tot.acumulado / tot.contratado) * 100) : '—'} />
          </View>
        </View>

        <Text style={e.seccion}>Resumen por capítulo</Text>
        <TablaCapitulos grupos={grupos} final={corte.es_final} />
        <View style={e.ttGeneral} wrap={false}>
          <Text style={{ width: corte.es_final ? '38%' : '44%' }}>TOTAL LIQUIDADO (contrato + adicionales)</Text>
          <Text style={{ width: corte.es_final ? '11%' : '12%', textAlign: 'right' }}>{pesos(tot.contratado)}</Text>
          <Text style={{ width: corte.es_final ? '11%' : '12%', textAlign: 'right' }}>{pesos(tot.anterior)}</Text>
          <Text style={{ width: corte.es_final ? '11%' : '12%', textAlign: 'right' }}>{pesos(tot.este)}</Text>
          <Text style={{ width: corte.es_final ? '11%' : '12%', textAlign: 'right' }}>{pesos(tot.acumulado)}</Text>
          <Text style={{ width: corte.es_final ? '7%' : '8%' }} />
          {corte.es_final && <Text style={{ width: '11%', textAlign: 'right' }}>{pesos(tot.acumulado - tot.contratado)}</Text>}
        </View>
        {info && (
          <Text style={[e.nota, { marginTop: 3 }]}>
            Los capítulos de pago directo del cliente ({pesos(info.acumulado)}) se muestran solo como información: los pagó el cliente directamente y no suman al total liquidado.
          </Text>
        )}

        <View style={e.resumen} wrap={false}>
          <View style={[e.bloque, { flex: 1.2 }]}>
            <Text style={e.bloqueT}>Pagos recibidos del cliente</Text>
            {(pagos || []).length === 0 && <Text style={[e.nota, { padding: 6 }]}>Sin pagos registrados hasta la fecha del corte.</Text>}
            {(pagos || []).map((p, i) => (
              <View key={i} style={e.resFila}><Text>{fechaCC(p.fecha)} · {p.concepto}</Text><Text>{pesos(p.valor)}</Text></View>
            ))}
            <View style={[e.resFila, { fontFamily: 'Helvetica-Bold', borderTopWidth: 1, borderTopColor: COLOR_DORADO }]}><Text>Total pagos</Text><Text>{pesos(tot.pagos)}</Text></View>
          </View>
          <View style={[e.bloque, { flex: 1 }]}>
            <Text style={e.bloqueT}>Estado de cuenta</Text>
            <View style={e.resFila}><Text>Valor de este corte</Text><Text>{pesos(tot.este)}</Text></View>
            <View style={e.resFila}><Text>Total liquidado acumulado</Text><Text style={{ fontFamily: 'Helvetica-Bold' }}>{pesos(tot.acumulado)}</Text></View>
            <View style={e.resFila}><Text>(-) Pagos recibidos del cliente</Text><Text>{pesos(tot.pagos)}</Text></View>
            <View style={e.resNeto}><Text>{aFavor ? 'SALDO A FAVOR DEL CLIENTE' : 'SALDO A PAGAR POR EL CLIENTE'}</Text><Text>{pesos(Math.abs(tot.saldo))}</Text></View>
          </View>
        </View>

        {corte.notas ? (
          <View style={{ borderWidth: 0.5, borderColor: GRIS_CALIDO, borderRadius: 3, marginTop: 8, padding: 6 }} wrap={false}>
            <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>Observaciones</Text>
            <Text style={e.nota}>{corte.notas}</Text>
          </View>
        ) : null}

        <View style={e.firmas} wrap={false}>
          <View style={e.firma}><Text style={e.raya}>{proyecto?.cliente || 'Cliente'}</Text><Text style={e.nota}>Cliente · aprobó</Text></View>
          <View style={e.firma}><Text style={e.raya}>{contratista}</Text><Text style={e.nota}>Contratista</Text></View>
        </View>

        {capsCant.length > 0 && (
          <View break>
            <Text style={e.seccion}>Detalle de cantidades</Text>
            {capsCant.map((c) => <TablaItems key={c.id} cap={c} />)}
          </View>
        )}


        <View style={e.pie} fixed>
          <Text>{marca ? 'HABITATUM' : (proyecto?.nombre_emisor || '')} · {titulo} · {proyecto?.nombre}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
