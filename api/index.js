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

        console.log(
            "[NGUONC] Search:",
            movieName
        );

        const searchUrl =
            "https://phim.nguonc.com/api/films/search?keyword=" +
            encodeURIComponent(movieName);

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
            res.data?.items || [];

        console.log(
            "[NGUONC] Search results:",
            items.length
        );

        if (!items.length) {
            return streams;
        }

        const movie =
            items[0];

        const movieSlug =
            movie.slug;

        if (!movieSlug) {
            return streams;
        }

        console.log(
            "[NGUONC] Slug:",
            movieSlug
        );

        const detailUrl =
            "https://phim.nguonc.com/api/film/" +
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

        const episodes =
            detail.data?.movie?.episodes ||
            detail.data?.episodes ||
            [];

        episodes.forEach(server => {

            const serverItems =
                server.items ||
                server.server_data ||
                [];

            serverItems.forEach(ep => {

                const streamUrl =
                    ep.link_m3u8 ||
                    ep.m3u8_url;

                if (!streamUrl) return;

                streams.push({

                    name:
                        "🎬 [API] NguonC",

                    title:
                        "Tap " +
                        (
                            ep.name ||
                            ep.slug ||
                            ""
                        ) +
                        " - " +
                        (
                            server.server_name ||
                            ""
                        ),

                    url:
                        String(streamUrl)
                });
            });
        });

        console.log(
            "[NGUONC] Streams:",
            streams.length
        );

    } catch (e) {

        console.log(
            "[NGUONC ERROR]",
            e?.response?.status ||
            e?.message ||
            e
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

        console.log(
            "[VSMOV] Search:",
            movieName
        );

        /*
         * VSmov dùng URL dạng:
         *
         * https://vsmov.com/phim/gia-tai-cua-ngoai
         *
         * nên chuyển tên phim thành slug.
         */

        const slug =
            toSlug(movieName);

        if (!slug) {

            console.log(
                "[VSMOV] Slug rỗng"
            );

            return streams;
        }

        const movieUrl =
            "https://vsmov.com/phim/" +
            encodeURIComponent(slug);

        console.log(
            "[VSMOV] Movie URL:",
            movieUrl
        );

        /*
         * Lấy HTML trang phim
         */

        const res =
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
                            "vi,en-US;q=0.9,en;q=0.8"
                    }
                }
            );

        const html =
            String(
                res.data || ""
            );

        /*
         * ========================================================
         * TÌM VIDEO HASH
         * ========================================================
         *
         * HTML thực tế của VSmov có dạng:
         *
         * <div
         *   id="rp-player"
         *   data-hash="e8a8a270-..."
         * >
         *
         * và JavaScript:
         *
         * const videoHash = "e8a8a270-...";
         *
         */

        let videoHash = "";

        /*
         * Cách 1:
         * data-hash="UUID"
         */

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

        /*
         * Cách 2:
         * const videoHash = "UUID"
         */

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

        /*
         * Cách 3:
         * Nếu HTML đã chứa trực tiếp:
         *
         * /video/UUID
         */

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

        /*
         * Cách 4:
         * Nếu HTML đã chứa trực tiếp:
         *
         * /stream/UUID/master.m3u8
         */

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

            return streams;
        }

        console.log(
            "[VSMOV] Video Hash:",
            videoHash
        );

        /*
         * ========================================================
         * TẠO MASTER M3U8
         * ========================================================
         *
         * Player HTML thực tế của VSmov:
         *
         * baseUrl + '/stream/' +
         * videoHash +
         * '/master.m3u8'
         *
         */

        const streamUrl =
            "https://v8.streamvsmov.com/stream/" +
            videoHash +
            "/master.m3u8";

        console.log(
            "[VSMOV] Stream URL:",
            streamUrl
        );

        /*
         * ========================================================
         * TRẢ STREAM CHO STREMIO
         * ========================================================
         */

        streams.push({

            name:
                "🌟 [Scrape] VSMov",

            title:
                "Luồng phát VSMov",

            url:
                String(
                    streamUrl
                ),

            behaviorHints: {

                /*
                 * Trang phim nguồn.
                 * Có thể cần thiết nếu CDN kiểm tra Referer.
                 */

                httpReferrer:
                    movieUrl,

                /*
                 * Giúp Stremio gom stream
                 * của cùng nguồn.
                 */

                bingeGroup:
                    "vsmov"

            }

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
                    timeout: 8000
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

        /*
         * Nếu selector trên không bắt được,
         * thử tìm link /phim/
         */

        if (!firstMovieLink) {

            firstMovieLink =
                parseHtml(
                    'a[href*="/phim/"]'
                )
                .first()
                .attr("href");
        }

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


        /*
         * =====================================================
         * MỞ TRANG PHIM
         * =====================================================
         */

        const movieRes =
            await axios.get(
                firstMovieLink,
                {
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                    },
                    timeout: 8000
                }
            );

        const parseMovie =
            cheerio.load(
                movieRes.data
            );


        /*
         * =====================================================
         * TÌM vpm.php
         * =====================================================
         */

        let vpmUrl = null;

        parseMovie("iframe").each(
            (i, el) => {

                const src =
                    parseMovie(el).attr("src");

                if (
                    src &&
                    src.includes("/vpm.php")
                ) {

                    vpmUrl = src;
                }
            }
        );


        /*
         * Nếu iframe không có,
         * tìm trực tiếp trong HTML
         */

        if (!vpmUrl) {

            const vpmMatch =
                movieRes.data.match(
                    /https?:\/\/www\.1phim32\.com\/vpm\.php\?[^"'<>\\\s]+/i
                );

            if (vpmMatch?.[0]) {

                vpmUrl =
                    vpmMatch[0];
            }
        }


        /*
         * Một số trường hợp HTML chỉ chứa:
         *
         * vpm.php?v=...&h=...
         */

        if (!vpmUrl) {

            const relativeVpm =
                movieRes.data.match(
                    /\/vpm\.php\?[^"'<>\\\s]+/i
                );

            if (relativeVpm?.[0]) {

                vpmUrl =
                    "https://www.1phim32.com" +
                    relativeVpm[0];
            }
        }

        if (!vpmUrl) {

            console.log(
                "[1PHIM32] Không tìm thấy vpm.php"
            );

            return streams;
        }

        /*
         * Decode HTML entities nếu có &amp;
         */

        vpmUrl =
            vpmUrl.replace(
                /&amp;/g,
                "&"
            );

        console.log(
            "[1PHIM32] VPM URL:",
            vpmUrl
        );


        /*
         * =====================================================
         * MỞ vpm.php
         * =====================================================
         */

        const vpmRes =
            await axios.get(
                vpmUrl,
                {
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 6.3; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0",
                        "Referer":
                            firstMovieLink
                    },
                    timeout: 8000
                }
            );

        const vpmHtml =
            vpmRes.data;


        /*
         * =====================================================
         * TÌM CÁC play2.php
         *
         * Ví dụ:
         *
         * https://www.1phim32.com/play2.php?
         * hash=...
         * &token=...
         * &type=.html
         * &tt=3
         * =====================================================
         */

        const play2Matches =
            vpmHtml.match(
                /https?:\/\/www\.1phim32\.com\/play2\.php\?[^"'<>\\\s]+/gi
            ) || [];


        /*
         * Loại bỏ URL trùng
         */

        const uniquePlay2 =
            [...new Set(
                play2Matches.map(
                    url =>
                        url.replace(
                            /&amp;/g,
                            "&"
                        )
                )
            )];


        console.log(
            "[1PHIM32] play2 URLs:",
            uniquePlay2.length
        );


        /*
         * =====================================================
         * GIẢI MÃ hash
         * =====================================================
         */

        for (
            let i = 0;
            i < uniquePlay2.length;
            i++
        ) {

            const playUrl =
                uniquePlay2[i];

            try {

                const urlObj =
                    new URL(playUrl);

                const hash =
                    urlObj.searchParams.get(
                        "hash"
                    );

                if (!hash) {
                    continue;
                }


                /*
                 * hash là Base64 của URL thật
                 */

                const decodedUrl =
                    Buffer
                        .from(
                            hash,
                            "base64"
                        )
                        .toString("utf8")
                        .trim();


                console.log(
                    "[1PHIM32] Decoded:",
                    decodedUrl
                );


                /*
                 * Chỉ lấy URL m3u8
                 */

                if (
                    !/\.m3u8(?:$|[?#])/i.test(
                        decodedUrl
                    )
                ) {

                    continue;
                }


                /*
                 * Tránh stream trùng
                 */

                const alreadyExists =
                    streams.some(
                        stream =>
                            stream.url ===
                            decodedUrl
                    );

                if (alreadyExists) {
                    continue;
                }


                /*
                 * Xác định tên server
                 */

                let serverName =
                    "1Phim32";

                const lowerPlay =
                    playUrl.toLowerCase();

                if (
                    lowerPlay.includes(
                        "play2.php"
                    )
                ) {

                    /*
                     * S1/S2 không được truyền
                     * trực tiếp trong play2.php,
                     * nên đánh số theo thứ tự.
                     */

                    serverName =
                        "1Phim32 S" +
                        (streams.length + 1);
                }


                streams.push({

                    name:
                        "🔊 [Scrape] " +
                        serverName,

                    title:
                        "Luong phat " +
                        serverName,

                    url:
                        decodedUrl
                });

            } catch (e) {

                console.log(
                    "[1PHIM32] Decode error:",
                    e?.message || e
                );
            }
        }


        /*
         * =====================================================
         * FALLBACK:
         * TÌM hash= trực tiếp trong HTML
         *
         * Trường hợp HTML encode URL hoặc
         * không match được play2.php hoàn chỉnh.
         * =====================================================
         */

        if (!streams.length) {

            const hashMatches =
                vpmHtml.match(
                    /hash=([^&"'<>\\\s]+)/gi
                ) || [];

            console.log(
                "[1PHIM32] Fallback hash:",
                hashMatches.length
            );

            for (
                const hashItem of hashMatches
            ) {

                try {

                    const hash =
                        hashItem
                            .replace(
                                /^hash=/i,
                                ""
                            )
                            .trim();

                    const decodedUrl =
                        Buffer
                            .from(
                                hash,
                                "base64"
                            )
                            .toString("utf8")
                            .trim();


                    if (
                        !/\.m3u8(?:$|[?#])/i.test(
                            decodedUrl
                        )
                    ) {

                        continue;
                    }


                    const alreadyExists =
                        streams.some(
                            stream =>
                                stream.url ===
                                decodedUrl
                        );

                    if (alreadyExists) {
                        continue;
                    }


                    streams.push({

                        name:
                            "🔊 [Scrape] 1Phim32",

                        title:
                            "Luong phat 1Phim32",

                        url:
                            decodedUrl
                    });

                } catch (e) {

                    console.log(
                        "[1PHIM32] Fallback decode error:",
                        e?.message || e
                    );
                }
            }
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
   DIRECT STREAM + 5 EXTERNAL URL FALLBACKS
   ============================================================ */

builder.defineStreamHandler(async (args) => {

    console.log(
        "================================================"
    );

    console.log(
        "[STREAM] Request:",
        JSON.stringify(args)
    );

    let movieName = "";

    const rawId =
        String(args.id || "").trim();


    /* ========================================================
       1. LẤY TÊN PHIM TỪ ID
       ======================================================== */

    if (
        rawId.toLowerCase().startsWith("vnwpsw:")
    ) {

        try {

            let customId =
                rawId.substring(
                    rawId.indexOf(":") + 1
                );

            /*
             * Với phim bộ, Stremio có thể gửi:
             *
             * vnwpsw:Tên phim:1:3
             *
             * => chỉ lấy "Tên phim"
             */

            const parts =
                customId.split(":");

            if (
                args.type === "series" &&
                parts.length >= 3 &&
                /^\d+$/.test(
                    parts[parts.length - 2]
                ) &&
                /^\d+$/.test(
                    parts[parts.length - 1]
                )
            ) {

                parts.splice(
                    parts.length - 2,
                    2
                );

                customId =
                    parts.join(":");
            }

            movieName =
                decodeURIComponent(
                    customId
                );

        } catch (e) {

            console.log(
                "[STREAM CUSTOM ID ERROR]",
                e?.message || e
            );

            movieName = "";
        }
    }


    /* ========================================================
       2. IMDb
       ======================================================== */

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
                "[STREAM IMDB ERROR]",
                e?.message || e
            );

            movieName = "";
        }
    }


    /* ========================================================
       3. ID KHÁC
       ======================================================== */

    else {

        try {

            movieName =
                decodeURIComponent(
                    rawId
                );

        } catch (e) {

            console.log(
                "[STREAM ID DECODE ERROR]",
                e?.message || e
            );

            movieName =
                rawId;
        }
    }


    /* ========================================================
       4. CHUẨN HÓA TÊN PHIM
       ======================================================== */

    movieName =
        String(movieName || "")
            .replace(/\s+/g, " ")
            .trim();


    console.log(
        "[STREAM] Movie:",
        movieName
    );

    console.log(
        "[STREAM] Type:",
        args.type
    );


    /* ========================================================
       5. KIỂM TRA ID KHÔNG HỢP LỆ
       ======================================================== */

    if (
        !movieName ||
        movieName.toLowerCase() === "phim"
    ) {

        console.log(
            "[STREAM] Invalid movie name"
        );

        return {
            streams: []
        };
    }


    /* ========================================================
       6. CHẠY 5 DIRECT RESOLVERS
       ======================================================== */

    console.log(
        "[STREAM] Starting 5 direct sources..."
    );

    const results =
        await Promise.allSettled([

            fetchNguonC(movieName),

            fetchKKPhim(movieName),

            fetchVSMov(movieName),

            scrapePhimLongTieng(movieName),

            scrapeMotPhimTV(movieName)

        ]);


    /* ========================================================
       7. LẤY KẾT QUẢ TỪNG NGUỒN
       ======================================================== */

    const nguonc =
        results[0].status === "fulfilled" &&
        Array.isArray(results[0].value)
            ? results[0].value
            : [];

    const kkphim =
        results[1].status === "fulfilled" &&
        Array.isArray(results[1].value)
            ? results[1].value
            : [];

    const vsmov =
        results[2].status === "fulfilled" &&
        Array.isArray(results[2].value)
            ? results[2].value
            : [];

    const longtieng =
        results[3].status === "fulfilled" &&
        Array.isArray(results[3].value)
            ? results[3].value
            : [];

    const motphim =
        results[4].status === "fulfilled" &&
        Array.isArray(results[4].value)
            ? results[4].value
            : [];


    /* ========================================================
       8. GOM DIRECT STREAMS
       ======================================================== */

    const directStreams = [

        ...nguonc,

        ...kkphim,

        ...vsmov,

        ...longtieng,

        ...motphim

    ];


    console.log(
        "[STREAM] Direct total:",
        directStreams.length
    );


    /* ========================================================
       9. TẠO URL FALLBACK
       ======================================================== */

    const slugQuery =
        toSlug(movieName);

    const urlQuery =
        encodeURIComponent(
            movieName
        ).replace(
            /%20/g,
            "+"
        );


    /* ========================================================
       10. 5 EXTERNAL URL FALLBACKS
       ======================================================== */

    const externalStreams = [

        /* ----------------------------------------------------
           1. 1PHIM32
           ---------------------------------------------------- */

        {
            name:
                "🌐 [Fallback] 1Phim32",

            title:
                "Mở trang 1Phim32 để phát: " +
                movieName,

            externalUrl:
                "https://www.1phim32.com/search/" +
                slugQuery +
                "/"
        },


        /* ----------------------------------------------------
           2. NGUỒNC
           ---------------------------------------------------- */

        {
            name:
                "🌐 [Fallback] NguồnC",

            title:
                "Mở trang NguồnC để phát: " +
                movieName,

            externalUrl:
                "https://nguonc.com/tim-kiem?keyword=" +
                urlQuery
        },


        /* ----------------------------------------------------
           3. MOTPHIMTV
           ---------------------------------------------------- */

        {
            name:
                "🌐 [Fallback] MotPhimTV",

            title:
                "Mở trang MotPhimTV để phát: " +
                movieName,

            externalUrl:
                "https://motphimtv.run/?search=" +
                urlQuery
        },


        /* ----------------------------------------------------
           4. VSMOV
           ---------------------------------------------------- */

        {
            name:
                "🌐 [Fallback] VSmov",

            title:
                "Mở trang VSmov để phát: " +
                movieName,

            externalUrl:
                "https://vsmov.com/phim/" +
                slugQuery
        },


        /* ----------------------------------------------------
           5. KKPHIM
           ---------------------------------------------------- */

        {
            name:
                "🌐 [Fallback] KKPhim",

            title:
                "Mở trang KKPhim để tìm và phát: " +
                movieName,

            externalUrl:
                "https://phimapi.com/tim-kiem/" +
                slugQuery
        }

    ];


    /* ========================================================
       11. GOM DIRECT + FALLBACK
       ======================================================== */

    const allStreams = [

        ...directStreams,

        ...externalStreams

    ];


    /* ========================================================
       12. CHỈ GIỮ STREAM CÓ URL HỢP LỆ
       ======================================================== */

    const validStreams =
        allStreams.filter(
            stream => {

                if (!stream) {
                    return false;
                }


                /* Direct stream */

                if (
                    typeof stream.url === "string" &&
                    (
                        stream.url.startsWith(
                            "http://"
                        ) ||
                        stream.url.startsWith(
                            "https://"
                        )
                    )
                ) {

                    return true;
                }


                /* External URL */

                if (
                    typeof stream.externalUrl === "string" &&
                    (
                        stream.externalUrl.startsWith(
                            "http://"
                        ) ||
                        stream.externalUrl.startsWith(
                            "https://"
                        )
                    )
                ) {

                    return true;
                }


                return false;
            }
        );


    /* ========================================================
       13. XÓA DIRECT URL TRÙNG
       ======================================================== */

    const seenDirectUrls =
        new Set();

    const seenExternalUrls =
        new Set();


    const uniqueStreams =
        validStreams.filter(
            stream => {


                /* Direct URL */

                if (stream.url) {

                    const url =
                        String(
                            stream.url
                        ).trim();

                    if (
                        seenDirectUrls.has(
                            url
                        )
                    ) {

                        return false;
                    }

                    seenDirectUrls.add(
                        url
                    );

                    return true;
                }


                /* External URL */

                if (stream.externalUrl) {

                    const externalUrl =
                        String(
                            stream.externalUrl
                        ).trim();

                    if (
                        seenExternalUrls.has(
                            externalUrl
                        )
                    ) {

                        return false;
                    }

                    seenExternalUrls.add(
                        externalUrl
                    );

                    return true;
                }


                return false;
            }
        );


    /* ========================================================
       14. LOG CHI TIẾT
       ======================================================== */

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

    console.log(
        "[STREAM] Direct:",
        directStreams.length
    );

    console.log(
        "[STREAM] Fallback:",
        externalStreams.length
    );

    console.log(
        "[STREAM] Final:",
        uniqueStreams.length
    );


    /* ========================================================
       15. LOG TỪNG STREAM CUỐI
       ======================================================== */

    uniqueStreams.forEach(
        (stream, index) => {

            console.log(
                "[STREAM FINAL]",
                index + 1,
                "|",
                stream.name || "",
                "|",
                stream.title || "",
                "|",
                stream.url ||
                stream.externalUrl ||
                ""
            );
        }
    );


    /* ========================================================
       16. TRẢ KẾT QUẢ CHO STREMIO
       ======================================================== */

    return {
        streams:
            uniqueStreams
    };

});
