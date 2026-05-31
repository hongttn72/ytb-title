export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const { videoId, apiKey } = req.query;
        
        if (!videoId || !apiKey) {
            return res.status(400).json({ error: 'Missing parameters' });
        }
        
        const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error) {
            return res.status(400).json({ error: data.error.message });
        }
        
        if (!data.items || data.items.length === 0) {
            return res.status(404).json({ error: 'Video not found' });
        }
        
        const video = data.items[0];
        
        return res.status(200).json({
            title: video.snippet.title,
            channelTitle: video.snippet.channelTitle,
            description: (video.snippet.description || '').substring(0, 3000),
            thumbnail: video.snippet.thumbnails.maxres?.url || video.snippet.thumbnails.high?.url || video.snippet.thumbnails.default?.url,
            views: parseInt(video.statistics.viewCount) || 0
        });
        
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
