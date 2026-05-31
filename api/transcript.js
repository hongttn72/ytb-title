export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { videoId } = req.query;
    if (!videoId) return res.status(400).json({ error: 'Missing videoId' });

    try {
        let tracks = await tryInnertube(videoId);
        if (!tracks.length) tracks = await tryWatchPage(videoId);
        if (!tracks.length) return res.status(200).json({ transcript: '', reason: 'no_tracks' });

        const track = tracks.find(t => t.languageCode === 'en' && !t.kind)
            || tracks.find(t => t.languageCode === 'en')
            || tracks.find(t => t.languageCode === 'vi')
            || tracks[0];

        const capRes = await fetch(track.baseUrl + '&fmt=json3');
        if (!capRes.ok) return res.status(200).json({ transcript: '', reason: 'caption_fetch_failed' });
        const capData = await capRes.json();
        const text = (capData.events || [])
            .filter(e => e.segs)
            .map(e => e.segs.map(s => s.utf8 || '').join(''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        return res.status(200).json({ transcript: text, language: track.languageCode });
    } catch (error) {
        return res.status(200).json({ transcript: '', error: error.message });
    }
}

async function tryInnertube(videoId) {
    try {
        const r = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
            body: JSON.stringify({
                context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en' } },
                videoId
            })
        });
        if (!r.ok) return [];
        const data = await r.json();
        return data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    } catch { return []; }
}

async function tryWatchPage(videoId) {
    try {
        const r = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cookie': 'CONSENT=YES+cb'
            }
        });
        const html = await r.text();
        const json = extractPlayerResponse(html);
        if (!json) return [];
        const pr = JSON.parse(json);
        return pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    } catch { return []; }
}

function extractPlayerResponse(html) {
    const idx = html.indexOf('ytInitialPlayerResponse');
    if (idx < 0) return null;
    const eq = html.indexOf('=', idx);
    if (eq < 0) return null;
    let start = eq + 1;
    while (start < html.length && /\s/.test(html[start])) start++;
    if (html[start] !== '{') return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < html.length; i++) {
        const c = html[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
        } else {
            if (c === '"') inStr = true;
            else if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth === 0) return html.substring(start, i + 1); }
        }
    }
    return null;
}
