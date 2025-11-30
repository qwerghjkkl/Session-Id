import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';
import crypto from 'crypto';

const router = express.Router();

// Delete folder/file function
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

// Convert creds.json → CYPHER-X style session ID
function generateCypherXSession(credsPath) {
    const buffer = fs.readFileSync(credsPath);
    let base64 = buffer.toString('base64');

    // Insert random '*' separators to imitate CYPHER-X style
    const parts = [];
    let i = 0;
    while (i < base64.length) {
        const len = Math.floor(Math.random() * 20) + 10; // random chunk 10-30 chars
        parts.push(base64.slice(i, i + len));
        i += len;
    }

    return 'CYPHER-X:~' + parts.join('*');
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);

    await removeFile(dirs);
    num = num.replace(/[^0-9]/g, '');

    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) return res.status(400).send({ code: 'Invalid phone number.' });
        return;
    }

    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            const KnightBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false,
            });

            KnightBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    try {
                        const cypherXSession = generateCypherXSession(`${dirs}/creds.json`);
                        if (!res.headersSent) {
                            await res.send({ session: cypherXSession });
                        }

                        await delay(1000);
                        removeFile(dirs);
                    } catch (err) {
                        console.error("Error sending session:", err);
                        removeFile(dirs);
                    }
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 401) {
                        console.log("❌ Logged out — need new pairing code.");
                    } else {
                        console.log("🔄 Reconnecting...");
                        initiateSession();
                    }
                }
            });

            KnightBot.ev.on('creds.update', saveCreds);

            // Pairing code request
            if (!KnightBot.authState.creds.registered) {
                await delay(3000);
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await KnightBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) {
                        console.log({ num, code });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                }
            }
        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) res.status(503).send({ code: 'Service Unavailable' });
        }
    }

    await initiateSession();
});

export default router;
