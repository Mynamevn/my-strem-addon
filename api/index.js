const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

const manifest = {
    "id": "community.paproplayer.multisource.v2000",
    "version": "2000.0.1",
    "name": "PA MULTI SOURCE STREAM",
    "description": "He thong tu dong gop luong truc tiep (.m3u8): NguonC, KKPhim, VSMov, 1Phim32, MotPhimTV",
    "resources": ["catalog", "stream"],
    "types": ["movie", "series"],
    "idPrefixes": ["tt", "vnwpsw"],
    "catalogs": [
        {
            "type": "movie",
            "id": "pa_movies_new",
            "name": "Phim le moi (PA)",
            "extra": [{ "name": "search", "isRequired": false }]
        },
        {
            "type": "series",
            "id": "pa_series_new",
            "name": "Phim bo moi (PA)",
            "extra": [{ "name": "search", "isRequired": false }]
        }
    ]
};

const builder = new addonBuilder(manifest);

function toSlug(text) {
    if (!text) return "phim";
    return text.toString().toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-');
}

builder.defineCatalogHandler(async (args) => {
    let apiUrl = 'https://phimapi.com';
    if (args.type === 'series' || args.id === 'pa_series_new') {
        apiUrl = 'https://phimapi.com';
    }
    if (args.extra && args.extra.search) {
        apiUrl = 'https://phimapi.com' + encodeURIComponent(args.extra.search) + '&limit=12';
    }
    try {
        const res = await axios.get(apiUrl, { timeout: 4000 });
        const items = res.data?.data?.items || res.data?.items || [];
        if (items.length > 0) {
            const metas = items.map(item => ({
                id: 'vnwpsw:' + encodeURIComponent(item.name),
                type: args.type || 'movie',
                name: item.name,
                poster: item.poster_url?.startsWith('http') ? item.poster_url : 'https://phimimg.com' + item.poster_url,
                description: 'Original: ' + (item.origin_name || item.name) + ' (' + (item.year || 'New') + ')'
            }));
            return { metas };
        }
    } catch (e) { console.error(e); }
    return { metas: [] };
});

async function fetchNguonC(movieName) {
    let streams = [];
    try {
        const res = await axios.get(`https://nguonc.com{encodeURIComponent(movieName)}`, { timeout: 3000 });
        if (res.data && res.data.items && res.data.items.length > 0) {
            const movieSlug = res.data.items[0].slug;
            const detail = await axios.get(`https://nguonc.com{movieSlug}`, { timeout: 3000 });
            const episodes = detail.data?.film?.episodes || [];
            episodes.forEach(server => {
                if (server.items) {
                    server.items.forEach(ep => {
                        if (ep.m3u8_url) {
                            streams.push({
                                name: "🎬 [API] NguonC",
                                title: "Tap " + ep.name + " - " + server.server_name,
                                url: ep.m3u8_url
                            });
                        }
                    });
                }
            });
        }
    } catch (e) { console.log("NguonC timeout"); }
    return streams;
}

async function fetchKKPhim(movieName) {
    let streams = [];
    try {
        const res = await axios.get(`https://kkphim.vip{encodeURIComponent(movieName)}`, { timeout: 3000 });
        if (res.data && res.data.data && res.data.data.items && res.data.data.items.length > 0) {
            const movieSlug = res.data.data.items[0].slug;
            const detail = await axios.get(`https://kkphim.vip{movieSlug}`, { timeout: 3000 });
            const serverData = detail.data?.data?.server_data || [];
            serverData.forEach(server => {
                if (server.server_data) {
                    server.server_data.forEach(ep => {
                        if (ep.link_m3u8) {
                            streams.push({
                                name: "⚡ [API] KKPhim",
                                title: "Ban phat: " + ep.name + " - " + server.server_name,
                                url: ep.link_m3u8
                            });
                        }
                    });
                }
            });
        }
    } catch (e) { console.log("KKPhim timeout"); }
    return streams;
}

async function fetchVSMov(movieName) {
    let streams = [];
    try {
        const res = await axios.get(`https://vsmov.com{encodeURIComponent(movieName)}`, { timeout: 3000 });
        if (res.data && res.data.stream_url) {
            streams.push({
                name: "🌟 [API] VSMov",
                title: "Luong phat VSMov",
                url: res.data.stream_url
            });
        } else if (res.data && res.data.results && res.data.results.stream_url) {
            streams.push({
                name: "🌟 [API] VSMov",
                title: "Luong phat VSMov",
                url: res.data.results.stream_url
            });
        }
    } catch (e) { console.log("VSMov timeout"); }
    return streams;
}

async function scrapePhimLongTieng(movieName) {
    let streams = [];
    try {
        const searchSlug = toSlug(movieName);
        const searchRes = await axios.get(`https://1phim32.com{encodeURIComponent(searchSlug)}/`, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 3000 
        });
        const parseHtml = cheerio.load(searchRes.data);
        const firstMovieLink = parseHtml('.list-films .item a').first().attr('href');
        if (firstMovieLink) {
            const movieRes = await axios.get(firstMovieLink, { 
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                timeout: 3000
            });
            const parseMovie = cheerio.load(movieRes.data);
            const scripts = parseMovie('script').text();
            const m3u8Match = scripts.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/);
            if (m3u8Match) {
                streams.push({
                    name: "🔊 [Scrape] LongTieng",
                    title: "Ban Thuyet Minh / Long Tieng (.m3u8)",
                    url: m3u8Match[0]
                });
            }
        }
    } catch (e) { console.log("LongTieng timeout"); }
    return streams;
}

async function scrapeMotPhimTV(movieName) {
    let streams = [];
    try {
        const searchRes = await axios.get(`https://motphimtv.run{encodeURIComponent(movieName)}`, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 3000 
        });
        const parseHtml = cheerio.load(searchRes.data);
        const firstMovieLink = parseHtml('.list-films .item a').first().attr('href');
        if (firstMovieLink) {
            const movieRes = await axios.get(firstMovieLink, { 
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                timeout: 3000
            });
            const parseMovie = cheerio.load(movieRes.data);
            const scripts = parseMovie('script').text();
            const m3u8Match = scripts.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/);
            if (m3u8Match) {
                streams.push({
                    name: "📺 [Scrape] MotPhimTV",
                    title: "Luong phat du phong MotPhim",
                    url: m3u8Match[0]
                });
            }
        }
    } catch (e) { console.log("MotPhimTV timeout"); }
    return streams;
}

builder.defineStreamHandler(async (args) => {
    let movieName = "";
    const parts = args.id.split(':');
    
    if (args.id.startsWith('tt')) {
        try {
            const imdbId = parts[0]; 
            const cleanType = args.type === 'series' ? 'series' : 'movie';
            const res = await axios.get(`https://stremio.com{cleanType}/${imdbId}.json`, { timeout: 2500 });
            if (res.data?.meta?.name) {
                movieName = res.data.meta.name;
            }
        } catch (e) { movieName = ""; }
    } else if (parts.length > 1) {
        movieName = decodeURIComponent(parts[1]);
    } else {
        movieName = decodeURIComponent(args.id);
    }
    
    if (!movieName || movieName.toLowerCase() === "phim") {
        movieName = "Minecraft";
    }

    const [nguonc, kkphim, vsmov, longtieng, motphim] = await Promise.all([
        fetchNguonC(movieName),
        fetchKKPhim(movieName),
        fetchVSMov(movieName),
        scrapePhimLongTieng(movieName),
        scrapeMotPhimTV(movieName)
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
const sdkRouter = getRouter(addonInterface);

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    sdkRouter(req, res, () => {
        res.statusCode = 404;
        res.end();
    });
};
