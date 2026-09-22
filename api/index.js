const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

const manifest = {
    id: "community.paproplayer.multisource.v2000",
    version: "0.1.0",
    name: "MOVINA",
    description: "He thong gop nguon truc tiep",

    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "vnwpsw"],

    catalogs: [
        {
            type: "movie",
            id: "pa_movies_new",
            name: "Phim le moi",
            extra: [
                {
                    name: "search",
                    isRequired: false
                }
            ]
        },
        {
            type: "series",
            id: "pa_series_new",
            name: "Phim bo moi",
            extra: [
                {
                    name: "search",
                    isRequired: false
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

    return text
        .toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, "-");
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
        "";

    if (!rawPoster) return undefined;

    const poster = String(rawPoster).trim();

    if (
        poster.startsWith("https://") ||
        poster.startsWith("http://")
    ) {
        return poster;
    }

    if (poster.startsWith("//")) {
        return "https:" + poster;
    }

    const cleanPath = poster.startsWith("/")
        ? poster
        : "/" + poster;

    return "https://phimimg.com" + cleanPath;
}


/* ============================================================
   CATALOG
   ============================================================ */

async function fetchCatalogFromPhimApi(args) {

    const search = args.extra?.search;

    let apiUrl;

    if (search && search.trim()) {

        apiUrl =
            "https://phimapi.com/v1/api/tim-kiem?keyword=" +
            encodeURIComponent(search.trim()) +
            "&limit=20";

    } else if (
        args.type === "series" ||
        args.id === "pa_series_new"
    ) {

        apiUrl =
            "https://phimapi.com/v1/api/danh-sach/phim-bo?page=1&limit=20";

    } else {

        apiUrl =
            "https://phimapi.com/v1/api/danh-sach/phim-le?page=1&limit=20";
    }

    console.log("[CATALOG] Request:", apiUrl);

    const res = await axios.get(apiUrl, {
        timeout: 8000,
        headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json"
        }
    });

    const data = res.data || {};

    const items =
        data?.data?.items ||
        data?.items ||
        [];

    console.log("[CATALOG] Items:", items.length);

    return items;
}


builder.defineCatalogHandler(async (args) => {

    console.log(
        "[CATALOG] type:",
        args.type,
        "id:",
        args.id,
        "search:",
        args.extra?.search || ""
    );

    try {

        const items =
            await fetchCatalogFromPhimApi(args);

        if (!Array.isArray(items)) {

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
                        "vnwpsw:" +
                        encodeURIComponent(movieName),

                    type:
                        args.type === "series"
                            ? "series"
                            : "movie",

                    name:
                        movieName,

                    poster:
                        poster,

                    description:
                        "Original: " +
                        (
                            item.origin_name ||
                            item.original_name ||
                            movieName
                        ) +
                        " (" +
                        (
                            item.year ||
                            "New"
                        ) +
                        ")"
                };
            });

        console.log(
            "[CATALOG] Metas:",
            metas.length
        );

        return {
            metas
        };

    } catch (e) {

        console.error(
            "[CATALOG ERROR]",
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
        "[META] type:",
        args.type,
        "id:",
        args.id
    );

    try {

        let movieName = "";

        const rawId =
            String(args.id || "");

        /*
         * ID do Catalog tạo:
         *
         * vnwpsw:Tên%20phim
         */

        if (
            rawId.startsWith("vnwpsw:")
        ) {

            movieName =
                decodeURIComponent(
                    rawId.substring(
                        "vnwpsw:".length
                    )
                );

        } else if (
            rawId.startsWith("tt")
        ) {

            const imdbId =
                rawId.split(":")[0];

            const cleanType =
                args.type === "series"
                    ? "series"
                    : "movie";

            const res =
                await axios.get(
                    "https://stremio.com/" +
                    cleanType +
                    "/" +
                    imdbId +
                    ".json",
                    {
                        timeout: 5000
                    }
                );

            if (
                res.data?.meta?.name
            ) {

                movieName =
                    res.data.meta.name;
            }

        } else {

            movieName =
                decodeURIComponent(rawId);
        }

        console.log(
            "[META] Movie:",
            movieName
        );

        if (!movieName) {

            console.log(
                "[META] Không tìm thấy tên phim"
            );

            return {
                meta: null
            };
        }


        /* ----------------------------------------------------
           Tìm phim lại trên PhimAPI
           ---------------------------------------------------- */

        const searchUrl =
            "https://phimapi.com/v1/api/tim-kiem?keyword=" +
            encodeURIComponent(movieName) +
            "&limit=10";

        console.log(
            "[META] Search:",
            searchUrl
        );

        const res =
            await axios.get(
                searchUrl,
                {
                    timeout: 8000,
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0",
                        "Accept":
                            "application/json"
                    }
                }
            );

        const items =
            res.data?.data?.items ||
            res.data?.items ||
            [];

        console.log(
            "[META] Search results:",
            items.length
        );


        /* ----------------------------------------------------
           Tìm chính xác tên phim trước
           ---------------------------------------------------- */

        let item =
            items.find(
                x =>
                    x &&
                    x.name &&
                    x.name.toLowerCase() ===
                    movieName.toLowerCase()
            );


        /* ----------------------------------------------------
           Nếu không khớp tuyệt đối thì lấy kết quả đầu
           ---------------------------------------------------- */

        if (
            !item &&
            items.length > 0
        ) {

            item =
                items[0];
        }


        /* ----------------------------------------------------
           Không tìm được trên API
           ---------------------------------------------------- */

        if (!item) {

            console.log(
                "[META] Không tìm thấy item:",
                movieName
            );

            return {

                meta: {

                    id:
                        args.id,

                    type:
                        args.type === "series"
                            ? "series"
                            : "movie",

                    name:
                        movieName

                }

            };
        }


        /* ----------------------------------------------------
           Tạo Meta
           ---------------------------------------------------- */

        const poster =
            makePosterUrl(item);

        const meta = {

            id:
                args.id,

            type:
                args.type === "series"
                    ? "series"
                    : "movie",

            name:
                item.name ||
                movieName,

            poster:
                poster,

            description:
                "Original: " +
                (
                    item.origin_name ||
                    item.original_name ||
                    item.name ||
                    movieName
                ) +
                " (" +
                (
                    item.year ||
                    "New"
                ) +
                ")",

            releaseInfo:
                item.year
                    ? String(item.year)
                    : undefined,

            genres:
                Array.isArray(item.category)
                    ? item.category.map(
                        x =>
                            typeof x === "string"
                                ? x
                                : x.name
                    )
                    : undefined
        };

        console.log(
            "[META] OK:",
            meta.name
        );

        return {
            meta
        };

    } catch (e) {

        console.error(
            "[META ERROR]",
            e?.message || e
        );

        return {
            meta: null
        };
    }
});


/* ============================================================
   NGUONC
   ============================================================ */

async function fetchNguonC(movieName) {

    const streams = [];

    try {

        const searchUrl =
            "https://nguonc.com" +
            encodeURIComponent(movieName);

        const res =
            await axios.get(
                searchUrl,
                {
                    timeout: 4000
                }
            );

        if (
            res.data?.items &&
            res.data.items.length > 0
        ) {

            const movieSlug =
                res.data.items[0].slug;

            const detailUrl =
                "https://nguonc.com" +
                movieSlug;

            const detail =
                await axios.get(
                    detailUrl,
                    {
                        timeout: 4000
                    }
                );

            const episodes =
                detail.data?.film?.episodes || [];

            episodes.forEach(server => {

                if (!server.items) return;

                server.items.forEach(ep => {

                    if (!ep.m3u8_url) return;

                    streams.push({

                        name:
                            "🎬 [API] NguonC",

                        title:
                            "Tap " +
                            ep.name +
                            " - " +
                            (
                                server.server_name ||
                                ""
                            ),

                        url:
                            String(
                                ep.m3u8_url
                            )
                    });
                });
            });
        }

    } catch (e) {

        console.log(
            "[NguonC ERROR]",
            e?.message || e
        );
    }

    return streams;
}


/* ============================================================
   KKPHIM
   ============================================================ */

async function fetchKKPhim(movieName) {

    const streams = [];

    try {

        const searchUrl =
            "https://phimapi.com/v1/api/tim-kiem?keyword=" +
            encodeURIComponent(movieName);

        const res =
            await axios.get(
                searchUrl,
                {
                    timeout: 4000
                }
            );

        const items =
            res.data?.data?.items || [];

        if (
            items.length > 0
        ) {

            const movieSlug =
                items[0].slug;

            const detailUrl =
                "https://phimapi.com" +
                movieSlug;

            const detail =
                await axios.get(
                    detailUrl,
                    {
                        timeout: 4000
                    }
                );

            const episodesData =
                detail.data?.episodes || [];

            episodesData.forEach(server => {

                if (!server.server_data) {
                    return;
                }

                server.server_data.forEach(ep => {

                    if (!ep.link_m3u8) {
                        return;
                    }

                    streams.push({

                        name:
                            "⚡ [API] KKPhim",

                        title:
                            "Ban phat: " +
                            ep.name +
                            " - " +
                            (
                                server.server_name ||
                                ""
                            ),

                        url:
                            String(
                                ep.link_m3u8
                            )
                    });
                });
            });
        }

    } catch (e) {

        console.log(
            "[KKPhim ERROR]",
            e?.message || e
        );
    }

    return streams;
}


/* ============================================================
   VSMOV
   ============================================================ */

async function fetchVSMov(movieName) {

    const streams = [];

    try {

        const searchUrl =
            "https://vsmov.com" +
            encodeURIComponent(movieName);

        const res =
            await axios.get(
                searchUrl,
                {
                    timeout: 4000
                }
            );

        if (
            res.data?.stream_url
        ) {

            streams.push({

                name:
                    "🌟 [API] VSMov",

                title:
                    "Luong phat VSMov",

                url:
                    String(
                        res.data.stream_url
                    )
            });

        } else if (
            res.data?.results?.stream_url
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
            "[VSMov ERROR]",
            e?.message || e
        );
    }

    return streams;
}


/* ============================================================
   1PHIM32
   ============================================================ */

async function scrapePhimLongTieng(movieName) {

    const streams = [];

    try {

        const searchSlug =
            toSlug(movieName);

        const searchUrl =
            "https://www.1phim32.com/search/" +
            encodeURIComponent(searchSlug) +
            "/";

        const searchRes =
            await axios.get(
                searchUrl,
                {
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                    },
                    timeout: 4000
                }
            );

        const parseHtml =
            cheerio.load(
                searchRes.data
            );

        const firstMovieLink =
            parseHtml(
                ".list-films .item a"
            )
            .first()
            .attr("href");

        if (firstMovieLink) {

            const movieRes =
                await axios.get(
                    firstMovieLink,
                    {
                        headers: {
                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                        },
                        timeout: 4000
                    }
                );

            const parseMovie =
                cheerio.load(
                    movieRes.data
                );

            const scripts =
                parseMovie(
                    "script"
                ).text();

            const m3u8Match =
                scripts.match(
                    /(https?:\/\/[^"']+\.m3u8[^"']*)/
                );

            if (
                m3u8Match?.[1]
            ) {

                streams.push({

                    name:
                        "🔊 [Scrape] LongTieng",

                    title:
                        "Ban Thuyet Minh / Long Tieng (.m3u8)",

                    url:
                        String(
                            m3u8Match[1]
                        )
                });
            }
        }

    } catch (e) {

        console.log(
            "[LongTieng ERROR]",
            e?.message || e
        );
    }

    return streams;
}


/* ============================================================
   MOTPHIMTV
   ============================================================ */

async function scrapeMotPhimTV(movieName) {

    const streams = [];

    try {

        const searchUrl =
            "https://motphimtv.run/?search=" +
            encodeURIComponent(movieName);

        const searchRes =
            await axios.get(
                searchUrl,
                {
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                    },
                    timeout: 4000
                }
            );

        const parseHtml =
            cheerio.load(
                searchRes.data
            );

        const firstMovieLink =
            parseHtml(
                ".list-films .item a"
            )
            .first()
            .attr("href");

        if (firstMovieLink) {

            const movieRes =
                await axios.get(
                    firstMovieLink,
                    {
                        headers: {
                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                        },
                        timeout: 4000
                    }
                );

            const parseMovie =
                cheerio.load(
                    movieRes.data
                );

            const scripts =
                parseMovie(
                    "script"
                ).text();

            const m3u8Match =
                scripts.match(
                    /(https?:\/\/[^"']+\.m3u8[^"']*)/
                );

            if (
                m3u8Match?.[1]
            ) {

                streams.push({

                    name:
                        "📺 [Scrape] MotPhimTV",

                    title:
                        "Luong phat du phong MotPhim",

                    url:
                        String(
                            m3u8Match[1]
                        )
                });
            }
        }

    } catch (e) {

        console.log(
            "[MotPhimTV ERROR]",
            e?.message || e
        );
    }

    return streams;
}


/* ============================================================
   STREAM HANDLER
   ============================================================ */

builder.defineStreamHandler(async (args) => {

    console.log(
        "[STREAM] ID:",
        args.id,
        "TYPE:",
        args.type
    );

    let movieName = "";

    const parts =
        String(
            args.id || ""
        ).split(":");


    if (
        args.id?.startsWith("tt")
    ) {

        try {

            const imdbId =
                parts[0];

            const cleanType =
                args.type === "series"
                    ? "series"
                    : "movie";

            const res =
                await axios.get(
                    "https://stremio.com/" +
                    cleanType +
                    "/" +
                    imdbId +
                    ".json",
                    {
                        timeout: 3000
                    }
                );

            if (
                res.data?.meta?.name
            ) {

                movieName =
                    res.data.meta.name;
            }

        } catch (e) {

            console.log(
                "[IMDB ERROR]",
                e?.message || e
            );
        }

    } else if (
        parts.length > 1
    ) {

        movieName =
            decodeURIComponent(
                parts
                    .slice(1)
                    .join(":")
            );

    } else {

        movieName =
            decodeURIComponent(
                args.id || ""
            );
    }


    console.log(
        "[STREAM] Movie:",
        movieName
    );


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


    console.log(
        "[STREAM] Total:",
        orderedStreams.length
    );


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
    getRouter(
        addonInterface
    );


module.exports = async (req, res) => {

    res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.setHeader(
        "Access-Control-Allow-Headers",
        "*"
    );

    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, OPTIONS"
    );


    if (
        req.method === "OPTIONS"
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
