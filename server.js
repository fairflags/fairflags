// FairFlags scoreboard server: re-indexes the pools every 5 minutes and serves the page + JSON. Bind address from env HOST (default 127.0.0.1; on the server the Tailscale IP).
import http from "http";
import fs from "fs";
import { runIndex } from "./indexer.js";

const HOST = process.env.HOST || "127.0.0.1", PORT = +(process.env.PORT || 3011);
let busy = false;
async function tick() { if (busy) return; busy = true; try { const o = await runIndex(); console.log(new Date().toISOString(), "indexed", o.trades, "trades"); } catch (e) { console.log("index error", String(e.message).slice(0, 200)); } busy = false; }
tick(); setInterval(tick, 5 * 60 * 1000);
http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/" || url === "/index.html") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(fs.readFileSync("scoreboard.html")); }
  if (url === "/api/scoreboard") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); return res.end(fs.existsSync("out/scoreboard.json") ? fs.readFileSync("out/scoreboard.json") : "{}"); }
  res.writeHead(404); res.end("not found");
}).listen(PORT, HOST, () => console.log("FairFlags scoreboard on http://" + HOST + ":" + PORT));
