import express from 'express';
import fs from 'fs';
import pino from 'pino';
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

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
    if (!num) return res.status(400).send({ code: 'Number is required' });

    const phone = pn('+' + num);
    if (!phone.isValid()) return res.status(400).send({ code: 'Invalid phone number' });

    num = phone.getNumber('e164').replace('+', '');
    const dirs = './' + num;
    await removeFile(dirs);

    const { state, saveCreds } = await useMultiFileAuthState(dirs);
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
    });

    // Listen for credentials update to save them
    KnightBot.ev.on('creds.update', saveCreds);

    // Wait a bit to ensure creds.json is written
    await delay(1500);

    try {
        const sessionBuffer = fs.readFileSync(`${dirs}/creds.json`);
        let sessionBase64 = sessionBuffer.toString('base64');
        sessionBase64 = sessionBase64.replace(/\=/g, '*'); // CYPHER-X style

        const cypherSession = `CYPHER-X:~${sessionBase64}`;

        // Send session immediately
        res.send({ session: cypherSession });

        console.log("✔ CYPHER-X session generated and sent!");
    } catch (err) {
        console.error("❌ Failed to generate session:", err);
        if (!res.headersSent) res.status(500).send({ code: 'Failed to generate session' });
    }

    // Cleanup session folder after a short delay
    setTimeout(() => removeFile(dirs), 5000);
});

export default router;
