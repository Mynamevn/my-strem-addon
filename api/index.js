const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const manifest = {
    "id": "org.stremio.vn.ultimate.addon",
    "version": "1.0.0",
    "name": "VN Ultimate Stream Addon",
    "description": "Tự động gộp nguồn API (NguonC, KKPhim, VSMov) và Cào Web (PhimLongTieng, MotPhimTV)",
    "resources": ["stream"],
    "types": ["movie", "series"],
    "idPrefixes": ["tt", "k20tm:"]
};

const builder = new addonBuilder(manifest);

// BẮT BUỘC: Thêm hàm xử lý Catalog ảo để Stremio chấp nhận cài đặt Addon thành công
builder.defineCatalogHandler(() => {
    return Promise.resolve({ metas: [] });
});

// Hàm phụ dịch IMDB ID sang tên phim tiếng Việt/Anh để đi tìm kiếm
async function getMovieName(stremioId) {
    try {
        const cleanId = stremioId.split(":");
        const res = await axios.get(`https://stremio.com{cleanId}.json`, { timeout: 3000 });
        return res.data.meta ? res.data.meta.name : "Minecraft";
    } catch {
        return "Minecraft"; 
    }
}

// [ƯU TIÊN 1] API NguonC
async function fetchNguonC(movieName) {
    let streams = [];
    try {
        const res = await axios.get(`https://nguonc.com{encodeURIComponent(movieName)}`, { timeout: 4000 });
        if (res.data && res.data.items && res.data.items.length > 0) {
            const movieSlug = res.data.items.slug;
            const detail = await axios.get(`https://nguonc.com{movieSlug}`, { timeout: 4000 });
            const episodes = detail.data.film.episodes || [];
            episodes.forEach(server => {
                if (server.items) {
                    server.items.forEach(ep => {
                        if (ep.m3u8_url) {
                            streams.push({
                                name: "🎬 [API] NguonC",
                                title: `Tập ${ep.name} - ${server.server_name}`,
                                url: ep.m3u8_url
                            });
                        }
                    });
                }
            });
        }
    } catch (e) { console.log("Lỗi NguonC API:", e.message); }
    return streams;
}

// [ƯU TIÊN 2] API KKPhim
async function fetchKKPhim(movieName) {
    let streams = [];
    try {
        const res = await axios.get(`https://kkphim.vip{encodeURIComponent(movieName)}`, { timeout: 4000 });
        if (res.data && res.data.data && res.data.data.items && res.data.data.items.length > 0) {
            const movieSlug = res.data.data.items.slug;
            const detail = await axios.get(`https://kkphim.vip{movieSlug}`, { timeout: 4000 });
            const serverData = detail.data.data.server_data || [];
            serverData.forEach(server => {
                if (server.server_data) {
                    server.server_data.forEach(ep => {
                        if (ep.link_m3u8) {
                            streams.push({
                                name: "⚡ [API] KKPhim",
                                title: `Bản phát: ${ep.name} - ${server.server_name}`,
                                url: ep.link_m3u8
                            });
                        }
                    });
                }
            });
        }
    } catch (e) { console.log("Lỗi KKPhim API:", e.message); }
    return streams;
}

// [ƯU TIÊN 3] API VSMov
async function fetchVSMov(movieName) {
    let streams = [];
    try {
        const res = await axios.get(`https://vsmov.com{encodeURIComponent(movieName)}`, { timeout: 4000 });
        if (res.data && res.data.results && res.data.results.length > 0) {
            const videoUrl = res.data.results.stream_url;
            if (videoUrl) {
                streams.push({
                    name: "🌟 [API] VSMov",
                    title: `Luồng trực tiếp tốc độ cao`,
                    url: videoUrl
                });
            }
        }
    } catch (e) { console.log("Lỗi VSMov API:", e.message); }
    return streams;
}

// [ƯU TIÊN 4] Cào dữ liệu PhimLongTieng (Sử dụng 1phim32.com)
async function scrapePhimLongTieng(movieName) {
    let streams = [];
    try {
        const searchSlug = movieName.toLowerCase().trim().replace(/\s+/g, '-');
        const searchUrl = `https://1phim32.com{encodeURIComponent(searchSlug)}/`;
        const searchRes = await axios.get(searchUrl, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 5000 
        });
        const \$ = cheerio.load(searchRes.data);
        const firstMovieLink = \$('.list-films .item a').first().attr('href');
        if (firstMovieLink) {
            const movieRes = await axios.get(firstMovieLink, { 
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                timeout: 5000
            });
            const \$movie = cheerio.load(movieRes.data);
            const scripts = \$movie('script').text();
            const m3u8Match = scripts.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/);
            if (m3u8Match) {
                streams.push({
                    name: "🔊 [Scrape] LongTieng",
                    title: `Bản Thuyết Minh / Lồng Tiếng`,
                    url: m3u8Match[1]
                });
            }
        }
    } catch (e) { console.log("Lỗi cào PhimLongTieng:", e.message); }
    return streams;
}

// [ƯU TIÊN 5] Cào dữ liệu MotPhimTV
async function scrapeMotPhimTV(movieName) {
    let streams = [];
    try {
        const searchUrl = `https://motphimtv.run{encodeURIComponent(movieName)}`;
        const searchRes = await axios.get(searchUrl, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 5000 
        });
        const \$ = cheerio.load(searchRes.data);
        const firstMovieLink = \$('.list-films .item a').first().attr('href');
        if (firstMovieLink) {
            const movieRes = await axios.get(firstMovieLink, { 
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                timeout: 5000
            });
            const \$movie = cheerio.load(movieRes.data);
            const scripts = \$movie('script').text();
            const m3u8Match = scripts.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/);
            if (m3u8Match) {
                streams.push({
                    name: "📺 [Scrape] MotPhimTV",
                    title: `Luồng phát dự phòng MotPhim`,
                    url: m3u8Match[1]
                });
            }
        }
    } catch (e) { console.log("Lỗi cào MotPhimTV:", e.message); }
    return streams;
}

// Giao diện xử lý chính gộp các luồng phát
builder.defineStreamHandler(async (args) => {
    const movieName = await getMovieName(args.id);
    
    const [nguonc, kkphim, vsmov, longtieng, motphim] = await Promise.all([
        fetchNguonC(movieName).catch(() => []),
        fetchKKPhim(movieName).catch(() => []),
        fetchVSMov(movieName).catch(() => []),
        scrapePhimLongTieng(movieName).catch(() => []),
        scrapeMotPhimTV(movieName).catch(() => [])
    ]);

    const orderedStreams = [
        ...nguonc,
        ...kkphim,
        ...vsmov,
        ...longtieng,
        ...motphim
    ];

    return { streams: orderedStreams };
});

const addonInterface = builder.getInterface();
module.exports = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { url } = req;
    
    if (url === '/' || url === '/manifest.json') {
        return res.status(200).json(addonInterface.manifest);
    }
    
    const pathParts = url.split('/').filter(Boolean);
    
    if (pathParts.length >= 3) {
        const resource = pathParts[0];
        const type = pathParts[1];
        const idWithExt = pathParts[2];
        const id = idWithExt.replace('.json', '');

        if (resource === 'stream') {
            return builder.getRouter().handleStream({ type, id }, (err, result) => {
                if (err) return res.status(500).json({ error: err.message });
                return res.status(200).json(result);
            });
        } else if (resource === 'catalog') {
            return builder.getRouter().handleCatalog({ type, id }, (err, result) => {
                if (err) return res.status(500).json({ error: err.message });
                return res.status(200).json(result);
            });
        }
    }

    return res.status(404).json({ error: "Not Found" });
};
