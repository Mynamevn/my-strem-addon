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

        console.log("========================================");
        console.log("[VSMOV] START");
        console.log("[VSMOV] Original title:", movieName);


        if (!movieName) {
            console.log("[VSMOV] Movie name rỗng");
            return streams;
        }


        // ============================================================
        // 1. NORMALIZE
        // ============================================================

        const normalizeName = text => {

            return String(text || "")
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/đ/g, "d")
                .replace(/[\/|]+/g, " ")
                .replace(/[\(\)\[\]\{\}:;,!?'"“”‘’]/g, " ")
                .replace(/[-–—]+/g, " ")
                .replace(/[^a-z0-9\s]/g, " ")
                .replace(/\s+/g, " ")
                .trim();

        };


        // ============================================================
        // 2. TẠO DANH SÁCH TÊN ĐỂ TÌM
        //
        // Ví dụ:
        //
        // Đội nhảy xuất sắc nhất / Đội Nhảy Số Một
        //
        // =>
        //
        // Đội nhảy xuất sắc nhất / Đội Nhảy Số Một
        // Đội nhảy xuất sắc nhất
        // Đội Nhảy Số Một
        // ============================================================

        const searchNames = [];

        const addSearchName = value => {

            const clean =
                String(value || "").trim();

            if (!clean) return;

            const normalized =
                normalizeName(clean);

            if (!normalized) return;

            const exists =
                searchNames.some(
                    x =>
                        normalizeName(x) ===
                        normalized
                );

            if (!exists) {
                searchNames.push(clean);
            }

        };


        addSearchName(movieName);


        String(movieName)
            .split(/\s*[\/|]\s*/)
            .forEach(
                x => addSearchName(x)
            );


        String(movieName)
            .split(/\s+[-–—]\s+/)
            .forEach(
                x => addSearchName(x)
            );


        // ============================================================
        // 3. THỬ SEARCH API VSMOV
        // ============================================================

        const candidates = [];


        for (
            const searchName
            of searchNames
        ) {

            try {

                const searchUrl =
                    "https://vsmov.com/api/tim-kiem?keyword=" +
                    encodeURIComponent(searchName) +
                    "&page=1&limit=24";


                console.log(
                    "[VSMOV] API SEARCH:",
                    searchName
                );

                console.log(
                    "[VSMOV] URL:",
                    searchUrl
                );


                const response =
                    await axios.get(
                        searchUrl,
                        {
                            timeout: 8000,

                            headers: {
                                "User-Agent":
                                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

                                "Accept":
                                    "application/json,text/plain,*/*",

                                "Accept-Language":
                                    "vi,en-US;q=0.9,en;q=0.8",

                                "Referer":
                                    "https://vsmov.com/"
                            }
                        }
                    );


                const data =
                    response.data || {};


                // VSMov có thể trả items ở các dạng
                // khác nhau tùy phiên bản API.

                let items = [];


                if (
                    Array.isArray(data?.items)
                ) {

                    items =
                        data.items;

                } else if (
                    Array.isArray(
                        data?.data?.items
                    )
                ) {

                    items =
                        data.data.items;

                } else if (
                    Array.isArray(
                        data?.data
                    )
                ) {

                    items =
                        data.data;

                } else if (
                    Array.isArray(
                        data?.results
                    )
                ) {

                    items =
                        data.results;

                }


                console.log(
                    "[VSMOV] RESULT:",
                    searchName,
                    "=>",
                    items.length
                );


                for (
                    const item
                    of items
                ) {

                    if (
                        !item ||
                        !item.slug
                    ) {
                        continue;
                    }


                    candidates.push({

                        item,
                        searchedAs:
                            searchName

                    });

                }


            } catch (e) {

                console.log(
                    "[VSMOV] API SEARCH ERROR:",
                    searchName,
                    e?.response?.status ||
                    e?.message ||
                    e
                );

            }

        }


        // ============================================================
        // 4. LOẠI DUPLICATE
        // ============================================================

        const uniqueCandidates = [];

        const candidateSlugs =
            new Set();


        for (
            const candidate
            of candidates
        ) {

            const slug =
                String(
                    candidate.item?.slug ||
                    ""
                );


            if (!slug) continue;


            if (
                candidateSlugs.has(slug)
            ) {
                continue;
            }


            candidateSlugs.add(slug);

            uniqueCandidates.push(
                candidate
            );

        }


        console.log(
            "[VSMOV] Unique candidates:",
            uniqueCandidates.length
        );


        // ============================================================
        // 5. CHẤM ĐIỂM
        // ============================================================

        const target =
            normalizeName(movieName);


        const variants =
            searchNames.map(
                x => normalizeName(x)
            );


        const scoreCandidate =
            candidate => {

                const item =
                    candidate.item || {};


                const name =
                    normalizeName(
                        item.name
                    );


                const originName =
                    normalizeName(
                        item.origin_name
                    );


                let score = 0;


                // Tên đầy đủ
                if (
                    name === target
                ) {
                    score += 1000;
                }


                if (
                    originName === target
                ) {
                    score += 950;
                }


                // Tên sau khi tách "/"
                if (
                    variants.includes(name)
                ) {
                    score += 900;
                }


                if (
                    variants.includes(originName)
                ) {
                    score += 850;
                }


                // Một bên chứa bên kia
                if (
                    name &&
                    target.includes(name)
                ) {
                    score += 700;
                }


                if (
                    originName &&
                    target.includes(originName)
                ) {
                    score += 650;
                }


                if (
                    name &&
                    name.includes(target)
                ) {
                    score += 600;
                }


                if (
                    originName &&
                    originName.includes(target)
                ) {
                    score += 550;
                }


                // So sánh từng variant
                for (
                    const variant
                    of variants
                ) {

                    if (!variant) continue;


                    if (
                        name === variant
                    ) {
                        score += 500;
                    }


                    if (
                        originName === variant
                    ) {
                        score += 450;
                    }


                    if (
                        name &&
                        name.includes(variant)
                    ) {
                        score += 300;
                    }


                    if (
                        originName &&
                        originName.includes(variant)
                    ) {
                        score += 250;
                    }

                }


                return score;

            };


        const ranked =
            uniqueCandidates
                .map(
                    candidate => ({
                        ...candidate,

                        score:
                            scoreCandidate(
                                candidate
                            )

                    })
                )
                .sort(
                    (a, b) =>
                        b.score -
                        a.score
                );


        console.log(
            "[VSMOV] RANKED:",
            ranked
                .slice(0, 10)
                .map(
                    x => ({
                        name:
                            x.item?.name,

                        origin:
                            x.item?.origin_name,

                        slug:
                            x.item?.slug,

                        score:
                            x.score

                    })
                )
        );


        // ============================================================
        // 6. NẾU API KHÔNG TÌM THẤY
        //
        // KHÔNG RETURN [] NGAY NỮA.
        //
        // Tạo fallback search để người dùng vẫn có thể
        // mở VSMov.
        // ============================================================

        if (
            !ranked.length
        ) {

            console.log(
                "[VSMOV] API không tìm thấy kết quả."
            );


            const fallbackKeyword =
                searchNames.length > 1
                    ? searchNames[searchNames.length - 1]
                    : movieName;


            const fallbackSearchUrl =
                "https://vsmov.com/?search=" +
                encodeURIComponent(
                    fallbackKeyword
                );


            streams.push({

                name:
                    "🌐 [Fallback] VSmov",

                title:
                    "Tìm trên VSmov - " +
                    fallbackKeyword,

                externalUrl:
                    fallbackSearchUrl

            });


            console.log(
                "[VSMOV] Fallback search:",
                fallbackSearchUrl
            );


            return streams;

        }


        // ============================================================
// 7. CHỌN PHIM TỐT NHẤT
// ============================================================

const selected =
    ranked[0];

const movie =
    selected?.item || {};

const foundName =
    String(
        movie?.name ||
        movie?.origin_name ||
        movieName
    ).trim();

const movieSlug =
    String(
        movie?.slug ||
        ""
    ).trim();

console.log(
    "[VSMOV] SELECTED NAME:",
    foundName
);

console.log(
    "[VSMOV] SELECTED ORIGIN:",
    movie?.origin_name || ""
);

console.log(
    "[VSMOV] SELECTED SLUG:",
    movieSlug
);

console.log(
    "[VSMOV] SELECTED SCORE:",
    selected?.score
);


// ============================================================
// 8. NẾU CÓ SLUG → ĐI THẲNG TRANG PHIM
// ============================================================

if (movieSlug) {

    const movieUrl =
        "https://vsmov.com/phim/" +
        encodeURIComponent(
            movieSlug
        );

    console.log(
        "[VSMOV] EXACT MOVIE PAGE:",
        movieUrl
    );


    // ----------------------------------------------------------
    // FALLBACK EXACT PAGE
    // ----------------------------------------------------------

    const fallbackStream = {

        name:
            "🌐 [Fallback] VSmov",

        title:
            "Mở VSmov - " +
            foundName,

        externalUrl:
            movieUrl

    };


    // ----------------------------------------------------------
    // LẤY HTML TRANG PHIM
    // ----------------------------------------------------------

    let html = "";

    try {

        const movieResponse =
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


        html =
            String(
                movieResponse.data || ""
            );


        console.log(
            "[VSMOV] Movie HTML length:",
            html.length
        );


    } catch (e) {

        console.log(
            "[VSMOV] Movie page ERROR:",
            e?.response?.status ||
            e?.message ||
            e
        );

    }


    // ----------------------------------------------------------
    // TÌM VIDEO HASH
    // ----------------------------------------------------------

    let videoHash = "";

    const hashPatterns = [

        /data-hash=["']([^"']+)["']/i,

        /videoHash\s*[:=]\s*["']([^"']+)["']/i,

        /video_hash\s*[:=]\s*["']([^"']+)["']/i,

        /\/video\/([a-f0-9-]{20,})/i,

        /\/stream\/([a-f0-9-]{20,})\/master\.m3u8/i

    ];


    for (
        const pattern
        of hashPatterns
    ) {

        const match =
            html.match(pattern);


        if (
            match &&
            match[1]
        ) {

            videoHash =
                match[1];

            break;

        }

    }


    // ----------------------------------------------------------
    // CÓ M3U8
    // ----------------------------------------------------------

    if (videoHash) {

        console.log(
            "[VSMOV] VIDEO HASH:",
            videoHash
        );


        const streamUrl =
            "https://v8.streamvsmov.com/stream/" +
            videoHash +
            "/master.m3u8";


        streams.push({

            name:
                "🌟 [Scrape] VSmov",

            title:
                "Luồng phát VSmov - " +
                foundName,

            url:
                streamUrl,

            behaviorHints: {

                httpReferrer:
                    movieUrl,

                bingeGroup:
                    "vsmov"

            }

        });


        console.log(
            "[VSMOV] M3U8:",
            streamUrl
        );

    } else {

        console.log(
            "[VSMOV] Không lấy được M3U8"
        );

    }


    // ----------------------------------------------------------
    // LUÔN CÓ EXACT PAGE
    // ----------------------------------------------------------

    streams.push(
        fallbackStream
    );


    console.log(
        "[VSMOV] FINAL:",
        streams.length,
        "streams"
    );


    return streams;
}


// ============================================================
// 9. CHỈ KHI KHÔNG CÓ SLUG MỚI DÙNG SEARCH FALLBACK
// ============================================================

console.log(
    "[VSMOV] Có candidate nhưng không có slug"
);


const fallbackKeyword =
    searchNames.length > 1
        ? searchNames[searchNames.length - 1]
        : movieName;


const fallbackSearchUrl =
    "https://vsmov.com/?search=" +
    encodeURIComponent(
        fallbackKeyword
    );


streams.push({

    name:
        "🔎 [Fallback Search] VSmov",

    title:
        "Tìm trên VSmov - " +
        fallbackKeyword,

    externalUrl:
        fallbackSearchUrl

});


return streams;


        // ============================================================
        // 10. LẤY HTML TRANG PHIM
        // ============================================================

        let html = "";


        try {

            const movieResponse =
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


            html =
                String(
                    movieResponse.data || ""
                );


            console.log(
                "[VSMOV] HTML length:",
                html.length
            );


        } catch (e) {

            console.log(
                "[VSMOV] Movie page ERROR:",
                e?.response?.status ||
                e?.message ||
                e
            );

        }


        // ============================================================
        // 11. TÌM VIDEO HASH
        // ============================================================

        let videoHash = "";


        const hashPatterns = [

            /data-hash=["']([^"']+)["']/i,

            /videoHash\s*[:=]\s*["']([^"']+)["']/i,

            /video_hash\s*[:=]\s*["']([^"']+)["']/i,

            /\/video\/([a-f0-9-]{20,})/i,

            /\/stream\/([a-f0-9-]{20,})\/master\.m3u8/i

        ];


        for (
            const pattern
            of hashPatterns
        ) {

            const match =
                html.match(pattern);


            if (
                match &&
                match[1]
            ) {

                videoHash =
                    match[1];

                break;

            }

        }


        // ============================================================
        // 12. CÓ M3U8
        // ============================================================

        if (
            videoHash
        ) {

            console.log(
                "[VSMOV] VIDEO HASH:",
                videoHash
            );


            const streamUrl =
                "https://v8.streamvsmov.com/stream/" +
                videoHash +
                "/master.m3u8";


            streams.push({

                name:
                    "🌟 [Scrape] VSmov",

                title:
                    "Luồng phát VSmov - " +
                    foundName,

                url:
                    streamUrl,

                behaviorHints: {

                    httpReferrer:
                        movieUrl,

                    bingeGroup:
                        "vsmov"

                }

            });


            console.log(
                "[VSMOV] M3U8:",
                streamUrl
            );

        } else {

            console.log(
                "[VSMOV] Không tìm thấy video hash"
            );

        }


        // ============================================================
        // 13. LUÔN THÊM EXACT PAGE FALLBACK
        // ============================================================

        streams.push(
            fallbackStream
        );


        console.log(
            "[VSMOV] FINAL STREAMS:",
            streams.length
        );


    } catch (e) {

        console.log(
            "========================================"
        );

        console.log(
            "[VSMOV FATAL ERROR]"
        );

        console.log(
            "Message:",
            e?.message ||
            e
        );

        console.log(
            "Status:",
            e?.response?.status ||
            "N/A"
        );

        console.log(
            "========================================"
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
