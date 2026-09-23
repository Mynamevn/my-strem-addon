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


function decodeMovieName(id) {
    try {
        const rawId = String(id || "");

        if (rawId.startsWith("vnwpsw:")) {
            return decodeURIComponent(
                rawId.substring("vnwpsw:".length)
            );
        }

        if (rawId.startsWith("tt")) {
            return "";
        }

        if (rawId.includes(":")) {
            return decodeURIComponent(
                rawId.split(":").slice(1).join(":")
            );
        }

        return decodeURIComponent(rawId);

    } catch (e) {
        return "";
    }
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
            return { metas: [] };
        }

        const metas = items
            .filter(item => item && item.name)
            .map(item => {

                const movieName =
                    String(item.name);

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
                        makePosterUrl(item),

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

        return { metas };

    } catch (e) {

        console.error(
            "[CATALOG ERROR]",
            e?.message || e
        );

        return { metas: [] };
    }
});


/* ============================================================
   META
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

        if (rawId.startsWith("vnwpsw:")) {

            movieName =
                decodeURIComponent(
                    rawId.substring("vnwpsw:".length)
                );

        } else if (rawId.startsWith("tt")) {

            const imdbId =
                rawId.split(":")[0];

            const cleanType =
                args.type === "series"
                    ? "series"
                    : "movie";

            try {

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

                movieName =
                    res.data?.meta?.name || "";

            } catch (e) {

                console.log(
                    "[META IMDB ERROR]",
                    e?.message || e
                );
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
            return { meta: null };
        }

        const searchUrl =
            "https://phimapi.com/v1/api/tim-kiem?keyword=" +
            encodeURIComponent(movieName) +
            "&limit=10";

        const res =
            await axios.get(
                searchUrl,
                {
                    timeout: 8000,
                    headers: {
                        "User-Agent": "Mozilla/5.0",
                        "Accept": "application/json"
                    }
                }
            );

        const items =
            res.data?.data?.items ||
            res.data?.items ||
            [];

        let item =
            items.find(
                x =>
                    x &&
                    x.name &&
                    x.name.toLowerCase() ===
                    movieName.toLowerCase()
            );

        if (!item && items.length > 0) {
            item = items[0];
        }

        if (!item) {

            return {
                meta: {
                    id: args.id,
                    type:
                        args.type === "series"
                            ? "series"
                            : "movie",
                    name: movieName
                }
            };
        }

        const meta = {

            id: args.id,

            type:
                args.type === "series"
                    ? "series"
                    : "movie",

            name:
                item.name ||
                movieName,

            poster:
                makePosterUrl(item),

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

        return { meta };

    } catch (e) {

        console.error(
            "[META ERROR]",
            e?.message || e
        );

        return { meta: null };
    }
});


/* ============================================================
   NGUONC
   API:
   https://phim.nguonc.com/api
   ============================================================ */

async function fetchNguonC(movieName) {

    const streams = [];

    try {

        console.log("");
        console.log("========================================");
        console.log("[NGUONC] START");
        console.log("[NGUONC] Movie:", movieName);
        console.log("========================================");

        if (!movieName) {
            console.log(
                "[NGUONC] Movie name is empty"
            );

            return streams;
        }


        /* ----------------------------------------------------
           1. SEARCH
           ---------------------------------------------------- */

        const searchUrl =
            "https://phim.nguonc.com/api/films/search?keyword=" +
            encodeURIComponent(movieName);

        console.log(
            "[NGUONC] Search URL:",
            searchUrl
        );

        const searchRes =
            await axios.get(
                searchUrl,
                {
                    timeout: 10000,
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                        "Accept":
                            "application/json,text/plain,*/*"
                    }
                }
            );

        console.log(
            "[NGUONC] Search HTTP:",
            searchRes.status
        );

        console.log(
            "[NGUONC] Search response type:",
            typeof searchRes.data
        );


        /* ----------------------------------------------------
           2. SEARCH RESULTS
           ---------------------------------------------------- */

        const items =
            searchRes.data?.items ||
            searchRes.data?.data?.items ||
            [];

        console.log(
            "[NGUONC] Search items:",
            Array.isArray(items)
                ? items.length
                : "NOT ARRAY"
        );

        if (
            !Array.isArray(items) ||
            !items.length
        ) {

            console.log(
                "[NGUONC] NO SEARCH RESULT"
            );

            return streams;
        }


        /* ----------------------------------------------------
           3. CHỌN PHIM KHỚP TÊN
           ---------------------------------------------------- */

        let movie =
            items.find(item => {

                const name =
                    String(
                        item?.name || ""
                    )
                    .trim()
                    .toLowerCase();

                return (
                    name ===
                    String(movieName)
                        .trim()
                        .toLowerCase()
                );

            }) || items[0];


        console.log(
            "[NGUONC] Selected movie:",
            JSON.stringify(movie)
        );


        const movieSlug =
            movie?.slug;

        if (!movieSlug) {

            console.log(
                "[NGUONC] NO SLUG"
            );

            return streams;
        }

        console.log(
            "[NGUONC] Slug:",
            movieSlug
        );


        /* ----------------------------------------------------
           4. DETAIL
           ---------------------------------------------------- */

        const detailUrl =
            "https://phim.nguonc.com/api/film/" +
            encodeURIComponent(movieSlug);

        console.log(
            "[NGUONC] Detail URL:",
            detailUrl
        );

        const detailRes =
            await axios.get(
                detailUrl,
                {
                    timeout: 10000,
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                        "Accept":
                            "application/json,text/plain,*/*"
                    }
                }
            );

        console.log(
            "[NGUONC] Detail HTTP:",
            detailRes.status
        );


        /* ----------------------------------------------------
           5. EPISODES
           ---------------------------------------------------- */

        const movieData =
            detailRes.data?.movie ||
            detailRes.data?.data?.movie ||
            detailRes.data ||
            {};

        const episodes =
            movieData?.episodes ||
            detailRes.data?.episodes ||
            [];

        console.log(
            "[NGUONC] Episodes type:",
            Array.isArray(episodes)
                ? "array"
                : typeof episodes
        );

        console.log(
            "[NGUONC] Servers:",
            Array.isArray(episodes)
                ? episodes.length
                : 0
        );

        if (!Array.isArray(episodes)) {

            console.log(
                "[NGUONC] EPISODES IS NOT ARRAY"
            );

            return streams;
        }


        /* ----------------------------------------------------
           6. LẤY M3U8
           ---------------------------------------------------- */

        episodes.forEach(
            (server, serverIndex) => {

                console.log(
                    "[NGUONC] Server",
                    serverIndex,
                    ":",
                    server?.server_name ||
                    server?.name ||
                    "Unknown"
                );

                const serverItems =
                    server?.items ||
                    server?.server_data ||
                    [];

                console.log(
                    "[NGUONC] Server items:",
                    Array.isArray(serverItems)
                        ? serverItems.length
                        : 0
                );

                if (!Array.isArray(serverItems)) {
                    return;
                }

                serverItems.forEach(
                    (ep, episodeIndex) => {

                        const streamUrl =
                            ep?.link_m3u8 ||
                            ep?.m3u8_url ||
                            ep?.link_embed ||
                            ep?.url;

                        console.log(
                            "[NGUONC] Episode",
                            episodeIndex,
                            "name:",
                            ep?.name
                        );

                        console.log(
                            "[NGUONC] Episode URL:",
                            streamUrl || "NONE"
                        );

                        if (!streamUrl) {
                            return;
                        }

                        streams.push({

                            name:
                                "🎬 [API] NguonC",

                            title:
                                "Tập " +
                                (
                                    ep?.name ||
                                    ep?.slug ||
                                    episodeIndex + 1
                                ) +
                                " - " +
                                (
                                    server?.server_name ||
                                    server?.name ||
                                    "NguonC"
                                ),

                            url:
                                String(streamUrl)

                        });

                    }
                );

            }
        );


        console.log(
            "[NGUONC] FINAL STREAM COUNT:",
            streams.length
        );

        console.log(
            "[NGUONC] FINAL STREAMS:",
            JSON.stringify(streams)
        );

    } catch (e) {

        console.error(
            "========================================"
        );

        console.error(
            "[NGUONC ERROR]"
        );

        console.error(
            "Message:",
            e?.message || e
        );

        console.error(
            "Status:",
            e?.response?.status || "N/A"
        );

        console.error(
            "Response:",
            e?.response?.data
                ? JSON.stringify(e.response.data)
                : "N/A"
        );

        console.error(
            "========================================"
        );
    }

    return streams;
}


/* ============================================================
   KKPHIM / PHIMAPI
   ============================================================ */

async function fetchKKPhim(movieName) {

    const streams = [];

    try {

        console.log(
            "[KKPHIM] Search:",
            movieName
        );

        const searchUrl =
            "https://phimapi.com/v1/api/tim-kiem?keyword=" +
            encodeURIComponent(movieName) +
            "&limit=10";

        const res =
            await axios.get(
                searchUrl,
                {
                    timeout: 8000,
                    headers: {
                        "User-Agent": "Mozilla/5.0",
                        "Accept": "application/json"
                    }
                }
            );

        const items =
            res.data?.data?.items ||
            res.data?.items ||
            [];

        console.log(
            "[KKPHIM] Search results:",
            items.length
        );

        if (!items.length) {
            return streams;
        }

        const movie =
            items.find(
                x =>
                    x?.name?.toLowerCase() ===
                    movieName.toLowerCase()
            ) ||
            items[0];

        const movieSlug =
            movie?.slug;

        if (!movieSlug) {
            return streams;
        }

        console.log(
            "[KKPHIM] Slug:",
            movieSlug
        );

        const detailUrl =
            "https://phimapi.com/v1/api/phim/" +
            encodeURIComponent(movieSlug);

        const detail =
            await axios.get(
                detailUrl,
                {
                    timeout: 8000,
                    headers: {
                        "User-Agent": "Mozilla/5.0",
                        "Accept": "application/json"
                    }
                }
            );

        const episodesData =
            detail.data?.episodes ||
            [];

        episodesData.forEach(server => {

            const serverData =
                server.server_data ||
                [];

            serverData.forEach(ep => {

                if (!ep.link_m3u8) {
                    return;
                }

                streams.push({

                    name:
                        "⚡ [API] KKPhim",

                    title:
                        "Ban phat: " +
                        (
                            ep.name ||
                            ""
                        ) +
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

        console.log(
            "[KKPHIM] Streams:",
            streams.length
        );

    } catch (e) {

        console.log(
            "[KKPHIM ERROR]",
            e?.response?.status ||
            e?.message ||
            e
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

        console.log(
            "[VSMOV] Search:",
            movieName
        );

        const searchUrl =
            "https://vsmov.com" +
            encodeURIComponent(movieName);

        const res =
            await axios.get(
                searchUrl,
                {
                    timeout: 6000,
                    headers: {
                        "User-Agent": "Mozilla/5.0",
                        "Accept": "application/json"
                    }
                }
            );

        const streamUrl =
            res.data?.stream_url ||
            res.data?.results?.stream_url;

        if (streamUrl) {

            streams.push({

                name:
                    "🌟 [API] VSMov",

                title:
                    "Luong phat VSMov",

                url:
                    String(streamUrl)
            });
        }

        console.log(
            "[VSMOV] Streams:",
            streams.length
        );

    } catch (e) {

        console.log(
            "[VSMOV ERROR]",
            e?.response?.status ||
            e?.message ||
            e
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

        console.log(
            "[1PHIM32] Search:",
            movieName
        );

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
                    timeout: 6000
                }
            );

        const parseHtml =
            cheerio.load(
                searchRes.data
            );

        let firstMovieLink =
            parseHtml(
                ".list-films .item a"
            )
            .first()
            .attr("href");

        if (
            firstMovieLink &&
            firstMovieLink.startsWith("/")
        ) {

            firstMovieLink =
                "https://www.1phim32.com" +
                firstMovieLink;
        }

        if (!firstMovieLink) {

            console.log(
                "[1PHIM32] Không tìm thấy trang phim"
            );

            return streams;
        }

        console.log(
            "[1PHIM32] Movie URL:",
            firstMovieLink
        );

        const movieRes =
            await axios.get(
                firstMovieLink,
                {
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                    },
                    timeout: 6000
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
                /(https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*)/
            );

        if (m3u8Match?.[1]) {

            streams.push({

                name:
                    "🔊 [Scrape] 1Phim32",

                title:
                    "Luong phat 1Phim32",

                url:
                    String(
                        m3u8Match[1]
                    )
            });
        }

        console.log(
            "[1PHIM32] Streams:",
            streams.length
        );

    } catch (e) {

        console.log(
            "[1PHIM32 ERROR]",
            e?.response?.status ||
            e?.message ||
            e
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

        console.log(
            "[MOTPHIM] Search:",
            movieName
        );

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
                    timeout: 6000
                }
            );

        const parseHtml =
            cheerio.load(
                searchRes.data
            );

        let firstMovieLink =
            parseHtml(
                ".list-films .item a"
            )
            .first()
            .attr("href");

        if (
            firstMovieLink &&
            firstMovieLink.startsWith("/")
        ) {

            firstMovieLink =
                "https://motphimtv.run" +
                firstMovieLink;
        }

        if (!firstMovieLink) {

            console.log(
                "[MOTPHIM] Không tìm thấy trang phim"
            );

            return streams;
        }

        console.log(
            "[MOTPHIM] Movie URL:",
            firstMovieLink
        );

        const movieRes =
            await axios.get(
                firstMovieLink,
                {
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64;
                    },
                    timeout: 6000
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
                /(https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*)/
            );

        if (m3u8Match?.[1]) {

            streams.push({

                name:
                    "🔥 [Scrape] MotPhimTV",

                title:
                    "Luong phat MotPhimTV",

                url:
                    String(
                        m3u8Match[1]
                    )
            });
        }

        console.log(
            "[MOTPHIM] Streams:",
            streams.length
        );

    } catch (e) {

        console.log(
            "[MOTPHIM ERROR]",
            e?.response?.status ||
            e?.message ||
            e
        );
    }

    return streams;
}
/* ============================================================
   STREAM HANDLER - KÍCH HOẠT GỘP NGUỒN
   ============================================================ */

builder.defineStreamHandler(async (args) => {

    console.log("");
    console.log("========================================");
    console.log("[STREAM] NEW REQUEST");
    console.log("========================================");

    console.log(
        "[STREAM] Args:",
        JSON.stringify(args)
    );

    let movieName = "";

    const rawId =
        String(args.id || "");

    console.log(
        "[STREAM] Raw ID:",
        rawId
    );

    /* --------------------------------------------------------
       MOVINA ID
       -------------------------------------------------------- */

    if (
        rawId.startsWith("vnwpsw:")
    ) {

        try {

            movieName =
                decodeURIComponent(
                    rawId.substring(
                        "vnwpsw:".length
                    )
                );

        } catch (e) {

            console.log(
                "[STREAM ID ERROR]:",
                e?.message || e
            );

            movieName =
                rawId.substring(
                    "vnwpsw:".length
                );
        }
    }

    /* --------------------------------------------------------
       IMDb
       -------------------------------------------------------- */

    else if (
        rawId.startsWith("tt")
    ) {

        try {

            const imdbId =
                rawId.split(":")[0];

            const cleanType =
                args.type === "series"
                    ? "series"
                    : "movie";

            const res =
                await axios.get(
                    "https://stremio.com" +
                    cleanType +
                    "/" +
                    imdbId +
                    ".json",
                    {
                        timeout: 5000
                    }
                );

            movieName =
                res.data?.meta?.name || "";

        } catch (e) {

            console.log(
                "[STREAM IMDB ERROR]:",
                e?.message || e
            );
        }
    }

    /* --------------------------------------------------------
       OTHER ID
       -------------------------------------------------------- */

    else {

        try {

            movieName =
                decodeURIComponent(
                    rawId
                );

        } catch (e) {

            console.log(
                "[STREAM DECODE ERROR]:",
                e?.message || e
            );

            movieName =
                rawId;
        }
    }

    console.log(
        "[STREAM] Type:",
        args.type
    );

    console.log(
        "[STREAM] Resolved movie:",
        movieName
    );

    /* --------------------------------------------------------
       KIỂM TRA ID
       -------------------------------------------------------- */

    if (
        !movieName ||
        !movieName.trim()
    ) {

        console.log(
            "[STREAM] ERROR: movieName is empty"
        );

        return {
            streams: []
        };
    }

    console.log(
        "[STREAM] Movie name resolved successfully"
    );

    /* --------------------------------------------------------
       GỘP 5 NGUỒN PHIM CHẠY SONG SONG
       -------------------------------------------------------- */
    console.log("[STREAM] Đang tìm kiếm link phim từ cả 5 nguồn...");

    try {
        // Thực thi gọi cả 5 hàm lấy nguồn cùng lúc để tối ưu thời gian phản hồi
        const [
            nguonCStreams, 
            kkPhimStreams, 
            vsMovStreams, 
            phim32Streams, 
            motPhimStreams
        ] = await Promise.all([
            fetchNguonC(movieName).catch(e => { console.error("[STREAM ERR NguonC]:", e.message || e); return []; }),
            fetchKKPhim(movieName).catch(e => { console.error("[STREAM ERR KKPhim]:", e.message || e); return []; }),
            fetchVSMov(movieName).catch(e => { console.error("[STREAM ERR VSMov]:", e.message || e); return []; }),
            scrapePhimLongTieng(movieName).catch(e => { console.error("[STREAM ERR 1Phim32]:", e.message || e); return []; }),
            scrapeMotPhimTV(movieName).catch(e => { console.error("[STREAM ERR MotPhimTV]:", e.message || e); return []; })
        ]);

        // Gộp tất cả kết quả thu thập được vào một danh sách duy nhất
        const allStreams = [
            ...nguonCStreams,
            ...kkPhimStreams,
            ...vsMovStreams,
            ...phim32Streams,
            ...motPhimStreams
        ];

        console.log(`[STREAM] Hoàn tất gộp nguồn. Tổng số luồng phát tìm thấy: ${allStreams.length}`);

        return {
            streams: allStreams
        };

    } catch (error) {
        console.error("[STREAM GLOBAL ERROR]:", error.message || error);
        return {
            streams: []
        };
    }
});

/* ============================================================
   ADDON ROUTER
   ============================================================ */

const addonInterface =
    builder.getInterface();

const sdkRouter =
    getRouter(addonInterface);


/* ============================================================
   HTTP HANDLER
   ============================================================ */

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
