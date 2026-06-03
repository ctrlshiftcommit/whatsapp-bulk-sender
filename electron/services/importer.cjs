const Papa = require("papaparse");
const ExcelJS = require("exceljs");
const { normalizePhone } = require("./database.cjs");

function valueFrom(values, key) {
  return key ? values[key] : "";
}

function mapRows(rows, defaultCountryCode = "91", mapping = {}) {
  return rows.map((row) => {
    const values = typeof row === "string" ? { phone: row } : row;
    const rawPhone = valueFrom(values, mapping.phone) || values.phone || values.mobile || values.number || values.Phone || values.Mobile || values.Number || "";
    const withCountry = String(rawPhone).trim().startsWith("+") ? rawPhone : `${defaultCountryCode}${rawPhone}`;
    return {
      name: valueFrom(values, mapping.name) || values.name || values.Name || "",
      phone: normalizePhone(withCountry),
      tags: String(valueFrom(values, mapping.tags) || values.tags || values.Tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
      custom1: valueFrom(values, mapping.custom1) || values.custom1 || values.Custom1 || "",
      custom2: valueFrom(values, mapping.custom2) || values.custom2 || values.Custom2 || "",
    };
  }).filter((contact) => contact.phone);
}

function parseCsvRows(content) {
  const result = Papa.parse(content, { header: true, skipEmptyLines: true });
  if (result.errors.length) throw new Error(result.errors[0].message);
  return { headers: result.meta.fields || [], rows: result.data };
}

function parseCsv(content, countryCode, mapping) {
  const { rows } = parseCsvRows(content);
  return mapRows(rows, countryCode, mapping);
}

async function parseWorkbookRows(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };
  const headers = sheet.getRow(1).values.slice(1).map((value) => String(value || "").trim());
  const rows = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    rows.push(Object.fromEntries(headers.map((header, column) => [header, row.getCell(column + 1).text])));
  });
  return { headers, rows };
}

async function parseWorkbook(buffer, countryCode, mapping) {
  const { rows } = await parseWorkbookRows(buffer);
  return mapRows(rows, countryCode, mapping);
}

function parsePasted(raw, countryCode) {
  return mapRows(raw.split(/\r?\n/).filter(Boolean), countryCode);
}

async function parseGoogleSheet(url, countryCode) {
  const match = String(url).match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) throw new Error("Enter a valid public Google Sheets URL.");
  const gid = new URL(url).searchParams.get("gid") || "0";
  const csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
  const response = await fetch(csvUrl);
  if (!response.ok) throw new Error("The Google Sheet could not be fetched. Make sure link sharing is enabled.");
  return parseCsv(await response.text(), countryCode);
}

function exportCsv(contacts) {
  return Papa.unparse(contacts.map(({ name, phone, tags, custom1, custom2 }) => ({ name, phone, tags: (tags || []).join(","), custom1, custom2 })));
}

module.exports = { parseCsv, parseCsvRows, parseWorkbook, parseWorkbookRows, parsePasted, parseGoogleSheet, exportCsv, mapRows };
