const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

const manifest = {
    "id": "community.paproplayer.multisource.v2000",
    "version": "2000.0.10",
    "name": "MOVINA",
    "description": "He thong gop nguon truc tiep",
    "resources": ["catalog", "stream"],
    "types": ["movie", "series"],
    "idPrefixes": ["tt", "vnwpsw"],

    "catalogs": [
        {
            "type": "movie",
            "id": "pa_movies_new",
            "name": "MOVINA - Phim le moi",
            "extra": [
                {
                    "name": "search",
                    "isRequired": false
                }
            ]
        },
        {
            "type": "series",
            "id": "pa_series_new",
            "name": "MOVINA - Phim bo moi",
            "extra": [
                {
                    "name": "search",
                    "isRequired": false
                }
            ]
        }
    ]
};

const builder = new addonBuilder(manifest);


/* ============================================================
   UTILITY
   ============================================================ */

function toSlug(text) {
    if (!text) return "phim";

    return text.toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-');
}


/* ============================================================
   POSTER
   ============================================================ */

function makePosterUrl(item) {
    if (!item) return undefined;

    const rawPoster =
        item.poster_url ||
        item.poster ||
        item.thumb_url ||
        item.thumb ||
        '';

    if (!rawPoster) {
        return undefined;
    }

    const poster = String(rawPoster).trim();

    if (
        poster.startsWith('https://') ||
        poster.startsWith('http://')
    ) {
        return poster;
    }

    if (poster.startsWith('//')) {
        return 'https:' + poster;
    }

    const cleanPath = poster.startsWith('/')
        ? poster
        : '/' + poster;

    return 'https://phimimg.com' + cleanPath;
}


/* ============================================================
   CATALOG / BOARD
   ============================================================ */

async function fetchCatalogFromPhimApi(args) {

    const search = args.extra?.search;

    let apiUrl;

    if (search && search.trim()) {

        apiUrl =
            'https://phimapi.com/v1/api/tim-kiem?keyword=' +
            encodeURIComponent(search.trim()) +
            '&limit=20';

    } else {

        if (
            args.type === 'series' ||
            args.id === 'pa_series_new'
        ) {

            apiUrl =
                'https://phimapi.com/v1/api/danh-sach/phim-bo?page=1&limit=20';

        } else {

            apiUrl =
                'https://phimapi.com/v1/api/danh-sach/phim-le?page=1&limit=20';
        }
    }

    console.log('[CATALOG] Request:', apiUrl);

    const res = await axios.get(apiUrl, {
        timeout: 8000,
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json'
        }
    });

    const data = res.data || {};

    const items =
        data?.data?.items ||
        data?.items ||
        [];

    console.log('[CATALOG] Items:', items.length);

    return items;
}


builder.defineCatalogHandler(async (args) => {

    console.log(
        '[CATALOG] type:',
        args.type,
        'id:',
        args.id,
        'search:',
        args.extra?.search || ''
    );

    try {

        const items =
            await fetchCatalogFromPhimApi(args);

        if (
            !Array.isArray(items) ||
            items.length === 0
        ) {

            return {
                metas: []
            };
        }

        const metas = items
            .filter(item => item && item.name)
            .map(item => {

                const movieName =
                    String(item.name);

                const poster =
                    makePosterUrl(item);

                return {

                    id:
                        'vnwpsw:' +
                        encodeURIComponent(movieName),

                    type:
                        args.type === 'series'
                            ? 'series'
                            : 'movie',

                    name:
                        movieName,

                    poster:
                        poster,

                    description:
                        'Original: ' +
                        (
                            item.origin_name ||
                            item.original_name ||
                            movieName
                        ) +
                        ' (' +
                        (
                            item.year ||
                            'New'
                        ) +
                        ')'
                };
            });

        console.log(
            '[CATALOG] Metas:',
            metas.length
        );

        return {
            metas
        };

    } catch (e) {

        console.error(
            '[CATALOG ERROR]',
            e?.message || e
        );

        return {
            metas: []
        };
    }
});


/* ============================================================
   META HANDLER
   ============================================================ */

builder.defineMetaHandler(async (args) => {

    console.log(
        '[META] Request:',
        args.id,
        'type:',
        args.type
    );

    try {

        let movieName = '';

        /*
         * Catalog tạo ID dạng:
         *
         * vnwpsw:Tên phim
         */
        if (args.id.startsWith('vnwpsw:')) {

            movieName =
                decodeURIComponent(
                    args.id.substring('vnwpsw:'.length)
                );

        } else {

            movieName =
                decodeURIComponent(args.id);
        }

        if (!movieName) {

            console.log(
                '[META] Empty movie name'
            );

            return {
                meta: {
                    id: args.id,
                    type: args.type || 'movie',
                    name: 'Unknown'
                }
            };
        }

        console.log(
            '[META] Movie:',
            movieName
        );


        /* --------------------------------------------------------
           Tìm metadata từ PhimAPI
           -------------------------------------------------------- */

        const searchUrl =
            'https://phimapi.com/v1/api/tim-kiem?keyword=' +
            encodeURIComponent(movieName) +
            '&limit=10';

        const res =
            await axios.get(searchUrl, {
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'application/json'
                }
            });

        const items =
            res.data?.data?.items ||
            res.data?.items ||
            [];


        /* --------------------------------------------------------
           Tìm kết quả khớp
           -------------------------------------------------------- */

        let item =
            items.find(x =>
                x &&
                (
                    x.name === movieName ||
                    x.origin_name === movieName
                )
            );

        /*
         * Không khớp tuyệt đối thì dùng
         * kết quả đầu tiên.
         */
        if (!item && items.length > 0) {
            item = items[0];
        }


        /* --------------------------------------------------------
           Không tìm thấy metadata
           -------------------------------------------------------- */

        if (!item) {

            console.log(
                '[META] Không tìm thấy:',
                movieName
            );

            return {
                meta: {
                    id: args.id,
                    type: args.type || 'movie',
                    name: movieName
                }
            };
        }


        /* --------------------------------------------------------
           Tạo metadata cho Stremio
           -------------------------------------------------------- */

        const poster =
            makePosterUrl(item);

        const categories =
            Array.isArray(item.category)
                ? item.category
                    .map(x => x?.name)
                    .filter(Boolean)
                : [];

        const countries =
            Array.isArray(item.country)
                ? item.country
                    .map(x => x?.name)
                    .filter(Boolean)
                : [];

        const meta = {

            id:
                args.id,

            type:
                args.type === 'series'
                    ? 'series'
                    : 'movie',

            name:
                item.name ||
                movieName,

            poster:
                poster,

            description:
                item.content ||
                (
                    'Original: ' +
                    (
                        item.origin_name ||
                        item.original_name ||
                        movieName
                    ) +
                    ' (' +
                    (
                        item.year ||
                        'New'
                    ) +
                    ')'
                ),

            releaseInfo:
                item.year
                    ? String(item.year)
                    : undefined,

            year:
                item.year
                    ? Number(item.year)
                    : undefined,

            genres:
                categories,

            country:
                countries
        };

        console.log(
            '[META] OK:',
            meta.name,
            'poster:',
            meta.poster || 'NO POSTER'
        );

        return {
            meta
        };

    } catch (e) {

        console.error(
            '[META ERROR]',
            e?.message || e
        );

        /*
         * Fallback để Stremio vẫn nhận
         * metadata tối thiểu.
         */

        let fallbackName = '';

        try {

            if (args.id.startsWith('vnwpsw:')) {

                fallbackName =
                    decodeURIComponent(
                        args.id.substring(
                            'vnwpsw:'.length
                        )
                    );

            } else {

                fallbackName =
                    decodeURIComponent(args.id);
            }

        } catch (_) {

            fallbackName =
                String(args.id || 'Unknown');
        }

        return {

            meta: {
                id: args.id,
                type: args.type || 'movie',
                name: fallbackName || 'Unknown'
            }

        };
    }
});


/* ============================================================
   STREAM HANDLER
   ============================================================ */

builder.defineStreamHandler(async (args) => {

    /*
     * Giữ handler hiện tại của bạn ở đây.
     *
     * Bước này chưa thay đổi logic nguồn.
     */

    let movieName = "";

    const parts =
        args.id.split(':');

    if (args.id.startsWith('tt')) {

        try {

            const imdbId =
                parts[0];

            const cleanType =
                args.type === 'series'
                    ? 'series'
                    : 'movie';

            const res =
                await axios.get(
                    'https://stremio.com' +
                    cleanType +
                    '/' +
                    imdbId +
                    '.json',
                    {
                        timeout: 3000
                    }
                );

            if (
                res.data &&
                res.data.meta &&
                res.data.meta.name
            ) {

                movieName =
                    res.data.meta.name;
            }

        } catch (e) {

            movieName = "";
        }

    } else if (
        parts.length > 1
    ) {

        movieName =
            decodeURIComponent(parts[1]);

    } else {

        movieName =
            decodeURIComponent(args.id);
    }

    if (
        !movieName ||
        movieName.toLowerCase() === "phim"
    ) {

        return {
            streams: []
        };
    }

    /*
     * Tạm thời trả mảng rỗng trong bước metadata.
     *
     * Sau khi xác nhận trang phim mở được,
     * mới xử lý riêng phần stream.
     */
    return {
        streams: []
    };
});


/* ============================================================
   ROUTER
   ============================================================ */

const addonInterface =
    builder.getInterface();

const sdkRouter =
    getRouter(addonInterface);


module.exports = async (req, res) => {

    res.setHeader(
        'Access-Control-Allow-Origin',
        '*'
    );

    res.setHeader(
        'Access-Control-Allow-Headers',
        '*'
    );

    res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, OPTIONS'
    );

    if (
        req.method === 'OPTIONS'
    ) {

        res.status(200).end();
        return;
    }

    sdkRouter(
        req,
        res,
        () => {

            res.statusCode = 404;
            res.end();

        }
    );
};
