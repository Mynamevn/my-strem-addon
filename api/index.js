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
        // 1. TẠO CÁC BIẾN THỂ TÊN PHIM
        // ----------------------------------------------------

        function buildNguonCTitleVariants(title) {

            const original =
                String(title || "")
                    .replace(/\s+/g, " ")
                    .trim();

            if (!original) {
                return [];
            }

            const variants = [];

            function add(value) {

                const clean =
                    String(value || "")
                        .replace(/\s+/g, " ")
                        .trim();

                if (!clean) {
                    return;
                }

                const key =
                    clean
                        .normalize("NFD")
                        .replace(/[\u0300-\u036f]/g, "")
                        .toLowerCase();

                if (
                    !variants.some(
                        item => item.key === key
                    )
                ) {
                    variants.push({
                        text: clean,
                        key: key
                    });
                }

            }

            // Tên đầy đủ
            add(original);

            // Tách theo /
            original
                .split("/")
                .forEach(add);

            // Tách theo |
            original
                .split("|")
                .forEach(add);

            // Tách theo " - "
            original
                .split(/\s+-\s+/)
                .forEach(part => {

                    if (
                        String(part).trim().length >= 3
                    ) {
                        add(part);
                    }

                });

            return variants.map(
                item => item.text
            );

        }

        const titleVariants =
            buildNguonCTitleVariants(
                movieName
            );

        console.log(
            "[NGUONC] Title variants:",
            JSON.stringify(titleVariants)
        );

        // ----------------------------------------------------
        // 2. SEARCH
        // ----------------------------------------------------

        let movie = null;
        let selectedSearchTerm = "";

        for (
            const searchTerm
            of titleVariants
        ) {

            const searchUrl =
                "https://phim.nguonc.com/api/films/search?keyword=" +
                encodeURIComponent(searchTerm);

            console.log(
                "[NGUONC] Search term:",
                searchTerm
            );

            console.log(
                "[NGUONC] Search URL:",
                searchUrl
            );

            try {

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

                if (
                    !Array.isArray(items) ||
                    !items.length
                ) {
                    continue;
                }

                // ------------------------------------------------
                // 3. CHỌN PHIM KHỚP TÊN
                // ------------------------------------------------

                const normalizedSearchTerm =
                    String(searchTerm)
                        .trim()
                        .normalize("NFD")
                        .replace(/[\u0300-\u036f]/g, "")
                        .toLowerCase();

                const normalizedOriginal =
                    String(movieName)
                        .trim()
                        .normalize("NFD")
                        .replace(/[\u0300-\u036f]/g, "")
                        .toLowerCase();

                movie =
                    items.find(item => {

                        const name =
                            String(
                                item?.name || ""
                            )
                            .trim()
                            .normalize("NFD")
                            .replace(/[\u0300-\u036f]/g, "")
                            .toLowerCase();

                        return (
                            name ===
                            normalizedOriginal
                        );

                    }) ||

                    items.find(item => {

                        const name =
                            String(
                                item?.name || ""
                            )
                            .trim()
                            .normalize("NFD")
                            .replace(/[\u0300-\u036f]/g, "")
                            .toLowerCase();

                        return (
                            name ===
                            normalizedSearchTerm
                        );

                    }) ||

                    items[0];

                if (
                    movie &&
                    movie?.slug
                ) {

                    selectedSearchTerm =
                        searchTerm;

                    console.log(
                        "[NGUONC] MATCH FOUND with:",
                        searchTerm
                    );

                    console.log(
                        "[NGUONC] Selected movie:",
                        JSON.stringify(movie)
                    );

                    break;

                }

            } catch (searchError) {

                console.log(
                    "[NGUONC] Search error for:",
                    searchTerm
                );

                console.log(
                    "[NGUONC] Search error:",
                    searchError?.response?.status ||
                    searchError?.message ||
                    searchError
                );

                // Thử biến thể tiếp theo
                continue;
            }

        }

        // ----------------------------------------------------
        // 4. KHÔNG TÌM THẤY
        // ----------------------------------------------------

        if (!movie) {

            console.log(
                "[NGUONC] NO SEARCH RESULT"
            );

            return streams;
        }

        console.log(
            "[NGUONC] Selected search term:",
            selectedSearchTerm
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
        // 5. DETAIL
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
        // 6. EPISODES
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
        // 7. LẤY STREAM
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
   KKPHiM / PHIMAPI
   DIRECT STREAM
   ============================================================ */

async function fetchKKPhim(movieName) {

    const streams = [];

    try {

        console.log(
            "========================================"
        );

        console.log(
            "[KKPHIM] START"
        );

        console.log(
            "[KKPHIM] Search:",
            movieName
        );

        // =====================================================
        // 1. SEARCH PHIM
        // =====================================================

        const searchUrl =
            "https://phimapi.com/v1/api/tim-kiem?keyword=" +
            encodeURIComponent(movieName) +
            "&limit=10";

        console.log(
            "[KKPHIM] Search URL:",
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

        console.log(
            "[KKPHIM] Search HTTP:",
            res.status
        );

        const items =
            res.data?.data?.items ||
            res.data?.items ||
            [];

        console.log(
            "[KKPHIM] Search results:",
            Array.isArray(items)
                ? items.length
                : "NOT ARRAY"
        );

        if (
            !Array.isArray(items) ||
            !items.length
        ) {

            console.log(
                "[KKPHIM] NO SEARCH RESULT"
            );

            return streams;
        }

        // =====================================================
        // 2. CHỌN PHIM
        // =====================================================

        const normalizedSearch =
            String(movieName)
                .trim()
                .toLowerCase();

        const movie =
            items.find(
                item =>
                    String(
                        item?.name || ""
                    )
                        .trim()
                        .toLowerCase() ===
                    normalizedSearch
            ) ||
            items[0];

        console.log(
            "[KKPHIM] Selected movie:",
            JSON.stringify({
                name:
                    movie?.name,

                origin_name:
                    movie?.origin_name,

                slug:
                    movie?.slug,

                year:
                    movie?.year,

                type:
                    movie?.type
            })
        );

        const movieSlug =
            movie?.slug;

        if (!movieSlug) {

            console.log(
                "[KKPHIM] NO SLUG"
            );

            return streams;
        }

        console.log(
            "[KKPHIM] Slug:",
            movieSlug
        );

        // =====================================================
        // 3. DETAIL API
        // =====================================================

        const detailUrl =
            "https://phimapi.com/v1/api/phim/" +
            encodeURIComponent(
                movieSlug
            );

        console.log(
            "[KKPHIM] Detail URL:",
            detailUrl
        );

        const detail =
            await axios.get(
                detailUrl,
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

        console.log(
            "[KKPHIM] Detail HTTP:",
            detail.status
        );

        // =====================================================
        // 4. LẤY EPISODES
        // =====================================================

        const episodesData =
            detail.data?.episodes ||
            detail.data?.data?.episodes ||
            [];

        console.log(
            "[KKPHIM] Episodes type:",
            Array.isArray(episodesData)
                ? "array"
                : typeof episodesData
        );

        console.log(
            "[KKPHIM] Server count:",
            Array.isArray(episodesData)
                ? episodesData.length
                : 0
        );

        if (
            !Array.isArray(
                episodesData
            )
        ) {

            console.log(
                "[KKPHIM] EPISODES IS NOT ARRAY"
            );

            return streams;
        }

        // =====================================================
        // 5. DUYỆT TỪNG SERVER
        // =====================================================

        episodesData.forEach(
            (
                server,
                serverIndex
            ) => {

                const serverName =
                    server?.server_name ||
                    server?.name ||
                    "KKPhim";

                console.log(
                    "[KKPHIM] Server",
                    serverIndex,
                    ":",
                    serverName
                );

                const serverData =
                    server?.server_data ||
                    server?.items ||
                    [];

                console.log(
                    "[KKPHIM] Server",
                    serverIndex,
                    "episode count:",
                    Array.isArray(
                        serverData
                    )
                        ? serverData.length
                        : 0
                );

                if (
                    !Array.isArray(
                        serverData
                    )
                ) {
                    return;
                }

                // =================================================
                // 6. DUYỆT TỪNG EPISODE
                // =================================================

                serverData.forEach(
                    (
                        ep,
                        episodeIndex
                    ) => {

                        const episodeName =
                            ep?.name ||
                            ep?.filename ||
                            String(
                                episodeIndex + 1
                            );

                        const linkM3U8 =
                            ep?.link_m3u8 ||
                            ep?.m3u8_url ||
                            "";

                        const linkEmbed =
                            ep?.link_embed ||
                            ep?.embed ||
                            "";

                        console.log(
                            "[KKPHIM] Episode",
                            episodeIndex,
                            ":",
                            JSON.stringify({
                                name:
                                    episodeName,

                                link_m3u8:
                                    linkM3U8 || null,

                                link_embed:
                                    linkEmbed || null
                            })
                        );

                        // =================================================
                        // 7. NẾU CÓ M3U8 → DIRECT STREAM
                        // =================================================

                        if (
                            linkM3U8
                        ) {

                            console.log(
                                "[KKPHIM] DIRECT M3U8 FOUND:",
                                linkM3U8
                            );

                            streams.push({

                                name:
                                    "⚡ [API] KKPhim",

                                title:
                                    "Tập " +
                                    episodeName +
                                    " - " +
                                    serverName,

                                url:
                                    String(
                                        linkM3U8
                                    ),

                                behaviorHints: {
                                    bingeGroup:
                                        "kkphim-" +
                                        String(
                                            movieSlug
                                        )
                                }

                            });

                            return;
                        }

                        // =================================================
                        // 8. KHÔNG CÓ M3U8
                        // =================================================

                        console.log(
                            "[KKPHIM] NO DIRECT M3U8:",
                            episodeName
                        );

                    }
                );

            }
        );

        // =====================================================
        // 9. LOẠI URL TRÙNG
        // =====================================================

        const seen =
            new Set();

        const uniqueStreams =
            streams.filter(
                stream => {

                    const url =
                        String(
                            stream?.url ||
                            ""
                        ).trim();

                    if (!url) {
                        return false;
                    }

                    if (
                        seen.has(url)
                    ) {
                        return false;
                    }

                    seen.add(url);

                    return true;

                }
            );

        console.log(
            "[KKPHIM] DIRECT STREAMS:",
            uniqueStreams.length
        );

        if (
            uniqueStreams.length > 0
        ) {

            console.log(
                "[KKPHIM] First stream:",
                JSON.stringify(
                    uniqueStreams[0]
                )
            );

        } else {

            console.log(
                "[KKPHIM] KHONG CO DIRECT M3U8"
            );

        }

        console.log(
            "[KKPHIM] END"
        );

        console.log(
            "========================================"
        );

        return uniqueStreams;

    } catch (e) {

        console.error(
            "========================================"
        );

        console.error(
            "[KKPHIM ERROR]"
        );

        console.error(
            "Message:",
            e?.message ||
            e
        );

        console.error(
            "Status:",
            e?.response?.status ||
            "N/A"
        );

        console.error(
            "Response:",
            e?.response?.data
                ? JSON.stringify(
                    e.response.data
                )
                : "N/A"
        );

        console.error(
            "========================================"
        );

        return streams;
    }
}


/* ============================================================
   VSMOV
   TÌM PHIM
   SCRAPE M3U8
   FALLBACK ĐÚNG TRANG PHIM
   FALLBACK SEARCH NẾU KHÔNG CÓ PHIM
   ============================================================ */

async function fetchVSMov(movieName) {

    const streams = [];

    try {

        console.log("========================================");
        console.log("[VSMOV] START");
        console.log("[VSMOV] Search:", movieName);

        if (!movieName) {
            console.log("[VSMOV] Movie name rỗng");
            return streams;
        }

        // ====================================================
        // 1. TITLE VARIANTS
        // ====================================================

        const original =
            String(movieName || "").trim();

        const variants = [];

        function addVariant(value) {

            const clean =
                String(value || "")
                    .replace(/\s+/g, " ")
                    .trim();

            if (!clean) return;

            const key =
                clean
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .toLowerCase();

            if (
                !variants.some(
                    x => x.key === key
                )
            ) {

                variants.push({
                    text: clean,
                    key
                });

            }

        }

        addVariant(original);

        original
            .split("/")
            .forEach(addVariant);

        original
            .split("|")
            .forEach(addVariant);

        original
            .split(/\s+-\s+/)
            .forEach(part => {

                if (
                    String(part).trim().length >= 3
                ) {

                    addVariant(part);

                }

            });

        const titleVariants =
            variants.map(
                x => x.text
            );

        console.log(
            "[VSMOV] Title variants:",
            JSON.stringify(titleVariants)
        );

        // ====================================================
        // HÀM SCRAPE TRANG PHIM VSMOV
        // ====================================================

        async function scrapeMoviePage(
            movieUrl,
            foundName
        ) {

            try {

                console.log(
                    "[VSMOV] Movie URL:",
                    movieUrl
                );

                const movieRes =
                    await axios.get(
                        movieUrl,
                        {
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
                        }
                    );

                const html =
                    String(
                        movieRes.data || ""
                    );

                console.log(
                    "[VSMOV] Page HTML:",
                    html.length
                );

                // ====================================================
                // TÌM VIDEO HASH
                // ====================================================

                let videoHash = "";

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

                // ====================================================
                // KHÔNG CÓ VIDEO HASH
                // ====================================================

                if (!videoHash) {

                    console.log(
                        "[VSMOV] Không tìm thấy video hash"
                    );

                    // Vẫn cho phép mở đúng trang phim
                    streams.push({

                        name:
                            "🌐 [VSmov] " +
                            foundName,

                        title:
                            "Mở đúng trang VSmov - " +
                            foundName,

                        externalUrl:
                            movieUrl

                    });

                    return true;

                }

                console.log(
                    "[VSMOV] Video Hash:",
                    videoHash
                );

                // ====================================================
                // TẠO M3U8
                // ====================================================

                const streamUrl =
                    "https://v8.streamvsmov.com/stream/" +
                    videoHash +
                    "/master.m3u8";

                console.log(
                    "[VSMOV] Stream URL:",
                    streamUrl
                );

                // ====================================================
                // SCRAPE STREAM
                // ====================================================

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

                // ====================================================
                // FALLBACK ĐÚNG TRANG PHIM
                // ====================================================

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

                return true;

            } catch (e) {

                console.log(
                    "[VSMOV] Movie page error:",
                    e?.response?.status ||
                    e?.message ||
                    e
                );

                return false;

            }

        }

        // ====================================================
        // 2. API SEARCH
        // ====================================================

        const candidates = [];

        for (
            const variant
            of titleVariants
        ) {

            try {

                const searchUrl =
                    "https://vsmov.com/api/tim-kiem?keyword=" +
                    encodeURIComponent(variant) +
                    "&page=1&limit=24";

                console.log(
                    "[VSMOV] API Search:",
                    variant
                );

                const res =
                    await axios.get(
                        searchUrl,
                        {
                            timeout: 8000,

                            headers: {
                                "User-Agent":
                                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",

                                "Accept":
                                    "application/json"
                            }
                        }
                    );

                const data =
                    res.data || {};

                const items =
                    data?.data?.items ||
                    data?.items ||
                    data?.results ||
                    [];

                console.log(
                    "[VSMOV] Search results:",
                    variant,
                    "=>",
                    Array.isArray(items)
                        ? items.length
                        : 0
                );

                if (
                    Array.isArray(items)
                ) {

                    items.forEach(
                        item => {

                            if (
                                item &&
                                item.slug
                            ) {

                                candidates.push(
                                    item
                                );

                            }

                        }
                    );

                }

            } catch (e) {

                console.log(
                    "[VSMOV] API ERROR:",
                    variant,
                    e?.response?.status ||
                    e?.message ||
                    e
                );

            }

        }

        // ====================================================
        // 3. UNIQUE CANDIDATES
        // ====================================================

        const uniqueCandidates = [];

        const candidateSeen =
            new Set();

        candidates.forEach(
            item => {

                const slug =
                    String(
                        item?.slug || ""
                    ).trim();

                if (
                    !slug ||
                    candidateSeen.has(slug)
                ) {
                    return;
                }

                candidateSeen.add(slug);

                uniqueCandidates.push(
                    item
                );

            }
        );

        console.log(
            "[VSMOV] Unique candidates:",
            uniqueCandidates.length
        );

        // ====================================================
        // 4. NORMALIZE
        // ====================================================

        function normalizeTitle(text) {

            return String(text || "")
                .normalize("NFD")
                .replace(
                    /[\u0300-\u036f]/g,
                    ""
                )
                .toLowerCase()
                .replace(
                    /đ/g,
                    "d"
                )
                .replace(
                    /[^a-z0-9\s]/g,
                    " "
                )
                .replace(
                    /\s+/g,
                    " "
                )
                .trim();

        }

        // ====================================================
        // 5. RANK API RESULTS
        // ====================================================

        const ranked =
            uniqueCandidates
                .map(item => {

                    const name =
                        String(
                            item?.name || ""
                        );

                    const normalizedName =
                        normalizeTitle(
                            name
                        );

                    let score = 0;

                    titleVariants.forEach(
                        variant => {

                            const normalizedVariant =
                                normalizeTitle(
                                    variant
                                );

                            if (
                                normalizedName ===
                                normalizedVariant
                            ) {

                                score += 100;

                            }
                            else if (
                                normalizedName.includes(
                                    normalizedVariant
                                )
                            ) {

                                score += 50;

                            }
                            else if (
                                normalizedVariant.includes(
                                    normalizedName
                                )
                            ) {

                                score += 40;

                            }

                        }
                    );

                    return {
                        item,
                        score
                    };

                })
                .sort(
                    (a, b) =>
                        b.score - a.score
                );

        console.log(
            "[VSMOV] RANKED:",
            JSON.stringify(
                ranked.map(
                    x => ({
                        name:
                            x.item?.name,

                        slug:
                            x.item?.slug,

                        score:
                            x.score
                    })
                )
            )
        );

        // ====================================================
        // 6. API TÌM ĐƯỢC PHIM
        //    → SCRAPE
        // ====================================================

        if (
            ranked.length > 0
        ) {

            const selected =
                ranked[0].item;

            const movieSlug =
                String(
                    selected?.slug || ""
                ).trim();

            if (movieSlug) {

                const movieUrl =
                    "https://vsmov.com/phim/" +
                    encodeURIComponent(
                        movieSlug
                    );

                const foundName =
                    selected?.name ||
                    movieName;

                console.log(
                    "[VSMOV] Selected:",
                    foundName
                );

                console.log(
                    "[VSMOV] Slug:",
                    movieSlug
                );

                // SCRAPE TRANG PHIM
                const scraped =
                    await scrapeMoviePage(
                        movieUrl,
                        foundName
                    );

                if (scraped) {
                    return streams;
                }

            }

        }

        // ====================================================
        // 7. API KHÔNG TÌM THẤY
        //    → THỬ DIRECT SLUG
        // ====================================================

        console.log(
            "[VSMOV] API không tìm thấy phim."
        );

        const directSlugs = [];

        const slugSeen =
            new Set();

        titleVariants.forEach(
            variant => {

                const slug =
                    toSlug(variant);

                if (
                    slug &&
                    !slugSeen.has(slug)
                ) {

                    slugSeen.add(slug);

                    directSlugs.push(
                        slug
                    );

                }

            }
        );

        console.log(
            "[VSMOV] Direct slug candidates:",
            JSON.stringify(
                directSlugs
            )
        );

        // ====================================================
        // 8. KIỂM TRA DIRECT PAGE
        //    → NẾU CÓ THÌ SCRAPE LUÔN
        // ====================================================

        for (
            const slug
            of directSlugs
        ) {

            const movieUrl =
                "https://vsmov.com/phim/" +
                encodeURIComponent(
                    slug
                );

            console.log(
                "[VSMOV] Direct slug test:",
                movieUrl
            );

            try {

                const pageRes =
                    await axios.get(
                        movieUrl,
                        {
                            timeout: 7000,

                            headers: {
                                "User-Agent":
                                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",

                                "Accept":
                                    "text/html,application/xhtml+xml"
                            },

                            validateStatus:
                                status =>
                                    status >= 200 &&
                                    status < 500
                        }
                    );

                if (
                    pageRes.status !== 200
                ) {

                    console.log(
                        "[VSMOV] Direct slug error:",
                        slug,
                        pageRes.status
                    );

                    continue;

                }

                const html =
                    String(
                        pageRes.data || ""
                    );

                const lowerHtml =
                    html.toLowerCase();

                const looksLikeMoviePage =
                    lowerHtml.includes(
                        "nguồn phim"
                    ) ||
                    lowerHtml.includes(
                        "danh sách tập phim"
                    ) ||
                    lowerHtml.includes(
                        "<title>"
                    );

                if (
                    !looksLikeMoviePage
                ) {

                    continue;

                }

                console.log(
                    "[VSMOV] EXACT PAGE FOUND:",
                    movieUrl
                );

                // SCRAPE TRANG PHIM
                const scraped =
                    await scrapeMoviePage(
                        movieUrl,
                        movieName
                    );

                if (scraped) {
                    return streams;
                }

            } catch (e) {

                console.log(
                    "[VSMOV] Direct slug error:",
                    slug,
                    e?.response?.status ||
                    e?.message ||
                    e
                );

            }

        }

        // ====================================================
        // 9. KHÔNG CÓ PHIM
        //    → FALLBACK SEARCH
        // ====================================================

        console.log(
            "[VSMOV] Không tìm được phim."
        );

        const searchTerm =
            titleVariants.length > 1
                ? titleVariants[
                    titleVariants.length - 1
                ]
                : movieName;

        const searchUrl =
            "https://vsmov.com/?search=" +
            encodeURIComponent(
                searchTerm
            );

        console.log(
            "[VSMOV] Fallback URL:",
            searchUrl
        );

        streams.push({

            name:
                "🔎 [Fallback Search] VSmov",

            title:
                "Tìm phim trên VSmov - " +
                searchTerm,

            externalUrl:
                searchUrl

        });

    } catch (e) {

        console.log(
            "[VSMOV FATAL]",
            e?.message ||
            e
        );

        // ====================================================
        // 10. FALLBACK NẾU VSMOV LỖI
        // ====================================================

        const searchUrl =
            "https://vsmov.com/?search=" +
            encodeURIComponent(
                movieName
            );

        console.log(
            "[VSMOV] Fallback URL:",
            searchUrl
        );

        streams.push({

            name:
                "🔎 [Fallback Search] VSmov",

            title:
                "Tìm phim trên VSmov - " +
                movieName,

            externalUrl:
                searchUrl

        });

    }

    console.log(
        "[VSMOV] FINAL:",
        streams.length
    );

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
    // 1. LẤY ID + TYPE
    // =====================================================

    const rawId =
        String(args?.id || "").trim();

    const streamType =
        String(args?.type || "movie").trim();

    console.log(
        "[STREAM] Type:",
        streamType
    );

    console.log(
        "[STREAM] Raw ID:",
        rawId
    );

    if (!rawId) {

        console.log(
            "[STREAM] Không có ID"
        );

        return {
            streams: []
        };
    }

    // =====================================================
    // 2. XÁC ĐỊNH TÊN PHIM
    // =====================================================

    let movieName = "";

    try {

        // -------------------------------------------------
        // A. ID CỦA MOVINA
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

            console.log(
                "[STREAM] MOVINA name:",
                movieName
            );

        }

        // -------------------------------------------------
        // B. IMDb ID TỪ BOARD / DISCOVER
        // -------------------------------------------------

        else if (
            rawId.startsWith("tt")
        ) {

            const imdbId =
                rawId.split(":")[0];

            console.log(
                "[STREAM] IMDb ID:",
                imdbId
            );

            const metadataType =
                streamType === "series"
                    ? "series"
                    : "movie";

            // =================================================
            // B1. THỬ CINEMETA
            // =================================================

            const cinemetaUrl =
                "https://v3-cinemeta.strem.io/meta/" +
                metadataType +
                "/" +
                encodeURIComponent(
                    imdbId
                ) +
                ".json";

            console.log(
                "[STREAM] Cinemeta URL:",
                cinemetaUrl
            );

            try {

                const metaRes =
                    await axios.get(
                        cinemetaUrl,
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

                movieName =
                    metaRes.data?.meta?.name ||
                    "";

                console.log(
                    "[STREAM] Cinemeta name:",
                    movieName
                );

            } catch (e) {

                console.log(
                    "[STREAM] Cinemeta error:",
                    e?.response?.status ||
                    e?.message ||
                    e
                );

            }

            // =================================================
            // B2. NẾU CINEMETA KHÔNG CÓ → IMDb SUGGESTION
            // =================================================

            if (!movieName) {

                const imdbSuggestionUrl =
                    "https://v3.sg.media-imdb.com/suggestion/x/" +
                    encodeURIComponent(
                        imdbId
                    ) +
                    ".json";

                console.log(
                    "[STREAM] IMDb Suggestion URL:",
                    imdbSuggestionUrl
                );

                try {

                    const imdbRes =
                        await axios.get(
                            imdbSuggestionUrl,
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

                    const imdbItems =
                        Array.isArray(
                            imdbRes.data?.d
                        )
                            ? imdbRes.data.d
                            : [];

                    const imdbMovie =
                        imdbItems.find(
                            item =>
                                String(
                                    item?.id || ""
                                ) === imdbId
                        ) ||
                        imdbItems[0];

                    movieName =
                        imdbMovie?.l ||
                        "";

                    console.log(
                        "[STREAM] IMDb Suggestion name:",
                        movieName
                    );

                } catch (e) {

                    console.log(
                        "[STREAM] IMDb Suggestion error:",
                        e?.response?.status ||
                        e?.message ||
                        e
                    );

                }

            }

        }

        // -------------------------------------------------
        // C. ID KHÁC
        // -------------------------------------------------

        else {

            movieName =
                decodeMovieName(
                    rawId
                );

            console.log(
                "[STREAM] Decoded name:",
                movieName
            );

        }

    } catch (e) {

        console.log(
            "[STREAM] Resolve movie name error:",
            e?.message ||
            e
        );

        movieName = "";

    }

    // =====================================================
    // 3. CHUẨN HÓA TÊN
    // =====================================================

    movieName =
        String(movieName || "")
            .replace(/\s+/g, " ")
            .trim();

    console.log(
        "[STREAM] Final movie name:",
        movieName
    );

    // =====================================================
    // 4. NẾU VẪN KHÔNG CÓ TÊN
    // =====================================================

    if (!movieName) {

        console.log(
            "[STREAM] KHÔNG LẤY ĐƯỢC TÊN PHIM"
        );

        /*
         * Không thể tạo chính xác URL tìm kiếm
         * theo tên phim nếu chưa biết tên.
         *
         * Trả về một fallback thông báo bằng IMDb ID
         * để Stream Handler vẫn không hoàn toàn rỗng.
         */

        return {
            streams: [
                {
                    name:
                        "⚠️ [Metadata] Không lấy được tên phim",

                    title:
                        "IMDb: " +
                        rawId,

                    externalUrl:
                        "https://www.imdb.com/title/" +
                        encodeURIComponent(
                            rawId.split(":")[0]
                        ) +
                        "/"
                }
            ]
        };

    }

    // =====================================================
    // 5. TẠO TÊN RIÊNG CHO FALLBACK NGUONC
    // =====================================================

    let nguonCFallbackName =
        movieName;

    const slashParts =
        String(movieName)
            .split("/");

    if (
        slashParts.length > 1 &&
        String(
            slashParts[0]
        ).trim().length >= 3
    ) {

        nguonCFallbackName =
            String(
                slashParts[0]
            )
                .replace(/\s+/g, " ")
                .trim();

    }

    console.log(
        "[NGUONC FALLBACK] Original:",
        movieName
    );

    console.log(
        "[NGUONC FALLBACK] Selected:",
        nguonCFallbackName
    );

    // =====================================================
    // 6. CHẠY 5 NGUỒN SONG SONG
    // =====================================================

    let results = [];

    try {

        results =
            await Promise.allSettled([

                // 1
                fetchNguonC(
                    movieName
                ),

                // 2
                fetchKKPhim(
                    movieName
                ),

                // 3
                fetchVSMov(
                    movieName
                ),

                // 4
                scrapePhimLongTieng(
                    movieName
                ),

                // 5
                scrapeMotPhimTV(
                    movieName
                )

            ]);

    } catch (e) {

        console.log(
            "[STREAM] Promise error:",
            e?.message ||
            e
        );

        results = [];

    }

    // =====================================================
    // 7. LẤY KẾT QUẢ TỪ 5 NGUỒN
    // =====================================================

    const nguonc =
        results[0]?.status === "fulfilled" &&
        Array.isArray(
            results[0].value
        )
            ? results[0].value
            : [];

    const kkphim =
        results[1]?.status === "fulfilled" &&
        Array.isArray(
            results[1].value
        )
            ? results[1].value
            : [];

    const vsmov =
        results[2]?.status === "fulfilled" &&
        Array.isArray(
            results[2].value
        )
            ? results[2].value
            : [];

    const longtieng =
        results[3]?.status === "fulfilled" &&
        Array.isArray(
            results[3].value
        )
            ? results[3].value
            : [];

    const motphim =
        results[4]?.status === "fulfilled" &&
        Array.isArray(
            results[4].value
        )
            ? results[4].value
            : [];

    // =====================================================
    // 8. LOG
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
        "[STREAM] VSMov:",
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
    // 9. GỘP STREAM TRỰC TIẾP
    // =====================================================

    const directStreams = [

        ...nguonc,

        ...kkphim,

        ...vsmov,

        ...longtieng,

        ...motphim

    ];

    // =====================================================
    // 10. 4 FALLBACK CHUNG
    //
    // VSMOV KHÔNG THÊM Ở ĐÂY
    //
    // fetchVSMov() đã tự tạo fallback của VSMov
    // khi không lấy được stream.
    //
    // Tổng cộng:
    //
    // 1. 1Phim32
    // 2. NguonC
    // 3. MotPhimTV
    // 4. KKPhim2
    // 5. VSMov
    // =====================================================

    const externalStreams = [

        // -------------------------------------------------
        // FALLBACK 1 — 1PHIM32
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
        // FALLBACK 2 — NGUONC
        // -------------------------------------------------

        {
            name:
                "🌐 [Fallback] NguonC",

            title:
                "Mở trang tìm kiếm NguonC - " +
                nguonCFallbackName,

            externalUrl:
                "https://nguonc.com/tim-kiem?keyword=" +
                encodeURIComponent(
                    nguonCFallbackName
                )
        },

        // -------------------------------------------------
        // FALLBACK 3 — MOTPHIMTV
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
        // FALLBACK 4 — KKPHIM2
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
    // 11. LỌC DIRECT STREAM
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
    // 12. LỌC FALLBACK
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
    // 13. GỘP TẤT CẢ
    // =====================================================

    const allStreams = [

        ...validDirectStreams,

        ...validExternalStreams

    ];

    // =====================================================
    // 14. LOẠI URL TRÙNG
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
    // 15. LOG CUỐI
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
        "[STREAM] Fallback URLs:",
        JSON.stringify(
            validExternalStreams
        )
    );

    console.log(
        "========== STREAM END =========="
    );

    // =====================================================
    // 16. TRẢ VỀ STREMIO
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

    return router(
        req,
        res,
        function next(err) {

            if (err) {

                console.error(
                    "[ROUTER ERROR]",
                    err
                );

                if (
                    !res.headersSent
                ) {

                    res.statusCode =
                        500;

                    res.end(
                        "Internal Server Error"
                    );

                }

            }

        }
    );

};
