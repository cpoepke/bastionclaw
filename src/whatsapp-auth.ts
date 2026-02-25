/**
 * WhatsApp Authentication Script
 *
 * Run this during setup to authenticate with WhatsApp.
 * Browser mode opens a QR code page; terminal mode uses a pairing code.
 *
 * Usage:
 *   npx tsx src/whatsapp-auth.ts                       # Browser QR (default)
 *   npx tsx src/whatsapp-auth.ts --terminal             # Pairing code (headless)
 *   npx tsx src/whatsapp-auth.ts --terminal --phone NUM # Pairing code, skip prompt
 */
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import readline from 'readline';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

const AUTH_DIR = './store/auth';
const QR_HTML_PATH = path.join('store', 'qr-auth.html');
const useTerminal = process.argv.includes('--terminal');
const useBrowser = !useTerminal;
const phoneArgIdx = process.argv.indexOf('--phone');
const phoneArg = phoneArgIdx !== -1 ? process.argv[phoneArgIdx + 1] : undefined;

const logger = pino({
  level: 'warn',
});

// --- Browser QR helpers ---

function generateQrSvg(qrText: string): Promise<string> {
  // Write temp .cjs file inside the project so require('qrcode') resolves from node_modules.
  // Uses .cjs to avoid Node.js 25 TypeScript parsing of inline scripts (PR #437 fix).
  const tmpFile = path.join(process.cwd(), 'store', '.qr-gen.cjs');
  const script = `const QR=require('qrcode');const data=${JSON.stringify(qrText)};QR.toString(data,{type:'svg',margin:2},(e,s)=>{if(e)process.exit(1);process.stdout.write(s)});`;

  fs.writeFileSync(tmpFile, script);

  return new Promise((resolve, reject) => {
    exec(`node "${tmpFile}"`, { cwd: process.cwd() }, (error, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch {}

      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

function buildHtmlPage(svg: string): string {
  return `<!DOCTYPE html>
<html><head><title>BastionClaw - WhatsApp Auth</title>
<meta http-equiv="refresh" content="3">
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex; justify-content: center; align-items: center;
    min-height: 100vh; margin: 0;
    background: #0a0a0a; color: #e0e0e0;
  }
  .card {
    text-align: center; padding: 2rem;
    background: #1a1a1a; border-radius: 16px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    max-width: 400px;
  }
  h1 { font-size: 1.4rem; margin-bottom: 0.5rem; color: #fff; }
  .subtitle { color: #888; font-size: 0.9rem; margin-bottom: 1.5rem; }
  .qr-container {
    background: #fff; border-radius: 12px; padding: 1rem;
    display: inline-block; margin-bottom: 1.5rem;
  }
  .qr-container svg { width: 280px; height: 280px; }
  .steps { text-align: left; font-size: 0.85rem; color: #aaa; line-height: 1.8; }
  .steps b { color: #fff; }
  .timer { margin-top: 1rem; font-size: 0.8rem; color: #666; }
  .timer.urgent { color: #e74c3c; font-weight: bold; }
  #countdown { color: #f59e0b; font-weight: bold; }
</style></head><body>
<div class="card">
  <h1>BastionClaw</h1>
  <p class="subtitle">Scan to link WhatsApp</p>
  <div class="qr-container">${svg}</div>
  <div class="steps">
    <b>1.</b> Open WhatsApp on your phone<br>
    <b>2.</b> Tap <b>Settings</b> &rarr; <b>Linked Devices</b> &rarr; <b>Link a Device</b><br>
    <b>3.</b> Point your camera at the QR code above
  </div>
  <div class="timer" id="timer">Expires in <span id="countdown">60</span>s</div>
</div>
<script>
  var startKey = 'bastionclaw_qr_start';
  var start = localStorage.getItem(startKey);
  if (!start) { start = Date.now().toString(); localStorage.setItem(startKey, start); }
  var elapsed = Math.floor((Date.now() - parseInt(start)) / 1000);
  var remaining = Math.max(0, 60 - elapsed);
  var countdown = document.getElementById('countdown');
  var timer = document.getElementById('timer');
  countdown.textContent = remaining;
  if (remaining <= 10) timer.classList.add('urgent');
  if (remaining <= 0) {
    timer.textContent = 'QR code expired — a new one will appear shortly';
    timer.classList.add('urgent');
    localStorage.removeItem(startKey);
  }
</script></body></html>`;
}

function buildSuccessPage(): string {
  return `<!DOCTYPE html>
<html><head><title>BastionClaw - Connected</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex; justify-content: center; align-items: center;
    min-height: 100vh; margin: 0;
    background: #0a0a0a; color: #e0e0e0;
  }
  .card {
    text-align: center; padding: 2rem;
    background: #1a1a1a; border-radius: 16px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    max-width: 400px;
  }
  .check { font-size: 4rem; margin-bottom: 1rem; }
  h1 { font-size: 1.4rem; color: #22c55e; }
  p { color: #888; font-size: 0.9rem; }
</style></head><body>
<div class="card">
  <div class="check">&#10003;</div>
  <h1>WhatsApp Connected</h1>
  <p>Credentials saved. You can close this tab and start BastionClaw.</p>
</div>
<script>localStorage.removeItem('bastionclaw_qr_start');</script>
</body></html>`;
}

function openInBrowser(filePath: string): void {
  const absPath = path.resolve(filePath);
  const cmd = process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${absPath}"`);
}

let browserOpened = false;

async function showBrowserQr(qrText: string): Promise<void> {
  const svg = await generateQrSvg(qrText);
  const html = buildHtmlPage(svg);

  fs.writeFileSync(QR_HTML_PATH, html);

  if (!browserOpened) {
    openInBrowser(QR_HTML_PATH);
    browserOpened = true;
    console.log(`QR code opened in browser: ${path.resolve(QR_HTML_PATH)}`);
  } else {
    // Page auto-refreshes every 3s, picks up new QR automatically
    console.log('QR code updated (browser will auto-refresh)');
  }
}

function showSuccessInBrowser(): void {
  fs.writeFileSync(QR_HTML_PATH, buildSuccessPage());
}

// --- Terminal pairing code helpers ---

function askQuestion(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// --- Main auth flow ---

async function authenticate(): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  if (state.creds.registered) {
    console.log('Already authenticated with WhatsApp');
    console.log('  To re-authenticate, delete the store/auth folder and run again.');
    process.exit(0);
  }

  // For terminal mode, get phone number upfront (needed for pairing code)
  let phoneNumber: string | undefined;
  if (useTerminal) {
    phoneNumber = phoneArg;
    if (!phoneNumber) {
      phoneNumber = await askQuestion('Enter your phone number (with country code, no + or spaces, e.g. 14155551234): ');
    }
    if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber)) {
      console.error('Invalid phone number. Use digits only with country code (e.g. 14155551234)');
      process.exit(1);
    }
    console.log(`Starting WhatsApp authentication (pairing code)...\n`);
  } else {
    console.log(`Starting WhatsApp authentication (browser QR)...\n`);
  }

  async function connectSocket(isReconnect = false): Promise<void> {
    const { version } = await fetchLatestWaWebVersion({});
    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger,
      browser: Browsers.macOS('Chrome'),
    });

    // Request pairing code after connection initializes (terminal mode only, first connect)
    if (useTerminal && phoneNumber && !state.creds.me && !isReconnect) {
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(phoneNumber!);
          console.log(`\n  Your pairing code: ${code}\n`);
          console.log('  1. Open WhatsApp on your phone');
          console.log('  2. Tap Settings > Linked Devices > Link a Device');
          console.log('  3. Tap "Link with phone number instead"');
          console.log(`  4. Enter the code: ${code}\n`);
        } catch (err: any) {
          console.error('Failed to request pairing code:', err.message);
          process.exit(1);
        }
      }, 3000);
    }

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && useBrowser) {
        await showBrowserQr(qr);
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as any)?.output?.statusCode;

        if (reason === DisconnectReason.loggedOut) {
          console.log('\nLogged out. Delete store/auth and try again.');
          process.exit(1);
        } else {
          // Transient disconnect (e.g. 515 restart) — reconnect to complete handshake
          console.log('Connection interrupted, reconnecting...');
          setTimeout(() => connectSocket(true), 2000);
        }
      }

      if (connection === 'open') {
        console.log('\nSuccessfully authenticated with WhatsApp!');
        console.log('  Credentials saved to store/auth/');
        console.log('  You can now start the BastionClaw service.\n');

        if (useBrowser) {
          showSuccessInBrowser();
        }

        setTimeout(() => process.exit(0), 2000);
      }
    });

    sock.ev.on('creds.update', saveCreds);
  }

  connectSocket();
}

authenticate().catch((err) => {
  console.error('Authentication failed:', err.message);
  process.exit(1);
});
