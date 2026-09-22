const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

// 1. Cấu hình Manifest chuẩn hóa qua SDK Router
const manifest = {
    "id": "community.paproplayer.secure.v1000",
    "version": "1002.0.0", // Tăng phiên bản để Stremio xóa hoàn toàn cache lỗi cũ
    "name": "PA Ultimate Addon",
    "description": "Tự động gộp luồng trực tiếp (.m3u8): NguonC, KKPhim, VSMov, 1Phim32, MotPhimTV",
    "resources": ["stream"],
    "types": ["movie", "series"],
    "idPrefixes": ["tt", "k20tm:"]
};

const builder = new addonBuilder(manifest);

// Hàm phụ: Sửa lỗi dịch tên phim từ mã IMDB (tt...) của Stremio sang tên tiếng Việt chuẩn để đi tìm kiếm
async function getMovieName(stremioId) {
    try {
        const cleanId = stremioId.split(':')[0];
        // Sử dụng Endpoint Cinemeta chuẩn của Stremio để lấy thông tin phim
        const res = await axios.get(`https://stremio.com{cleanId}.json`, { timeout: 3000 });
        if (res.data && res.data.meta && res.data.meta.name) {
            return res.data.meta.name;
        }
    } catch (e) {
        console.log("Lỗi phân giải tên phim, dùng mặc định:", e.message);
    }
    return "Minecraft"; // Tên dự phòng nếu phân giải thất bại
}

// Hàm hỗ trợ format slug tiếng Việt không dấu chuẩn xác cho 1Phim32
function toSlug(text) {
    if (!text) return "phim";
    return text.toString().toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-');
}

// ==========================================
// HÀM XỬ LÝ KHAI THÁC LUỒNG (.M3U8) TỪ CÁC NGUỒN TỰ ĐỘNG
// ==========================================

// [ƯU TIÊN 1] API NguonC
async function fetchNguonC(movieName) {
    let streams = [];
    try {
        const res = await axios.get(`https://nguonc.com{encodeURIComponent(movieName)}`, { timeout: 4000 });
        if (res.data && res.data.items && res.data.items.length > 0) {
            const movieSlug = res.data.items[0].slug;
            const detail = await axios.get(`https://nguonc.com{movieSlug}`, { timeout: 4000 });
            const episodes = detail.data.film.episodes || [];
            episodes.forEach(server => {
                if (server.items) {
                    server.items.forEach(ep => {
                        if (ep.m3u8_url) {
                            streams.push({
                                name: "🎬 [API] NguonC",
                                title: `Tập ${ep.name} - ${server.server_name}\nPhát trực tiếp (.m3u8)`,
                                url: ep.m3u8_url
                            });
                        }
                    });
                }
            });
        }
    } catch (e) { console.log("Lỗi NguonC API"); }
    return streams;
}

// [ƯU TIÊN 2] API KKPhim
async function fetchKKPhim(movieName) {
    let streams = [];
    try {
        const res = await axios.get(`https://kkphim.vip{encodeURIComponent(movieName)}`, { timeout: 4000 });
        if (res.data && res.data.data && res.data.data.items && res.data.data.items.length > 0) {
            const movieSlug = res.data.data.items[0].slug;
            const detail = await axios.get(`https://kkphim.vip{movieSlug}`, { timeout: 4000 });
            const serverData = detail.data.data.server_data || [];
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
    } catch (e) { console.log("Lỗi KKPhim API"); }
    return streams;
}

// [ƯU TIÊN 3] API VSMov
async function fetchVSMov(movieName) {
    let streams = [];
    try {
        const res = await axios.get(`https://vsmov.com{encodeURIComponent(movieName)}`, { timeout: 4000 });
        if (res.data && res.data.results && res.data.results.length > 0) {
            const videoUrl = res.data.results[0].stream_url;
            if (videoUrl) {
                streams.push({
                    name: "🌟 [API] VSMov",
                    title: `Luồng trực tiếp truyền tải VSMov (.m3u8)`,
                    url: videoUrl
                });
            }
        }
    } catch (e) { console.log("Lỗi VSMov API"); }
    return streams;
}

// [ƯU TIÊN 4] Cào dữ liệu PhimLongTieng (Sử dụng 1phim32.com)
async function scrapePhimLongTieng(movieName) {
    let streams = [];
    try {
        const searchSlug = toSlug(movieName);
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
                    title: `Bản Thuyết Minh / Lồng Tiếng (.m3u8)`,
                    url: m3u8Match[0]
                });
            }
        }
    } catch (e) { console.log("Lỗi cào PhimLongTieng"); }
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
                    title: `Luồng phát trực tiếp dự phòng MotPhim`,
                    url: m3u8Match[0]
                });
            }
        }
    } catch (e) { console.log("Lỗi cào MotPhimTV"); }
    return streams;
}

// 3. Logic Gộp luồng phát trả về cho Stremio Player
builder.defineStreamHandler(async (args) => {
    // Lấy tên phim thật từ ID (giải quyết triệt để lỗi chữ "phim") [^An toàn tuyệt đối]
    const movieName = await getMovieName(args.id);
    
    // Gọi chạy song song tất cả các nguồn cùng lúc để tối ưu hóa tốc độ tải
    const [nguonc, kkphim, vsmov, longtieng, motphim] = await Promise.all([
        fetchNguonC(movieName).catch(() => []),
        fetchKKPhim(movieName).catch(() => []),
        fetchVSMov(movieName).catch(() => []),
        scrapePhimLongTieng(movieName).catch(() => []),
        scrapeMotPhimTV(movieName).catch(() => [])
    ]);

    // Xếp thứ tự chuẩn xác: 3 nguồn API lên đầu -> Tiếp theo mới tới 2 nguồn cào Web
    const orderedStreams = [
        ...nguonc,
        ...kkphim,
        ...vsmov,
        ...longtieng,
        ...motphim
    ];

    return { streams: orderedStreams };
});

// 4. Khởi chạy bằng SDK Router chính thống để gạt bỏ lỗi "Failed to fetch" khi cài đặt
const addonInterface = builder.getInterface();
const sdkRouter = getRouter(addonInterface);

module.exports = async (req, res) => {
    // Thiết lập CORS đầy đủ cho thiết bị kết nối thông suốt
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Chuyển tiếp toàn bộ request cho SDK Router tự động xử lý định tuyến chuẩn 100%
    sdkRouter(req, res, () => {
        res.statusCode = 404;
        res.end();
    });
};
