import fs from 'fs';
import path from 'path';
import { Document, Page, Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer';
import { formatoPesos } from './calculosOC';

// ============================================================
// PDF del contrato estándar con contratista v1.0: Contrato + Anexo 1 + Anexo 2 en un solo
// documento, tamaño carta, numeración de páginas continua. Todo el texto viene del
// modelo (lib/documentoContrato.js → modeloDocumento), que a su vez lo toma de la plantilla
// guardada en la base de datos. Fuente: Liberation Sans (métrica equivalente a Arial).
// ============================================================

const CARBON = '#2e2e2e';
const DORADO = '#b88a52';
const DORADO_OSCURO = '#8a6430';
const HUESO = '#efece6';
const HUESO_CLARO = '#f7f5f1';
const GRIS = '#cdc5ba';
const SUAVE = '#6b655d';

// Liberation Sans: métrica idéntica a Arial y con todos los signos (·, ², ³, Ø) que la Helvetica
// estándar del PDF no trae. Si no se encuentra el archivo, se usa Helvetica.
let FUENTE = 'Helvetica', FUENTE_B = 'Helvetica-Bold';
try {
  const dir = path.join(process.cwd(), 'public', 'fonts');
  if (fs.existsSync(path.join(dir, 'LiberationSans-Regular.ttf'))) {
    Font.register({ family: 'Arial', fonts: [
      { src: path.join(dir, 'LiberationSans-Regular.ttf') },
      { src: path.join(dir, 'LiberationSans-Bold.ttf'), fontWeight: 'bold' },
    ] });
    Font.registerHyphenationCallback((w) => [w]);
    FUENTE = 'Arial'; FUENTE_B = 'Arial';
  }
} catch { /* Helvetica */ }
const B = FUENTE === 'Arial' ? { fontFamily: 'Arial', fontWeight: 'bold' } : { ...B };

let logo = null;
try { logo = `data:image/png;base64,${fs.readFileSync(path.join(process.cwd(), 'public', 'logo-habitatum-pdf.png')).toString('base64')}`; } catch { logo = null; }

const e = StyleSheet.create({
  pagina: { paddingTop: 92, paddingBottom: 46, paddingHorizontal: 42, fontSize: 8.6, fontFamily: FUENTE, color: CARBON, lineHeight: 1.35 },
  banda: { position: 'absolute', top: 0, left: 0, right: 0, height: 66, backgroundColor: CARBON, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 42 },
  lineaDorada: { position: 'absolute', top: 66, left: 0, right: 0, height: 2.2, backgroundColor: DORADO },
  logo: { width: 24, height: 38, marginRight: 12 },
  marca: { color: 'white', fontSize: 15, ...B, letterSpacing: 1 },
  subt: { color: DORADO, fontSize: 10, marginTop: 2 },
  lineaProy: { color: '#d9d4cc', fontSize: 7.6, marginTop: 2 },
  numDer: { color: 'white', fontSize: 9, ...B, textAlign: 'right' },
  pie: { position: 'absolute', bottom: 18, left: 42, right: 42, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.8, color: SUAVE, borderTopWidth: 0.5, borderTopColor: GRIS, paddingTop: 4 },
  titulo: { fontSize: 13, ...B, textAlign: 'center' },
  subtitulo: { fontSize: 10, textAlign: 'center', color: DORADO_OSCURO, marginTop: 2, marginBottom: 12 },
  h1: { fontSize: 10, ...B, marginTop: 12, marginBottom: 6, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: DORADO },
  just: { textAlign: 'justify' },
  bandaSec: { backgroundColor: CARBON, color: 'white', ...B, fontSize: 8, paddingVertical: 3.5, paddingHorizontal: 6, marginTop: 6 },
  fila: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: HUESO, borderLeftWidth: 0.5, borderRightWidth: 0.5, borderLeftColor: HUESO, borderRightColor: HUESO },
  et: { width: '31%', backgroundColor: HUESO_CLARO, padding: 4, color: SUAVE },
  va: { width: '69%', padding: 4, textAlign: 'justify' },
  th: { flexDirection: 'row', backgroundColor: CARBON, color: 'white', ...B, fontSize: 7.4, paddingVertical: 4, paddingHorizontal: 3 },
  tr: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 0.5, borderBottomColor: HUESO, fontSize: 7.6 },
  trAlt: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 0.5, borderBottomColor: HUESO, backgroundColor: HUESO_CLARO, fontSize: 7.6 },
  nota: { fontSize: 7.2, color: SUAVE, marginTop: 4, textAlign: 'justify' },
  clausulaT: { ...B, color: DORADO_OSCURO, fontSize: 8.8, marginTop: 8, marginBottom: 3 },
  parrafo: { textAlign: 'justify', marginBottom: 3 },
  literal: { textAlign: 'justify', marginBottom: 2.5, paddingLeft: 14 },
  firmas: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 10 },
  firma: { width: '46%', marginTop: 40 },
  raya: { borderTopWidth: 0.7, borderTopColor: CARBON, paddingTop: 3 },
  rol: { fontSize: 7, color: SUAVE, letterSpacing: 0.5 },
  firmaNom: { ...B, fontSize: 8.4 },
  cierre: { textAlign: 'center', color: SUAVE, fontSize: 7.5, marginTop: 22 },
  totFila: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: HUESO, fontSize: 8 },
  totEt: { width: '42%', paddingHorizontal: 6 },
  totPct: { width: '12%', textAlign: 'right', paddingHorizontal: 6, color: SUAVE },
  totVa: { width: '22%', textAlign: 'right', paddingHorizontal: 6 },
  totBanda: { flexDirection: 'row', justifyContent: 'flex-end', backgroundColor: CARBON, color: 'white', ...B, paddingVertical: 5, marginTop: 2, fontSize: 9 },
  check: { width: 7, height: 7, borderWidth: 0.8, borderColor: CARBON, marginRight: 7, marginTop: 1.5 },
  num: { width: 18, ...B },
});

const pesos = (v) => formatoPesos(Math.round(Number(v) || 0));
const cant = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 }));

function Encabezado({ m, subtitulo, linea }) {
  return (
    <>
      <View style={e.banda} fixed>
        {logo && <Image src={logo} style={e.logo} />}
        <View style={{ flex: 1 }}>
          <Text style={e.marca}>HABITATUM</Text>
          <Text style={e.subt}>{subtitulo}</Text>
          <Text style={e.lineaProy}>{linea}</Text>
        </View>
        <Text style={e.numDer}>No. {m.numero}</Text>
      </View>
      <View style={e.lineaDorada} fixed />
    </>
  );
}

function Pie({ m, nombre }) {
  return (
    <View style={e.pie} fixed>
      <Text>{m.P.documento.pie_izquierdo}</Text>
      <Text>{nombre}</Text>
      <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  );
}

function Firmas({ lista }) {
  return (
    <View style={e.firmas} wrap={false}>
      {lista.map((f, i) => (
        <View key={i} style={e.firma}>
          <View style={e.raya}>
            <Text style={e.rol}>{f.rol}</Text>
            <Text style={e.firmaNom}>{f.nombre}</Text>
            <Text>{f.id}</Text>
            {f.extra ? <Text style={{ color: SUAVE }}>{f.extra}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export default function PlantillaDocumentoContratoPDF({ m, borrador }) {
  const P = m.P;
  const lineaContrato = [m.proyecto, m.municipio].filter(Boolean).join('  ·  ');
  const lineaAnexo = `${m.proyecto}  ·  Contrato No. ${m.numero}`;
  const marca = borrador ? <Text fixed style={{ position: 'absolute', top: 300, left: 60, fontSize: 64, color: '#b88a52', opacity: 0.12, transform: 'rotate(-30deg)' }}>BORRADOR</Text> : null;
  const totalesA = [
    [m.P.contratante_fijo ? 'Subtotal (antes de IVA)' : 'Subtotal costo directo', '', m.t.subtotal],
    ['Régimen de la cotización', '', null, { AIU: 'AIU', IVA: 'IVA', SIN_IVA: 'Sin IVA', IVA_UTILIDAD: 'IVA sobre la utilidad' }[m.regimen]],
    ...(m.regimen === 'AIU' ? [
      ['Administración (A)', `${m.pct.a} %`, m.t.valor_administracion],
      ['Imprevistos (I)', `${m.pct.i} %`, m.t.valor_imprevistos],
      ['Utilidad (U)', `${m.pct.u} %`, m.t.valor_utilidad],
      ['IVA (en AIU solo sobre la U)', `${m.pct.iva} %`, m.t.valor_iva],
    ] : m.regimen === 'IVA' ? [['IVA', `${m.pct.iva} %`, m.t.valor_iva]]
      : m.regimen === 'IVA_UTILIDAD' ? [
        ['Base gravable (utilidad)', `${m.pct.u} %`, m.t.base_gravable],
        ['IVA sobre la base gravable', `${m.pct.iva} %`, m.t.valor_iva],
      ] : []),
  ];
  const nB = P.anexo_2.B_obligaciones_generales.length;

  return (
    <Document title={`Contrato ${m.numero} · ${m.proyecto}`} author={P.documento.pie_izquierdo || 'HABITATUM S.A.S.'}>
      {/* ---------------- CONTRATO ---------------- */}
      <Page size="LETTER" style={e.pagina}>
        <Encabezado m={m} subtitulo={P.documento.encabezado_subtitulo} linea={lineaContrato} />
        {marca}
        <Text style={e.titulo}>{m.titulo}</Text>
        <Text style={e.subtitulo}>{m.subtitulo}</Text>

        <Text style={e.h1}>I. PARTES</Text>
        <Text style={e.just}>{m.partes}</Text>

        <Text style={e.h1}>II. CONDICIONES PARTICULARES</Text>
        {m.secciones.map((s) => (
          <View key={s.titulo}>
            <View wrap={false}>
              <Text style={e.bandaSec}>{s.titulo}</Text>
              {s.filas[0] && <View style={e.fila}><Text style={e.et}>{s.filas[0].etiqueta}</Text><Text style={e.va}>{s.filas[0].valor}</Text></View>}
            </View>
            {s.filas.slice(1).map((f) => (
              <View key={f.etiqueta} style={e.fila} wrap={!!f.largo}>
                <Text style={e.et}>{f.etiqueta}</Text><Text style={e.va}>{f.valor}</Text>
              </View>
            ))}
          </View>
        ))}

        {m.garantias.length > 0 && (
          <View>
            <Text style={e.h1} minPresenceAhead={60}>III. GARANTÍAS EXIGIDAS</Text>
            <View style={e.th} wrap={false}>
              <Text style={{ width: '34%' }}>{P.garantias_exigidas.columnas[0]}</Text>
              <Text style={{ width: '8%', textAlign: 'right' }}>{P.garantias_exigidas.columnas[1]}</Text>
              <Text style={{ width: '18%', paddingLeft: 6 }}>{P.garantias_exigidas.columnas[2]}</Text>
              <Text style={{ width: '17%', textAlign: 'right' }}>{P.garantias_exigidas.columnas[3]}</Text>
              <Text style={{ width: '23%', paddingLeft: 6 }}>{P.garantias_exigidas.columnas[4]}</Text>
            </View>
            {m.garantias.map((g, i) => (
              <View key={g.amparo} style={i % 2 ? e.trAlt : e.tr} wrap={false}>
                <Text style={{ width: '34%' }}>{g.amparo}</Text>
                <Text style={{ width: '8%', textAlign: 'right' }}>{g.pct}</Text>
                <Text style={{ width: '18%', paddingLeft: 6 }}>{g.base}</Text>
                <Text style={{ width: '17%', textAlign: 'right' }}>{g.valor}</Text>
                <Text style={{ width: '23%', paddingLeft: 6 }}>{g.vigencia}</Text>
              </View>
            ))}
            <Text style={e.nota}>{P.garantias_exigidas.nota_al_pie}</Text>
          </View>
        )}

        <Text style={e.h1} minPresenceAhead={60}>{m.garantias.length > 0 ? 'IV' : 'III'}. CONDICIONES GENERALES</Text>
        {P.clausulas.map((c) => (
          <View key={c.numero}>
            <Text style={e.clausulaT} minPresenceAhead={30}>CLÁUSULA {c.numero}. {c.titulo}</Text>
            {c.parrafos.map((p, i) => <Text key={i} style={p.tipo === 'literal' ? e.literal : e.parrafo}>{p.texto}</Text>)}
          </View>
        ))}

        <View wrap={false}>
          <Text style={e.h1}>{m.garantias.length > 0 ? 'V' : 'IV'}. FIRMAS</Text>
          <Text style={e.just}>{P.firmas.texto_previo}</Text>
          <Firmas lista={m.firmas} />
        </View>
        <Text style={e.cierre}>{P.documento.cierre}</Text>
        <Pie m={m} nombre={`Contrato No. ${m.numero}`} />
      </Page>

      {/* ---------------- ANEXO 1 ---------------- */}
      <Page size="LETTER" style={e.pagina}>
        <Encabezado m={m} subtitulo={P.anexo_1.titulo} linea={lineaAnexo} />
        {marca}
        <Text style={e.h1}>A. Cuadro de cantidades y precios</Text>
        <View style={e.th}>
          <Text style={{ width: '7%' }}>Ítem</Text><Text style={{ width: '45%' }}>Descripción de la actividad</Text>
          <Text style={{ width: '6%' }}>Un</Text><Text style={{ width: '10%', textAlign: 'right' }}>Cant.</Text>
          <Text style={{ width: '14%', textAlign: 'right' }}>V. unitario</Text><Text style={{ width: '18%', textAlign: 'right' }}>V. total</Text>
        </View>
        {m.itemsA.map((it, i) => (
          <View key={it.id} style={i % 2 ? e.trAlt : e.tr} wrap={false}>
            <Text style={{ width: '7%' }}>{it.codigo || ''}</Text>
            <Text style={{ width: '45%', paddingRight: 4 }}>{it.descripcion}</Text>
            <Text style={{ width: '6%' }}>{it.unidad || ''}</Text>
            <Text style={{ width: '10%', textAlign: 'right' }}>{cant(it.cantidad)}</Text>
            <Text style={{ width: '14%', textAlign: 'right' }}>{pesos(it.valor_unitario)}</Text>
            <Text style={{ width: '18%', textAlign: 'right' }}>{pesos(it.total ?? Number(it.cantidad || 0) * Number(it.valor_unitario || 0))}</Text>
          </View>
        ))}
        <Text style={e.nota}>{P.anexo_1.nota_A}</Text>
        <View wrap={false} style={{ marginTop: 6 }}>
          {totalesA.map(([et, pc, v, texto]) => (
            <View key={et} style={e.totFila}>
              <Text style={e.totEt}>{et}</Text><Text style={e.totPct}>{pc}</Text>
              <Text style={e.totVa}>{texto || pesos(v)}</Text>
            </View>
          ))}
          <View style={e.totBanda}>
            <Text style={{ width: '54%', paddingHorizontal: 6 }}>VALOR TOTAL DEL CONTRATO</Text>
            <Text style={{ width: '22%', textAlign: 'right', paddingHorizontal: 6 }}>{pesos(m.t.total)}</Text>
          </View>
        </View>

        {m.itemsB.length > 0 && (
          <View>
            <Text style={e.h1} minPresenceAhead={60}>B. Precios unitarios de referencia (sin cantidad contratada)</Text>
            <Text style={[e.nota, { marginTop: 0, marginBottom: 4 }]}>{P.anexo_1.nota_B}</Text>
            <View style={e.th} wrap={false}>
              <Text style={{ width: '7%' }}>Ítem</Text><Text style={{ width: '59%' }}>Descripción de la actividad</Text>
              <Text style={{ width: '8%' }}>Un</Text><Text style={{ width: '8%', textAlign: 'right' }}>Cant.</Text>
              <Text style={{ width: '18%', textAlign: 'right' }}>V. unitario</Text>
            </View>
            {m.itemsB.map((it, i) => (
              <View key={it.id} style={i % 2 ? e.trAlt : e.tr} wrap={false}>
                <Text style={{ width: '7%' }}>{it.codigo || ''}</Text>
                <Text style={{ width: '59%', paddingRight: 4 }}>{it.descripcion}</Text>
                <Text style={{ width: '8%' }}>{it.unidad || ''}</Text>
                <Text style={{ width: '8%', textAlign: 'right' }}>—</Text>
                <Text style={{ width: '18%', textAlign: 'right' }}>{pesos(it.valor_unitario)}</Text>
              </View>
            ))}
          </View>
        )}
        <Firmas lista={[...m.firmantesContratante, m.firmanteContratista]} />
        <Pie m={m} nombre={`Anexo 1 · Contrato No. ${m.numero}`} />
      </Page>

      {/* ---------------- ANEXO 2 ---------------- */}
      <Page size="LETTER" style={[e.pagina, { fontSize: 8.1, lineHeight: 1.28 }]}>
        <Encabezado m={m} subtitulo={P.anexo_2.titulo} linea={lineaAnexo} />
        {marca}
        <Text style={e.h1}>A. Requisitos previos al inicio de los trabajos</Text>
        {P.anexo_2.A_requisitos_previos.map((r) => (
          <View key={r} style={{ flexDirection: 'row', marginBottom: 3 }} wrap={false}>
            <View style={e.check} /><Text style={[e.just, { flex: 1 }]}>{r}</Text>
          </View>
        ))}
        <Text style={e.h1}>B. Obligaciones técnicas generales (aplican a todo contrato de obra)</Text>
        {P.anexo_2.B_obligaciones_generales.map((o, i) => (
          <View key={i} style={{ flexDirection: 'row', marginBottom: 3 }} wrap={false}>
            <Text style={e.num}>{i + 1}.</Text><Text style={[e.just, { flex: 1 }]}>{o}</Text>
          </View>
        ))}
        {m.obligaciones.length > 0 && (
          <View>
            <Text style={e.h1} minPresenceAhead={40}>C. Obligaciones particulares de esta obra</Text>
            {m.obligaciones.map((o, i) => (
              <View key={i} style={{ flexDirection: 'row', marginBottom: 3 }} wrap={false}>
                <Text style={e.num}>{nB + i + 1}.</Text><Text style={[e.just, { flex: 1 }]}>{o}</Text>
              </View>
            ))}
          </View>
        )}
        <View wrap={false}>
          <Text style={[e.nota, { marginTop: 8 }]}>{P.anexo_2.cierre}</Text>
          <View style={{ width: '46%', marginTop: 40 }}>
            <View style={e.raya}>
              <Text style={e.rol}>{P.anexo_2.firma.toUpperCase()}</Text>
              <Text style={e.firmaNom}>{m.firmanteContratista.nombre}</Text>
              <Text>{m.firmanteContratista.id}</Text>
            </View>
          </View>
        </View>
        <Pie m={m} nombre={`Anexo 2 · Contrato No. ${m.numero}`} />
      </Page>
    </Document>
  );
}
