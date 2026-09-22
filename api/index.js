const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

const manifest = {
    "id": "community.paproplayer.multisource.v2000",
    "version": "2000.0.9",
    "name": "PA MULTI SOURCE STREAM",
    "description": "He thong gop nguon truc tiep (.m3u8): NguonC, KKPhim, VSMov, 1Phim32, MotPhimTV v2000.0.9",
    "resources": ["catalog", "stream"],
    "types": ["movie", "series"],
    "idPrefixes": ["tt", "vnwpsw"],
    "catalogs": [
        {
            "type": "movie",
            "id": "pa_movies_new",
            "name": "Phim le moi (PA)",
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
            "name": "Phim bo moi (PA)",
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

    // Đã là URL đầy đủ
    if (
        poster.startsWith('https://') ||
        poster.startsWith('http://')
    ) {
        return poster;
    }

    // URL dạng //domain/path
    if (poster.startsWith('//')) {
        return 'https:' + poster;
    }

    // Đường dẫn tương đối
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

    // Log item đầu tiên để kiểm tra cấu trúc poster
    if (items.length > 0) {
        console.log(
            '[CATALOG] First item:',
            JSON.stringify(items[0])
        );
    }

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

            console.log(
                '[CATALOG] Không có item'
            );

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

                console.log(
                    '[CATALOG] Poster:',
                    movieName,
                    '=>',
                    poster || 'NO POSTER'
                );

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
   NGUONC
   ============================================================ */

async function fetchNguonC(movieName) {

    let streams = [];

    try {

        const searchUrl =
            'https://nguonc.com' +
            encodeURIComponent(movieName);

        const res =
            await axios.get(searchUrl, {
                timeout: 4000
            });

        if (
            res.data &&
            res.data.items &&
            res.data.items.length > 0
        ) {

            const movieSlug =
                res.data.items[0].slug;

            const detailUrl =
                'https://nguonc.com' +
                movieSlug;

            const detail =
                await axios.get(detailUrl, {
                    timeout: 4000
                });

            const episodes =
                detail.data?.film?.episodes || [];

            episodes.forEach(server => {

                if (server.items) {

                    server.items.forEach(ep => {

                        if (ep.m3u8_url) {

                            streams.push({
                                name: "🎬 [API] NguonC",
                                title:
                                    "Tap " +
                                    ep.name +
                                    " - " +
                                    server.server_name,
                                url:
                                    String(ep.m3u8_url)
                            });

                        }

                    });

                }

            });
        }

    } catch (e) {

        console.log(
            "NguonC error"
        );
    }

    return streams;
}


/* ============================================================
   KKPHIM
   ============================================================ */

async function fetchKKPhim(movieName) {

    let streams = [];

    try {

        const searchUrl =
            'https://phimapi.com/v1/api/tim-kiem?keyword=' +
            encodeURIComponent(movieName);

        const res =
            await axios.get(searchUrl, {
                timeout: 4000
            });

        if (
            res.data &&
            res.data.data &&
            res.data.data.items &&
            res.data.data.items.length > 0
        ) {

            const movieSlug =
                res.data.data.items[0].slug;

            const detailUrl =
                'https://phimapi.com' +
                movieSlug;

            const detail =
                await axios.get(detailUrl, {
                    timeout: 4000
                });

            const episodesData =
                detail.data?.episodes || [];

            episodesData.forEach(server => {

                if (server.server_data) {

                    server.server_data.forEach(ep => {

                        if (ep.link_m3u8) {

                            streams.push({
                                name:
                                    "⚡ [API] KKPhim",
                                title:
                                    "Ban phat: " +
                                    ep.name +
                                    " - " +
                                    server.server_name,
                                url:
                                    String(ep.link_m3u8)
                            });

                        }

                    });

                }

            });
        }

    } catch (e) {

        console.log(
            "KKPhim error"
        );
    }

    return streams;
}


/* ============================================================
   VSMOV
   ============================================================ */

async function fetchVSMov(movieName) {

    let streams = [];

    try {

        const searchUrl =
            'https://vsmov.com' +
            encodeURIComponent(movieName);

        const res =
            await axios.get(searchUrl, {
                timeout: 4000
            });

        if (
            res.data &&
            res.data.stream_url
        ) {

            streams.push({
                name:
                    "🌟 [API] VSMov",
                title:
                    "Luong phat VSMov",
                url:
                    String(res.data.stream_url)
            });

        } else if (
            res.data &&
            res.data.results &&
            res.data.results.stream_url
        ) {

            streams.push({
                name:
                    "🌟 [API] VSMov",
                title:
                    "Luong phat VSMov",
                url:
                    String(
                        res.data.results.stream_url
                    )
            });
        }

    } catch (e) {

        console.log(
            "VSMov error"
        );
    }

    return streams;
}


/* ============================================================
   1PHIM32
   ============================================================ */

async function scrapePhimLongTieng(movieName) {

    let streams = [];

    try {

        const searchSlug =
            toSlug(movieName);

        const searchUrl =
            'https://www.1phim32.com/search/' +
            encodeURIComponent(searchSlug) +
            '/';

        const searchRes =
            await axios.get(searchUrl, {
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                },
                timeout: 4000
            });

        const parseHtml =
            cheerio.load(searchRes.data);

        const firstMovieLink =
            parseHtml(
                '.list-films .item a'
            )
            .first()
            .attr('href');

        if (firstMovieLink) {

            const movieRes =
                await axios.get(
                    firstMovieLink,
                    {
                        headers: {
                            'User-Agent':
                                'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                        },
                        timeout: 4000
                    }
                );

            const parseMovie =
                cheerio.load(movieRes.data);

            const scripts =
                parseMovie('script').text();

            const m3u8Match =
                scripts.match(
                    /(https?:\/\/[^"']+\.m3u8[^"']*)/
                );

            if (
                m3u8Match &&
                m3u8Match[1]
            ) {

                streams.push({
                    name:
                        "🔊 [Scrape] LongTieng",
                    title:
                        "Ban Thuyet Minh / Long Tieng (.m3u8)",
                    url:
                        String(m3u8Match[1])
                });
            }
        }

    } catch (e) {

        console.log(
            "LongTieng error"
        );
    }

    return streams;
}


/* ============================================================
   MOTPHIMTV
   ============================================================ */

async function scrapeMotPhimTV(movieName) {

    let streams = [];

    try {

        const searchUrl =
            'https://motphimtv.run/?search=' +
            encodeURIComponent(movieName);

        const searchRes =
            await axios.get(searchUrl, {
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                },
                timeout: 4000
            });

        const parseHtml =
            cheerio.load(searchRes.data);

        const firstMovieLink =
            parseHtml(
                '.list-films .item a'
            )
            .first()
            .attr('href');

        if (firstMovieLink) {

            const movieRes =
                await axios.get(
                    firstMovieLink,
                    {
                        headers: {
                            'User-Agent':
                                'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                        },
                        timeout: 4000
                    }
                );

            const parseMovie =
                cheerio.load(movieRes.data);

            const scripts =
                parseMovie('script').text();

            const m3u8Match =
                scripts.match(
                    /(https?:\/\/[^"']+\.m3u8[^"']*)/
                );

            if (
                m3u8Match &&
                m3u8Match[1]
            ) {

                streams.push({
                    name:
                        "📺 [Scrape] MotPhimTV",
                    title:
                        "Luong phat du phong MotPhim",
                    url:
                        String(m3u8Match[1])
                });
            }
        }

    } catch (e) {

        console.log(
            "MotPhimTV error"
        );
    }

    return streams;
}


/* ============================================================
   STREAM HANDLER
   ============================================================ */

builder.defineStreamHandler(async (args) => {

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
            decodeURIComponent(
                parts[1]
            );

    } else {

        movieName =
            decodeURIComponent(
                args.id
            );
    }

    if (
        !movieName ||
        movieName.toLowerCase() === "phim"
    ) {

        return {
            streams: []
        };
    }

    const [
        nguonc,
        kkphim,
        vsmov,
        longtieng,
        motphim
    ] = await Promise.all([

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

    return {
        streams:
            orderedStreams
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
