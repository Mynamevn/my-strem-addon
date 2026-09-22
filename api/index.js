const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

// 1. Giữ nguyên 100% cấu trúc Manifest mẫu đã cài đặt thành công của bạn
const manifest = {
    "id": "community.paproplayer.secure.v1000",
    "version": "1010.0.0", // Tăng phiên bản lên v1010 để ép Stremio xóa hoàn toàn cache lỗi cũ
    "name": "PA Ultimate Addon",
    "description": "Hệ thống gộp nguồn trực tiếp chuẩn (.m3u8) v1010",
    "resources": ["catalog", "stream"],
    "types": ["movie", "series"],
    "idPrefixes": ["tt", "vnwpsw"],
    "catalogs": [
        {
            "type": "movie",
            "id": "pa_movies_new",
            "name": "Phim lẻ mới (PA)",
            "extra": [{ "name": "search", "isRequired": false }]
        },
        {
            "type": "series",
            "id": "pa_series_new",
            "name": "Phim bộ mới (PA)",
            "extra": [{ "name": "search", "isRequired": false }]
        }
    ]
};

const builder = new addonBuilder(manifest);

// Hàm hỗ trợ định dạng slug tiếng Việt không dấu chuẩn xác cho 1Phim32
function toSlug(text) {
    if (!text) return "phim";
    return text.toString().toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-');
}

// 2. GIỮ NGUYÊN LOGIC CATALOG GỐC ĐÃ CHẠY MƯỢT MÀ CỦA BẠN
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
                description: 'Tên gốc: ' + (item.origin_name || item.name) + ' (' + (item.year || 'New') + ')'
            }));
            return { metas };
        }
    } catch (e) { console.error("Lỗi đồng bộ danh mục Catalog mẫu:", e.message); }

    return { metas: [] };
});

// ==========================================
// CÁC KHU VỰC KHAI THÁC LUỒNG (.M3U8) TRỰC TIẾP
// ==========================================

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
                                title: `Tập ${ep.name} - ${server.server_name}\nLuồng phát .m3u8 tốc độ cao`,
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
                                title: `Bản phát: ${ep.name} - ${server.server_name}\nTốc độ cao (.m3u8)`,
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
        if (res.data && res.data.results && res.data.results.length > 0 && res.data.results[0].stream_url) {
            streams.push({
                name: "🌟 [API] VSMov",
                title: `Luồng phát trực tiếp truyền tải VSMov (.m3u8)`,
                url: res.data.results[0].stream_url
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
        const $ = cheerio.load(searchRes.data);
        const firstMovieLink = $('.list-films .item a').first().attr('href');
        if (firstMovieLink) {
            const movieRes = await axios.get(firstMovieLink, { 
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                timeout: 3000
            });
            const $movie = cheerio.load(movieRes.data);
            const scripts = $movie('script').text();
            const m3u8Match = scripts.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/);
            if (m3u8Match) {
                streams.push({
                    name: "🔊 [Scrape] LongTieng",
                    title: `Bản Thuyết Minh / Lồng Tiếng (.m3u8)`,
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
        const $ = cheerio.load(searchRes.data);
        const firstMovieLink = $('.list-films .item a').first().attr('href');
        if (firstMovieLink) {
            const movieRes = await axios.get(firstMovieLink, { 
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                timeout: 3000
            });
            const $movie = cheerio.load(movieRes.data);
            const scripts = $movie('script').text();
            const m3u8Match = scripts.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/);
            if (m3u8Match) {
                streams.push({
                    name: "📺 [Scrape] MotPhimTV",
                    title: `Luồng phát dự phòng MotPhim (.m3u8)`,
                    url: m3u8Match[0]
                });
            }
        }
    } catch (e) { console.log("MotPhimTV timeout"); }
    return streams;
}

// 3. Logic xử lý luồng phát gộp nguồn thông minh
builder.defineStreamHandler(async (args) => {
    let movieName = "phim";
    const parts = args.id.split(':');

    // Tự động dịch mã IMDB sang tên thật bằng API Cinemeta chuẩn toàn cầu
    if (args.id.startsWith('tt')) {
        try {
            const cleanId = parts[0];
            const cleanType = args.type === 'series' ? 'series' : 'movie';
            const res = await axios.get(`https://stremio.com{cleanType}/${cleanId}.json`, { timeout: 2000 });
            if (res.data?.meta?.name) movieName = res.data.meta.name;
        } catch (e) { movieName = "phim"; }
    } else if (parts.length > 1) {
        movieName = decodeURIComponent(parts[1]);
    } else {
        movieName = decodeURIComponent(args.id);
    }

    if (!movieName || movieName === "phim") {
        return { streams: [] };
    }

    // Thu thập tài nguyên song song từ cả 5 nguồn dữ liệu
    const [nguonc, kkphim, vsmov, longtieng, motphim] = await Promise.all([
        fetchNguonC(movieName),
        fetchKKPhim(movieName),
        fetchVSMov(movieName),
        scrapePhimLongTieng(movieName),
        scrapeMotPhimTV(movieName)
    ]);

    // Xếp thứ tự chuẩn xác: 3 API lên đầu -> 2 trang cào Web ở sau
    const orderedStreams = [
        ...nguonc,
        ...kkphim,
        ...vsmov,
        ...longtieng,
        ...motphim
    ];

    return { streams: orderedStreams };
});

// 4. KHỞI CHẠY BẰNG CƠ CHẾ ROUTER GỐC SDK GIỐNG HỆT FILE MẪU CHẠY ĐƯỢC CỦA BẠN
const addonInterface = builder.getInterface();
const sdkRouter = getRouter(addonInterface);

module.exports = async (req, res) => {
    // Giữ nguyên cơ chế mở chặn CORS nguyên bản của bạn để SmartTV, Mobile kết nối thông suốt
    res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Headers', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

if (req.method === 'OPTIONS') {
res.status(200).end();
return;
}

// Chuyển tiếp cho router của SDK xử lý đồng bộ để tránh sập lỗi mạng Vercel
sdkRouter(req, res, () => {
res.statusCode = 404;
res.end();
});
};
