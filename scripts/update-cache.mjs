import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const publishedBase = "https://docs.google.com/spreadsheets/d/1VVmwTf-aAXgeE26cftc6z8zVlJz8w8fC5sNqnPWbGBY/export?format=csv";
const sources = {
  playersCsv: publishedBase,
  teamInfoCsv: `${publishedBase}&gid=980574984`,
  lastUpdateCsv: "https://docs.google.com/spreadsheets/d/1VVmwTf-aAXgeE26cftc6z8zVlJz8w8fC5sNqnPWbGBY/export?format=csv&gid=980574984&range=B6",
  intelHistoryCsv: `${publishedBase}&gid=1023185859`,
  vpHistoryCsv: `${publishedBase}&gid=861908891`,  operationsScheduleCsv: `${publishedBase}&gid=980574984&range=B17`,
  teamStatsCsv: "https://docs.google.com/spreadsheets/d/1VVmwTf-aAXgeE26cftc6z8zVlJz8w8fC5sNqnPWbGBY/export?format=csv&gid=980574984&range=B8:B16"
};

function parseCsvRow(row) {
  const columns = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === '"' && quoted && row[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      columns.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  columns.push(value);
  return columns;
}

function toCsvRow(columns) {
  return columns.map(value => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(",");
}

function trimPlayerHistory(text) {
  return text.trim().split(/\r?\n/).map(parseCsvRow)
    .map((columns, rowIndex) => {
      const history = rowIndex === 0
        ? columns.slice(2).slice(-30)
        : columns.slice(2).filter(value => String(value).trim() !== "").slice(-30);
      return toCsvRow([...columns.slice(0, 2), ...history]);
    })
    .join("\n");
}

function trimTeamIntelHistory(text) {
  const rows = text.trim().split(/\r?\n/).map(parseCsvRow);
  const populatedRows = rows.slice(1).filter(columns => {
    const date = String(columns[1] ?? "").trim();
    const value = String(columns[7] ?? "").trim();
    return date !== "" && value !== "" && Number.isFinite(Number(value));
  });
  return [rows[0], ...populatedRows.slice(-30)].map(toCsvRow).join("\n");
}

function normalizePlayerName(value) {
  const name = String(value ?? "").trim();
  return /^´´petrs´´$/i.test(name) ? '"Petrs"' : name;
}

function trimPlayers(text) {
  const rows = text.trim().split(/\r?\n/).map(parseCsvRow);
  const header = rows[0];
  const normalizedHeader = header.map(value => String(value).trim().toLowerCase());
  const nameIndex = normalizedHeader.indexOf("name");
  const accountsIndex = normalizedHeader.indexOf("accounts");
  const players = rows.slice(1, 51).map(columns => {
    const row = [...columns];
    if (nameIndex >= 0) row[nameIndex] = normalizePlayerName(row[nameIndex]);
    if (accountsIndex >= 0) {
      row[accountsIndex] = String(row[accountsIndex] ?? "")
        .split(", ")
        .map(normalizePlayerName)
        .filter(Boolean)
        .join(", ");
    }
    return row;
  });
  return [header, ...players].map(toCsvRow).join("\n");
}

const transforms = {
  playersCsv: trimPlayers,
  intelHistoryCsv: trimPlayerHistory,
  vpHistoryCsv: trimPlayerHistory,
  teamIntelHistoryCsv: trimTeamIntelHistory
};

async function download([key, url]) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const separator = url.includes("?") ? "&" : "?";
      const requestUrl = `${url}${separator}_=${Date.now()}-${attempt}`;
      const response = await fetch(requestUrl, { headers: { "user-agent": "boom-beach-cache-updater", "cache-control": "no-cache" }, signal: AbortSignal.timeout(90000) });
      if (!response.ok) throw new Error(`${key}: HTTP ${response.status}`);
      const text = (await response.text()).replace(/\r\n/g, "\n");
      console.log(`${key} downloaded.`);
      return [key, transforms[key] ? transforms[key](text) : text];
    } catch (error) {
      lastError = error;
      console.warn(`${key} attempt ${attempt} failed.`);
    }
  }
  throw lastError;
}

const cache = Object.fromEntries(await Promise.all(Object.entries(sources).map(download)));
const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "../data/cache.json");
const nextContent = `${JSON.stringify(cache, null, 2)}\n`;
let previousContent = "";
try { previousContent = await readFile(outputPath, "utf8"); } catch {}
if (previousContent !== nextContent) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, nextContent, "utf8");
  console.log("Data cache updated.");
} else {
  console.log("Data cache is already current.");
}
