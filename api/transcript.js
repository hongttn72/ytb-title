export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { videoId } = req.query;
    if (!videoId) return res.status(400).json({ error: 'Missing videoId' });

    const clients = [
        { name: 'ANDROID', body: { context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'en' } }, videoId }, key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w' },
        { name: 'IOS', body: { context: { client: { clientName: 'IOS', clientVersion: '19.09.3', deviceModel: 'iPhone14,3', hl: 'en' } }, videoId }, key: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc' },
        { name: 'WEB', body: { context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en' } }, videoId }, key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8' },
        { name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', body: { context: { client: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'en' } }, videoId }, key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8' }
    ];

    const log = [];

    try {
        let tracks = [];
        let usedClient = '';

        for (const c of clients) {
            try {
                const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${c.key}&prettyPrint=false`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'User-Agent': uaFor(c.name) },
                    body: JSON.stringify(c.body)
                });
                const data = await r.json();
                const t = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
                log.push(`${c.name}:${t.length}`);
                if (t.length) { tracks = t; usedClient = c.name; break; }
            } catch (e) { log.push(`${c.name}:err`); }
        }

        if (!tracks.length) {
            const fb = await tryTimedTextFallback(videoId);
            if (fb) return res.status(200).json({ transcript: fb, source: 'timedtext_fallback', log });
            return res.status(200).json({ transcript: '', reason: 'no_tracks', log });
        }

        const track = tracks.find(t => t.languageCode === 'en' && !t.kind)
            || tracks.find(t => t.languageCode === 'en')
            || tracks.find(t => t.languageCode === 'vi')
            || tracks[0];

        const capRes = await fetch(track.baseUrl + '&fmt=json3');
        if (!capRes.ok) return res.status(200).json({ transcript: '', reason: 'caption_fetch_failed', status: capRes.status, log });
        const capData = await capRes.json();
        const text = (capData.events || [])
            .filter(e => e.segs)
            .map(e => e.segs.map(s => s.utf8 || '').join(''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        return res.status(200).json({ transcript: text, language: track.languageCode, client: usedClient, log });
    } catch (error) {
        return res.status(200).json({ transcript: '', error: error.message, log });
    }
}

function uaFor(client) {
    if (client === 'ANDROID') return 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip';
    if (client === 'IOS') return 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)';
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
}

async function tryTimedTextFallback(videoId) {
    try {
        const langs = ['en', 'vi', 'en-US'];
        for (const lang of langs) {
            for (const kind of ['', '&kind=asr']) {
                const url = `https://www.youtube.com/api/timedtext?lang=${lang}&v=${videoId}&fmt=json3${kind}`;
                const r = await fetch(url);
                if (!r.ok) continue;
                const txt = await r.text();
                if (!txt.trim()) continue;
                try {
                    const d = JSON.parse(txt);
                    const t = (d.events || []).filter(e => e.segs).map(e => e.segs.map(s => s.utf8 || '').join('')).join(' ').replace(/\s+/g, ' ').trim();
                    if (t) return t;
                } catch {}
            }
        }
    } catch {}
    return '';
}
