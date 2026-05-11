const { google } = require('googleapis');

const SPREADSHEET_ID = '1CNISUnxT8-rAQxiq_Fj1gz4yGwVAg4MqusS-0R9ioMo';
const SHEET_NAME = 'Trabajos';
const CFG_SHEET = 'Config';

const HEADERS = ['ID','CLIENTE','NOMENCLATURA','CONTACTO','TAREA','CONTRATA','HONORARIO','GASTOS','ESTADO','FORMA_PAGO','COBRO','COBRADOR','MES','OBSERVACION'];
const CFG_HEADERS = ['CLAVE','VALOR'];

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getSheets() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

async function ensureHeaders(sheets) {
  // Ensure Trabajos sheet has headers
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:N1`,
  }).catch(() => null);

  if (!res || !res.data.values || !res.data.values[0] || res.data.values[0][0] !== 'ID') {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
  }

  // Ensure Config sheet exists and has headers
  const cfgRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${CFG_SHEET}!A1:B1`,
  }).catch(() => null);

  if (!cfgRes || !cfgRes.data.values || !cfgRes.data.values[0]) {
    // Try to add Config sheet
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{ addSheet: { properties: { title: CFG_SHEET } } }],
        },
      });
    } catch(e) { /* sheet may already exist */ }

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${CFG_SHEET}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [CFG_HEADERS] },
    });
  }
}

function rowToWork(row) {
  return {
    id: parseInt(row[0]) || 0,
    cli: row[1] || '',
    nom: row[2] || '',
    con: row[3] || '',
    tar: row[4] || '',
    con2: row[5] || '',
    pre: parseFloat(row[6]) || 0,
    gas: parseFloat(row[7]) || 0,
    est: row[8] || '',
    fpag: row[9] || '',
    cob: row[10] || 'Cobrar',
    cobr: row[11] || '',
    mes: row[12] || 'Enero',
    obs: row[13] || '',
  };
}

function workToRow(w) {
  return [w.id, w.cli, w.nom, w.con, w.tar, w.con2, w.pre, w.gas, w.est, w.fpag, w.cob, w.cobr, w.mes, w.obs];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sheets = await getSheets();
    await ensureHeaders(sheets);

    const action = req.query.action;

    // GET all works
    if (req.method === 'GET' && action === 'trabajos') {
      const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:N`,
      });
      const rows = r.data.values || [];
      const works = rows.filter(row => row[0] && row[1]).map(rowToWork);
      return res.json(works);
    }

    // GET config
    if (req.method === 'GET' && action === 'config') {
      const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${CFG_SHEET}!A2:B`,
      });
      const rows = r.data.values || [];
      const cfg = {};
      rows.forEach(row => { if (row[0]) cfg[row[0]] = row[1]; });
      return res.json(cfg);
    }

    // POST - add work
    if (req.method === 'POST' && action === 'trabajo') {
      const w = req.body;
      // Get next ID
      const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:A`,
      });
      const ids = (r.data.values || []).map(row => parseInt(row[0]) || 0);
      w.id = ids.length ? Math.max(...ids) + 1 : 1;

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2`,
        valueInputOption: 'RAW',
        requestBody: { values: [workToRow(w)] },
      });
      return res.json({ ok: true, id: w.id });
    }

    // POST - bulk import
    if (req.method === 'POST' && action === 'importar') {
      const works = req.body;
      const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:A`,
      });
      const ids = (r.data.values || []).map(row => parseInt(row[0]) || 0);
      let nextId = ids.length ? Math.max(...ids) + 1 : 1;
      const rows = works.map(w => { w.id = nextId++; return workToRow(w); });
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2`,
        valueInputOption: 'RAW',
        requestBody: { values: rows },
      });
      return res.json({ ok: true, count: rows.length });
    }

    // PUT - update work
    if (req.method === 'PUT' && action === 'trabajo') {
      const w = req.body;
      const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:A`,
      });
      const rows = r.data.values || [];
      const rowIndex = rows.findIndex(row => parseInt(row[0]) === w.id);
      if (rowIndex === -1) return res.status(404).json({ error: 'Not found' });
      const sheetRow = rowIndex + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A${sheetRow}:N${sheetRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [workToRow(w)] },
      });
      return res.json({ ok: true });
    }

    // DELETE - delete work
    if (req.method === 'DELETE' && action === 'trabajo') {
      const id = parseInt(req.query.id);
      const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:A`,
      });
      const rows = r.data.values || [];
      const rowIndex = rows.findIndex(row => parseInt(row[0]) === id);
      if (rowIndex === -1) return res.status(404).json({ error: 'Not found' });

      // Get sheet ID
      const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
      const sheet = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);
      const sheetId = sheet.properties.sheetId;
      const sheetRow = rowIndex + 1; // 0-indexed, row 1 = headers

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex: sheetRow, endIndex: sheetRow + 1 }
            }
          }]
        }
      });
      return res.json({ ok: true });
    }

    // PUT - save config
    if (req.method === 'PUT' && action === 'config') {
      const cfg = req.body;
      const rows = Object.entries(cfg).map(([k, v]) => [k, String(v)]);
      // Clear and rewrite
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${CFG_SHEET}!A2:B`,
      });
      if (rows.length) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${CFG_SHEET}!A2`,
          valueInputOption: 'RAW',
          requestBody: { values: rows },
        });
      }
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
