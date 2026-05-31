export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { videoId } = req.query;
    if (!videoId) return res.status(400).json({ error: 'Missing videoId' });

    const log = [];

    // 1. Try third-party transcript services (they have residential proxies)
    const services = [
        { name: 'tactiq', fn: () => fetchFromTactiq(videoId) },
        { name: 'kome', fn: () => fetchFromKome(videoId) },
        { name: 'youtubetotranscript', fn: () => fetchFromYTT(videoId) }
    ];
    for (const s of services) {
        try {
            const t = await s.fn();
            log.push(`${s.name}:${t ? t.length : 0}`);
            if (t) return res.status(200).json({ transcript: t, source: s.name, log });
        } catch (e) { log.push(`${s.name}:err`); }
    }

    // 2. Fallback: direct YouTube innertube (often blocked on datacenter IPs)
    const clients = [
        { name: 'ANDROID', body: { context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'en' } }, videoId }, key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w' },
        { name: 'IOS', body: { context: { client: { clientName: 'IOS', clientVersion: '19.09.3', deviceModel: 'iPhone14,3', hl: 'en' } }, videoId }, key: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc' }
    ];
    for (const c of clients) {
        try {
            const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${c.key}&prettyPrint=false`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': uaFor(c.name) },
                body: JSON.stringify(c.body)
            });
            const data = await r.json();
            const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            log.push(`${c.name}:${tracks.length}`);
            if (tracks.length) {
                const track = tracks.find(t => t.languageCode === 'en' && !t.kind)
                    || tracks.find(t => t.languageCode === 'en')
                    || tracks[0];
                const capRes = await fetch(track.baseUrl + '&fmt=json3');
                if (capRes.ok) {
                    const cd = await capRes.json();
                    const text = (cd.events || []).filter(e => e.segs).map(e => e.segs.map(s => s.utf8 || '').join('')).join(' ').replace(/\s+/g, ' ').trim();
                    if (text) return res.status(200).json({ transcript: text, source: c.name, log });
                }
            }
        } catch (e) { log.push(`${c.name}:err`); }
    }

    return res.status(200).json({ transcript: '', reason: 'all_sources_failed', log });
}

function uaFor(client) {
    if (client === 'ANDROID') return 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip';
    if (client === 'IOS') return 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)';
    return 'Mozilla/5.0';
}

async function fetchFromTactiq(videoId) {
    const r = await fetch('https://tactiq-apps-prod.tactiq.io/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': 'https://tactiq.io', 'Referer': 'https://tactiq.io/' },
        body: JSON.stringify({
            videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
            langCode: 'en'
        })
    });
    if (!r.ok) return '';
    const d = await r.json();
    if (Array.isArray(d.captions)) {
        return d.captions.map(c => c.text || '').join(' ').replace(/\s+/g, ' ').trim();
    }
    return '';
}

async function fetchFromKome(videoId) {
    const r = await fetch('https://kome.ai/api/tools/youtube-transcripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': 'https://kome.ai', 'Referer': 'https://kome.ai/tools/youtube-transcript-generator' },
        body: JSON.stringify({
            video_id: `https://www.youtube.com/watch?v=${videoId}`,
            format: true
        })
    });
    if (!r.ok) return '';
    const d = await r.json();
    return (d.transcript || '').replace(/\s+/g, ' ').trim();
}

async function fetchFromYTT(videoId) {
    const r = await fetch('https://youtubetotranscript.com/transcript', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': 'https://youtubetotranscript.com',
            'Referer': 'https://youtubetotranscript.com/'
        },
        body: `youtube_url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}`
    });
    if (!r.ok) return '';
    const html = await r.text();
    const m = html.match(/<div[^>]*id=["']transcript["'][^>]*>([\s\S]*?)<\/div>/i);
    if (!m) return '';
    return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
