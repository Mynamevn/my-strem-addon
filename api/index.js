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
/* ============================================================
   TITLE VARIANTS
   Tách các tên phim ghép bằng "/", "|", " - "
   để từng nguồn có thể tìm tên phù hợp.
   ============================================================ */

function buildTitleVariants(movieName) {

    const original =
        String(movieName || "").trim();

    if (!original) {
        return [];
    }

    const variants = [];

    function add(value) {

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

        if (!variants.some(
            x =>
                x.key === key
        )) {
            variants.push({
                text: clean,
                key
            });
        }
    }

    // Tên đầy đủ
    add(original);

    // Tách theo "/"
    original
        .split("/")
        .forEach(add);

    // Tách theo "|"
    original
        .split("|")
        .forEach(add);

    // Nếu có dạng "Tên A - Tên B"
    // chỉ thêm phần bên phải nếu đủ dài.
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
        x => x.text
    );
}

async function fetchNguonC(movieName) {

    const streams = [];

    console.log("========================================");
    console.log("[NGUONC] START");
    console.log("[NGUONC] Movie:", movieName);

    const variants =
        buildTitleVariants(movieName);

    console.log(
        "[NGUONC] Title variants:",
        variants
    );

    // ========================================================
    // HELPER: tìm M3U8 trong HTML / JSON
    // ========================================================

    function collectM3U8(
        value,
        found = []
    ) {

        if (!value) {
            return found;
        }

        if (
            typeof value === "string"
        ) {

            const matches =
                value.match(
                    /https?:\/\/[^"'\\\s<>]+\.m3u8(?:\?[^"'\\\s<>]*)?/gi
                ) || [];

            matches.forEach(
                url => {

                    if (
                        !found.includes(url)
                    ) {
                        found.push(url);
                    }

                }
            );

            return found;
        }

        if (
            Array.isArray(value)
        ) {

            value.forEach(
                item =>
                    collectM3U8(
                        item,
                        found
                    )
            );

            return found;
        }

        if (
            typeof value === "object"
        ) {

            Object.entries(
                value
            ).forEach(
                ([key, val]) => {

                    const lowerKey =
                        String(key)
                            .toLowerCase();

                    if (
                        lowerKey.includes("m3u8") ||
                        lowerKey === "url" ||
                        lowerKey === "link"
                    ) {

                        collectM3U8(
                            val,
                            found
                        );

                    } else if (
                        typeof val === "object"
                    ) {

                        collectM3U8(
                            val,
                            found
                        );

                    }

                }
            );

        }

        return found;
    }

    // ========================================================
    // 1. API SEARCH
    //
    // API có thể bị Cloudflare 403.
    // Vì vậy API chỉ là bước thử.
    // ========================================================

    const candidates = [];

    for (
        const variant of variants
    ) {

        try {

            console.log(
                "[NGUONC] API SEARCH:",
                variant
            );

            const searchUrl =
                "https://phim.nguonc.com/api/films/search?keyword=" +
                encodeURIComponent(
                    variant
                );

            console.log(
                "[NGUONC] Search URL:",
                searchUrl
            );

            const res =
                await axios.get(
                    searchUrl,
                    {
                        headers: {
                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 6.3; Win64; x64)",
                            "Accept":
                                "application/json",
                            "Referer":
                                "https://phim.nguonc.com/"
                        },
                        timeout: 7000
                    }
                );

            const data =
                res.data || {};

            const items =
                data?.items ||
                data?.data?.items ||
                data?.films ||
                data?.data?.films ||
                [];

            console.log(
                "[NGUONC] API RESULT:",
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

                        if (!item) {
                            return;
                        }

                        const slug =
                            item.slug ||
                            item.url_slug;

                        if (
                            !slug
                        ) {
                            return;
                        }

                        if (
                            !candidates.some(
                                x =>
                                    x.slug === slug
                            )
                        ) {

                            candidates.push({
                                ...item,
                                slug,
                                searchedWith:
                                    variant
                            });

                        }

                    }
                );

            }

        } catch (e) {

            console.log(
                "[NGUONC API ERROR]",
                variant,
                e?.response?.status ||
                e?.message ||
                e
            );

        }

    }

    console.log(
        "[NGUONC] API candidates:",
        candidates.length
    );

    // ========================================================
    // 2. TẠO SLUG CANDIDATES
    //
    // Đây là phần QUAN TRỌNG nhất.
    //
    // Với:
    //
    // Đội nhảy xuất sắc nhất /
    // Đội nhảy số một
    //
    // sẽ tạo:
    //
    // doi-nhay-xuat-sac-nhat
    // doi-nhay-so-mot
    //
    // thay vì ghép thành một slug dài.
    // ========================================================

    const slugCandidates = [];

    // Slug API tìm được → ưu tiên
    candidates.forEach(
        candidate => {

            if (
                candidate.slug &&
                !slugCandidates.includes(
                    candidate.slug
                )
            ) {

                slugCandidates.push(
                    candidate.slug
                );

            }

        }
    );

    // Slug từ từng title variant
    variants.forEach(
        variant => {

            const slug =
                toSlug(variant);

            if (
                slug &&
                !slugCandidates.includes(
                    slug
                )
            ) {

                slugCandidates.push(
                    slug
                );

            }

        }
    );

    console.log(
        "[NGUONC] Slug candidates:",
        slugCandidates
    );

    // ========================================================
    // 3. DIRECT MOVIE PAGE
    //
    // API 403 cũng không sao.
    // Thử thẳng:
    //
    // https://phim.nguonc.com/phim/doi-nhay-xuat-sac-nhat
    // ========================================================

    for (
        const slug of slugCandidates
    ) {

        const movieUrl =
            "https://phim.nguonc.com/phim/" +
            encodeURIComponent(
                slug
            );

        try {

            console.log(
                "[NGUONC] DIRECT PAGE:",
                movieUrl
            );

            const movieRes =
                await axios.get(
                    movieUrl,
                    {
                        headers: {
                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 6.3; Win64; x64)",
                            "Accept":
                                "text/html,application/xhtml+xml"
                        },
                        timeout: 8000
                    }
                );

            const html =
                String(
                    movieRes.data ||
                    ""
                );

            console.log(
                "[NGUONC] PAGE STATUS:",
                movieRes.status,
                "HTML:",
                html.length
            );

            if (
                movieRes.status !== 200 ||
                html.length < 1000
            ) {

                continue;

            }

            const parseMovie =
                cheerio.load(
                    html
                );

            const pageTitle =
                parseMovie(
                    "title"
                )
                .first()
                .text()
                .trim();

            console.log(
                "[NGUONC] PAGE TITLE:",
                pageTitle
            );

            // =================================================
            // Kiểm tra đây có thực sự là trang phim hay không
            // =================================================

            const normalizedHtml =
                html
                    .normalize("NFD")
                    .replace(
                        /[\u0300-\u036f]/g,
                        ""
                    )
                    .toLowerCase();

            const normalizedSlug =
                String(slug)
                    .toLowerCase();

            const looksLikeMoviePage =
                normalizedHtml.includes(
                    normalizedSlug
                ) ||
                pageTitle.length > 0;

            if (
                !looksLikeMoviePage
            ) {

                console.log(
                    "[NGUONC] Không giống trang phim:",
                    movieUrl
                );

                continue;

            }

            // =================================================
            // Tìm M3U8
            // =================================================

            const htmlM3U8 =
                html.match(
                    /https?:\/\/[^"'\\\s<>]+\.m3u8(?:\?[^"'\\\s<>]*)?/gi
                ) || [];

            const scripts =
                parseMovie(
                    "script"
                ).text();

            const scriptM3U8 =
                scripts.match(
                    /https?:\/\/[^"'\\\s<>]+\.m3u8(?:\?[^"'\\\s<>]*)?/gi
                ) || [];

            const allM3U8 = [
                ...htmlM3U8,
                ...scriptM3U8
            ].filter(
                (url, index, arr) =>
                    arr.indexOf(url) ===
                    index
            );

            console.log(
                "[NGUONC] M3U8:",
                allM3U8.length
            );

            // =================================================
            // Nếu có M3U8 → stream trực tiếp
            // =================================================

            allM3U8.forEach(
                (url, index) => {

                    streams.push({

                        name:
                            "⚡ [Scrape] NguonC",

                        title:
                            "NguonC - " +
                            slug +
                            " - Stream " +
                            (
                                index + 1
                            ),

                        url:
                            String(url)

                    });

                }
            );

            // =================================================
            // QUAN TRỌNG:
            // Dù chưa lấy được M3U8,
            // vẫn trả exact externalUrl.
            // =================================================

            if (
                streams.length === 0
            ) {

                streams.push({

                    name:
                        "🌐 [NguonC] " +
                        slug,

                    title:
                        "Mở đúng trang phim NguonC",

                    externalUrl:
                        movieUrl

                });

            }

            console.log(
                "[NGUONC] SUCCESS:",
                movieUrl
            );

            // Dừng ngay tại slug hợp lệ đầu tiên.
            break;

        } catch (e) {

            console.log(
                "[NGUONC PAGE ERROR]",
                slug,
                e?.response?.status ||
                e?.message ||
                e
            );

        }

    }

    // ========================================================
    // 4. FINAL FALLBACK
    //
    // Nếu tất cả direct page đều thất bại,
    // tạo URL tìm kiếm bằng title variant.
    // ========================================================

    if (
        streams.length === 0
    ) {

        const fallbackTitle =
            variants[0] ||
            movieName;

        const fallbackUrl =
            "https://phim.nguonc.com/tim-kiem?keyword=" +
            encodeURIComponent(
                fallbackTitle
            );

        console.log(
            "[NGUONC] FINAL FALLBACK:",
            fallbackUrl
        );

        streams.push({

            name:
                "🌐 [Fallback] NguonC",

            title:
                "Tìm phim trên NguonC - " +
                fallbackTitle,

            externalUrl:
                fallbackUrl

        });

    }

    // ========================================================
    // FINAL
    // ========================================================

    console.log(
        "[NGUONC] FINAL STREAMS:",
        streams.length
    );

    console.log(
        "[NGUONC] STREAM TYPES:",
        streams.map(
            stream => ({
                name:
                    stream.name,
                hasUrl:
                    Boolean(
                        stream.url
                    ),
                hasExternalUrl:
                    Boolean(
                        stream.externalUrl
                    )
            })
        )
    );

    console.log(
        "========================================"
    );

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
    const scrapeSlugs = [];

    console.log("========================================");
    console.log("[VSMOV] START");
    console.log("[VSMOV] Original title:", movieName);

    // ========================================================
    // TITLE VARIANTS
    // ========================================================

    const variants =
        typeof buildTitleVariants === "function"
            ? buildTitleVariants(movieName)
            : [String(movieName || "").trim()];

    console.log(
        "[VSMOV] Title variants:",
        variants
    );

    // ========================================================
    // HELPER: NORMALIZE TITLE
    // ========================================================

    function normalizeTitle(value) {

        return String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();

    }

    const originalNormalized =
        normalizeTitle(movieName);

    const variantNormalized =
        variants.map(
            normalizeTitle
        );

    // ========================================================
    // HELPER: TÌM M3U8 ĐỆ QUY
    // ========================================================

    function collectM3U8(
        value,
        found = []
    ) {

        if (!value) {
            return found;
        }

        // ----------------------------------------------------
        // STRING
        // ----------------------------------------------------

        if (
            typeof value === "string"
        ) {

            const matches =
                value.match(
                    /https?:\/\/[^"'\\\s<>]+\.m3u8(?:\?[^"'\\\s<>]*)?/gi
                ) || [];

            matches.forEach(
                url => {

                    if (
                        !found.includes(url)
                    ) {

                        found.push(url);

                    }

                }
            );

            return found;
        }

        // ----------------------------------------------------
        // ARRAY
        // ----------------------------------------------------

        if (
            Array.isArray(value)
        ) {

            value.forEach(
                item =>
                    collectM3U8(
                        item,
                        found
                    )
            );

            return found;
        }

        // ----------------------------------------------------
        // OBJECT
        // ----------------------------------------------------

        if (
            typeof value === "object"
        ) {

            Object.entries(
                value
            ).forEach(
                ([key, val]) => {

                    const lowerKey =
                        String(key)
                            .toLowerCase();

                    // Chỉ lấy các field có khả năng
                    // chứa stream trực tiếp.
                    if (
                        lowerKey === "link_m3u8" ||
                        lowerKey === "m3u8_url" ||
                        lowerKey === "m3u8" ||
                        lowerKey === "url" ||
                        lowerKey === "link"
                    ) {

                        collectM3U8(
                            val,
                            found
                        );

                    } else if (
                        typeof val === "object"
                    ) {

                        collectM3U8(
                            val,
                            found
                        );

                    }

                }
            );

        }

        return found;
    }

    // ========================================================
    // 1. API SEARCH
    // ========================================================

    const candidates = [];

    for (
        const variant of variants
    ) {

        if (!variant) continue;

        try {

            console.log(
                "[VSMOV] API SEARCH:",
                variant
            );

            const searchUrl =
                "https://vsmov.com/api/tim-kiem?keyword=" +
                encodeURIComponent(
                    variant
                ) +
                "&page=1&limit=24";

            console.log(
                "[VSMOV] URL:",
                searchUrl
            );

            const res =
                await axios.get(
                    searchUrl,
                    {
                        headers: {
                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 6.3; Win64; x64)",
                            "Accept":
                                "application/json"
                        },
                        timeout: 7000
                    }
                );

            const data =
                res.data || {};

            const items =
                data?.data?.items ||
                data?.items ||
                [];

            console.log(
                "[VSMOV] RESULT:",
                variant,
                "=>",
                items.length
            );

            if (
                Array.isArray(items)
            ) {

                items.forEach(
                    item => {

                        if (
                            !item ||
                            !item.slug
                        ) {
                            return;
                        }

                        const exists =
                            candidates.some(
                                x =>
                                    x.slug ===
                                    item.slug
                            );

                        if (!exists) {

                            candidates.push({
                                ...item,
                                searchedWith:
                                    variant
                            });

                        }

                    }
                );

            }

        } catch (e) {

            console.log(
                "[VSMOV API ERROR]",
                variant,
                e?.response?.status ||
                e?.message ||
                e
            );

        }

    }

    console.log(
        "[VSMOV] Unique candidates:",
        candidates.length
    );

    // ========================================================
    // 2. RANK CANDIDATES
    // ========================================================

    candidates.sort(
        (a, b) => {

            const aName =
                normalizeTitle(
                    a.name
                );

            const bName =
                normalizeTitle(
                    b.name
                );

            let aScore = 0;
            let bScore = 0;

            // Tên trùng hoàn toàn với tên gốc
            if (
                aName ===
                originalNormalized
            ) {

                aScore += 100;

            }

            if (
                bName ===
                originalNormalized
            ) {

                bScore += 100;

            }

            // Tên trùng một trong các variant
            if (
                variantNormalized.includes(
                    aName
                )
            ) {

                aScore += 50;

            }

            if (
                variantNormalized.includes(
                    bName
                )
            ) {

                bScore += 50;

            }

            // Có slug
            if (a.slug) {
                aScore += 5;
            }

            if (b.slug) {
                bScore += 5;
            }

            return bScore - aScore;

        }
    );

    console.log(
        "[VSMOV] RANKED:",
        candidates.map(
            x => ({
                name: x.name,
                slug: x.slug
            })
        )
    );

    // ========================================================
    // 3. TẠO DANH SÁCH SLUG ĐỂ SCRAPE
    // ========================================================

    candidates.forEach(
        candidate => {

            if (
                candidate.slug &&
                !scrapeSlugs.includes(
                    candidate.slug
                )
            ) {

                scrapeSlugs.push(
                    candidate.slug
                );

            }

        }
    );

    variants.forEach(
        variant => {

            const slug =
                toSlug(variant);

            if (
                slug &&
                !scrapeSlugs.includes(
                    slug
                )
            ) {

                scrapeSlugs.push(
                    slug
                );

            }

        }
    );

    console.log(
        "[VSMOV] Scrape slugs:",
        scrapeSlugs
    );

    // ========================================================
    // 4. API DETAIL
    //
    // KHÔNG lấy link_embed.
    // CHỈ lấy M3U8.
    // ========================================================

    for (
        const candidate of candidates
    ) {

        const slug =
            candidate.slug;

        if (!slug) continue;

        const exactPageUrl =
            "https://vsmov.com/phim/" +
            encodeURIComponent(
                slug
            );

        console.log(
            "[VSMOV] Exact page:",
            exactPageUrl
        );

        try {

            const detailUrl =
                "https://vsmov.com/api/phim/" +
                encodeURIComponent(
                    slug
                );

            console.log(
                "[VSMOV] DETAIL API:",
                detailUrl
            );

            const detailRes =
                await axios.get(
                    detailUrl,
                    {
                        headers: {
                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 6.3; Win64; x64)",
                            "Accept":
                                "application/json"
                        },
                        timeout: 7000
                    }
                );

            const detailData =
                detailRes.data;

            const m3u8Links =
                collectM3U8(
                    detailData
                );

            console.log(
                "[VSMOV] DETAIL M3U8:",
                m3u8Links.length
            );

            m3u8Links.forEach(
                (url, index) => {

                    streams.push({

                        name:
                            "⚡ [API] VSmov",

                        title:
                            "VSmov - " +
                            (
                                candidate.name ||
                                movieName
                            ) +
                            " - Stream " +
                            (
                                index + 1
                            ),

                        url:
                            String(url)

                    });

                }
            );

            if (
                m3u8Links.length > 0
            ) {

                console.log(
                    "[VSMOV] API M3U8 SUCCESS"
                );

                break;

            }

        } catch (e) {

            console.log(
                "[VSMOV DETAIL ERROR]",
                slug,
                e?.response?.status ||
                e?.message ||
                e
            );

        }

    }

    // ========================================================
    // 5. SCRAPE FALLBACK
    //
    // Nếu API detail không có M3U8,
    // quay về scrape trang phim.
    // ========================================================

    if (
        streams.length === 0
    ) {

        console.log(
            "[VSMOV] API không có M3U8."
        );

        console.log(
            "[VSMOV] Chuyển sang SCRAPE."
        );

        for (
            const slug of scrapeSlugs
        ) {

            if (!slug) continue;

            const movieUrl =
                "https://vsmov.com/phim/" +
                encodeURIComponent(
                    slug
                );

            try {

                console.log(
                    "[VSMOV] SCRAPE URL:",
                    movieUrl
                );

                const movieRes =
                    await axios.get(
                        movieUrl,
                        {
                            headers: {
                                "User-Agent":
                                    "Mozilla/5.0 (Windows NT 6.3; Win64; x64)",
                                "Accept":
                                    "text/html,application/xhtml+xml"
                            },
                            timeout: 7000
                        }
                    );

                const html =
                    String(
                        movieRes.data ||
                        ""
                    );

                console.log(
                    "[VSMOV] SCRAPE STATUS:",
                    movieRes.status,
                    "HTML:",
                    html.length
                );

                if (
                    movieRes.status !== 200 ||
                    html.length < 1000
                ) {

                    continue;

                }

                // ------------------------------------------------
                // Tìm M3U8 trực tiếp trong HTML
                // ------------------------------------------------

                const htmlM3U8 =
                    html.match(
                        /https?:\/\/[^"'\\\s<>]+\.m3u8(?:\?[^"'\\\s<>]*)?/gi
                    ) || [];

                // ------------------------------------------------
                // Tìm M3U8 trong script
                // ------------------------------------------------

                const parseMovie =
                    cheerio.load(
                        html
                    );

                const scripts =
                    parseMovie(
                        "script"
                    ).text();

                const scriptM3U8 =
                    scripts.match(
                        /https?:\/\/[^"'\\\s<>]+\.m3u8(?:\?[^"'\\\s<>]*)?/gi
                    ) || [];

                // ------------------------------------------------
                // Gộp + loại trùng
                // ------------------------------------------------

                const allM3U8 = [
                    ...htmlM3U8,
                    ...scriptM3U8
                ].filter(
                    (url, index, arr) =>
                        arr.indexOf(url) ===
                        index
                );

                console.log(
                    "[VSMOV] SCRAPE M3U8:",
                    allM3U8.length
                );

                allM3U8.forEach(
                    (url, index) => {

                        streams.push({

                            name:
                                "🔊 [Scrape] VSmov",

                            title:
                                "Luong phat VSmov - " +
                                (
                                    index + 1
                                ),

                            url:
                                String(url)

                        });

                    }
                );

                if (
                    allM3U8.length > 0
                ) {

                    console.log(
                        "[VSMOV] SCRAPE SUCCESS:",
                        allM3U8.length
                    );

                    break;

                }

            } catch (e) {

                console.log(
                    "[VSMOV SCRAPE ERROR]",
                    slug,
                    e?.response?.status ||
                    e?.message ||
                    e
                );

            }

        }

    }

    // ========================================================
    // 6. FALLBACK CUỐI
    //
    // Không dùng link_embed.
    // Chỉ mở trang phim chính xác.
    // ========================================================

    if (
        streams.length === 0
    ) {

        let fallbackSlug =
            candidates[0]?.slug ||
            scrapeSlugs[0] ||
            toSlug(
                variants[0] ||
                movieName
            );

        if (fallbackSlug) {

            const fallbackUrl =
                "https://vsmov.com/phim/" +
                encodeURIComponent(
                    fallbackSlug
                );

            console.log(
                "[VSMOV] FINAL FALLBACK:",
                fallbackUrl
            );

            streams.push({

                name:
                    "🌐 [Fallback] VSmov",

                title:
                    "Mở trang phim VSmov - " +
                    movieName,

                externalUrl:
                    fallbackUrl

            });

        }

    }

    // ========================================================
    // FINAL
    // ========================================================

    console.log(
        "[VSMOV] FINAL STREAMS:",
        streams.length
    );

    console.log(
        "[VSMOV] STREAM TYPES:",
        streams.map(
            stream => ({
                name: stream.name,
                hasUrl: Boolean(
                    stream.url
                ),
                hasExternalUrl:
                    Boolean(
                        stream.externalUrl
                    )
            })
        )
    );

    console.log(
        "========================================"
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
