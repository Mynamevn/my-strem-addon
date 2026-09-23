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

        console.log("========================================");
        console.log("[NGUONC] START");
        console.log("[NGUONC] Movie:", movieName);

        if (!movieName) {
            console.log("[NGUONC] Movie name is empty");
            return streams;
        }

        // ----------------------------------------------------
        // 1. SEARCH
        // ----------------------------------------------------

        const searchUrl =
            "https://phim.nguonc.com/api/films/search?keyword=" +
            encodeURIComponent(movieName);

        console.log("[NGUONC] Search URL:", searchUrl);

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

        if (!Array.isArray(items) || !items.length) {

            console.log(
                "[NGUONC] NO SEARCH RESULT"
            );

            return streams;
        }

        // ----------------------------------------------------
        // 2. CHỌN PHIM
        // ----------------------------------------------------

        let movie =
            items.find(item => {

                const name =
                    String(
                        item?.name || ""
                    ).trim().toLowerCase();

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

        // ----------------------------------------------------
        // 3. DETAIL
        // ----------------------------------------------------

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

        // ----------------------------------------------------
        // 4. EPISODES
        // ----------------------------------------------------

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

        // ----------------------------------------------------
        // 5. LẤY STREAM
        // ----------------------------------------------------

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

        /*
         * QUAN TRỌNG:
         * Endpoint detail phải là:
         *
         * /v1/api/phim/{slug}
         */

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
        console.log("[VSMOV] Search:", movieName);

        if (!movieName) {
            console.log("[VSMOV] Movie name rỗng");
            return streams;
        }

        // =====================================================
        // STEP 1: Tìm phim bằng API chính thức của VSMOV
        // =====================================================

        const searchUrl =
            "https://vsmov.com/api/tim-kiem?keyword=" +
            encodeURIComponent(movieName) +
            "&limit=10";

        console.log(
            "[VSMOV] API Search URL:",
            searchUrl
        );

        const searchRes =
            await axios.get(searchUrl, {
                timeout: 8000,
                headers: {
                    "User-Agent": "Mozilla/5.0",
                    "Accept": "application/json"
                }
            });

        const searchData =
            searchRes.data || {};

        // VSMOV có thể trả dữ liệu ở các cấu trúc khác nhau
        const items =
            searchData?.items ||
            searchData?.data?.items ||
            searchData?.data ||
            [];

        console.log(
            "[VSMOV] Search results:",
            Array.isArray(items) ? items.length : 0
        );

        if (!Array.isArray(items) || !items.length) {
            console.log(
                "[VSMOV] Không tìm thấy phim qua API"
            );
            return streams;
        }

        // =====================================================
        // STEP 2: Tìm kết quả phù hợp nhất
        // =====================================================

        const normalizeName = text => {

            return String(text || "")
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/đ/g, "d")
                .replace(/[^a-z0-9\s]/g, " ")
                .replace(/\s+/g, " ")
                .trim();

        };

        const targetName =
            normalizeName(movieName);

        let movie =
            items.find(item => {

                const name =
                    normalizeName(
                        item?.name
                    );

                return name === targetName;

            });

        // Thử origin_name nếu không tìm thấy
        if (!movie) {

            movie =
                items.find(item => {

                    const originName =
                        normalizeName(
                            item?.origin_name
                        );

                    return (
                        originName &&
                        originName === targetName
                    );

                });

        }

        // Thử tên chứa nhau
        if (!movie) {

            movie =
                items.find(item => {

                    const name =
                        normalizeName(
                            item?.name
                        );

                    const originName =
                        normalizeName(
                            item?.origin_name
                        );

                    return (
                        (name && name.includes(targetName)) ||
                        (targetName && targetName.includes(name)) ||
                        (originName && originName.includes(targetName)) ||
                        (targetName && originName.includes(targetName))
                    );

                });

        }

        // Cuối cùng mới lấy kết quả đầu tiên
        if (!movie) {
            movie = items[0];
        }

        if (!movie) {
            console.log(
                "[VSMOV] Không xác định được phim"
            );
            return streams;
        }

        const movieSlug =
            movie?.slug;

        const foundName =
            movie?.name ||
            movie?.origin_name ||
            "";

        if (!movieSlug) {

            console.log(
                "[VSMOV] Kết quả không có slug:",
                foundName
            );

            return streams;
        }

        console.log(
            "[VSMOV] Found:",
            foundName
        );

        console.log(
            "[VSMOV] Slug:",
            movieSlug
        );

        // =====================================================
        // STEP 3: Tạo URL trang phim thật của VSMOV
        // =====================================================

        const movieUrl =
            "https://vsmov.com/phim/" +
            encodeURIComponent(movieSlug);

        console.log(
            "[VSMOV] Movie URL:",
            movieUrl
        );

        // =====================================================
        // STEP 4: Mở trang phim thật
        // =====================================================

        const movieRes =
            await axios.get(movieUrl, {
                timeout: 8000,
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

                    "Accept":
                        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",

                    "Accept-Language":
                        "vi,en-US;q=0.9,en;q=0.8",

                    "Referer":
                        "https://vsmov.com/"
                }
            });

        const html =
            String(movieRes.data || "");

        console.log(
            "[VSMOV] Page HTML:",
            html.length
        );

        // =====================================================
        // STEP 5: Tìm video hash
        // =====================================================

        let videoHash = "";

        // Cách 1:
        // data-hash="..."
        const hashMatch =
            html.match(
                /data-hash=["']([^"']+)["']/i
            );

        if (
            hashMatch &&
            hashMatch[1]
        ) {
            videoHash =
                hashMatch[1];
        }

        // Cách 2:
        // videoHash = "..."
        if (!videoHash) {

            const jsMatch =
                html.match(
                    /videoHash\s*=\s*["']([^"']+)["']/i
                );

            if (
                jsMatch &&
                jsMatch[1]
            ) {
                videoHash =
                    jsMatch[1];
            }
        }

        // Cách 3:
        // /video/HASH
        if (!videoHash) {

            const videoMatch =
                html.match(
                    /\/video\/([a-f0-9-]{20,})/i
                );

            if (
                videoMatch &&
                videoMatch[1]
            ) {
                videoHash =
                    videoMatch[1];
            }
        }

        // Cách 4:
        // /stream/HASH/master.m3u8
        if (!videoHash) {

            const streamMatch =
                html.match(
                    /\/stream\/([a-f0-9-]{20,})\/master\.m3u8/i
                );

            if (
                streamMatch &&
                streamMatch[1]
            ) {
                videoHash =
                    streamMatch[1];
            }
        }

        if (!videoHash) {

            console.log(
                "[VSMOV] Không tìm thấy video hash"
            );

            // Vẫn trả về fallback mở đúng trang phim
            streams.push({
                name:
                    "🌐 [Fallback] VSmov",
                title:
                    "Mở đúng trang VSmov: " +
                    foundName,
                externalUrl:
                    movieUrl
            });

            return streams;
        }

        console.log(
            "[VSMOV] Video Hash:",
            videoHash
        );

        // =====================================================
        // STEP 6: Tạo M3U8
        // =====================================================

        const streamUrl =
            "https://v8.streamvsmov.com/stream/" +
            videoHash +
            "/master.m3u8";

        console.log(
            "[VSMOV] Stream URL:",
            streamUrl
        );

        // =====================================================
        // STEP 7: Stream trực tiếp
        // =====================================================

        streams.push({

            name:
                "🌟 [Scrape] VSmov",

            title:
                "Luồng phát VSmov - " +
                foundName,

            url:
                String(streamUrl),

            behaviorHints: {

                httpReferrer:
                    movieUrl,

                bingeGroup:
                    "vsmov"

            }

        });

        // =====================================================
        // STEP 8: Luôn thêm fallback mở đúng trang phim
        // =====================================================

        streams.push({

            name:
                "🌐 [Fallback] VSmov",

            title:
                "Mở đúng trang VSmov - " +
                foundName,

            externalUrl:
                movieUrl

        });

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
                    "📺 [Scrape] MotPhimTV",

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
   STREAM HANDLER
   ============================================================ */

builder.defineStreamHandler(async (args) => {

    console.log(
        "========== STREAM REQUEST =========="
    );

    console.log(
        "[STREAM] Args:",
        JSON.stringify(args || {})
    );

    // =====================================================
    // 1. Lấy ID
    // =====================================================

    const rawId =
        String(args?.id || "").trim();

    if (!rawId) {

        console.log(
            "[STREAM] Không có ID"
        );

        return {
            streams: []
        };
    }

    console.log(
        "[STREAM] Raw ID:",
        rawId
    );

    // =====================================================
    // 2. Xác định tên phim
    // =====================================================

    let movieName = "";

    try {

        // -------------------------------------------------
        // ID MOVINA dạng:
        //
        // vnwpsw:Tên phim
        //
        // hoặc series:
        //
        // vnwpsw:Tên phim:season:1:episode:2
        // -------------------------------------------------

        if (
            rawId.startsWith("vnwpsw:")
        ) {

            const encodedPart =
                rawId
                    .substring("vnwpsw:".length)
                    .split(":")[0];

            movieName =
                decodeURIComponent(
                    encodedPart
                );

        } else {

            // -------------------------------------------------
            // Các ID khác
            // -------------------------------------------------

            movieName =
                decodeMovieName(
                    rawId
                );

        }

    } catch (e) {

        console.log(
            "[STREAM] Decode ID error:",
            e?.message || e
        );

        movieName = "";

    }

    movieName =
        String(movieName || "")
            .trim();

    if (!movieName) {

        console.log(
            "[STREAM] Không xác định được tên phim"
        );

        return {
            streams: []
        };
    }

    console.log(
        "[STREAM] Movie:",
        movieName
    );

    // =====================================================
    // 3. Chạy 5 nguồn song song
    // =====================================================

    let results;

    try {

        results =
            await Promise.allSettled([

                // -----------------------------------------
                // NGUONC
                // -----------------------------------------

                fetchNguonC(
                    movieName
                ),

                // -----------------------------------------
                // KKPHIM
                // -----------------------------------------

                fetchKKPhim(
                    movieName
                ),

                // -----------------------------------------
                // VSMOV
                // -----------------------------------------

                fetchVSMov(
                    movieName
                ),

                // -----------------------------------------
                // 1PHIM32
                // -----------------------------------------

                scrapePhimLongTieng(
                    movieName
                ),

                // -----------------------------------------
                // MOTPHIMTV
                // -----------------------------------------

                scrapeMotPhimTV(
                    movieName
                )

            ]);

    } catch (e) {

        console.log(
            "[STREAM] Promise error:",
            e?.message || e
        );

        results = [];

    }

    // =====================================================
    // 4. Lấy kết quả từng nguồn
    // =====================================================

    const nguonc =
        results[0]?.status === "fulfilled" &&
        Array.isArray(results[0].value)
            ? results[0].value
            : [];

    const kkphim =
        results[1]?.status === "fulfilled" &&
        Array.isArray(results[1].value)
            ? results[1].value
            : [];

    const vsmov =
        results[2]?.status === "fulfilled" &&
        Array.isArray(results[2].value)
            ? results[2].value
            : [];

    const longtieng =
        results[3]?.status === "fulfilled" &&
        Array.isArray(results[3].value)
            ? results[3].value
            : [];

    const motphim =
        results[4]?.status === "fulfilled" &&
        Array.isArray(results[4].value)
            ? results[4].value
            : [];

    // =====================================================
    // 5. Log kết quả
    // =====================================================

    console.log(
        "[STREAM] NguonC:",
        nguonc.length
    );

    console.log(
        "[STREAM] KKPhim:",
        kkphim.length
    );

    console.log(
        "[STREAM] VSmov:",
        vsmov.length
    );

    console.log(
        "[STREAM] 1Phim32:",
        longtieng.length
    );

    console.log(
        "[STREAM] MotPhimTV:",
        motphim.length
    );

    // =====================================================
    // 6. Gộp stream trực tiếp
    // =====================================================

    const directStreams = [

        ...nguonc,
        ...kkphim,
        ...vsmov,
        ...longtieng,
        ...motphim

    ];

    // =====================================================
    // 7. Fallback website
    // =====================================================

    const externalStreams = [

        // -------------------------------------------------
        // 1PHIM32
        // -------------------------------------------------

        {
            name:
                "🌐 [Fallback] 1Phim32",

            title:
                "Mở trang tìm kiếm 1Phim32 - " +
                movieName,

            externalUrl:
                "https://www.1phim32.com/search/" +
                toSlug(movieName) +
                "/"
        },

        // -------------------------------------------------
        // NGUONC
        // -------------------------------------------------

        {
            name:
                "🌐 [Fallback] NguonC",

            title:
                "Mở trang tìm kiếm NguonC - " +
                movieName,

            externalUrl:
                "https://nguonc.com/tim-kiem?keyword=" +
                encodeURIComponent(
                    movieName
                )
        },

        // -------------------------------------------------
        // MOTPHIMTV
        // -------------------------------------------------

        {
            name:
                "🌐 [Fallback] MotPhimTV",

            title:
                "Mở trang tìm kiếm MotPhimTV - " +
                movieName,

            externalUrl:
                "https://motphimtv.run/?search=" +
                encodeURIComponent(
                    movieName
                )
        },

        // -------------------------------------------------
        // KKPHIM2
        // -------------------------------------------------

        {
            name:
                "🌐 [Fallback] KKPhim2",

            title:
                "Mở trang tìm kiếm KKPhim2 - " +
                movieName,

            externalUrl:
                "https://www.kkphim2.com/tim-kiem?keyword=" +
                encodeURIComponent(
                    movieName
                )
        }

    ];

    // =====================================================
    // 8. Lọc stream trực tiếp hợp lệ
    // =====================================================

    const validDirectStreams =
        directStreams.filter(
            stream => {

                if (
                    !stream ||
                    typeof stream !== "object"
                ) {
                    return false;
                }

                return Boolean(
                    stream.url ||
                    stream.externalUrl
                );

            }
        );

    // =====================================================
    // 9. Lọc fallback hợp lệ
    // =====================================================

    const validExternalStreams =
        externalStreams.filter(
            stream => {

                if (
                    !stream ||
                    typeof stream !== "object"
                ) {
                    return false;
                }

                return Boolean(
                    stream.externalUrl
                );

            }
        );

    // =====================================================
    // 10. Gộp tất cả
    // =====================================================

    const allStreams = [

        ...validDirectStreams,
        ...validExternalStreams

    ];

    // =====================================================
    // 11. Loại URL trùng
    // =====================================================

    const seen =
        new Set();

    const uniqueStreams =
        allStreams.filter(
            stream => {

                const key =
                    stream.url ||
                    stream.externalUrl;

                if (!key) {
                    return false;
                }

                if (
                    seen.has(key)
                ) {
                    return false;
                }

                seen.add(key);

                return true;

            }
        );

    // =====================================================
    // 12. Log cuối
    // =====================================================

    console.log(
        "[STREAM] Direct:",
        validDirectStreams.length
    );

    console.log(
        "[STREAM] Fallback:",
        validExternalStreams.length
    );

    console.log(
        "[STREAM] Total:",
        uniqueStreams.length
    );

    console.log(
        "========== STREAM END =========="
    );

    // =====================================================
    // 13. Trả về Stremio
    // =====================================================

    return {
        streams:
            uniqueStreams
    };

});

/* ============================================================
   VERCEL HANDLER
   ============================================================ */

const router =
    getRouter(
        builder.getInterface()
    );

module.exports = function handler(req, res) {
    return router(req, res, function next(err) {
        if (err) {
            console.error("[ROUTER ERROR]", err);

            if (!res.headersSent) {
                res.statusCode = 500;
                res.end("Internal Server Error");
            }
        }
    });
};
