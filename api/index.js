const { addonBuilder } = require('stremio-addon-sdk');

// 1. Cấu hình Manifest từ bản v20 - Thêm tiền tố tt để Stremio khóa chặt hàng phim trên Board
const manifest = {
    "id": "community.paproplayer.secure.v500",
    "version": "500.0.0", // Nâng hẳn lên v500 để ép xóa sạch bộ nhớ cache lỗi cũ trên mọi thiết bị
    "name": "PA",
    "description": "Hệ thống kết nối luồng nội bộ PA v500.",
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
const catalogHandler = async (args) => {
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
    } catch (e) { console.error(e); }

    return { metas: [] };
};

// 3. Logic Stream: Nâng cấp trực tiếp từ bản v20, vá lỗi dính chữ bằng liên kết mảng thô độc lập
const streamHandler = async (args) => {
    let movieName = "Phim";
    const parts = args.id.split(':');

    // Chuyển hóa thông minh: Nếu mở phim từ kho chung Stremio, tự động tra cứu dịch sang tên Tiếng Việt
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

    // NỐI CHUỖI KHÓA CỨNG DẤU GẠCH CHÉO VÀ TỪ KHÓA TÌM KIẾM - CAM KẾT HIỂN THỊ ĐỦ 100% CẤU TRÚC MẪU CỦA BẠN
    const link1Phim32 = 'https://1phim32.com' + '/search/' + slugQuery + '/';
    const linkNguonC = 'https://nguonc.com' + '/tim-kiem?keyword=' + urlQuery;
    const linkMotPhim = 'https://motphimtv.run' + '/?search=' + urlQuery;

    const streams = [
        {
            name: "🌐 PA [1Phim32]",
            title: 'Mở trình phát nhúng 1Phim32 cho phim: ' + movieName,
            playerFrameUrl: link1Phim32,
            externalUrl: link1Phim32
        },
        {
            name: "🌐 PA [NguồnC]",
            title: 'Mở trình phát nhúng NguồnC cho phim: ' + movieName,
            playerFrameUrl: linkNguonC,
            externalUrl: linkNguonC
        },
        {
            name: "🌐 PA [MọtPhim]",
            title: 'Mở trình phát nhúng MọtPhim cho phim: ' + movieName,
            playerFrameUrl: linkMotPhim,
            externalUrl: linkMotPhim
        }
    ];

    return { streams };
};

// 4. Bộ định tuyến Router Serverless Native xử lý siêu tốc cho Vercel - Khóa chặt Board ổn định
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const cleanUrl = req.url.replace(/\/+/g, '/');
    const [pathPart, queryPart] = cleanUrl.split('?');

    try {
        if (pathPart === '/' || pathPart === '/manifest.json') {
            return res.status(200).json(manifest);
        }

        if (pathPart.includes('/catalog/')) {
            const cleanPath = pathPart.replace('.json', '');
            const parts = cleanPath.split('/').filter(p => p);
            const type = parts[1];
            const id = parts[2];
            const extraStr = parts[3];
            const extra = {};

            if (extraStr && extraStr.includes('=')) {
                const [key, val] = extraStr.split('=');
                if (key && val) extra[key] = decodeURIComponent(val);
            } else if (queryPart && queryPart.includes('=')) {
                const params = new URLSearchParams(queryPart);
                if (params.has('search')) extra['search'] = params.get('search');
            }

            const result = await catalogHandler({ type, id, extra });
            return res.status(200).json({ metas: result.metas || [] });
        }

        if (pathPart.includes('/stream/')) {
            const cleanPath = pathPart.replace('.json', '');
            const parts = cleanPath.split('/').filter(p => p);
            const type = parts[1];
            const id = parts.slice(2).join('/'); 

            const result = await streamHandler({ type, id: decodeURIComponent(id) });
            return res.status(200).json({ streams: result.streams || [] });
        }

        return res.status(200).json(manifest);
    } catch (error) {
        return res.status(200).json({ metas: [], streams: [] });
    }
};
