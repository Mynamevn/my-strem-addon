const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

const crypto = require('crypto');
const http2 = require('http2');
const express = require('express');

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
   FETCH NGUONC
   ============================================================ */

async function fetchNguonC(
    movieName
) {

    const streams = [];

    const headers = {

        "User-Agent":
            NGUONC_UA,

        "Accept":
            "application/json, text/plain, */*",

        "Referer":
            "https://nguonc.com/",

        "Origin":
            "https://nguonc.com"

    };

    /* --------------------------------------------------------
       NORMALIZE TITLE
       -------------------------------------------------------- */

    function normalizeTitle(
        value
    ) {

        return String(
            value || ""
        )
            .normalize("NFD")
            .replace(
                /[\u0300-\u036f]/g,
                ""
            )
            .toLowerCase()
            .replace(
                /[^a-z0-9]+/g,
                " "
            )
            .replace(
                /\s+/g,
                " "
            )
            .trim();

    }

    /* --------------------------------------------------------
       TITLE VARIANTS
       -------------------------------------------------------- */

    const variants = [];

    function addVariant(
        value
    ) {

        value =
            String(
                value || ""
            ).trim();

        if (!value) {
            return;
        }

        const normalized =
            normalizeTitle(
                value
            );

        if (
            !variants.some(
                x =>
                    normalizeTitle(
                        x
                    ) === normalized
            )
        ) {

            variants.push(
                value
            );

        }

    }

    addVariant(
        movieName
    );

    String(movieName)
        .split("/")
        .forEach(
            addVariant
        );

    String(movieName)
        .split("|")
        .forEach(
            addVariant
        );

    String(movieName)
        .split(/\s+-\s+/)
        .forEach(
            addVariant
        );

    /* --------------------------------------------------------
       SEARCH NGUONC
       -------------------------------------------------------- */

    let searchItems = [];

    for (
        const keyword
        of variants
    ) {

        try {

            const searchUrl =
                NGUONC_API +
                "/api/films/search?keyword=" +
                encodeURIComponent(
                    keyword
                );

            console.log(
                "[NGUONC] Search URL:",
                searchUrl
            );

            const response =
                await axios.get(
                    searchUrl,
                    {
                        timeout:
                            15000,

                        headers,

                        validateStatus:
                            () => true
                    }
                );

            console.log(
                "[NGUONC] Search HTTP:",
                response.status
            );

            /*
             * Nếu Cloudflare / server trả 403
             * thì bỏ qua keyword này và thử variant tiếp theo.
             */

            if (
                response.status !== 200
            ) {

                console.log(
                    "[NGUONC] Search blocked/status:",
                    response.status
                );

                continue;
            }

            const data =
                response.data || {};

            const items =
                data?.items ||
                data?.data?.items ||
                data?.data ||
                [];

            if (
                Array.isArray(
                    items
                ) &&
                items.length
            ) {

                searchItems.push(
                    ...items
                );

            }

        } catch (e) {

            console.log(
                "[NGUONC] Search error:",
                e?.message ||
                e
            );

        }

    }

    /* --------------------------------------------------------
       REMOVE DUPLICATES
       -------------------------------------------------------- */

    searchItems =
        searchItems.filter(
            (item, index, arr) => {

                const slug =
                    String(
                        item?.slug ||
                        ""
                    );

                if (!slug) {
                    return false;
                }

                return (
                    index ===
                    arr.findIndex(
                        x =>
                            String(
                                x?.slug ||
                                ""
                            ) === slug
                    )
                );

            }
        );

    if (
        !searchItems.length
    ) {

        console.log(
            "[NGUONC] Không tìm thấy:",
            movieName
        );

        return [];

    }

    /* --------------------------------------------------------
       MATCH
       -------------------------------------------------------- */

    const wanted =
        normalizeTitle(
            movieName
        );

    function getScore(
        item
    ) {

        const names = [

            item?.name,

            item?.original_name,

            item?.origin_name,

            item?.title,

            item?.slug

        ]
            .filter(Boolean)
            .map(
                normalizeTitle
            );

        let score =
            0;

        for (
            const name
            of names
        ) {

            if (
                name === wanted
            ) {

                score =
                    Math.max(
                        score,
                        100
                    );

            } else if (
                name.includes(
                    wanted
                ) ||
                wanted.includes(
                    name
                )
            ) {

                score =
                    Math.max(
                        score,
                        80
                    );

            }

        }

        return score;

    }

    searchItems.sort(
        (a, b) =>
            getScore(b) -
            getScore(a)
    );

    const selected =
        searchItems.find(
            item =>
                item?.slug
        );

    if (
        !selected
    ) {

        console.log(
            "[NGUONC] Không có phim phù hợp:",
            movieName
        );

        return [];

    }

    const slug =
        String(
            selected.slug
        ).trim();

    console.log(
        "[NGUONC] Selected:",
        selected.name,
        "|",
        slug
    );

    /* --------------------------------------------------------
       DETAIL
       -------------------------------------------------------- */

    let detail;

    try {

        const url =
            NGUONC_API +
            "/api/film/" +
            encodeURIComponent(
                slug
            );

        console.log(
            "[NGUONC] Detail URL:",
            url
        );

        const response =
            await axios.get(
                url,
                {
                    timeout:
                        15000,

                    headers,

                    validateStatus:
                        () => true
                }
            );

        console.log(
            "[NGUONC] Detail HTTP:",
            response.status
        );

        if (
            response.status !== 200
        ) {

            console.log(
                "[NGUONC] Detail blocked/status:",
                response.status
            );

            return [];

        }

        detail =
            response.data;

    } catch (e) {

        console.log(
            "[NGUONC] Detail error:",
            e?.message ||
            e
        );

        return [];

    }

    const movie =
        detail?.movie ||
        detail?.data?.movie ||
        {};

    const episodes =
        movie?.episodes ||
        detail?.episodes ||
        detail?.data?.episodes ||
        [];

    if (
        !Array.isArray(
            episodes
        )
    ) {

        console.log(
            "[NGUONC] Episodes không hợp lệ"
        );

        return [];

    }

    console.log(
        "[NGUONC] Servers:",
        episodes.length
    );

    /* --------------------------------------------------------
       MOVIE REFERER
       -------------------------------------------------------- */

    const movieUrl =
        NGUONC_API +
        "/phim/" +
        slug;

    /* --------------------------------------------------------
       EPISODES
       -------------------------------------------------------- */

    for (
        const server
        of episodes
    ) {

        const serverName =
            server?.server_name ||
            server?.name ||
            "NguonC";

        const episodeList =
            server?.items ||
            server?.server_data ||
            server?.list ||
            [];

        if (
            !Array.isArray(
                episodeList
            )
        ) {

            continue;

        }

        for (
            const ep
            of episodeList
        ) {

            const episodeName =
                ep?.name ||
                ep?.slug ||
                "FULL";

            const embed =
                String(
                    ep?.embed ||
                    ep?.link_embed ||
                    ""
                ).trim();

            const directM3u8 =
                String(
                    ep?.link_m3u8 ||
                    ep?.m3u8 ||
                    ""
                ).trim();

            if (
                !embed &&
                !directM3u8
            ) {

                console.log(
                    "[NGUONC] Không có link:",
                    episodeName
                );

                continue;

            }

            /* ------------------------------------------------
               DIRECT M3U8
               ------------------------------------------------ */

            if (
                directM3u8
            ) {

                streams.push({

                    name:
                        "🌐 [NguonC] " +
                        serverName,

                    title:
                        episodeName +
                        " - NguonC",

                    url:
                        directM3u8,

                    behaviorHints: {

                        bingeGroup:
                            "nguonc-" +
                            slug

                    }

                });

                console.log(
                    "[NGUONC] DIRECT:",
                    episodeName,
                    directM3u8
                );

                continue;

            }

            /* ------------------------------------------------
               EMBED → STATELESS PLAYLIST TOKEN
               ------------------------------------------------ */

            try {

                const tokenPayload = {

                    embedUrl:
                        embed,

                    movieUrl:
                        movieUrl,

                    created:
                        Date.now()

                };

                const token =
                    Buffer
                        .from(
                            JSON.stringify(
                                tokenPayload
                            ),
                            "utf8"
                        )
                        .toString(
                            "base64url"
                        );

                const publicBase =
                    process.env.ADDON_PUBLIC_URL ||
                    "";

                if (
                    !publicBase
                ) {

                    throw new Error(
                        "Thiếu ADDON_PUBLIC_URL"
                    );

                }

                const streamUrl =
                    publicBase
                        .replace(
                            /\/+$/,
                            ""
                        ) +
                    "/nguonc/playlist/" +
                    token;

                streams.push({

                    name:
                        "🌐 [NguonC] " +
                        serverName,

                    title:
                        episodeName +
                        " - NguonC",

                    url:
                        streamUrl,

                    behaviorHints: {

                        bingeGroup:
                            "nguonc-" +
                            slug

                    }

                });

                console.log(
                    "[NGUONC] READY:",
                    episodeName,
                    streamUrl
                );

            } catch (e) {

                console.log(
                    "[NGUONC] Token error:",
                    episodeName,
                    e?.message ||
                    e
                );

                /*
                 * Không để một episode lỗi
                 * làm hỏng các episode còn lại.
                 */

                continue;

            }

        }

    }

    console.log(
        "[NGUONC] Streams:",
        streams.length
    );

    return streams;

}


/* ============================================================
   KKPHiM / PHIMAPI
   DEBUG DETAIL RESPONSE
   ============================================================ */

async function fetchKKPhim(movieName) {
    const streams = [];

    try {
        console.log("========================================");
        console.log("[KKPHIM] START");
        console.log("[KKPHIM] Search:", movieName);

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
                        "User-Agent": "Mozilla/5.0",
                        "Accept": "application/json"
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

        const normalizedSearch =
            String(movieName)
                .trim()
                .toLowerCase();

        const movie =
            items.find(item => {

                const name =
                    String(
                        item?.name || ""
                    )
                    .trim()
                    .toLowerCase();

                const origin =
                    String(
                        item?.origin_name || ""
                    )
                    .trim()
                    .toLowerCase();

                return (
                    name === normalizedSearch ||
                    origin === normalizedSearch
                );

            }) ||
            items[0];

        console.log(
            "[KKPHIM] Selected movie:",
            JSON.stringify({
                name: movie?.name,
                origin_name: movie?.origin_name,
                slug: movie?.slug,
                year: movie?.year,
                type: movie?.type
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

        const detailUrl =
            "https://phimapi.com/v1/api/phim/" +
            encodeURIComponent(movieSlug);

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
                        "User-Agent": "Mozilla/5.0",
                        "Accept": "application/json"
                    }
                }
            );

        console.log(
            "[KKPHIM] Detail HTTP:",
            detail.status
        );

        /*
         * CẤU TRÚC THỰC TẾ:
         *
         * detail.data
         *   └── data
         *       └── item
         *           └── episodes
         *               └── server_data
         *                   └── link_m3u8
         */

        const movieData =
            detail.data?.data?.item ||
            {};

        const episodes =
            movieData?.episodes ||
            [];

        console.log(
            "[KKPHIM] Movie data:",
            movieData?.name ||
            "UNKNOWN"
        );

        console.log(
            "[KKPHIM] Episodes:",
            Array.isArray(episodes)
                ? episodes.length
                : "NOT ARRAY"
        );

        if (
            !Array.isArray(episodes) ||
            !episodes.length
        ) {
            console.log(
                "[KKPHIM] NO EPISODES"
            );

            return streams;
        }

        episodes.forEach(
            (server, serverIndex) => {

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
                    [];

                console.log(
                    "[KKPHIM] Server data:",
                    Array.isArray(serverData)
                        ? serverData.length
                        : "NOT ARRAY"
                );

                if (
                    !Array.isArray(serverData)
                ) {
                    return;
                }

                serverData.forEach(
                    (ep, episodeIndex) => {

                        const streamUrl =
                            ep?.link_m3u8 ||
                            ep?.m3u8_url;

                        console.log(
                            "[KKPHIM] Episode",
                            episodeIndex,
                            "name:",
                            ep?.name ||
                            ep?.slug ||
                            "Unknown"
                        );

                        console.log(
                            "[KKPHIM] Episode URL:",
                            streamUrl ||
                            "NONE"
                        );

                        if (!streamUrl) {
                            return;
                        }

                        streams.push({

                            name:
                                "⚡ [API] KKPhim",

                            title:
                                (
                                    ep?.name ||
                                    "Full"
                                ) +
                                " - " +
                                serverName,

                            url:
                                String(streamUrl),

                            behaviorHints: {
                                bingeGroup:
                                    "kkphim"
                            }

                        });

                    }
                );

            }
        );

        console.log(
            "[KKPHIM] DIRECT STREAMS:",
            streams.length
        );

        console.log(
            "[KKPHIM] FINAL STREAMS:",
            JSON.stringify(streams)
        );

        console.log(
            "[KKPHIM] END"
        );

        console.log(
            "========================================"
        );

        return streams;

    } catch (e) {

        console.error(
            "========================================"
        );

        console.error(
            "[KKPHIM ERROR]"
        );

        console.error(
            "Message:",
            e?.message || e
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
   TEST VSMOV HLS / PNG
   ============================================================ */

async function testVsmovHls() {

    const masterUrl =
        "https://v9.streamvsmov.com/stream/a672c032-832c-4395-ba2b-ec64ead7c9d5/master.m3u8";

    const pngUrl =
        "https://p25.streamvsmov.com/file/ZnVja3lvdWZ1Y2t5b3U/tiktok/a672c032-832c-4395-ba2b-ec64ead7c9d5/file-tiktok_1.png";

    const headers = {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

        "Accept":
            "*/*",

        "Referer":
            "https://v9.streamvsmov.com/"
    };

    try {

        console.log("");
        console.log("============================================================");
        console.log("[VSMOV TEST] MASTER M3U8");
        console.log("============================================================");

        const master = await axios.get(masterUrl, {
            headers,
            timeout: 15000,
            responseType: "text",
            validateStatus: () => true
        });

        console.log("[VSMOV TEST] Status:", master.status);

        console.log(
            "[VSMOV TEST] Content-Type:",
            master.headers["content-type"]
        );

        console.log(
            "[VSMOV TEST] Content-Length:",
            master.headers["content-length"]
        );

        console.log(
            "[VSMOV TEST] Content-Encoding:",
            master.headers["content-encoding"]
        );

        console.log(
            "[VSMOV TEST] Accept-Ranges:",
            master.headers["accept-ranges"]
        );

        console.log(
            "[VSMOV TEST] Content-Range:",
            master.headers["content-range"]
        );

        console.log(
            "[VSMOV TEST] Body length:",
            typeof master.data === "string"
                ? master.data.length
                : "NOT_STRING"
        );

        console.log("");
        console.log("============================================================");
        console.log("[VSMOV TEST] FIRST PNG SEGMENT");
        console.log("============================================================");

        const png = await axios.get(pngUrl, {
            headers,
            timeout: 15000,
            responseType: "arraybuffer",
            validateStatus: () => true
        });

        console.log("[VSMOV TEST] Status:", png.status);

        console.log(
            "[VSMOV TEST] Content-Type:",
            png.headers["content-type"]
        );

        console.log(
            "[VSMOV TEST] Content-Length:",
            png.headers["content-length"]
        );

        console.log(
            "[VSMOV TEST] Content-Encoding:",
            png.headers["content-encoding"]
        );

        console.log(
            "[VSMOV TEST] Accept-Ranges:",
            png.headers["accept-ranges"]
        );

        console.log(
            "[VSMOV TEST] Content-Range:",
            png.headers["content-range"]
        );

        console.log(
            "[VSMOV TEST] Bytes received:",
            png.data
                ? Buffer.byteLength(png.data)
                : 0
        );

        console.log("");
        console.log("============================================================");
        console.log("[VSMOV TEST] DONE");
        console.log("============================================================");
        console.log("");

    } catch (error) {

        console.error(
            "[VSMOV TEST] ERROR:",
            error.message
        );

        if (error.response) {

            console.error(
                "[VSMOV TEST] HTTP STATUS:",
                error.response.status
            );

            console.error(
                "[VSMOV TEST] HEADERS:",
                error.response.headers
            );
        }
    }
}

testVsmovHls();

/* ============================================================
   VSMOV API
   SEARCH API
   DETAIL API
   DIRECT M3U8
   EMBED -> RESOLVE M3U8
   SIGNED / UNSIGNED STREAM
   FALLBACK ĐÚNG TRANG PHIM
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
        // 2. NORMALIZE TITLE
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
        // 3. API SEARCH
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
                            timeout: 10000,

                            headers: {

                                "User-Agent":
                                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

                                "Accept":
                                    "application/json, text/plain, */*",

                                "Accept-Language":
                                    "vi,en-US;q=0.9,en;q=0.8",

                                "Referer":
                                    "https://vsmov.com/"

                            }

                        }
                    );


                const data =
                    res.data || {};


                /*
                 * VSMov có thể trả kết quả ở nhiều
                 * cấu trúc khác nhau.
                 *
                 * Thử lần lượt tất cả các dạng thường gặp.
                 */

                let items = [];


                if (
                    Array.isArray(data)
                ) {

                    items = data;

                }


                else if (
                    Array.isArray(data?.data)
                ) {

                    items = data.data;

                }


                else if (
                    Array.isArray(data?.items)
                ) {

                    items = data.items;

                }


                else if (
                    Array.isArray(data?.results)
                ) {

                    items = data.results;

                }


                else if (
                    Array.isArray(data?.data?.items)
                ) {

                    items = data.data.items;

                }


                else if (
                    Array.isArray(data?.data?.results)
                ) {

                    items = data.data.results;

                }


                else if (
                    Array.isArray(data?.data?.data)
                ) {

                    items = data.data.data;

                }


                /*
                 * Một số API có thể bọc trong `movies`
                 */

                else if (
                    Array.isArray(data?.movies)
                ) {

                    items = data.movies;

                }


                else if (
                    Array.isArray(data?.data?.movies)
                ) {

                    items = data.data.movies;

                }


                console.log(
                    "[VSMOV] Search HTTP:",
                    res.status
                );


                console.log(
                    "[VSMOV] Search results:",
                    variant,
                    "=>",
                    Array.isArray(items)
                        ? items.length
                        : 0
                );


                /*
                 * Nếu vẫn không tìm thấy,
                 * log cấu trúc response để lần sau
                 * biết chính xác API đang trả gì.
                 */

                if (
                    !Array.isArray(items) ||
                    items.length === 0
                ) {

                    console.log(
                        "[VSMOV] Search response keys:",
                        Object.keys(data || {})
                    );

                }


                if (
                    Array.isArray(items)
                ) {

                    items.forEach(
                        item => {

                            if (
                                item &&
                                (
                                    item.slug ||
                                    item._id ||
                                    item.id
                                )
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
                    "[VSMOV] API SEARCH ERROR:",
                    variant,
                    e?.response?.status ||
                    e?.message ||
                    e
                );

            }

        }


        // ====================================================
        // 4. UNIQUE CANDIDATES
        // ====================================================

        const uniqueCandidates = [];

        const candidateSeen =
            new Set();


        candidates.forEach(
            item => {

                const slug =
                    String(
                        item?.slug ||
                        item?._id ||
                        item?.id ||
                        ""
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
        // 5. RANK SEARCH RESULTS
        // ====================================================

        const ranked =
            uniqueCandidates
                .map(item => {

                    const name =
                        String(
                            item?.name ||
                            item?.title ||
                            ""
                        );


                    const originName =
                        String(
                            item?.origin_name ||
                            item?.originName ||
                            ""
                        );


                    const normalizedName =
                        normalizeTitle(
                            name
                        );


                    const normalizedOrigin =
                        normalizeTitle(
                            originName
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
                                normalizedOrigin ===
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
                                ) &&
                                normalizedName
                            ) {

                                score += 40;

                            }


                            else if (
                                normalizedOrigin.includes(
                                    normalizedVariant
                                )
                            ) {

                                score += 45;

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

                        origin_name:
                            x.item?.origin_name,

                        slug:
                            x.item?.slug,

                        score:
                            x.score

                    })
                )
            )
        );


        // ====================================================
        // 6. KHÔNG TÌM THẤY
        // ====================================================

        if (
            ranked.length === 0
        ) {

            console.log(
                "[VSMOV] API không tìm thấy phim."
            );


            const searchTerm =
                titleVariants.length > 1
                    ? titleVariants[
                        titleVariants.length - 1
                    ]
                    : movieName;


            streams.push({

                name:
                    "🔎 [Fallback Search] VSmov",

                title:
                    "Tìm phim trên VSmov - " +
                    searchTerm,

                externalUrl:
                    "https://vsmov.com/?search=" +
                    encodeURIComponent(
                        searchTerm
                    )

            });


            return streams;

        }


        // ====================================================
        // 7. CHỌN PHIM
        // ====================================================

        const selected =
            ranked[0].item;


        const movieSlug =
            String(
                selected?.slug ||
                selected?._id ||
                selected?.id ||
                ""
            ).trim();


        const foundName =
            selected?.name ||
            movieName;


        if (!movieSlug) {

            console.log(
                "[VSMOV] Không có slug."
            );

            return streams;

        }


        console.log(
            "[VSMOV] Selected:",
            foundName
        );


        console.log(
            "[VSMOV] Slug:",
            movieSlug
        );


        // ====================================================
        // 8. API DETAIL
        // ====================================================

        const detailUrl =
            "https://vsmov.com/api/phim/" +
            encodeURIComponent(
                movieSlug
            );


        console.log(
            "[VSMOV] Detail API:",
            detailUrl
        );


        let detailRes;


        try {

            detailRes =
                await axios.get(
                    detailUrl,
                    {
                        timeout: 10000,

                        headers: {

                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

                            "Accept":
                                "application/json, text/plain, */*",

                            "Accept-Language":
                                "vi,en-US;q=0.9,en;q=0.8",

                            "Referer":
                                "https://vsmov.com/"

                        }
                    }
                );


        } catch (e) {

            console.log(
                "[VSMOV] Detail API ERROR:",
                e?.response?.status ||
                e?.message ||
                e
            );


            detailRes = null;

        }


        // ====================================================
        // 9. ĐỌC EPISODES
        // ====================================================

        const detailData =
            detailRes?.data || {};


        const movieData =
            detailData?.movie ||
            detailData?.data ||
            detailData;


        const episodes =
            Array.isArray(
                detailData?.episodes
            )
                ? detailData.episodes
                : Array.isArray(
                    movieData?.episodes
                )
                    ? movieData.episodes
                    : [];


        console.log(
            "[VSMOV] Servers:",
            episodes.length
        );


        // ====================================================
        // 10. LẤY STREAM
        // ====================================================

        for (
            const server
            of episodes
        ) {

            const serverName =
                String(
                    server?.server_name ||
                    server?.name ||
                    "VSMov"
                )
                .replace(/\s+/g, " ")
                .trim();


            const serverData =
                Array.isArray(
                    server?.server_data
                )
                    ? server.server_data
                    : [];


            console.log(
                "[VSMOV] Server:",
                serverName,
                "Episodes:",
                serverData.length
            );


            for (
                const ep
                of serverData
            ) {

                const episodeName =
                    String(
                        ep?.name ||
                        ep?.filename ||
                        ep?.slug ||
                        "Full"
                    )
                    .replace(/\s+/g, " ")
                    .trim();


                // =================================================
                // 10A. API CÓ LINK_M3U8
                // =================================================

                const m3u8 =
                    String(
                        ep?.link_m3u8 ||
                        ep?.m3u8 ||
                        ep?.link_m3u8_url ||
                        ""
                    ).trim();


                if (
                    m3u8 &&
                    /^https?:\/\//i.test(m3u8)
                ) {

                    console.log(
                        "[VSMOV] DIRECT M3U8:",
                        serverName,
                        episodeName,
                        m3u8
                    );


                    streams.push({

                        name:
                            "⚡ [API] VSMov",

                        title:
                            episodeName +
                            " - " +
                            serverName,

                        url:
                            m3u8,

                        behaviorHints: {

                            bingeGroup:
                                "vsmov-" +
                                normalizeTitle(
                                    serverName
                                )

                        }

                    });


                    continue;

                }


                // =================================================
                // 10B. LINK_EMBED
                // =================================================

                const embed =
                    String(
                        ep?.link_embed ||
                        ep?.embed ||
                        ""
                    ).trim();


                if (!embed) {

                    continue;

                }


                console.log(
                    "[VSMOV] EMBED GET:",
                    serverName,
                    episodeName,
                    embed
                );


                // =================================================
                // 10C. GET EMBED HTML
                // =================================================

                let embedRes;


                try {

                    embedRes =
                        await axios.get(
                            embed,
                            {
                                timeout: 10000,

                                maxRedirects: 5,

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


                } catch (e) {

                    console.log(
                        "[VSMOV] EMBED ERROR:",
                        e?.response?.status ||
                        e?.message ||
                        e
                    );


                    continue;

                }


                const html =
                    String(
                        embedRes?.data || ""
                    );


                if (!html) {

                    console.log(
                        "[VSMOV] EMBED EMPTY"
                    );

                    continue;

                }


                // =================================================
                // 10D. LẤY VIDEO HASH
                // =================================================

                let videoHash = "";


                const dataHashMatch =
                    html.match(
                        /id=["']rp-player["'][^>]*data-hash=["']([^"']+)["']/i
                    );


                if (
                    dataHashMatch
                ) {

                    videoHash =
                        dataHashMatch[1];

                }


                if (!videoHash) {

                    const videoHashMatch =
                        html.match(
                            /const\s+videoHash\s*=\s*["']([^"']+)["']/i
                        );


                    if (
                        videoHashMatch
                    ) {

                        videoHash =
                            videoHashMatch[1];

                    }

                }


                // =================================================
                // 10E. LẤY SIGNED SETTINGS
                // =================================================

                let enableSignedUrl =
                    false;


                let signedMasterUrl =
                    "";


                const signedEnabledMatch =
                    html.match(
                        /enableSignedUrl\s*:\s*(true|false)/i
                    );


                if (
                    signedEnabledMatch
                ) {

                    enableSignedUrl =
                        signedEnabledMatch[1]
                            .toLowerCase() ===
                        "true";

                }


                const signedUrlMatch =
                    html.match(
                        /signedMasterUrl\s*:\s*"([^"]*)"/i
                    );


                if (
                    signedUrlMatch
                ) {

                    signedMasterUrl =
                        signedUrlMatch[1];

                }


                console.log(
                    "[VSMOV] Hash:",
                    videoHash || "NOT FOUND"
                );


                console.log(
                    "[VSMOV] Signed:",
                    enableSignedUrl
                );


                if (
                    signedMasterUrl
                ) {

                    console.log(
                        "[VSMOV] Signed M3U8:",
                        signedMasterUrl
                    );

                }


                // =================================================
                // 10F. QUYẾT ĐỊNH STREAM URL
                // =================================================

                let streamUrl =
                    "";


                /*
                 * CASE 1
                 * SIGNED URL
                 */

                if (
                    enableSignedUrl &&
                    signedMasterUrl
                ) {

                    streamUrl =
                        signedMasterUrl;


                    console.log(
                        "[VSMOV] USING SIGNED M3U8"
                    );

                }


                /*
                 * CASE 2
                 * UNSIGNED URL
                 */

                else if (
                    videoHash
                ) {

                    try {

                        const embedOrigin =
                            new URL(
                                embed
                            ).origin;


                        streamUrl =
                            embedOrigin +
                            "/stream/" +
                            videoHash +
                            "/master.m3u8";


                        console.log(
                            "[VSMOV] USING UNSIGNED M3U8:",
                            streamUrl
                        );


                    } catch (e) {

                        console.log(
                            "[VSMOV] INVALID EMBED URL:",
                            embed
                        );

                    }

                }


                // =================================================
                // 10G. ADD DIRECT STREAM
                // =================================================

                if (
                    streamUrl
                ) {

                    streams.push({

                        name:
                            "⚡ [VSMov] " +
                            serverName,

                        title:
                            episodeName +
                            " - " +
                            serverName,

                        url:
                            streamUrl,

                        behaviorHints: {

                            bingeGroup:
                                "vsmov-" +
                                normalizeTitle(
                                    serverName
                                )

                        }

                    });


                    console.log(
                        "[VSMOV] STREAM ADDED:",
                        streamUrl
                    );

                }


                else {

                    /*
                     * Chỉ khi không lấy được M3U8
                     * mới đưa embed ra externalUrl.
                     */

                    console.log(
                        "[VSMOV] Không resolve được M3U8, dùng EMBED fallback"
                    );


                    streams.push({

                        name:
                            "🌐 [VSMov Embed] " +
                            serverName,

                        title:
                            episodeName +
                            " - Mở VSMov",

                        externalUrl:
                            embed

                    });

                }

            }

        }


        // ====================================================
        // 11. FALLBACK ĐÚNG TRANG PHIM
        // ====================================================

        const movieUrl =
            "https://vsmov.com/phim/" +
            encodeURIComponent(
                movieSlug
            );


        if (
            streams.length === 0
        ) {

            console.log(
                "[VSMOV] API không trả stream."
            );


            streams.push({

                name:
                    "🌐 [Fallback] VSmov",

                title:
                    "Mở đúng trang VSmov - " +
                    foundName,

                externalUrl:
                    movieUrl

            });

        }


        // ====================================================
        // 12. FINAL
        // ====================================================

        console.log(
            "[VSMOV] FINAL STREAMS:",
            JSON.stringify(
                streams
            )
        );


        console.log(
            "[VSMOV] END"
        );


        return streams;


    } catch (e) {

        console.log(
            "[VSMOV FATAL]",
            e?.response?.status ||
            e?.message ||
            e
        );


        const searchUrl =
            "https://vsmov.com/?search=" +
            encodeURIComponent(
                movieName
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


        return streams;

    }

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
   NGUONC DIRECT STREAM / PROXY
   ============================================================ */

const NGUONC_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/131.0.0.0 Safari/537.36";

const NGUONC_API =
    "https://phim.nguonc.com";

/* ============================================================
   HTTP/2 REQUEST
   NguonC embed hiện có thể yêu cầu HTTP/2
   ============================================================ */

function nguoncHttp2Request(
    targetUrl,
    options = {}
) {

    return new Promise(
        (resolve, reject) => {

            let parsed;

            try {
                parsed =
                    new URL(targetUrl);
            } catch (e) {
                reject(e);
                return;
            }

            if (
                parsed.protocol !== "https:"
            ) {
                reject(
                    new Error(
                        "NguonC HTTP/2 chỉ hỗ trợ HTTPS"
                    )
                );
                return;
            }

            const client =
                http2.connect(
                    parsed.origin
                );

            let settled = false;

            const finishError =
                err => {

                    if (settled) return;

                    settled = true;

                    try {
                        client.close();
                    } catch (_) {}

                    reject(err);
                };

            client.on(
                "error",
                finishError
            );

            const headers = {

                ":method":
                    options.method || "GET",

                ":path":
                    parsed.pathname +
                    parsed.search,

                ":authority":
                    parsed.host,

                "user-agent":
                    NGUONC_UA,

                "accept":
                    options.accept ||
                    "*/*",

                ...(options.headers || {})
            };

            if (
                options.referer
            ) {
                headers[
                    "referer"
                ] =
                    options.referer;
            }

            const req =
                client.request(
                    headers
                );

            const chunks = [];

            let responseHeaders = {};

            req.on(
                "response",
                h => {

                    responseHeaders =
                        h;

                }
            );

            req.on(
                "data",
                chunk => {

                    chunks.push(
                        Buffer.from(
                            chunk
                        )
                    );

                }
            );

            req.on(
                "end",
                () => {

                    if (settled) {
                        return;
                    }

                    settled = true;

                    const body =
                        Buffer.concat(
                            chunks
                        );

                    const status =
                        Number(
                            responseHeaders[
                                ":status"
                            ] || 0
                        );

                    try {
                        client.close();
                    } catch (_) {}

                    resolve({
                        status,
                        headers:
                            responseHeaders,
                        body
                    });

                }
            );

            req.on(
                "error",
                finishError
            );

            if (
                options.body
            ) {

                req.write(
                    options.body
                );

            }

            req.end();

        }
    );
}


/* ============================================================
   DECRYPT BOOTSTRAP AES-GCM
   ============================================================ */

function nguoncDecryptBootstrap(
    envelope,
    apiHref
) {

    if (
        envelope?.format !==
        "aesgcm-v1"
    ) {

        return envelope;

    }

    const ivHex =
        String(
            envelope?.iv || ""
        );

    const dataB64 =
        String(
            envelope?.data || ""
        );

    if (
        !/^[0-9a-fA-F]{24}$/.test(
            ivHex
        ) ||
        !dataB64
    ) {

        throw new Error(
            "NguonC bootstrap envelope không hợp lệ"
        );

    }

    const aad =
        Buffer.from(
            "stream-bootstrap-v1\n" +
            apiHref,
            "utf8"
        );

    const key =
        crypto
            .createHash("sha256")
            .update(aad)
            .digest();

    const iv =
        Buffer.from(
            ivHex,
            "hex"
        );

    const encrypted =
        Buffer.from(
            dataB64,
            "base64"
        );

    /*
     * AES-GCM trong Node:
     *
     * ciphertext + 16-byte authentication tag
     */

    if (
        encrypted.length < 17
    ) {

        throw new Error(
            "Bootstrap AES-GCM data quá ngắn"
        );

    }

    const tag =
        encrypted.subarray(
            encrypted.length - 16
        );

    const ciphertext =
        encrypted.subarray(
            0,
            encrypted.length - 16
        );

    const decipher =
        crypto.createDecipheriv(
            "aes-256-gcm",
            key,
            iv
        );

    decipher.setAAD(
        aad
    );

    decipher.setAuthTag(
        tag
    );

    const plaintext =
        Buffer.concat([
            decipher.update(
                ciphertext
            ),
            decipher.final()
        ]);

    return JSON.parse(
        plaintext.toString("utf8")
    );
}


/* ============================================================
   DECRYPT ENCRYPTED M3U8
   #ENC-AESGCM
   ============================================================ */

function nguoncDecryptM3U8(
    encryptedContent,
    videoHash
) {

    const lines =
        String(
            encryptedContent
        )
            .trim()
            .split(/\r?\n/);

    let ivHex = "";
    let dataLine = "";

    for (
        const line of lines
    ) {

        if (
            line.includes(
                "#ENC-AESGCM"
            )
        ) {

            const match =
                line.match(
                    /iv=([0-9a-fA-F]+)/
                );

            if (match) {
                ivHex =
                    match[1];
            }

        } else if (
            !line.startsWith("#") &&
            line.trim()
        ) {

            dataLine =
                line.trim();

        }

    }

    if (
        !ivHex ||
        !dataLine
    ) {

        throw new Error(
            "Không đọc được encrypted NguonC m3u8"
        );

    }

    /*
     * key =
     *
     * HMAC-SHA256(
     *     "stream-derive-v1",
     *     videoHash
     * )
     */

    const key =
        crypto
            .createHmac(
                "sha256",
                Buffer.from(
                    "stream-derive-v1",
                    "utf8"
                )
            )
            .update(
                String(
                    videoHash
                ),
                "utf8"
            )
            .digest();

    const iv =
        Buffer.from(
            ivHex,
            "hex"
        );

    const encrypted =
        Buffer.from(
            dataLine,
            "base64"
        );

    if (
        encrypted.length < 17
    ) {

        throw new Error(
            "Encrypted m3u8 quá ngắn"
        );

    }

    const tag =
        encrypted.subarray(
            encrypted.length - 16
        );

    const ciphertext =
        encrypted.subarray(
            0,
            encrypted.length - 16
        );

    const decipher =
        crypto.createDecipheriv(
            "aes-256-gcm",
            key,
            iv
        );

    decipher.setAuthTag(
        tag
    );

    const plaintext =
        Buffer.concat([
            decipher.update(
                ciphertext
            ),
            decipher.final()
        ]);

    return plaintext.toString(
        "utf8"
    );
}


/* ============================================================
   RESOLVE NguonC EMBED
   ============================================================ */

async function resolveNguonCEmbed(
    embedUrl,
    movieUrl = ""
) {

    const embed =
        new URL(
            embedUrl
        );

    const origin =
        embed.origin;

    /*
     * ----------------------------------------------------------
     * 1. LẤY EMBED PAGE BẰNG HTTP/2
     * ----------------------------------------------------------
     */

    const page =
        await nguoncHttp2Request(
            embedUrl,
            {
                method: "GET",

                referer:
                    movieUrl ||
                    NGUONC_API,

                accept:
                    "text/html,application/xhtml+xml"
            }
        );

    if (
        page.status !== 200
    ) {

        throw new Error(
            `NguonC embed HTTP ${page.status}`
        );

    }

    const html =
        page.body.toString(
            "utf8"
        );

    /*
     * ----------------------------------------------------------
     * 2. STREAM-BOOTSTRAP
     * ----------------------------------------------------------
     */

    const bootstrapMatch =
        html.match(
            /<script\s+id=["']stream-bootstrap["'][^>]*>([\s\S]*?)<\/script>/i
        );

    if (
        bootstrapMatch
    ) {

        let bootstrap;

        try {

            bootstrap =
                JSON.parse(
                    bootstrapMatch[1]
                );

        } catch (e) {

            throw new Error(
                "Không parse được stream-bootstrap"
            );

        }

        const apiHref =
            bootstrap?.api;

        if (!apiHref) {

            throw new Error(
                "NguonC bootstrap không có api"
            );

        }

        const api =
            new URL(
                apiHref,
                embedUrl
            );

        if (
            api.host !==
            embed.host
        ) {

            throw new Error(
                "NguonC bootstrap API khác host"
            );

        }

        /*
         * ------------------------------------------------------
         * 3. VIDEO HASH
         * ------------------------------------------------------
         */

        let videoHash = "";

        try {

            videoHash =
                new URL(
                    embedUrl
                ).searchParams.get(
                    "hash"
                ) || "";

        } catch (_) {}

        /*
         * ------------------------------------------------------
         * 4. MOVIE ORIGIN
         * ------------------------------------------------------
         */

        let movieOrigin =
            "";

        if (
            movieUrl
        ) {

            try {

                movieOrigin =
                    new URL(
                        movieUrl
                    ).origin;

            } catch (_) {}

        }

        /*
         * ------------------------------------------------------
         * 5. BOOTSTRAP BODY
         * ------------------------------------------------------
         */

        const body =
            JSON.stringify({

                action:
                    "bootstrap",

                referrer:
                    String(
                        movieUrl || ""
                    ).slice(
                        0,
                        4096
                    ),

                frame_origins:
                    movieOrigin
                        ? [
                            movieOrigin
                        ]
                        : [],

                request_grant:
                    true,

                playlist_format:
                    "aesgcm-v2",

                pretty_url:
                    true,

                path_chunks:
                    true,

                bootstrap_format:
                    "aesgcm-v1"

            });

        /*
         * ------------------------------------------------------
         * 6. POST BOOTSTRAP
         * ------------------------------------------------------
         */

        const bootstrapResponse =
            await nguoncHttp2Request(
                api.href,
                {

                    method:
                        "POST",

                    referer:
                        embedUrl,

                    headers: {

                        "content-type":
                            "application/json",

                        "origin":
                            origin

                    },

                    body

                }
            );

        if (
            bootstrapResponse.status !==
            200
        ) {

            throw new Error(
                `NguonC bootstrap HTTP ${bootstrapResponse.status}`
            );

        }

        let envelope;

        try {

            envelope =
                JSON.parse(
                    bootstrapResponse.body.toString(
                        "utf8"
                    )
                );

        } catch (e) {

            throw new Error(
                "NguonC bootstrap không trả JSON"
            );

        }

        /*
         * ------------------------------------------------------
         * 7. GIẢI MÃ BOOTSTRAP
         * ------------------------------------------------------
         */

        const opened =
            nguoncDecryptBootstrap(
                envelope,
                api.href
            );

        videoHash =
            opened?.video ||
            videoHash;

        /*
         * ------------------------------------------------------
         * 8. PREISSUED PLAYLIST
         * ------------------------------------------------------
         */

        const playlistUrl =
            opened?.preissued?.playlist;

        if (
            !playlistUrl
        ) {

            if (
                opened?.turnstileEnabled
            ) {

                throw new Error(
                    "NguonC yêu cầu Turnstile"
                );

            }

            throw new Error(
                "NguonC bootstrap không có playlist"
            );

        }

        const playlist =
            new URL(
                playlistUrl
            );

        if (
            playlist.host !==
            embed.host
        ) {

            throw new Error(
                "NguonC playlist khác host"
            );

        }

        /*
         * ------------------------------------------------------
         * 9. LẤY PLAYLIST
         * ------------------------------------------------------
         */

        const playlistResponse =
            await nguoncHttp2Request(
                playlist.href,
                {

                    method:
                        "GET",

                    referer:
                        embedUrl

                }
            );

        if (
            playlistResponse.status !==
            200
        ) {

            throw new Error(
                `NguonC playlist HTTP ${playlistResponse.status}`
            );

        }

        let playlistText =
            playlistResponse.body.toString(
                "utf8"
            );

        /*
         * ------------------------------------------------------
         * 10. AES-GCM PLAYLIST
         * ------------------------------------------------------
         */

        if (
            playlistText.includes(
                "#ENC-AESGCM"
            )
        ) {

            playlistText =
                nguoncDecryptM3U8(
                    playlistText,
                    videoHash
                );

        }

        return {
            playlist:
                playlistText,

            sourceUrl:
                playlist.href,

            referer:
                embedUrl,

            videoHash
        };

    }

    /*
     * ==========================================================
     * LEGACY NguonC
     * data-obf
     * ==========================================================
     */

    const obf =
        html.match(
            /data-obf=["']([^"']+)["']/i
        );

    if (
        !obf?.[1]
    ) {

        throw new Error(
            "NguonC không có stream-bootstrap hoặc data-obf"
        );

    }

    let streamData;

    try {

        streamData =
            JSON.parse(
                Buffer.from(
                    obf[1],
                    "base64"
                ).toString(
                    "utf8"
                )
            );

    } catch (e) {

        throw new Error(
            "Không decode được NguonC data-obf"
        );

    }

    const sub =
        streamData?.sUb;

    const videoHash =
        streamData?.hD ||
        "";

    if (
        !sub
    ) {

        throw new Error(
            "NguonC data-obf không có sUb"
        );

    }

    const playlistUrl =
        origin +
        "/" +
        sub +
        ".m3u8";

    const playlistResponse =
        await nguoncHttp2Request(
            playlistUrl,
            {

                method:
                    "GET",

                referer:
                    embedUrl

            }
        );

    if (
        playlistResponse.status !==
        200
    ) {

        throw new Error(
            `NguonC legacy playlist HTTP ${playlistResponse.status}`
        );

    }

    let playlistText =
        playlistResponse.body.toString(
            "utf8"
        );

    if (
        playlistText.includes(
            "#ENC-AESGCM"
        )
    ) {

        playlistText =
            nguoncDecryptM3U8(
                playlistText,
                videoHash
            );

    }

    return {

        playlist:
            playlistText,

        sourceUrl:
            playlistUrl,

        referer:
            embedUrl,

        videoHash

    };
}


/* ============================================================
   NGUONC HLS PROXY
   ============================================================ */

function encodeProxyUrl(
    url,
    referer
) {

    const payload =
        JSON.stringify({
            url,
            referer
        });

    return Buffer
        .from(payload)
        .toString("base64url");
}


function decodeProxyUrl(
    value
) {

    const json =
        Buffer
            .from(
                value,
                "base64url"
            )
            .toString("utf8");

    return JSON.parse(
        json
    );
}


/* ============================================================
   PROXY PLAYLIST / SEGMENT
   ============================================================ */

async function proxyNguonCRequest(
    targetUrl,
    referer
) {

    const parsed =
        new URL(
            targetUrl
        );

    /*
     * NguonC CDN có thể dùng HTTP/2.
     */

    if (
        parsed.protocol ===
        "https:"
    ) {

        return nguoncHttp2Request(
            targetUrl,
            {
                method:
                    "GET",

                referer:
                    referer ||

                    NGUONC_API
            }
        );

    }

    const response =
        await axios.get(
            targetUrl,
            {

                responseType:
                    "arraybuffer",

                timeout:
                    30000,

                headers: {

                    "User-Agent":
                        NGUONC_UA,

                    "Referer":
                        referer ||
                        NGUONC_API

                }

            }
        );

    return {

        status:
            response.status,

        headers:
            response.headers,

        body:
            Buffer.from(
                response.data
            )

    };
}


/* ============================================================
   REWRITE M3U8
   ============================================================ */

function rewriteNguonCPlaylist(
    playlist,
    playlistUrl,
    referer
) {

    const lines =
        String(
            playlist
        )
            .split(/\r?\n/);

    const rewritten =
        lines.map(
            line => {

                const trimmed =
                    line.trim();

                if (
                    !trimmed ||
                    trimmed.startsWith("#")
                ) {

                    /*
                     * Xử lý URI trong:
                     *
                     * #EXT-X-KEY:URI="..."
                     *
                     * hoặc các tag tương tự.
                     */

                    return line.replace(
                        /URI="([^"]+)"/g,
                        (_, uri) => {

                            try {

                                const absolute =
                                    new URL(
                                        uri,
                                        playlistUrl
                                    ).href;

                                const token =
                                    encodeProxyUrl(
                                        absolute,
                                        referer
                                    );

                                return `URI="/nguonc/hls/${token}"`;

                            } catch (_) {

                                return `URI="${uri}"`;

                            }

                        }
                    );

                }

                try {

                    const absolute =
                        new URL(
                            trimmed,
                            playlistUrl
                        ).href;

                    const token =
                        encodeProxyUrl(
                            absolute,
                            referer
                        );

                    return (
                        "/nguonc/hls/" +
                        token
                    );

                } catch (_) {

                    return line;

                }

            }
        );

    return rewritten.join(
        "\n"
    );
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
   EXPRESS ROUTER
   ============================================================ */

const addonRouter =
    getRouter(
        builder.getInterface()
    );

const app =
    express();

/* ============================================================
   CORS
   ============================================================ */

app.use(
    (req, res, next) => {

        res.setHeader(
            "Access-Control-Allow-Origin",
            "*"
        );

        res.setHeader(
            "Access-Control-Allow-Headers",
            "*"
        );

        next();

    }
);

/* ============================================================
   VSMOV HLS TEST
   ============================================================ */

app.get(
    "/nguonc/vsmov-test",
    async (req, res) => {

        const masterUrl =
            "https://v9.streamvsmov.com/stream/a672c032-832c-4395-ba2b-ec64ead7c9d5/master.m3u8";

        const pngUrl =
            "https://p25.streamvsmov.com/file/ZnVja3lvdWZ1Y2t5b3U/tiktok/a672c032-832c-4395-ba2b-ec64ead7c9d5/file-tiktok_1.png";

        const headers = {

            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

            "Accept":
                "*/*",

            "Referer":
                "https://v9.streamvsmov.com/"

        };

        const result = {

            master: {},

            png: {}

        };

        try {

            /* =================================================
               MASTER M3U8
               ================================================= */

            const master =
                await axios.get(
                    masterUrl,
                    {

                        headers,

                        timeout: 15000,

                        responseType:
                            "text",

                        validateStatus:
                            () => true

                    }
                );

            result.master = {

                status:
                    master.status,

                contentType:
                    master.headers[
                        "content-type"
                    ] || null,

                contentLength:
                    master.headers[
                        "content-length"
                    ] || null,

                contentEncoding:
                    master.headers[
                        "content-encoding"
                    ] || null,

                acceptRanges:
                    master.headers[
                        "accept-ranges"
                    ] || null,

                contentRange:
                    master.headers[
                        "content-range"
                    ] || null,

                bodyLength:
                    typeof master.data ===
                    "string"
                        ? master.data.length
                        : null

            };

            /* =================================================
               FIRST PNG
               ================================================= */

            const png =
                await axios.get(
                    pngUrl,
                    {

                        headers,

                        timeout: 15000,

                        responseType:
                            "arraybuffer",

                        validateStatus:
                            () => true

                    }
                );

            result.png = {

                status:
                    png.status,

                contentType:
                    png.headers[
                        "content-type"
                    ] || null,

                contentLength:
                    png.headers[
                        "content-length"
                    ] || null,

                contentEncoding:
                    png.headers[
                        "content-encoding"
                    ] || null,

                acceptRanges:
                    png.headers[
                        "accept-ranges"
                    ] || null,

                contentRange:
                    png.headers[
                        "content-range"
                    ] || null,

                bytesReceived:
                    png.data
                        ? Buffer.byteLength(
                            png.data
                        )
                        : 0

            };

            console.log("");
            console.log(
                "============================================================"
            );

            console.log(
                "[VSMOV TEST] MASTER"
            );

            console.log(
                JSON.stringify(
                    result.master,
                    null,
                    2
                )
            );

            console.log(
                "[VSMOV TEST] PNG"
            );

            console.log(
                JSON.stringify(
                    result.png,
                    null,
                    2
                )
            );

            console.log(
                "============================================================"
            );

            console.log("");

            res.json({

                success: true,

                ...result

            });

        } catch (error) {

            console.error(
                "[VSMOV TEST] ERROR:",
                error.message
            );

            res.status(
                500
            ).json({

                success: false,

                error:
                    error.message,

                response:
                    error.response
                        ? {

                            status:
                                error.response.status,

                            headers:
                                error.response.headers

                        }
                        : null

            });

        }

    }
);

/* ============================================================
   NGUONC PLAYLIST
   ============================================================ */

app.get(
    "/nguonc/playlist/:token",
    async (req, res) => {

        try {

            const token =
                String(
                    req.params.token || ""
                );

            if (!token) {
                res
                    .status(400)
                    .send(
                        "Missing NguonC token"
                    );
                return;
            }

            /*
             * Decode token
             */
            let payload;

            try {

                payload =
                    JSON.parse(
                        Buffer
                            .from(
                                token,
                                "base64url"
                            )
                            .toString("utf8")
                    );

            } catch (e) {

                res
                    .status(400)
                    .send(
                        "Invalid NguonC token"
                    );

                return;
            }

            const embedUrl =
                String(
                    payload?.embedUrl || ""
                );

            const movieUrl =
                String(
                    payload?.movieUrl || ""
                );

            const created =
                Number(
                    payload?.created || 0
                );

            if (
                !embedUrl ||
                !created
            ) {

                res
                    .status(400)
                    .send(
                        "Invalid NguonC payload"
                    );

                return;
            }

            /*
             * Token lifetime: 30 minutes
             */
            if (
                Date.now() - created >
                30 * 60 * 1000
            ) {

                res
                    .status(410)
                    .send(
                        "NguonC token expired"
                    );

                return;
            }

            console.log(
                "[NGUONC PLAYLIST] resolving:",
                embedUrl
            );

            /*
             * Resolve embed -> real playlist
             */
            const resolved =
                await resolveNguonCEmbed(
                    embedUrl,
                    movieUrl
                );

            if (
                !resolved ||
                !resolved.playlist
            ) {

                throw new Error(
                    "NguonC resolver returned empty playlist"
                );
            }

            /*
             * Rewrite all HLS URLs so that
             * Stremio can access them through
             * our Vercel proxy.
             */
            const rewritten =
                rewriteNguonCPlaylist(
                    resolved.playlist,
                    resolved.sourceUrl,
                    resolved.referer
                );

            res.setHeader(
                "Content-Type",
                "application/vnd.apple.mpegurl"
            );

            res.setHeader(
                "Cache-Control",
                "no-store, no-cache, must-revalidate"
            );

            res.setHeader(
                "Access-Control-Allow-Origin",
                "*"
            );

            res.send(
                rewritten
            );

        } catch (e) {

            console.error(
                "[NGUONC PLAYLIST ERROR]",
                e?.message || e
            );

            if (!res.headersSent) {

                res
                    .status(500)
                    .send(
                        "NguonC playlist error: " +
                        (
                            e?.message ||
                            "unknown error"
                        )
                    );
            }
        }
    }
);


/* ============================================================
   NGUONC HLS SEGMENT / KEY / PLAYLIST
   ============================================================ */

app.get(
    "/nguonc/hls/:token",
    async (req, res) => {

        try {

            const payload =
                decodeProxyUrl(
                    req.params.token
                );

            const targetUrl =
                payload?.url;

            const referer =
                payload?.referer ||
                NGUONC_API;

            if (
                !targetUrl
            ) {

                res.status(
                    400
                ).send(
                    "Missing target URL"
                );

                return;

            }

            /*
             * Chỉ cho proxy HTTPS.
             */

            const parsed =
                new URL(
                    targetUrl
                );

            if (
                parsed.protocol !==
                "https:"
            ) {

                res.status(
                    400
                ).send(
                    "Invalid protocol"
                );

                return;

            }

            const response =
                await proxyNguonCRequest(
                    targetUrl,
                    referer
                );

            if (
                response.status < 200 ||
                response.status >= 400
            ) {

                res.status(
                    response.status ||
                    502
                ).send(
                    "NguonC upstream error"
                );

                return;

            }

            /*
             * Nếu upstream trả m3u8,
             * tiếp tục rewrite.
             */

            const contentType =
                String(
                    response.headers?.[
                        "content-type"
                    ] ||
                    response.headers?.[
                        "Content-Type"
                    ] ||
                    ""
                ).toLowerCase();

            const body =
                response.body;

            const looksLikeM3U8 =
                contentType.includes(
                    "mpegurl"
                ) ||
                contentType.includes(
                    "m3u8"
                ) ||
                body
                    .toString(
                        "utf8",
                        0,
                        Math.min(
                            body.length,
                            32
                        )
                    )
                    .includes(
                        "#EXTM3U"
                    );

            if (
                looksLikeM3U8
            ) {

                const playlistText =
                    body.toString(
                        "utf8"
                    );

                const rewritten =
                    rewriteNguonCPlaylist(
                        playlistText,
                        targetUrl,
                        referer
                    );

                res.setHeader(
                    "Content-Type",
                    "application/vnd.apple.mpegurl"
                );

                res.setHeader(
                    "Cache-Control",
                    "no-store"
                );

                res.send(
                    rewritten
                );

                return;

            }

            /*
             * Segment / key / binary
             */

            if (
                contentType
            ) {

                res.setHeader(
                    "Content-Type",
                    contentType
                );

            }

            res.setHeader(
                "Cache-Control",
                "no-store"
            );

            res.send(
                body
            );

        } catch (e) {

            console.error(
                "[NGUONC HLS ERROR]",
                e
            );

            if (
                !res.headersSent
            ) {

                res.status(
                    500
                ).send(
                    "NguonC HLS proxy error"
                );

            }

        }

    }
);


/* ============================================================
   STREMIO ADDON ROUTES
   ============================================================ */

app.use(
    "/",
    addonRouter
);


/* ============================================================
   EXPORT
   ============================================================ */

module.exports =
    function handler(
        req,
        res
    ) {

        return app(
            req,
            res
        );

    };
