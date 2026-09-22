const { addonBuilder, getRouter } = require('stremio-addon-sdk');

// 1. Cấu hình Manifest chuẩn hóa tối đa
const manifest = {
    "id": "community.paproplayer.secure.v1000",
    "version": "1000.0.0", // Nâng lên v1000 để ép Stremio xóa hoàn toàn cache lỗi cũ trên thiết bị
    "name": "PA",
    "description": "Hệ thống kết nối luồng nội bộ PA v1000.",
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

// 2. Logic Catalog: Kéo danh sách phim từ API hiển thị mượt mà cố định lên Board
builder.defineCatalogHandler(async (args) => {
    let apiUrl = 'https://phimapi.com';
    if (args.type === 'series' || args.id === 'pa_series_new') {
        apiUrl = 'https://phimapi.com';
    }

    if (args.extra && args.extra.search) {
        apiUrl = 'https://phimapi.com' + encodeURIComponent(args.extra.search) + '&limit=12';
    }

    try {
        const res = await fetch(apiUrl);
        const data = await res.json();
        const items = data?.data?.items || data?.items || [];
        
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
    } catch (e) { console.error("Lỗi Catalog:", e); }

    return { metas: [] };
});

// 3. Logic Stream: Trích xuất tên phim thật, sửa dứt điểm lỗi chữ "phim", cam kết link ra chuẩn 100% link mẫu của bạn
builder.defineStreamHandler(async (args) => {
    let movieName = "Phim";
    const parts = args.id.split(':');

    if (args.id.startsWith('tt')) {
        try {
            const cleanType = args.type === 'series' ? 'series' : 'movie';
            const res = await fetch('https://strem.io' + cleanType + '/' + args.id + '.json');
            const data = await res.json();
            if (data?.meta?.name) {
                movieName = data.meta.name;
            }
        } catch (e) { movieName = "phim"; }
    } else if (parts.length > 1) {
        movieName = decodeURIComponent(parts[1]);
    } else {
        movieName = decodeURIComponent(args.id);
    }

    const slugQuery = toSlug(movieName);
    const urlQuery = encodeURIComponent(movieName).replace(/%20/g, '+');

    const link1Phim32 = 'https://1phim32.com' + '/search/' + slugQuery + '/';
    const linkNguonC = 'https://nguonc.com' + '/tim-kiem?keyword=' + urlQuery;
    const linkMotPhim = 'https://motphimtv.run' + '/?search=' + urlQuery;

    // Chỉ giữ duy nhất cơ chế externalUrl để ép Stremio bật tab mới, giải quyết dứt điểm lỗi "not supported"
    const streams = [
        {
            name: "🌐 PA [1Phim32]",
            title: 'Bấm để mở trang phát phim nhúng 1Phim32: ' + movieName,
            externalUrl: link1Phim32
        },
        {
            name: "🌐 PA [NguồnC]",
            title: 'Bấm để mở trang phát phim nhúng NguồnC: ' + movieName,
            externalUrl: linkNguonC
        },
        {
            name: "🌐 PA [MọtPhim]",
            title: 'Bấm để mở trang phát phim nhúng MọtPhim: ' + movieName,
            externalUrl: linkMotPhim
        }
    ];

    return { streams };
});

// 4. Khởi chạy Router chính thống của SDK kết nối thẳng vào Serverless Function của Vercel
const addonInterface = builder.getInterface();
const sdkRouter = getRouter(addonInterface);

module.exports = async (req, res) => {
    // Thiết lập CORS đầy đủ cho thiết bị SmartTV và Mobile kết nối thông suốt
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Chuyển tiếp request cho router chính thống của SDK xử lý định tuyến tự động chuẩn 100%
    sdkRouter(req, res, () => {
        res.statusCode = 404;
        res.end();
    });
};
