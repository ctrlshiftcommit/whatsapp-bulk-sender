const Papa = require("papaparse");
const ExcelJS = require("exceljs");
const { normalizePhone } = require("./database.cjs");

function mapRows(rows, defaultCountryCode = "91") {
  return rows.map((row) => {
    const values = typeof row === "string" ? { phone: row } : row;
    const rawPhone = values.phone || values.mobile || values.number || values.Phone || values.Mobile || "";
    const withCountry = String(rawPhone).trim().startsWith("+") ? rawPhone : `${defaultCountryCode}${rawPhone}`;
    return {
      name: values.name || values.Name || "",
      phone: normalizePhone(withCountry),
      tags: String(values.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
      custom1: values.custom1 || "",
      custom2: values.custom2 || "",
    };
  }).filter((contact) => contact.phone);
}

function parseCsv(content, countryCode) {
  const result = Papa.parse(content, { header: true, skipEmptyLines: true });
  if (result.errors.length) throw new Error(result.errors[0].message);
  return mapRows(result.data, countryCode);
}

async function parseWorkbook(buffer, countryCode) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const headers = sheet.getRow(1).values.slice(1).map((value) => String(value || "").trim());
  const rows = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    rows.push(Object.fromEntries(headers.map((header, column) => [header, row.getCell(column + 1).text])));
  });
  return mapRows(rows, countryCode);
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

module.exports = { parseCsv, parseWorkbook, parsePasted, parseGoogleSheet, exportCsv, mapRows };
