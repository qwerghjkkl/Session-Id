import express from 'express';
import fs from 'fs';
import pino from 'pino';
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

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

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);

    await removeFile(dirs);

    const phone = pn('+' + (num || ''));
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Invalid phone number. Use full international number.' });
        }
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
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            KnightBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin } = update;

                if (connection === 'open') {
                    console.log("🔥 Connected successfully! Generating CYPHER-X session ID...");

                    try {
                        const sessionBuffer = fs.readFileSync(`${dirs}/creds.json`);
                        const sessionBase64 = sessionBuffer.toString('base64');

                        // Format exactly like CYPHER-X style
                        const cypherSession = `CYPHER-X:~${sessionBase64.replace(/\=/g,'*')}`;

                        if (!res.headersSent) {
                            await res.send({ session: cypherSession });
                        }

                        // Cleanup
                        console.log("🧹 Cleaning session directory...");
                        await delay(1000);
                        removeFile(dirs);
                        console.log("🔥 Session cleaned. Done.");
                    } catch (err) {
                        console.error("❌ Error generating session:", err);
                        removeFile(dirs);
                        if (!res.headersSent) {
                            res.status(500).send({ code: 'Failed to generate session' });
                        }
                    }
                }

                if (isNewLogin) console.log("🔐 New login detected");

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

            // Pairing Code
            if (!KnightBot.authState.creds.registered) {
                await delay(3000);
                try {
                    let code = await KnightBot.requestPairingCode(num);
                    if (!code) code = "FAILED_TO_GENERATE";
                    code = code.match(/.{1,4}/g)?.join('-') || code;

                    if (!res.headersSent) {
                        await res.send({ code });
                        console.log("✔ Pairing code sent:", code);
                    }
                } catch (err) {
                    console.error("❌ Error requesting pairing code:", err);
                    if (!res.headersSent) res.status(503).send({ code: 'Failed to generate pairing code' });
                }
            }

            KnightBot.ev.on('creds.update', saveCreds);

        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) res.status(503).send({ code: 'Service Unavailable' });
        }
    }

    await initiateSession();
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
    const e = String(err);
    if (
        e.includes("conflict") || e.includes("not-authorized") || e.includes("Socket connection timeout") ||
        e.includes("rate-overlimit") || e.includes("Connection Closed") || e.includes("Timed Out") ||
        e.includes("Stream Errored") || e.includes("Stream Errored (restart required)") ||
        e.includes("statusCode: 515") || e.includes("statusCode: 503")
    ) return;
    console.log('Caught exception: ', err);
});

export default router;
