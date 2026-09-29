import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { formatoPesos } from './calculosOC';
import { EncabezadoPDF, COLOR_DORADO, COLOR_FONDO } from './EncabezadoPDF';

// Formato de CORTE DE OBRA para firma (misma línea gráfica del estado de cuenta).
const HUESO = '#efece6';
const HUESO_CLARO = '#f7f5f1';
const GRIS_CALIDO = '#cdc5ba';
const TEXTO_SUAVE = '#6b655d';
const ROJO = '#9b2c2c';

const e = StyleSheet.create({
  pagina: { paddingTop: 30, paddingHorizontal: 26, paddingBottom: 46, fontSize: 7.5, fontFamily: 'Helvetica', color: '#2e2e2e' },
  titulo: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  sub: { fontSize: 8.5, color: TEXTO_SUAVE, marginTop: 2 },
  filaTitulo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 },
  datos: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  bloque: { flex: 1, borderWidth: 0.5, borderColor: GRIS_CALIDO, borderRadius: 3 },
  bloqueT: { backgroundColor: HUESO, padding: 4, fontFamily: 'Helvetica-Bold', fontSize: 8, borderBottomWidth: 1, borderBottomColor: COLOR_DORADO },
  dato: { flexDirection: 'row', paddingVertical: 2, paddingHorizontal: 5 },
  et: { width: '36%', color: TEXTO_SUAVE },
  va: { width: '64%' },
  seccion: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 6, marginBottom: 4, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: COLOR_DORADO },
  th: { flexDirection: 'row', backgroundColor: COLOR_FONDO, color: 'white', paddingVertical: 4, paddingHorizontal: 2, fontFamily: 'Helvetica-Bold', fontSize: 6.8 },
  tr: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 2, borderBottomWidth: 0.5, borderBottomColor: HUESO },
  trAlt: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 2, borderBottomWidth: 0.5, borderBottomColor: HUESO, backgroundColor: HUESO_CLARO },
  tt: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 2, backgroundColor: HUESO, fontFamily: 'Helvetica-Bold', borderTopWidth: 1, borderTopColor: COLOR_DORADO },
  cDesc: { width: '34%', paddingRight: 3 }, cUnd: { width: '5%' },
  cN: { width: '8.5%', textAlign: 'right' }, cV: { width: '10%', textAlign: 'right' },
  corte: { backgroundColor: '#f3e9dc', fontFamily: 'Helvetica-Bold' },
  resumen: { flexDirection: 'row', gap: 8, marginTop: 8 },
  resFila: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.5, paddingHorizontal: 6 },
  resNeto: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, paddingHorizontal: 6, backgroundColor: COLOR_FONDO, color: 'white', fontFamily: 'Helvetica-Bold', fontSize: 10 },
  nota: { fontSize: 7, color: TEXTO_SUAVE, lineHeight: 1.35 },
  firmas: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 30 },
  firma: { width: '30%' },
  raya: { borderTopWidth: 0.5, borderTopColor: '#2e2e2e', paddingTop: 3, fontFamily: 'Helvetica-Bold', fontSize: 7.5 },
  pie: { position: 'absolute', bottom: 18, left: 26, right: 26, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.5, color: TEXTO_SUAVE, borderTopWidth: 0.5, borderTopColor: GRIS_CALIDO, paddingTop: 4 },
});

const fecha = (f) => { if (!f) return '-'; const p = String(f).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
const cant = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 }));
const pesos = (v) => formatoPesos(Math.round(Number(v) || 0));

function Dato({ et, va }) {
  return <View style={e.dato}><Text style={e.et}>{et}</Text><Text style={e.va}>{va || '-'}</Text></View>;
}

function Tabla({ filas, titulo }) {
  if (!filas.length) return null;
  const total = filas.reduce((a, f) => a + f.valor, 0);
  return (
    <View>
      <Text style={e.seccion}>{titulo}</Text>
      <View style={e.th} fixed>
        <Text style={e.cDesc}>Ítem</Text><Text style={e.cUnd}>Und</Text>
        <Text style={e.cN}>Contratado</Text><Text style={e.cN}>Anterior</Text><Text style={e.cN}>Este corte</Text>
        <Text style={e.cN}>Acumulado</Text><Text style={e.cN}>Saldo</Text><Text style={e.cV}>Vr. unit.</Text><Text style={e.cV}>Valor corte</Text>
      </View>
      {filas.map((f, i) => (
        <View key={i} style={i % 2 ? e.trAlt : e.tr} wrap={false}>
          <Text style={e.cDesc}>{f.descripcion.length > 150 ? f.descripcion.slice(0, 150) + '…' : f.descripcion}</Text>
          <Text style={e.cUnd}>{f.unidad || ''}</Text>
          <Text style={e.cN}>{cant(f.contratado)}</Text>
          <Text style={e.cN}>{cant(f.anterior)}</Text>
          <Text style={[e.cN, e.corte]}>{cant(f.cantidad)}</Text>
          <Text style={[e.cN, f.excede ? { color: ROJO, fontFamily: 'Helvetica-Bold' } : null]}>{cant(f.acumulado)}</Text>
          <Text style={[e.cN, f.excede ? { color: ROJO } : null]}>{f.contratado == null ? '—' : cant(f.contratado - f.acumulado)}</Text>
          <Text style={e.cV}>{pesos(f.valor_unitario)}</Text>
          <Text style={[e.cV, { fontFamily: 'Helvetica-Bold' }]}>{pesos(f.valor)}</Text>
        </View>
      ))}
      <View style={e.tt} wrap={false}>
        <Text style={{ width: '80%' }}>Subtotal {titulo.toLowerCase()}</Text>
        <Text style={{ width: '20%', textAlign: 'right' }}>{pesos(total)}</Text>
      </View>
    </View>
  );
}

export default function PlantillaCortePDF({ d }) {
  const { corte, contrato, proyecto, contratista, filas, anticipo } = d;
  const marca = proyecto?.mostrar_marca_habitatum !== false;
  const contratante = marca ? 'HABITATUM S.A.S.' : (proyecto?.nombre_emisor || 'Contratante');
  const delContrato = filas.filter((f) => !f.es_adicional);
  const adicionales = filas.filter((f) => f.es_adicional);
  const excedidos = filas.filter((f) => f.excede);
  const estado = corte.estado === 'APROBADO' ? `Aprobado · ${corte.folio || ''}` : 'BORRADOR (sin aprobar)';

  return (
    <Document title={`Corte ${corte.numero} ${contrato.numero_contrato}`} author={contratante}>
      <Page size="A4" orientation="landscape" style={e.pagina}>
        <EncabezadoPDF tituloDocumento={`Corte de obra No. ${corte.numero} · Contrato ${contrato.numero_contrato}`} nombreObra={proyecto?.nombre} mostrarMarcaHabitatum={marca} nombreEmisor={proyecto?.nombre_emisor} />
        <View style={e.filaTitulo}>
          <View>
            <Text style={e.titulo}>Corte de obra No. {corte.numero}</Text>
            <Text style={e.sub}>{contrato.concepto}</Text>
          </View>
          <View>
            <Text style={[e.sub, { textAlign: 'right' }]}>Fecha del corte</Text>
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: COLOR_DORADO, textAlign: 'right' }}>{fecha(corte.fecha)}</Text>
            <Text style={[e.sub, { textAlign: 'right', color: corte.estado === 'APROBADO' ? '#2f6b3a' : ROJO }]}>{estado}</Text>
          </View>
        </View>

        <View style={e.datos}>
          <View style={e.bloque}>
            <Text style={e.bloqueT}>Contratista</Text>
            <Dato et="Nombre" va={contratista?.nombre} />
            <Dato et="NIT / C.C." va={contratista?.nit} />
            <Dato et="Cuenta" va={[contratista?.banco, contratista?.tipo_cuenta, contratista?.numero_cuenta].filter(Boolean).join(' · ')} />
          </View>
          <View style={e.bloque}>
            <Text style={e.bloqueT}>Contrato</Text>
            <Dato et="Número" va={contrato.numero_contrato} />
            <Dato et="Valor" va={pesos(contrato.valor_inicial)} />
            <Dato et="Anticipo" va={anticipo?.folio ? `${anticipo.folio} · ${pesos(anticipo.valor)}` : 'Sin anticipo'} />
          </View>
        </View>

        <Tabla titulo="Ítems del contrato" filas={delContrato} />
        <Tabla titulo="Adicionales" filas={adicionales} />

        <View style={e.resumen} wrap={false}>
          <View style={[e.bloque, { flex: 1.3, padding: 6 }]}>
            <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 3 }}>Observaciones</Text>
            {corte.notas ? <Text style={e.nota}>{corte.notas}</Text> : null}
            {excedidos.length > 0 && (
              <Text style={[e.nota, { color: ROJO }]}>
                {excedidos.length} ítem(s) superan la cantidad contratada. Requiere verificación de medición u otrosí.
              </Text>
            )}
            <Text style={[e.nota, { marginTop: 4 }]}>
              Las cantidades de este corte fueron medidas y verificadas en obra. El pago se realiza mediante la Orden de Compra
              correspondiente, descontando la amortización del anticipo y la retención pactadas.
            </Text>
          </View>
          <View style={[e.bloque, { flex: 1 }]}>
            <View style={e.resFila}><Text>Subtotal del corte</Text><Text>{pesos(corte.subtotal_calc)}</Text></View>
            <View style={e.resFila}><Text>(-) Amortización del anticipo</Text><Text>{pesos(corte.amort_calc)}</Text></View>
            <View style={e.resFila}><Text>(-) Retención {Number(corte.porcentaje_retencion)}%</Text><Text>{pesos(corte.ret_calc)}</Text></View>
            <View style={e.resNeto}><Text>Neto a pagar</Text><Text>{pesos(corte.neto_calc)}</Text></View>
          </View>
        </View>

        <View style={e.firmas} wrap={false}>
          <View style={e.firma}><Text style={e.raya}>{contratista?.nombre || 'Contratista'}</Text><Text style={e.nota}>Contratista</Text></View>
          <View style={e.firma}><Text style={e.raya}>Residente de obra</Text><Text style={e.nota}>Verificó cantidades</Text></View>
          <View style={e.firma}><Text style={e.raya}>{contratante}</Text><Text style={e.nota}>Contratante · aprobó</Text></View>
        </View>

        <View style={e.pie} fixed>
          <Text>{marca ? 'HABITATUM' : (proyecto?.nombre_emisor || '')} · Corte No. {corte.numero} · Contrato {contrato.numero_contrato}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
