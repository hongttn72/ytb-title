export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { videoId } = req.query;
        if (!videoId) return res.status(400).json({ error: 'Missing videoId' });

        // Fetch YouTube page
        const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml'
            }
        });

        const html = await pageRes.text();

        // Extract ytInitialPlayerResponse
        const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s);
        if (!match) return res.status(200).json({ transcript: '' });

        let playerResponse;
        try {
            playerResponse = JSON.parse(match[1]);
        } catch {
            return res.status(200).json({ transcript: '' });
        }

        const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        if (!captionTracks.length) return res.status(200).json({ transcript: '' });

        // Prefer English, then auto-generated, then first available
        const track = captionTracks.find(t => t.languageCode === 'en' && !t.kind)
            || captionTracks.find(t => t.languageCode === 'en')
            || captionTracks[0];

        const captionUrl = track.baseUrl + '&fmt=json3';
        const captionRes = await fetch(captionUrl);
        const captionData = await captionRes.json();

        const text = (captionData.events || [])
            .filter(e => e.segs)
            .map(e => e.segs.map(s => s.utf8 || '').join(''))
            .join(' ')
            .replace(/\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return res.status(200).json({ transcript: text });
    } catch (error) {
        return res.status(200).json({ transcript: '', error: error.message });
    }
}
