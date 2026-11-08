import fs from 'fs';
import path from 'path';

const distAssetsDir = path.resolve('dist/assets');
const files = fs.readdirSync(distAssetsDir);

const cssFile = files.find(f => f.startsWith('index-') && f.endsWith('.css'));
const jsFile = files.find(f => f.startsWith('index-') && f.endsWith('.js'));

if (!cssFile || !jsFile) {
  console.error('Could not find compiled CSS or JS in dist/assets');
  process.exit(1);
}

const appCss = fs.readFileSync(path.join(distAssetsDir, cssFile), 'utf8');
const appJs = fs.readFileSync(path.join(distAssetsDir, jsFile), 'utf8');

for (const dir of ['public/laptop-bundle', 'dist/laptop-bundle']) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.css'), appCss, 'utf8');
  fs.writeFileSync(path.join(dir, 'app.js'), appJs, 'utf8');
}

const safeCss = appCss.replace(/<\/style/gi, '<\\/style');
const safeJs = appJs.replace(/<\/script/gi, '<\\/script');

const LIVE_APP_URL = 'https://ais-pre-5r2bu3uvfxmuwsvok5xoor-104198471035.asia-east1.run.app';

const standaloneHtml = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8" />',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  '  <meta name="application-url" content="' + LIVE_APP_URL + '" />',
  '  <link rel="canonical" href="' + LIVE_APP_URL + '" />',
  '  <title>PLUTUS Cable Production & Requisition System (Laptop Edition)</title>',
  '  <style id="plutus-app-css">',
  safeCss,
  '  </style>',
  '</head>',
  '<body>',
  '  <div id="root"></div>',
  '  <script id="plutus-live-url">',
  '    window.__PLUTUS_LIVE_URL__ = "' + LIVE_APP_URL + '";',
  '  </script>',
  '  <script id="plutus-init-orders">',
  '    const INITIAL_ORDERS = [];',
  '    window.__PLUTUS_INITIAL_ORDERS__ = INITIAL_ORDERS;',
  '  </script>',
  '  <script>',
  '    window.__PLUTUS_INITIAL_ORDERS__ = typeof INITIAL_ORDERS !== "undefined" ? INITIAL_ORDERS : [];',
  '  </script>',
  '  <script id="plutus-app-js">',
  safeJs,
  '  </script>',
  '</body>',
  '</html>',
].join('\n');

for (const target of [
  'public/assets/aistudio/PLUTUS_CABLE_PRODUCTION_APP__1__e94e75c2.html',
  'dist/assets/aistudio/PLUTUS_CABLE_PRODUCTION_APP__1__e94e75c2.html',
]) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, standaloneHtml, 'utf8');
}

console.log('Successfully generated laptop-bundle and updated standalone HTML asset.');
