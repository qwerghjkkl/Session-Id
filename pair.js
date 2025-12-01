import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
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
    num = num.replace(/[^0-9]/g, '');

    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Invalid phone number. Use full international number without + or spaces.' });
        }
        return;
    }

    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            let KnightBot = makeWASocket({
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
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log("🔥 Connected successfully! Sending Base64 session...");

                    try {
                        // Convert creds.json → Base64 (NO PREFIX)
                        const sessionBuffer = fs.readFileSync(`${dirs}/creds.json`);
                        const sessionBase64 = sessionBuffer.toString('base64');

                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');

                        // Send Base64 session
                        await KnightBot.sendMessage(userJid, {
                            text: `🔐 *Your Session ID (Base64)*\n\n${sessionBase64}\n\n⚠️ *Don't share with anyone!*`
                        });
                        console.log("✔ Base64 session sent!");

                        // Setup video
                        await KnightBot.sendMessage(userJid, {
                            image: { url: 'https://img.youtube.com/vi/-oz_u1iMgf8/maxresdefault.jpg' },
                            caption: `🎬 *KnightBot MD V2.0 Full Setup Guide!*\n🚀 More Commands + AI Update\n📺 https://youtu.be/NjOipI2AoMk`
                        });

                        // Warning message
                        await KnightBot.sendMessage(userJid, {
                            text: `⚠️ Security Warning ⚠️\n\nNever share your session ID with anyone.\n\n©2025 Knight Bot`
                        });

                        // Cleanup
                        console.log("🧹 Cleaning session directory...");
                        await delay(1000);
                        removeFile(dirs);
                        console.log("🔥 Session cleaned. Done.");
                    } catch (error) {
                        console.error("❌ Error sending session:", error);
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) console.log("🔐 New login detected");
                if (isOnline) console.log("📶 Client is online");

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

            // Generate Pairing Code
            if (!KnightBot.authState.creds.registered) {
                await delay(3000);
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await KnightBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) {
                        console.log({ num, code });
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent) res.status(503).send({ code: 'Failed to get pairing code.' });
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
