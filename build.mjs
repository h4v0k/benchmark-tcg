// Builds the site into dist/. `node build.mjs --serve` rebuilds on change and serves on :5173.
import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';

const serve = process.argv.includes('--serve');
const out = 'dist';

async function build() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const result = await esbuild.build({
    entryPoints: ['src/main.tsx'],
    bundle: true,
    minify: !serve,
    sourcemap: true,
    format: 'esm',
    target: ['es2020', 'safari15'],
    jsx: 'automatic',
    outdir: `${out}/assets`,
    entryNames: '[name]-[hash]',
    metafile: true,
    define: { 'process.env.NODE_ENV': JSON.stringify(serve ? 'development' : 'production') },
    logLevel: 'warning',
  });
  const css = await readFile('src/styles.css', 'utf8');
  const cssName = `styles-${createHash('sha1').update(css).digest('hex').slice(0, 8)}.css`;
  await writeFile(`${out}/assets/${cssName}`, css);
  const js = Object.keys(result.metafile.outputs).find(f => f.endsWith('.js'));
  const html = (await readFile('index.html', 'utf8'))
    .replace('%CSS%', `/assets/${cssName}`)
    .replace('%JS%', '/' + path.relative(out, js));
  await writeFile(`${out}/index.html`, html);
  await cp('public', out, { recursive: true });
  console.log(`built ${js} (${(result.metafile.outputs[js].bytes / 1024).toFixed(0)} KB)`);
}

await build();

if (serve) {
  const { watch } = await import('node:fs');
  let t; watch('src', { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => build().catch(e => console.error(e.message)), 100); });
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.map': 'application/json', '.png': 'image/png', '.txt': 'text/plain' };
  http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(out, p);
    try { await readFile(file); } catch { file = path.join(out, 'index.html'); }
    if (p === '/') file = path.join(out, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  }).listen(5173, () => console.log('serving http://localhost:5173'));
}
