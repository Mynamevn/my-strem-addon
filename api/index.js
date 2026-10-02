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
    id: "pa_movies_trending",
    name: "Phim lẻ - Trending",
    extra: [
        {
            name: "search",
            isRequired: false
        }
    ]
},

{
    type: "series",
    id: "pa_series_trending",
    name: "Phim bộ - Trending",
    extra: [
        {
            name: "search",
            isRequired: false
        }
    ]
},

{
    type: "movie",
    id: "pa_tvb",
    name: "🇭🇰 TVB",
    extra: [
        {
            name: "search",
            isRequired: false
        }
    ]
},

{
    type: "movie",
    id: "pa_daily",
    name: "⭐ Phim trong ngày",
    extra: [
        {
            name: "search",
            isRequired: false
        }
    ]
},

{
    type: "movie",
    id: "pa_animation_new",
    name: "🐼 Hoạt hình - New",
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

const CATALOG_TARGET = 50;

function catalogNormalize(value) {

return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

}

function catalogKey(item) {

return (
    item?.slug ||
    item?._id ||
    item?.id ||
    (
        String(item?.name || "") +
        "|" +
        String(item?.year || "")
    )
);

}

function catalogDedupe(items) {

const seen = new Set();
const result = [];

for (const item of items || []) {

    const key = catalogKey(item);

    if (!key || seen.has(key)) {
        continue;
    }

    seen.add(key);
    result.push(item);
}

return result;

}

function catalogPoster(item) {

return (
    item?.poster_url ||
    item?.thumb_url ||
    item?.poster ||
    ""
);

}

function catalogCountryNames(item) {

if (!Array.isArray(item?.country)) {
    return [];
}

return item.country
    .map(x =>
        typeof x === "string"
            ? x
            : x?.name
    )
    .filter(Boolean)
    .map(x => catalogNormalize(x));

}

function catalogCategoryNames(item) {

if (!Array.isArray(item?.category)) {
    return [];
}

return item.category
    .map(x =>
        typeof x === "string"
            ? x
            : x?.name
    )
    .filter(Boolean)
    .map(x => catalogNormalize(x));

}

function isHongKong(item) {

const countries =
    catalogCountryNames(item);

const text =
    catalogNormalize(
        [
            item?.name,
            item?.origin_name,
            item?.original_name
        ]
            .filter(Boolean)
            .join(" ")
    );

return (
    countries.some(x =>
        x.includes("hong kong") ||
        x.includes("hongkong")
    ) ||
    text.includes("hong kong") ||
    text.includes("hongkong") ||
    text.includes(" tvb ") ||
    text.startsWith("tvb ") ||
    text.endsWith(" tvb")
);

}

function isAnimation(item) {

const categories =
    catalogCategoryNames(item);

const text =
    catalogNormalize(
        [
            item?.name,
            item?.origin_name,
            item?.original_name
        ]
            .filter(Boolean)
            .join(" ")
    );

return (
    categories.some(x =>
        x.includes("hoat hinh") ||
        x.includes("animation") ||
        x.includes("anime")
    ) ||
    text.includes("anime")
);

}

function isJapanese(item) {

const countries =
    catalogCountryNames(item);

const text =
    catalogNormalize(
        [
            item?.name,
            item?.origin_name,
            item?.original_name
        ]
            .filter(Boolean)
            .join(" ")
    );

return (
    countries.some(x =>
        x.includes("nhat ban") ||
        x.includes("japan")
    ) ||
    text.includes("japan")
);

}

function isAmericanWestern(item) {

const countries =
    catalogCountryNames(item);

return countries.some(x =>
    x.includes("au my") ||
    x.includes("my") ||
    x.includes("anh") ||
    x.includes("phap") ||
    x.includes("duc") ||
    x.includes("canada") ||
    x.includes("uc") ||
    x.includes("new zealand")
);

}

function isAsian(item) {

const countries =
    catalogCountryNames(item);

return countries.some(x =>
    x.includes("trung quoc") ||
    x.includes("han quoc") ||
    x.includes("nhat ban") ||
    x.includes("thai lan") ||
    x.includes("dai loan") ||
    x.includes("hong kong") ||
    x.includes("an do") ||
    x.includes("philippines") ||
    x.includes("indonesia")
);

}

/* ============================================================
   XÁC ĐỊNH MOVIE / SERIES
   PhimAPI:
   - series   = phim bộ
   - single   = phim lẻ
   - hoathinh = hoạt hình
   - tvshows  = TV Shows
   ============================================================ */

function isSeriesItem(item) {

    if (!item) {
        return false;
    }

    /*
       Ưu tiên tuyệt đối trường type của PhimAPI.
    */

    const rawType =
        String(
            item?.type ||
            ""
        )
            .trim()
            .toLowerCase();

    if (
        rawType ===
        "series"
    ) {
        return true;
    }

    if (
        rawType ===
        "single"
    ) {
        return false;
    }

    if (
        rawType ===
        "movie"
    ) {
        return false;
    }

    /*
       Hoạt hình có thể là movie hoặc series.
       Không tự coi hoathinh là series ở đây.
       Nếu API không có type rõ ràng thì mới
       dùng các dấu hiệu phụ bên dưới.
    */

    if (
        rawType ===
        "hoathinh"
    ) {

        /*
           Nếu có episode_current / episode_total
           thì xem như series.
        */

        const episodeCurrent =
            String(
                item?.episode_current ||
                ""
            ).trim();

        const episodeTotal =
            String(
                item?.episode_total ||
                ""
            ).trim();

        if (
            episodeCurrent ||
            episodeTotal
        ) {
            return true;
        }

        return false;
    }

    /*
       Trường hợp API không trả type.
       Chỉ dùng dấu hiệu phụ nếu thật sự có.
    */

    const episodeCurrent =
        String(
            item?.episode_current ||
            ""
        ).trim();

    const episodeTotal =
        String(
            item?.episode_total ||
            ""
        ).trim();

    if (
        episodeCurrent ||
        episodeTotal
    ) {
        return true;
    }

    /*
       Không đủ bằng chứng là series
       => mặc định là movie.
    */

    return false;
}

function itemYear(item) {

const y =
    Number(
        item?.year ||
        item?.release_year ||
        item?.tmdb?.release_date?.slice?.(0, 4) ||
        0
    );

return Number.isFinite(y)
    ? y
    : 0;

}

function decadeOf(item) {

const year =
    itemYear(item);

if (!year) {
    return null;
}

return Math.floor(year / 10) * 10;

}

function stableHash(text) {

const str =
    String(text || "");

let hash = 2166136261;

for (let i = 0; i < str.length; i++) {

    hash ^= str.charCodeAt(i);

    hash =
        Math.imul(
            hash,
            16777619
        );
}

return hash >>> 0;

}

function stableShuffle(items, seed) {

return [...items]
    .sort(
        (a, b) =>
            stableHash(
                seed +
                "|" +
                catalogKey(a)
            ) -
            stableHash(
                seed +
                "|" +
                catalogKey(b)
            )
    );

}

async function catalogFetch(url) {

console.log(
    "[CATALOG API] Request:",
    url
);

try {

    const res =
        await axios.get(
            url,
            {
                timeout: 10000,

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
        "[CATALOG API] Items:",
        Array.isArray(items)
            ? items.length
            : 0
    );

    return Array.isArray(items)
        ? items
        : [];

} catch (e) {

    console.error(
        "[CATALOG API ERROR]",
        url,
        e?.response?.status ||
        e?.message ||
        e
    );

    return [];
}

}

/* ============================================================
MOVIE TRENDING
============================================================ */

async function fetchMovieTrending() {

const pages = [];

for (let page = 1; page <= 3; page++) {

    pages.push(
        catalogFetch(
            "https://phimapi.com/v1/api/" +
            "danh-sach/phim-chieu-rap" +
            "?page=" +
            page +
            "&limit=24"
        )
    );
}

const groups =
    await Promise.all(pages);

const items =
    catalogDedupe(
        groups.flat()
    );

return items
    .filter(
        item =>
            !isSeriesItem(item)
    )
    .slice(
        0,
        CATALOG_TARGET
    );

}

/* ============================================================
SERIES TRENDING
============================================================ */

/*
phim-bo-dang-chieu KHÔNG tồn tại ở endpoint hiện tại.
Dùng phim-bo + modified/year để lấy nhóm phim bộ mới nhất.
*/

async function fetchSeriesTrending() {

const pages = [];

for (let page = 1; page <= 4; page++) {

    pages.push(
        catalogFetch(
            "https://phimapi.com/v1/api/" +
            "danh-sach/phim-bo" +
            "?page=" +
            page +
            "&limit=24"
        )
    );
}

const groups =
    await Promise.all(pages);

let items =
    catalogDedupe(
        groups.flat()
    );

items =
    items
        .filter(
            item =>
                isSeriesItem(item)
        )
        .sort(
            (a, b) => {

                const ya =
                    itemYear(a);

                const yb =
                    itemYear(b);

                if (yb !== ya) {
                    return yb - ya;
                }

                const ma =
                    Date.parse(
                        a?.modified?.time ||
                        ""
                    ) || 0;

                const mb =
                    Date.parse(
                        b?.modified?.time ||
                        ""
                    ) || 0;

                return mb - ma;
            }
        );

return items.slice(
    0,
    CATALOG_TARGET
);

}

/* ============================================================
   TVB
   ============================================================ */

async function fetchTVB() {

    const seriesPages = [];
    const moviePages = [];

    /*
       Lấy nhiều trang để có đủ dữ liệu.
       Mục tiêu cuối cùng:
       50 item TOTAL, gồm cả phim bộ + phim lẻ.
    */

    for (
        let page = 1;
        page <= 6;
        page++
    ) {

        seriesPages.push(
            catalogFetch(
                "https://phimapi.com/v1/api/" +
                "danh-sach/phim-bo" +
                "?country=hong-kong" +
                "&page=" +
                page +
                "&limit=24"
            )
        );

        moviePages.push(
            catalogFetch(
                "https://phimapi.com/v1/api/" +
                "danh-sach/phim-le" +
                "?country=hong-kong" +
                "&page=" +
                page +
                "&limit=24"
            )
        );
    }

    const [
        seriesGroups,
        movieGroups
    ] =
        await Promise.all([
            Promise.all(seriesPages),
            Promise.all(moviePages)
        ]);

    const hkSeries =
        catalogDedupe(
            seriesGroups.flat()
        )
            .filter(
                item =>
                    isSeriesItem(item) &&
                    isHongKong(item)
            );

    const hkMovies =
        catalogDedupe(
            movieGroups.flat()
        )
            .filter(
                item =>
                    !isSeriesItem(item) &&
                    isHongKong(item)
            );

    console.log(
        "[TVB] HK series:",
        hkSeries.length
    );

    console.log(
        "[TVB] HK movies:",
        hkMovies.length
    );

    /*
       TVB = 50 ITEM TỔNG CỘNG.

       Cố gắng cân bằng:
       - 25 phim bộ
       - 25 phim lẻ

       Nếu một bên không đủ thì lấy phần còn thiếu
       từ bên còn lại.
    */

    const targetSeries =
        Math.min(
            25,
            hkSeries.length
        );

    const targetMovies =
        Math.min(
            25,
            hkMovies.length
        );

    let selectedSeries =
        stableShuffle(
            hkSeries,
            "tvb|series"
        ).slice(
            0,
            targetSeries
        );

    let selectedMovies =
        stableShuffle(
            hkMovies,
            "tvb|movies"
        ).slice(
            0,
            targetMovies
        );

    let result =
        catalogDedupe([
            ...selectedSeries,
            ...selectedMovies
        ]);

    /*
       Nếu chưa đủ 50 vì một bên không có đủ,
       lấy thêm từ bên còn lại.
    */

    if (
        result.length <
        CATALOG_TARGET
    ) {

        const used =
            new Set(
                result.map(
                    catalogKey
                )
            );

        const fallback =
            catalogDedupe([
                ...hkSeries,
                ...hkMovies
            ])
                .filter(
                    item =>
                        !used.has(
                            catalogKey(item)
                        )
                );

        result.push(
            ...stableShuffle(
                fallback,
                "tvb|fallback"
            )
        );
    }

    /*
       Cuối cùng chỉ giữ đúng 50.
    */

    result =
        catalogDedupe(
            result
        ).slice(
            0,
            CATALOG_TARGET
        );

    /*
       Trộn thứ tự phim bộ + phim lẻ
       để hàng TVB không bị chia thành
       25 bộ rồi 25 lẻ.
    */

    result =
        stableShuffle(
            result,
            "tvb|final"
        );

    console.log(
        "[TVB] Final:",
        result.length,
        "| Series:",
        result.filter(
            isSeriesItem
        ).length,
        "| Movies:",
        result.filter(
            item =>
                !isSeriesItem(item)
        ).length
    );

    return result;
}

/* ============================================================
DAILY
============================================================ */

async function fetchDailyCatalog() {

const today =
    new Date()
        .toISOString()
        .slice(0, 10);

console.log(
    "[DAILY] Date:",
    today
);

const sources = [];

for (let page = 1; page <= 5; page++) {

    sources.push(
        catalogFetch(
            "https://phimapi.com/v1/api/" +
            "danh-sach/phim-le" +
            "?page=" +
            page +
            "&limit=24"
        )
    );

    sources.push(
        catalogFetch(
            "https://phimapi.com/v1/api/" +
            "danh-sach/phim-bo" +
            "?page=" +
            page +
            "&limit=24"
        )
    );
}

const animationPages = [];

for (let page = 1; page <= 3; page++) {

    animationPages.push(
        catalogFetch(
            "https://phimapi.com/v1/api/" +
            "danh-sach/hoat-hinh" +
            "?page=" +
            page +
            "&limit=24"
        )
    );
}

const [
    normalGroups,
    animationGroups
] =
    await Promise.all([
        Promise.all(sources),
        Promise.all(animationPages)
    ]);

let normal =
    catalogDedupe(
        normalGroups.flat()
    );

const animation =
    catalogDedupe(
        animationGroups.flat()
    );

/*
   DAILY:
   - chính xác 50 item
   - chỉ 1 animation
   - 49 item còn lại chia đều theo từng thập niên
   - series/movie vẫn lấy từ cả hai nguồn
*/

const decadePools =
    new Map();

for (const item of normal) {

    if (isAnimation(item)) {
        continue;
    }

    const decade =
        decadeOf(item);

    if (!decade) {
        continue;
    }

    if (!decadePools.has(decade)) {
        decadePools.set(
            decade,
            []
        );
    }

    decadePools
        .get(decade)
        .push(item);
}

/*
   Các thập niên có dữ liệu.
   Chia 49 vị trí gần đều nhau.
*/

const decades =
    Array.from(
        decadePools.keys()
    )
        .sort(
            (a, b) =>
                b - a
        );

console.log(
    "[DAILY] Decades:",
    decades.join(", ")
);

const targetNormal = 49;

const selected = [];

/*
   Chia đều trước.
   Ví dụ 7 thập niên:
   7,7,7,7,7,7,7 = 49
   Nếu số thập niên thay đổi,
   phần dư sẽ được phân bổ ổn định.
*/

const base =
    decades.length > 0
        ? Math.floor(
            targetNormal /
            decades.length
        )
        : 0;

let remainder =
    decades.length > 0
        ? targetNormal %
            decades.length
        : 0;

for (const decade of decades) {

    const pool =
        stableShuffle(
            decadePools.get(decade),
            today +
            "|" +
            decade
        );

    let take =
        base;

    if (remainder > 0) {
        take++;
        remainder--;
    }

    selected.push(
        ...pool.slice(
            0,
            take
        )
    );
}

/*
   Nếu một thập niên không đủ phim,
   bù từ các thập niên còn dư.
*/

let result =
    catalogDedupe(
        selected
    );

if (result.length < targetNormal) {

    const used =
        new Set(
            result.map(
                catalogKey
            )
        );

    const fallback =
        normal
            .filter(
                item =>
                    !isAnimation(item) &&
                    !used.has(
                        catalogKey(item)
                    )
            );

    result.push(
        ...stableShuffle(
            fallback,
            today +
            "|fallback"
        )
    );
}

result =
    catalogDedupe(
        result
    ).slice(
        0,
        targetNormal
    );

/*
   Chỉ lấy ĐÚNG 1 animation.
   Ưu tiên animation Nhật nếu có.
*/

const japaneseAnimation =
    animation.filter(
        item =>
            isJapanese(item)
    );

const otherAnimation =
    animation.filter(
        item =>
            !isJapanese(item)
    );

const oneAnimation =
    stableShuffle(
        japaneseAnimation.length
            ? japaneseAnimation
            : otherAnimation,
        today +
        "|animation"
    )[0];

if (oneAnimation) {
    result.push(
        oneAnimation
    );
}

result =
    stableShuffle(
        catalogDedupe(result),
        today +
        "|daily-final"
    ).slice(
        0,
        CATALOG_TARGET
    );

console.log(
    "[DAILY] Normal:",
    result.filter(
        x =>
            !isAnimation(x)
    ).length,
    "| Animation:",
    result.filter(
        x =>
            isAnimation(x)
    ).length
);

return result;

}

/* ============================================================
ANIMATION NEW
============================================================ */

async function fetchAnimationNew() {

const pages = [];

for (let page = 1; page <= 6; page++) {

    pages.push(
        catalogFetch(
            "https://phimapi.com/v1/api/" +
            "danh-sach/hoat-hinh" +
            "?page=" +
            page +
            "&limit=24"
        )
    );
}

const groups =
    await Promise.all(
        pages
    );

const items =
    catalogDedupe(
        groups.flat()
    );

/*
   50 item:
   Nhật 40%
   Mỹ / Âu Mỹ 40%
   Trung + nước khác 20%
*/

const japanese =
    items.filter(
        item =>
            isJapanese(item)
    );

const western =
    items.filter(
        item =>
            !isJapanese(item) &&
            isAmericanWestern(item)
    );

const other =
    items.filter(
        item =>
            !isJapanese(item) &&
            !isAmericanWestern(item)
    );

/*
   Mỗi nhóm 25 / 20 / 10 tương ứng
   với 40% / 40% / 20% sau khi
   tổng mục tiêu là 50.

   Ở đây 40% Nhật = 20,
   40% Mỹ = 20,
   20% còn lại = 10.
*/

let japanSelected =
    stableShuffle(
        japanese,
        "anime|japan"
    ).slice(
        0,
        20
    );

let westernSelected =
    stableShuffle(
        western,
        "anime|western"
    ).slice(
        0,
        20
    );

let otherSelected =
    stableShuffle(
        other,
        "anime|other"
    ).slice(
        0,
        10
    );

/*
   Nếu nguồn Nhật/Mỹ không đủ,
   bù bằng nhóm còn lại để vẫn có 50.
*/

let result =
    catalogDedupe([
        ...japanSelected,
        ...westernSelected,
        ...otherSelected
    ]);

if (result.length < CATALOG_TARGET) {

    const used =
        new Set(
            result.map(
                catalogKey
            )
        );

    const fallback =
        items.filter(
            item =>
                !used.has(
                    catalogKey(item)
                )
        );

    result.push(
        ...stableShuffle(
            fallback,
            "anime|fallback"
        )
    );
}

result =
    catalogDedupe(
        result
    ).slice(
        0,
        CATALOG_TARGET
    );

console.log(
    "[ANIME] Japan:",
    result.filter(
        isJapanese
    ).length,
    "| Western:",
    result.filter(
        item =>
            isAmericanWestern(item)
        ).length,
    "| Other:",
    result.filter(
        item =>
            !isJapanese(item) &&
            !isAmericanWestern(item)
    ).length
);

return result;

}

/* ============================================================
CATALOG META
============================================================ */

function makeCatalogMeta(
item,
forcedType = null
) {

const type =
    forcedType ||
    (
        isSeriesItem(item)
            ? "series"
            : "movie"
    );

const poster =
    catalogPoster(item);

const imdbId =
    item?.imdb?.id ||
    item?.imdb_id ||
    item?.imdb?.id ||
    "";

let imdbRating = null;

const rawRating =
    item?.imdb?.vote_average ??
    item?.imdb?.rating ??
    item?.tmdb?.vote_average ??
    null;

if (
    rawRating !== null &&
    rawRating !== undefined &&
    rawRating !== ""
) {

    const parsed =
        Number(
            rawRating
        );

    if (
        Number.isFinite(parsed) &&
        parsed > 0
    ) {
        imdbRating =
            Math.round(
                parsed * 10
            ) / 10;
    }
}

return {

    id:
        "vnwpsw:" +
        encodeURIComponent(
            String(
                item?.name ||
                item?.origin_name ||
                ""
            )
        ),

    type:

        type,

    name:
        item?.name ||
        item?.origin_name ||
        "Unknown",

    poster:
        poster,

    posterShape:
        "poster",

    releaseInfo:
        item?.year
            ? String(
                item.year
            )
            : undefined,

    imdbRating:
        imdbRating !== null
            ? imdbRating
            : undefined
};

}

/* ============================================================
   DEFINE CATALOG HANDLER
   ============================================================ */

builder.defineCatalogHandler(
    async args => {

        console.log(
            "[CATALOG] type:",
            args.type,
            "id:",
            args.id,
            "search:",
            args.extra?.search ||
            ""
        );

        try {

            let items = [];
            let forcedType = null;

            /* ========================================================
               MOVIE TRENDING
               ======================================================== */

            if (
                args.id ===
                "pa_movies_trending"
            ) {

                console.log(
                    "[CATALOG] Mode: MOVIE TRENDING"
                );

                items =
                    await fetchMovieTrending();

                forcedType =
                    "movie";

            /* ========================================================
               SERIES TRENDING
               ======================================================== */

            } else if (
                args.id ===
                "pa_series_trending"
            ) {

                console.log(
                    "[CATALOG] Mode: SERIES TRENDING"
                );

                items =
                    await fetchSeriesTrending();

                forcedType =
                    "series";

            /* ========================================================
               TVB
               ======================================================== */

            } else if (
                args.id ===
                "pa_tvb"
            ) {

                console.log(
                    "[CATALOG] Mode: TVB"
                );

                /*
                   TVB = 50 item tổng cộng.
                   Bao gồm cả phim bộ + phim lẻ.
                */

                items =
                    await fetchTVB();

                /*
                   Không ép type.
                   Mỗi item sẽ tự xác định movie/series
                   trong makeCatalogMeta().
                */

                forcedType =
                    null;

            /* ========================================================
               DAILY
               ======================================================== */

            } else if (
                args.id ===
                "pa_daily"
            ) {

                console.log(
                    "[CATALOG] Mode: DAILY"
                );

                items =
                    await fetchDailyCatalog();

            /* ========================================================
               ANIMATION NEW
               ======================================================== */

            } else if (
                args.id ===
                "pa_animation_new"
            ) {

                console.log(
                    "[CATALOG] Mode: ANIME NEW"
                );

                items =
                    await fetchAnimationNew();

            /* ========================================================
               UNKNOWN
               ======================================================== */

            } else {

                console.log(
                    "[CATALOG] Unknown catalog:",
                    args.id
                );

                return {
                    metas: []
                };
            }

            /* ========================================================
               SEARCH
               ======================================================== */

            if (
                args.extra?.search
            ) {

                const q =
                    catalogNormalize(
                        args.extra.search
                    );

                items =
                    items.filter(
                        item => {

                            const text =
                                catalogNormalize(
                                    [
                                        item?.name,
                                        item?.origin_name,
                                        item?.original_name
                                    ]
                                        .filter(Boolean)
                                        .join(" ")
                                );

                            return text.includes(
                                q
                            );
                        }
                    );
            }

            /* ========================================================
               TYPE FILTER
               ======================================================== */

            /*
               Chỉ ép type cho hai catalog
               vốn đã có type cố định.

               TVB KHÔNG được lọc ở đây vì TVB
               chứa cả movie + series.
            */

            if (
                args.id ===
                "pa_movies_trending"
            ) {

                items =
                    items.filter(
                        item =>
                            !isSeriesItem(item)
                    );

            } else if (
                args.id ===
                "pa_series_trending"
            ) {

                items =
                    items.filter(
                        item =>
                            isSeriesItem(item)
                    );
            }

            /* ========================================================
               BUILD METAS
               ======================================================== */

            const metas =
                items
                    .slice(
                        0,
                        CATALOG_TARGET
                    )
                    .map(
                        item =>
                            makeCatalogMeta(
                                item,
                                forcedType
                            )
                    )
                    .filter(
                        meta =>
                            meta.id &&
                            meta.name
                    );

            /* ========================================================
               LOG
               ======================================================== */

            console.log(
                "[CATALOG] Items:",
                items.length
            );

            console.log(
                "[CATALOG] Metas:",
                metas.length
            );

            console.log(
                "[CATALOG] Movies:",
                metas.filter(
                    x =>
                        x.type === "movie"
                ).length,
                "| Series:",
                metas.filter(
                    x =>
                        x.type === "series"
                ).length,
                "| Posters:",
                metas.filter(
                    x =>
                        !!x.poster
                ).length
            );

            return {
                metas
            };

        } catch (e) {

            console.error(
                "[CATALOG ERROR]",
                e?.message ||
                e
            );

            return {
                metas: []
            };
        }
    }
);

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

        const rawId =
            String(args.id || "").trim();

        if (!rawId) {
            return { meta: null };
        }

        // =====================================================
        // 1. GIẢI MÃ TÊN PHIM
        // =====================================================

        let movieName = "";

        if (rawId.startsWith("vnwpsw:")) {

            movieName =
                decodeURIComponent(
                    rawId.substring(
                        "vnwpsw:".length
                    )
                );

        } else if (rawId.startsWith("tt")) {

            const imdbId =
                rawId.split(":")[0];

            try {

                const cinemetaRes =
                    await axios.get(
                        "https://v3-cinemeta.strem.io/meta/" +
                        (
                            args.type === "series"
                                ? "series"
                                : "movie"
                        ) +
                        "/" +
                        encodeURIComponent(imdbId) +
                        ".json",
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
                    cinemetaRes.data?.meta?.name ||
                    "";

            } catch (e) {

                console.log(
                    "[META CINEMETA ERROR]",
                    e?.response?.status ||
                    e?.message ||
                    e
                );

            }

        } else {

            movieName =
                decodeMovieName(
                    rawId
                );

        }

        movieName =
            String(movieName || "")
                .replace(/\s+/g, " ")
                .trim();

        console.log(
            "[META] Movie:",
            movieName
        );

        if (!movieName) {
            return { meta: null };
        }

        // =====================================================
        // 2. TÌM PHIM TRÊN PHIMAPI
        // =====================================================

        const searchUrl =
            "https://phimapi.com/v1/api/tim-kiem?keyword=" +
            encodeURIComponent(movieName) +
            "&limit=10";

        console.log(
            "[META] Search URL:",
            searchUrl
        );

        const searchRes =
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
            searchRes.data?.data?.items ||
            searchRes.data?.items ||
            [];

        console.log(
            "[META] Search items:",
            Array.isArray(items)
                ? items.length
                : 0
        );

        // =====================================================
        // 3. CHỌN KẾT QUẢ KHỚP TÊN
        // =====================================================

        const normalizedName =
            movieName
                .toLowerCase()
                .replace(/[^\p{L}\p{N}]+/gu, " ")
                .replace(/\s+/g, " ")
                .trim();

        let item = null;

        if (Array.isArray(items)) {

            // -------------------------------------------------
            // A. TÊN VIỆT KHỚP CHÍNH XÁC
            // -------------------------------------------------

            item =
                items.find(x => {

                    const name =
                        String(
                            x?.name || ""
                        )
                            .toLowerCase()
                            .replace(
                                /[^\p{L}\p{N}]+/gu,
                                " "
                            )
                            .replace(
                                /\s+/g,
                                " "
                            )
                            .trim();

                    return (
                        name &&
                        name === normalizedName
                    );

                });

            // -------------------------------------------------
            // B. TÊN GỐC KHỚP CHÍNH XÁC
            // -------------------------------------------------

            if (!item) {

                item =
                    items.find(x => {

                        const origin =
                            String(
                                x?.origin_name ||
                                x?.original_name ||
                                ""
                            )
                                .toLowerCase()
                                .replace(
                                    /[^\p{L}\p{N}]+/gu,
                                    " "
                                )
                                .replace(
                                    /\s+/g,
                                    " "
                                )
                                .trim();

                        return (
                            origin &&
                            origin === normalizedName
                        );

                    });

            }

            // -------------------------------------------------
            // C. alternative_names
            // -------------------------------------------------

            if (!item) {

                item =
                    items.find(x => {

                        const alternatives =
                            Array.isArray(
                                x?.alternative_names
                            )
                                ? x.alternative_names
                                : [];

                        return alternatives.some(
                            alt => {

                                const normalizedAlt =
                                    String(
                                        alt || ""
                                    )
                                        .toLowerCase()
                                        .replace(
                                            /[^\p{L}\p{N}]+/gu,
                                            " "
                                        )
                                        .replace(
                                            /\s+/g,
                                            " "
                                        )
                                        .trim();

                                return (
                                    normalizedAlt ===
                                    normalizedName
                                );

                            }
                        );

                    });

            }

            // -------------------------------------------------
            // D. KHÔNG CÓ KHỚP TUYỆT ĐỐI
            //    → chỉ dùng kết quả đầu nếu tìm kiếm
            //      thực sự trả về.
            // -------------------------------------------------

            if (!item && items.length > 0) {
                item = items[0];
            }

        }

        if (!item) {

            console.log(
                "[META] Không tìm thấy:",
                movieName
            );

            return {
                meta: {
                    id: rawId,

                    type:
                        args.type === "series"
                            ? "series"
                            : "movie",

                    name:
                        movieName
                }
            };

        }

        console.log(
            "[META] Selected:",
            item.name,
            "|",
            item.origin_name || "",
            "|",
            item.year || ""
        );

        // =====================================================
        // 4. LẤY DETAIL PHIM
        // =====================================================

        let detail = item;

        const slug =
            item.slug ||
            "";

        if (slug) {

            try {

                const detailRes =
                    await axios.get(
                        "https://phimapi.com/v1/api/phim/" +
                        encodeURIComponent(slug),
                        {
                            timeout: 10000,

                            headers: {
                                "User-Agent":
                                    "Mozilla/5.0",
                                "Accept":
                                    "application/json"
                            }
                        }
                    );

                detail =
                    detailRes.data?.data?.item ||
                    detailRes.data?.item ||
                    detail;

                console.log(
                    "[META] Detail OK:",
                    detail?.name ||
                    item.name
                );

            } catch (e) {

                console.log(
                    "[META DETAIL ERROR]",
                    e?.response?.status ||
                    e?.message ||
                    e
                );

            }

        }

        // =====================================================
        // 5. XÁC ĐỊNH TYPE THỰC
        // =====================================================

        const sourceType =
            String(
                detail?.type ||
                item?.type ||
                ""
            ).toLowerCase();

        const isSeries =
            args.type === "series" ||
            sourceType === "series" ||
            sourceType === "tvshows";

        const metaType =
            isSeries
                ? "series"
                : "movie";

        // =====================================================
        // 6. POSTER
        // =====================================================

        const poster =
            makePosterUrl(detail) ||
            makePosterUrl(item);

        // =====================================================
        // 7. BACKGROUND
        // =====================================================

        let background = "";

        if (
            detail?.thumb_url &&
            typeof detail.thumb_url === "string"
        ) {

            if (
                detail.thumb_url.startsWith("http")
            ) {

                background =
                    detail.thumb_url;

            }

        }

        // =====================================================
        // 8. NỘI DUNG THẬT
        // =====================================================

        let description =
            detail?.content ||
            item?.content ||
            "";

        description =
            String(description || "")
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<\/p>/gi, "\n")
                .replace(/<[^>]*>/g, "")
                .replace(/&nbsp;/gi, " ")
                .replace(/&amp;/gi, "&")
                .replace(/&quot;/gi, '"')
                .replace(/&#39;/gi, "'")
                .replace(/\n{3,}/g, "\n\n")
                .trim();

        if (!description) {

            description =
                "Đang cập nhật nội dung phim.";

        }

        // =====================================================
        // 9. IMDb
        // =====================================================

        let imdbRating = null;

        let imdbId =
            detail?.imdb?.id ||
            item?.imdb?.id ||
            "";

        const rawImdbRating =
            detail?.imdb?.vote_average ??
            item?.imdb?.vote_average ??
            null;

        if (
            rawImdbRating !== null &&
            rawImdbRating !== undefined &&
            rawImdbRating !== ""
        ) {

            const parsed =
                Number(
                    rawImdbRating
                );

            if (
                Number.isFinite(parsed) &&
                parsed > 0
            ) {

                imdbRating =
                    Math.round(
                        parsed * 10
                    ) / 10;

            }

        }

        // =====================================================
        // 10. NẾU PHIMAPI KHÔNG CÓ IMDb
        //     → THỬ CINEMETA BẰNG IMDb ID
        // =====================================================

        if (
            imdbId &&
            imdbRating === null
        ) {

            try {

                const cmRes =
                    await axios.get(
                        "https://v3-cinemeta.strem.io/meta/" +
                        metaType +
                        "/" +
                        encodeURIComponent(imdbId) +
                        ".json",
                        {
                            timeout: 8000
                        }
                    );

                const cmMeta =
                    cmRes.data?.meta ||
                    {};

                const cmRating =
                    Number(
                        cmMeta.imdbRating
                    );

                if (
                    Number.isFinite(cmRating) &&
                    cmRating > 0
                ) {

                    imdbRating =
                        cmRating;

                }

            } catch (e) {

                console.log(
                    "[META IMDb ERROR]",
                    e?.response?.status ||
                    e?.message ||
                    e
                );

            }

        }

        console.log(
            "[META] IMDb:",
            imdbId ||
            "N/A",
            "| rating:",
            imdbRating ??
            "N/A"
        );

        // =====================================================
        // 11. THỂ LOẠI
        // =====================================================

        const genres =
            Array.isArray(
                detail?.category
            )
                ? detail.category
                    .map(x =>
                        typeof x === "string"
                            ? x
                            : x?.name
                    )
                    .filter(Boolean)
                : (
                    Array.isArray(
                        item?.category
                    )
                        ? item.category
                            .map(x =>
                                typeof x === "string"
                                    ? x
                                    : x?.name
                            )
                            .filter(Boolean)
                        : undefined
                );

        // =====================================================
        // 12. VIDEOS CHO SERIES
        //
        // Đây là phần QUAN TRỌNG nhất:
        //
        // Stremio sẽ hiển thị:
        //
        //   Mùa 1
        //      Tập 1
        //      Tập 2
        //      Tập 3
        //
        // Sau khi chọn tập → mới gọi STREAM.
        // =====================================================

        let videos = undefined;

        if (isSeries) {

            const episodeMap =
                new Map();

            const episodeGroups =
                Array.isArray(
                    detail?.episodes
                )
                    ? detail.episodes
                    : [];

            for (
                const group
                of episodeGroups
            ) {

                const serverData =
                    Array.isArray(
                        group?.server_data
                    )
                        ? group.server_data
                        : [];

                for (
                    const ep
                    of serverData
                ) {

                    const rawEpisodeName =
                        String(
                            ep?.name ||
                            ep?.slug ||
                            ""
                        ).trim();

                    if (!rawEpisodeName) {
                        continue;
                    }

                    // -------------------------------------------------
                    // Lấy số tập:
                    // "Tập 1"
                    // "01"
                    // "Episode 1"
                    // "Ep 1"
                    // "1"
                    // -------------------------------------------------

                    const match =
                        rawEpisodeName.match(
                            /(?:tập|tap|episode|ep)?\s*0*(\d+)\b/i
                        );

                    if (!match) {

                        // "Full" không phải episode của series
                        continue;

                    }

                    const episodeNumber =
                        Number(
                            match[1]
                        );

                    if (
                        !Number.isFinite(
                            episodeNumber
                        ) ||
                        episodeNumber <= 0
                    ) {
                        continue;
                    }

                    if (
                        !episodeMap.has(
                            episodeNumber
                        )
                    ) {

                        episodeMap.set(
                            episodeNumber,
                            {
                                number:
                                    episodeNumber,

                                name:
                                    rawEpisodeName
                            }
                        );

                    }

                }

            }

            videos =
                Array.from(
                    episodeMap.values()
                )
                    .sort(
                        (a, b) =>
                            a.number -
                            b.number
                    )
                    .map(ep => {

                        const videoId =
                            rawId +
                            ":1:" +
                            ep.number;

                        return {

                            id:
                                videoId,

                            title:
                                "Tập " +
                                ep.number,

                            season:
                                1,

                            number:
                                ep.number,

                            name:
                                "Tập " +
                                ep.number
                        };

                    });

            console.log(
                "[META] Series episodes:",
                videos.length
            );

        }

        // =====================================================
        // 13. META HOÀN CHỈNH
        // =====================================================

        const meta = {

            id:
                rawId,

            type:
                metaType,

            name:
                detail?.name ||
                item?.name ||
                movieName,

            poster:
                poster,

            posterShape:
                "poster",

            background:
                background ||
                undefined,

            description:
                description,

            releaseInfo:
                detail?.year
                    ? String(
                        detail.year
                    )
                    : (
                        item?.year
                            ? String(
                                item.year
                            )
                            : undefined
                    ),

            imdbRating:
                imdbRating !== null
                    ? imdbRating
                    : undefined,

            genres:
                genres,

            country:
                Array.isArray(
                    detail?.country
                )
                    ? detail.country
                        .map(x =>
                            typeof x === "string"
                                ? x
                                : x?.name
                        )
                        .filter(Boolean)
                    : undefined,

            director:
                Array.isArray(
                    detail?.director
                )
                    ? detail.director
                        .filter(Boolean)
                    : undefined,

            cast:
                Array.isArray(
                    detail?.actor
                )
                    ? detail.actor
                        .filter(Boolean)
                    : undefined,

            runtime:
                detail?.time ||
                undefined
        };

        if (
            isSeries &&
            Array.isArray(videos)
        ) {

            meta.videos =
                videos;

        }

        console.log(
            "[META] OK:",
            meta.name,
            "| type:",
            meta.type,
            "| episodes:",
            Array.isArray(meta.videos)
                ? meta.videos.length
                : 0,
            "| IMDb:",
            meta.imdbRating ??
            "N/A"
        );

        return {
            meta
        };

    } catch (e) {

        console.error(
            "[META ERROR]",
            e?.message ||
            e
        );

        return {
            meta: null
        };

    }

});


// =====================================================
// NGUONC - API SEARCH + API DETAIL
// =====================================================

async function fetchNguonC(movieName) {

    const streams = [];

    try {

        console.log(
            "========================================"
        );

        console.log(
            "[NGUONC] START"
        );

        console.log(
            "[NGUONC] Searching via API:",
            movieName
        );

        // =================================================
        // 1. SEARCH API
        // =================================================

        const searchUrl =
            "https://phim.nguonc.com/api/films/search?keyword=" +
            encodeURIComponent(
                String(movieName || "").trim()
            );

        console.log(
            "[NGUONC] Search URL:",
            searchUrl
        );

        const searchResponse =
            await axios.get(
                searchUrl,
                {
                    timeout: 15000,

                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",

                        "Accept":
                            "application/json,text/plain,*/*",

                        "Referer":
                            "https://phim.nguonc.com/"
                    }
                }
            );

        console.log(
            "[NGUONC] Search HTTP:",
            searchResponse.status
        );

        const searchData =
            searchResponse.data;

        // =================================================
        // 2. LẤY DANH SÁCH KẾT QUẢ
        // =================================================

        let candidates = [];

        if (
            Array.isArray(
                searchData?.data
            )
        ) {

            candidates =
                searchData.data;

        } else if (
            Array.isArray(
                searchData?.items
            )
        ) {

            candidates =
                searchData.items;

        } else if (
            Array.isArray(
                searchData?.data?.items
            )
        ) {

            candidates =
                searchData.data.items;

        }

        console.log(
            "[NGUONC] Search results:",
            candidates.length
        );

        if (
            candidates.length === 0
        ) {

            console.log(
                "[NGUONC] No search results"
            );

            return streams;

        }

        // =================================================
        // 3. NORMALIZE TITLE
        // =================================================

        const normalizeTitle =
            function (value) {

                return String(
                    value || ""
                )
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(
                        /[\u0300-\u036f]/g,
                        ""
                    )
                    .replace(
                        /[^a-z0-9]+/g,
                        " "
                    )
                    .replace(
                        /\s+/g,
                        " "
                    )
                    .trim();

            };

        const wantedTitle =
            normalizeTitle(
                movieName
            );

        // =================================================
        // 4. CHỌN PHIM
        // =================================================

        let selectedMovie =
            null;

        // Exact normalized match
        selectedMovie =
            candidates.find(
                function (item) {

                    return (
                        normalizeTitle(
                            item?.name
                        ) ===
                        wantedTitle
                    );

                }
            );

        // Nếu không có exact match,
        // thử title chứa nhau
        if (
            !selectedMovie
        ) {

            selectedMovie =
                candidates.find(
                    function (item) {

                        const candidateTitle =
                            normalizeTitle(
                                item?.name
                            );

                        return (
                            candidateTitle &&
                            (
                                candidateTitle.includes(
                                    wantedTitle
                                ) ||
                                wantedTitle.includes(
                                    candidateTitle
                                )
                            )
                        );

                    }
                );

        }

        // Cuối cùng dùng kết quả đầu tiên
        if (
            !selectedMovie
        ) {

            selectedMovie =
                candidates[0];

        }

        console.log(
            "[NGUONC] Selected:",
            JSON.stringify(
                {
                    name:
                        selectedMovie?.name,

                    slug:
                        selectedMovie?.slug,

                    year:
                        selectedMovie?.year
                }
            )
        );

        const movieSlug =
            String(
                selectedMovie?.slug ||
                ""
            ).trim();

        if (
            !movieSlug
        ) {

            console.log(
                "[NGUONC] NO SLUG"
            );

            return streams;

        }

        // =================================================
        // 5. DETAIL API
        // =================================================

        const detailUrl =
            "https://phim.nguonc.com/api/film/" +
            encodeURIComponent(
                movieSlug
            );

        console.log(
            "[NGUONC] Detail URL:",
            detailUrl
        );

        const detailResponse =
            await axios.get(
                detailUrl,
                {
                    timeout: 15000,

                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",

                        "Accept":
                            "application/json,text/plain,*/*",

                        "Referer":
                            "https://phim.nguonc.com/"
                    }
                }
            );

        console.log(
            "[NGUONC] Detail HTTP:",
            detailResponse.status
        );

        const detailData =
            detailResponse.data;

        // =================================================
        // 6. CHUẨN HÓA MOVIE
        // =================================================

        const movie =
            detailData?.movie ||
            detailData?.data?.item ||
            detailData?.data ||
            {};

        const rawEpisodes =
            movie?.episodes ||
            detailData?.episodes ||
            detailData?.data?.item?.episodes ||
            [];

        console.log(
            "[NGUONC] Servers:",
            Array.isArray(
                rawEpisodes
            )
                ? rawEpisodes.length
                : 0
        );

        if (
            !Array.isArray(
                rawEpisodes
            )
        ) {

            console.log(
                "[NGUONC] Invalid episodes structure"
            );

            return streams;

        }

        // =================================================
        // 7. DUYỆT SERVER
        // =================================================

        for (
            let serverIndex = 0;
            serverIndex <
            rawEpisodes.length;
            serverIndex++
        ) {

            const server =
                rawEpisodes[
                    serverIndex
                ];

            const serverName =
                String(
                    server?.server_name ||
                    server?.name ||
                    "NguonC"
                ).trim();

            const episodes =
                server?.items ||
                server?.server_data ||
                [];

            if (
                !Array.isArray(
                    episodes
                )
            ) {

                continue;

            }

            console.log(
                "[NGUONC] Server:",
                serverName,
                "Episodes:",
                episodes.length
            );

            // =================================================
            // 8. DUYỆT EPISODE
            // =================================================

            for (
                let episodeIndex = 0;
                episodeIndex <
                episodes.length;
                episodeIndex++
            ) {

                const episode =
                    episodes[
                        episodeIndex
                    ];

                const episodeName =
                    String(
                        episode?.name ||
                        episode?.episode_name ||
                        episode?.slug ||
                        "Full"
                    ).trim();

                const embedUrl =
                    String(
                        episode?.embed ||
                        episode?.link_embed ||
                        ""
                    ).trim();

                const m3u8Url =
                    String(
                        episode?.m3u8 ||
                        episode?.link_m3u8 ||
                        ""
                    ).trim();

                console.log(
                    "[NGUONC] Episode:",
                    episodeName
                );

                console.log(
                    "[NGUONC] Embed:",
                    embedUrl ||
                    "(none)"
                );

                console.log(
                    "[NGUONC] M3U8:",
                    m3u8Url ||
                    "(none)"
                );

                // =================================================
                // 9. ƯU TIÊN M3U8 TRỰC TIẾP
                // =================================================

                if (
                    m3u8Url
                ) {

                    streams.push({

                        name:
                            "⚡ [API] NguonC " +
                            serverName,

                        title:
                            episodeName,

                        url:
                            m3u8Url,

                        behaviorHints: {
                            bingeGroup:
                                "nguonc"
                        }

                    });

                    continue;

                }

                // =================================================
                // 10. EMBED
                // =================================================

                if (
                    !embedUrl
                ) {

                    continue;

                }

                // =================================================
                // 11. THỬ RESOLVE EMBED BẰNG
                //     RESOLVER NGUONC HIỆN CÓ
                // =================================================

                try {

                    console.log(
                        "[NGUONC] Resolving embed..."
                    );

                    const resolved =
                        await resolveNguonCEmbed(
                            embedUrl,
                            "https://phim.nguonc.com/phim/" +
                            movieSlug
                        );

                    if (
                        resolved &&
                        resolved.playlist
                    ) {

                        console.log(
                            "[NGUONC] Embed resolved successfully"
                        );

                        /*
                         * Ở đây KHÔNG tự tạo URL HLS mới.
                         *
                         * Resolver/proxy NguonC hiện tại
                         * của bạn sẽ tiếp tục xử lý playlist
                         * thông qua phần proxy đã có.
                         *
                         * Tạm thời giữ embed như fallback
                         * nếu proxy route hiện tại không được
                         * expose trực tiếp từ fetch function.
                         */

                    } else {

                        console.log(
                            "[NGUONC] Embed resolver returned no playlist"
                        );

                    }

                } catch (resolveError) {

                    console.log(
                        "[NGUONC] Embed resolve error:",
                        resolveError?.message ||
                        resolveError
                    );

                }

                // =================================================
                // 12. FALLBACK EMBED
                // =================================================

                streams.push({

                    name:
                        "▶️ [NguonC] " +
                        serverName,

                    title:
                        episodeName,

                    externalUrl:
                        embedUrl,

                    behaviorHints: {
                        bingeGroup:
                            "nguonc"
                    }

                });

            }

        }

        console.log(
            "[NGUONC] FINAL STREAM COUNT:",
            streams.length
        );

        console.log(
            "[NGUONC] FINAL STREAMS:",
            JSON.stringify(
                streams
            )
        );

        console.log(
            "========================================"
        );

        return streams;

    } catch (error) {

        console.log(
            "[NGUONC ERROR]:",
            error?.response?.status ||
            error?.message ||
            error
        );

        if (
            error?.response?.data
        ) {

            console.log(
                "[NGUONC ERROR DATA]:",
                typeof error.response.data === "string"
                    ? error.response.data.slice(
                        0,
                        500
                    )
                    : JSON.stringify(
                        error.response.data
                    ).slice(
                        0,
                        500
                    )
            );

        }

        return streams;

    }

}


/* ============================================================
   KKPHiM / PHIMAPI
   YEAR + SEASON + EPISODE MATCHING
   ============================================================ */

async function fetchKKPhim(
    movieName,
    movieYear = 0,
    seasonNumber = 0,
    episodeNumber = 0,
    streamType = "movie",
    imdbId = ""
) {
    const streams = [];

    try {

        console.log("========================================");
        console.log("[KKPHIM] START");

        console.log(
            "[KKPHIM] Search:",
            movieName
        );

        console.log(
            "[KKPHIM] Target year:",
            movieYear
        );

        console.log(
            "[KKPHIM] Target season:",
            seasonNumber
        );

        console.log(
            "[KKPHIM] Target episode:",
            episodeNumber
        );

        // =================================================
// 1. IMDb LOOKUP → FALLBACK SEARCH
// =================================================

// -------------------------------------------------
// A. ƯU TIÊN TRA TRỰC TIẾP BẰNG IMDb ID
// -------------------------------------------------

let movie = null;

let imdbEpisodes = null;

if (
    imdbId
) {

    const imdbUrl =
        "https://phimapi.com/imdb/title/" +
        encodeURIComponent(
            imdbId
        );

    console.log(
        "[KKPHIM] IMDb URL:",
        imdbUrl
    );

    try {

        const imdbRes =
            await axios.get(
                imdbUrl,
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
            "[KKPHIM] IMDb HTTP:",
            imdbRes.status
        );

        const imdbData =
            imdbRes.data ||
            {};

        const imdbMovie =
            imdbData?.movie ||
            imdbData?.data?.movie ||
            imdbData?.data?.item ||
            imdbData?.item ||
            null;

        const directEpisodes =
            imdbData?.episodes ||
            imdbData?.data?.episodes ||
            imdbMovie?.episodes ||
            null;

        if (
            imdbMovie
        ) {

            movie =
                imdbMovie;

            imdbEpisodes =
                Array.isArray(
                    directEpisodes
                )
                    ? directEpisodes
                    : null;

            console.log(
                "[KKPHIM] IMDb MATCH:",
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
                        movie?.type,

                    episodes:
                        Array.isArray(
                            imdbEpisodes
                        )
                            ? imdbEpisodes.length
                            : 0
                })
            );

        } else {

            console.log(
                "[KKPHIM] IMDb lookup returned no movie"
            );

        }

    } catch (e) {

        console.log(
            "[KKPHIM] IMDb lookup error:",
            e?.response?.status ||
            e?.message ||
            e
        );

    }

}

// -------------------------------------------------
// B. FALLBACK 1: TÌM THEO NĂM + IMDb ID
// -------------------------------------------------
// Nếu endpoint /imdb/title/{id} không có dữ liệu,
// thử quét danh sách phim đúng năm.
// Mục tiêu vẫn là tìm ĐÚNG IMDb ID,
// tuyệt đối không lấy phim khác năm.
// -------------------------------------------------

if (
    !movie &&
    imdbId &&
    movieYear
) {

    const yearUrl =
        "https://phimapi.com/v1/api/nam/" +
        encodeURIComponent(
            movieYear
        ) +
        "?limit=64";

    console.log(
        "[KKPHIM] Year lookup URL:",
        yearUrl
    );

    try {

        const yearRes =
            await axios.get(
                yearUrl,
                {
                    timeout: 10000,

                    headers: {
                        "User-Agent":
                            "Mozilla/5.0",

                        "Accept":
                            "application/json"
                    }
                }
            );

        console.log(
            "[KKPHIM] Year lookup HTTP:",
            yearRes.status
        );

        const yearItems =
            yearRes.data?.data?.items ||
            yearRes.data?.items ||
            [];

        console.log(
            "[KKPHIM] Year results:",
            Array.isArray(
                yearItems
            )
                ? yearItems.length
                : "NOT ARRAY"
        );

        if (
            Array.isArray(
                yearItems
            ) &&
            yearItems.length
        ) {

            const imdbMatched =
                yearItems.find(
                    item => {

                        const itemImdb =
                            item?.imdb?.id ||
                            item?.imdb_id ||
                            item?.imdbId ||
                            "";

                        return (
                            String(
                                itemImdb
                            ).trim().toLowerCase() ===
                            String(
                                imdbId
                            ).trim().toLowerCase()
                        );

                    }
                );

            if (
                imdbMatched
            ) {

                movie =
                    imdbMatched;

                console.log(
                    "[KKPHIM] YEAR + IMDb MATCH:",
                    JSON.stringify({
                        name:
                            movie?.name,

                        origin_name:
                            movie?.origin_name,

                        slug:
                            movie?.slug,

                        year:
                            movie?.year,

                        imdb:
                            movie?.imdb?.id ||
                            movie?.imdb_id ||
                            movie?.imdbId ||
                            ""
                    })
                );

            } else {

                console.log(
                    "[KKPHIM] IMDb not found in year list:",
                    imdbId
                );

            }

        }

    } catch (e) {

        console.log(
            "[KKPHIM] Year lookup error:",
            e?.response?.status ||
            e?.message ||
            e
        );

    }

}

// -------------------------------------------------
// C. FALLBACK 2: SEARCH THEO TÊN
// -------------------------------------------------

if (
    !movie
) {

    const searchUrl =
        "https://phimapi.com/v1/api/tim-kiem?keyword=" +
        encodeURIComponent(movieName) +
        "&limit=64";

    console.log(
        "[KKPHIM] Search URL:",
        searchUrl
    );

    const res =
        await axios.get(
            searchUrl,
            {
                timeout: 10000,

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

    // =================================================
    // NORMALIZE TITLE
    // =================================================

    const normalizeTitle =
        value => {

            return String(
                value ||
                ""
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

        };

    const normalizedSearch =
        normalizeTitle(
            movieName
        );

    // =================================================
    // RANK CÁC KẾT QUẢ
    // =================================================

    const ranked =
        items.map(
            (item, index) => {

                const name =
                    normalizeTitle(
                        item?.name
                    );

                const origin =
                    normalizeTitle(
                        item?.origin_name
                    );

                const year =
                    Number(
                        item?.year
                    ) || 0;

                const type =
                    String(
                        item?.type ||
                        ""
                    ).toLowerCase();

                let score = 0;

                // -------------------------------------
                // TITLE
                // -------------------------------------

                if (
                    origin ===
                    normalizedSearch
                ) {

                    score += 1000;

                } else if (
                    name ===
                    normalizedSearch
                ) {

                    score += 900;

                } else if (
                    origin.includes(
                        normalizedSearch
                    )
                ) {

                    score += 300;

                } else if (
                    name.includes(
                        normalizedSearch
                    )
                ) {

                    score += 200;

                }

                // -------------------------------------
                // YEAR
                // -------------------------------------

                if (
                    movieYear &&
                    year === movieYear
                ) {

                    score += 3000;

                } else if (
                    movieYear &&
                    year &&
                    year !== movieYear
                ) {

                    score -= 1500;

                }

                // -------------------------------------
                // TYPE
                // -------------------------------------

                if (
                    streamType === "series" &&
                    type === "series"
                ) {

                    score += 500;

                }

                return {
                    item,
                    score,
                    index
                };

            }
        );

    ranked.sort(
        (a, b) => {

            if (
                b.score !==
                a.score
            ) {

                return (
                    b.score -
                    a.score
                );

            }

            return (
                a.index -
                b.index
            );

        }
    );

    console.log(
        "[KKPHIM] Ranked candidates:",
        ranked
            .slice(0, 10)
            .map(
                x => ({
                    name:
                        x.item?.name,

                    origin_name:
                        x.item?.origin_name,

                    year:
                        x.item?.year,

                    type:
                        x.item?.type,

                    score:
                        x.score,

                    imdb:
                        x.item?.imdb?.id ||
                        x.item?.imdb_id ||
                        ""
                })
            )
    );

    // =================================================
    // CHỌN PHIM THEO TITLE + YEAR
    // =================================================

    if (
        streamType === "series" &&
        movieYear
    ) {

        const yearMatched =
            ranked.filter(
                candidate =>
                    Number(
                        candidate?.item?.year
                    ) === Number(
                        movieYear
                    )
            );

        console.log(
            "[KKPHIM] Year matched candidates:",
            yearMatched.map(
                x => ({
                    name:
                        x.item?.name,

                    origin_name:
                        x.item?.origin_name,

                    year:
                        x.item?.year,

                    type:
                        x.item?.type,

                    score:
                        x.score
                })
            )
        );

        if (
            yearMatched.length
        ) {

            movie =
                yearMatched[0]?.item;

        } else {

            console.log(
                "[KKPHIM] NO EXACT YEAR MATCH:",
                movieYear
            );

            console.log(
                "[KKPHIM] Refusing mismatched version."
            );

            return streams;

        }

    } else {

        movie =
            ranked[0]?.item;

    }

}

// -------------------------------------------------
// KHÔNG CÓ MOVIE
// -------------------------------------------------

if (
    !movie
) {

    console.log(
        "[KKPHIM] NO MATCHED MOVIE"
    );

    return streams;

}

// =================================================
// 2. MOVIE ĐÃ ĐƯỢC CHỌN
// =================================================

// Tại thời điểm này:
// - IMDb lookup đã tìm được movie, hoặc
// - Year + IMDb đã tìm được movie, hoặc
// - Title search + year đã tìm được movie.
//
// KHÔNG chạy ranking lại ở đây.
// Đặc biệt không tham chiếu biến "items"
// vì "items" chỉ tồn tại bên trong nhánh search.

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
            movie?.type,

        imdb:
            movie?.imdb?.id ||
            movie?.imdb_id ||
            movie?.imdbId ||
            imdbId ||
            ""
    })
);


        // =================================================
        // 4. SLUG
        // =================================================

        const movieSlug =
            String(
                movie?.slug ||
                ""
            ).trim();

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

        // =================================================
        // 5. DETAIL
        // =================================================

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

        const movieData =
    detail.data?.data?.item ||
    {};

const episodes =
    Array.isArray(
        imdbEpisodes
    )
        ? imdbEpisodes
        : (
            movieData?.episodes ||
            []
        );

        console.log(
            "[KKPHIM] Movie data:",
            movieData?.name ||
            "UNKNOWN"
        );

        console.log(
            "[KKPHIM] Servers:",
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

        // =================================================
        // 6. XỬ LÝ TỪNG SERVER
        // =================================================

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
                    Array.isArray(
                        serverData
                    )
                        ? serverData.length
                        : "NOT ARRAY"
                );

                if (
                    !Array.isArray(
                        serverData
                    )
                ) {

                    return;
                }

                // =================================================
                // 7. MOVIE
                // =================================================

                if (
                    streamType !==
                    "series"
                ) {

                    serverData.forEach(
                        ep => {

                            const streamUrl =
                                ep?.link_m3u8 ||
                                ep?.m3u8_url;

                            if (
                                !streamUrl
                            ) {

                                return;
                            }

                            console.log(
                                "[KKPHIM] Movie episode:",
                                ep?.name ||
                                ep?.slug ||
                                "Full"
                            );

                            console.log(
                                "[KKPHIM] Episode URL:",
                                streamUrl
                            );

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
                                    String(
                                        streamUrl
                                    ),

                                behaviorHints: {
                                    bingeGroup:
                                        "kkphim"
                                }

                            });

                        }
                    );

                    return;
                }

                // =================================================
                // 8. SERIES → CHỈ LẤY EPISODE ĐƯỢC YÊU CẦU
                // =================================================

                const targetEpisode =
                    Number(
                        episodeNumber
                    ) || 1;

                const matchedEpisode =
                    serverData.find(
                        (
                            ep,
                            episodeIndex
                        ) => {

                            const episodeName =
                                String(
                                    ep?.name ||
                                    ep?.slug ||
                                    ""
                                ).trim();

                            // ---------------------------------
                            // Ưu tiên đọc số tập từ tên
                            // ---------------------------------

                            const match =
                                episodeName.match(
                                    /(?:tập|tap|episode|ep\.?|part|phần)\s*0*(\d+)/i
                                );

                            if (
                                match
                            ) {

                                return (
                                    Number(
                                        match[1]
                                    ) ===
                                    targetEpisode
                                );

                            }

                            // ---------------------------------
                            // Fallback theo vị trí mảng
                            // ---------------------------------

                            return (
                                episodeIndex + 1
                            ) ===
                            targetEpisode;

                        }
                    );

                if (
                    !matchedEpisode
                ) {

                    console.log(
                        "[KKPHIM] Episode not found:",
                        targetEpisode,
                        "on",
                        serverName
                    );

                    return;
                }

                const streamUrl =
                    matchedEpisode?.link_m3u8 ||
                    matchedEpisode?.m3u8_url;

                console.log(
                    "[KKPHIM] Matched episode:",
                    matchedEpisode?.name ||
                    matchedEpisode?.slug ||
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
                            matchedEpisode?.name ||
                            ("Tập " +
                                String(
                                    targetEpisode
                                ).padStart(
                                    2,
                                    "0"
                                ))
                        ) +
                        " - " +
                        serverName,

                    url:
                        String(
                            streamUrl
                        ),

                    behaviorHints: {
                        bingeGroup:
                            "kkphim"
                    }

                });

            }
        );

        // =================================================
        // 9. FINAL LOG
        // =================================================

        console.log(
            "[KKPHIM] DIRECT STREAMS:",
            streams.length
        );

        console.log(
            "[KKPHIM] FINAL STREAMS:",
            JSON.stringify(
                streams
            )
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
   VSMOV API
   SEARCH API
   DETAIL API
   ƯU TIÊN M3U8 TRỰC TIẾP
   FALLBACK EMBED
   GIỮ CẢ VIETSUB / 4K
   MATCH THEO TÊN + NĂM + SEASON + EPISODE
   ============================================================ */

async function fetchVSMov(
    movieName,
    movieYear = 0,
    seasonNumber = 0,
    episodeNumber = 0,
    streamType = "movie"
) {

    const streams = [];

    try {

        console.log(
            "========================================"
        );

        console.log(
            "[VSMOV] START"
        );

        console.log(
            "[VSMOV] Search:",
            movieName
        );

        console.log(
            "[VSMOV] Year:",
            movieYear
        );

        console.log(
            "[VSMOV] Season:",
            seasonNumber
        );

        console.log(
            "[VSMOV] Episode:",
            episodeNumber
        );

        console.log(
            "[VSMOV] Type:",
            streamType
        );

        if (!movieName) {
            return streams;
        }


        // =====================================================
// 1. TITLE VARIANTS
// =====================================================

const titleVariants = [];

const addVariant =
    value => {

        const text =
            String(
                value || ""
            ).trim();

        if (
            text &&
            !titleVariants.includes(
                text
            )
        ) {
            titleVariants.push(
                text
            );
        }

    };

addVariant(
    movieName
);

console.log(
    "[VSMOV] Title variants:",
    titleVariants
);


        // =====================================================
        // 2. SEARCH VSMOV
        // =====================================================

        const candidates = [];

        for (
            const variant
            of titleVariants
        ) {

            try {

                const searchUrl =
                    "https://vsmov.com/api/tim-kiem?keyword=" +
                    encodeURIComponent(
                        variant
                    ) +
                    "&page=1&limit=24";

                console.log(
                    "[VSMOV] Search URL:",
                    searchUrl
                );

                const res =
                    await axios.get(
                        searchUrl,
                        {
                            timeout: 8000,

                            headers: {
                                "User-Agent":
                                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

                                "Accept":
                                    "application/json"
                            }
                        }
                    );

                const data =
                    res.data ||
                    {};

                const items =
                    data?.data?.items ||
                    data?.items ||
                    data?.results ||
                    [];

                if (
                    Array.isArray(
                        items
                    )
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
                    "[VSMOV] Search error:",
                    e?.response?.status ||
                    e?.message ||
                    e
                );

            }

        }


        // =====================================================
        // 3. UNIQUE CANDIDATES
        // =====================================================

        const uniqueCandidates =
            Array.from(
                new Map(
                    candidates.map(
                        item => [
                            item.slug,
                            item
                        ]
                    )
                ).values()
            );

        console.log(
            "[VSMOV] Candidates:",
            uniqueCandidates.length
        );


        // =====================================================
        // 4. NORMALIZE HELPER
        // =====================================================

        const cleanTitle =
            value => {

                return String(
                    value || ""
                )
                    .toLowerCase()
                    .normalize(
                        "NFD"
                    )
                    .replace(
                        /[\u0300-\u036f]/g,
                        ""
                    )
                    .replace(
                        /đ/g,
                        "d"
                    )
                    .replace(
                        /[^a-z0-9]+/g,
                        " "
                    )
                    .replace(
                        /\s+/g,
                        " "
                    )
                    .trim();

            };


        const inputTitle =
            cleanTitle(
                movieName
            );


        const inputWords =
            inputTitle
                .split(" ")
                .filter(Boolean);


        // =====================================================
        // 5. RANK CANDIDATES
        // =====================================================

        const ranked =
            uniqueCandidates
                .map(
                    item => {

                        const name =
                            String(
                                item?.name ||
                                ""
                            ).trim();

                        const originName =
                            String(
                                item?.origin_name ||
                                item?.original_name ||
                                ""
                            ).trim();

                        const itemSlug =
                            String(
                                item?.slug ||
                                ""
                            ).trim();

                        const normalizedName =
                            cleanTitle(
                                name
                            );

                        const normalizedOrigin =
                            cleanTitle(
                                originName
                            );

                        const normalizedSlug =
                            cleanTitle(
                                itemSlug
                            );


                        let score = 0;


                        // -------------------------------------------------
                        // EXACT NAME
                        // -------------------------------------------------

                        if (
                            normalizedName ===
                            inputTitle
                        ) {

                            score += 1000;

                        }


                        // -------------------------------------------------
                        // EXACT ORIGINAL NAME
                        // -------------------------------------------------

                        if (
                            normalizedOrigin ===
                            inputTitle
                        ) {

                            score += 950;

                        }


                        // -------------------------------------------------
                        // NAME CONTAINS INPUT
                        // -------------------------------------------------

                        if (
                            normalizedName.includes(
                                inputTitle
                            )
                        ) {

                            score += 500;

                        }


                        // -------------------------------------------------
                        // INPUT CONTAINS NAME
                        // -------------------------------------------------

                        if (
                            inputTitle.includes(
                                normalizedName
                            )
                        ) {

                            score += 400;

                        }


                        // -------------------------------------------------
                        // ORIGINAL NAME CONTAINS INPUT
                        // -------------------------------------------------

                        if (
                            normalizedOrigin.includes(
                                inputTitle
                            )
                        ) {

                            score += 450;

                        }


                        // -------------------------------------------------
                        // WORD OVERLAP
                        // -------------------------------------------------

                        let overlap = 0;

                        for (
                            const word
                            of inputWords
                        ) {

                            if (
                                word.length < 2
                            ) {
                                continue;
                            }

                            if (
                                normalizedName.includes(
                                    word
                                ) ||
                                normalizedOrigin.includes(
                                    word
                                ) ||
                                normalizedSlug.includes(
                                    word
                                )
                            ) {

                                overlap++;

                            }

                        }

                        score +=
                            overlap * 25;


                        // -------------------------------------------------
                        // YEAR MATCH
                        // -------------------------------------------------

                        const itemYear =
                            Number(
                                item?.year ||
                                item?.release_year ||
                                item?.releaseYear ||
                                0
                            ) || 0;

                        if (
                            movieYear &&
                            itemYear
                        ) {

                            if (
                                itemYear ===
                                Number(
                                    movieYear
                                )
                            ) {

                                score += 1000;

                            } else {

                                score -= 700;

                            }

                        }


                        return {
                            item,
                            score,
                            itemYear,
                            normalizedName,
                            normalizedOrigin
                        };

                    }
                )
                .sort(
                    (
                        a,
                        b
                    ) =>
                        b.score -
                        a.score
                );


        console.log(
            "[VSMOV] RANKED:"
        );

        ranked
            .slice(
                0,
                10
            )
            .forEach(
                row => {

                    console.log(
                        " ",
                        row.item?.year ||
                        0,
                        row.item?.name ||
                        "",
                        "|",
                        row.item?.origin_name ||
                        "",
                        "| score:",
                        row.score
                    );

                }
            );


        // =====================================================
        // 6. CHỌN CANDIDATE
        // =====================================================

        let selected =
            null;


        // -----------------------------------------------------
        // A. ƯU TIÊN ĐÚNG NĂM
        // -----------------------------------------------------

        if (
            movieYear
        ) {

            const yearMatches =
                ranked.filter(
                    row =>
                        Number(
                            row.itemYear
                        ) ===
                        Number(
                            movieYear
                        )
                );

            console.log(
                "[VSMOV] Year matches:",
                yearMatches.length
            );


            // Trong nhóm đúng năm,
            // lấy title match tốt nhất.

            if (
                yearMatches.length
            ) {

                selected =
                    yearMatches[0];

            } else {

                console.log(
                    "[VSMOV] NO EXACT YEAR MATCH:",
                    movieYear
                );

            }

        }


        // -----------------------------------------------------
        // B. NẾU KHÔNG CÓ NĂM
        // -----------------------------------------------------

        if (
            !selected &&
            !movieYear
        ) {

            selected =
                ranked[0] ||
                null;

        }


        // -----------------------------------------------------
        // C. KHÔNG CHẤP NHẬN KHÁC NĂM
        // -----------------------------------------------------

        if (
            !selected
        ) {

            console.log(
                "[VSMOV] REFUSING MISMATCHED VERSION"
            );

            return streams;

        }


        const selectedMovie =
            selected.item;

        const movieSlug =
            String(
                selectedMovie?.slug ||
                ""
            ).trim();


        console.log(
            "[VSMOV] Selected:",
            selectedMovie?.name ||
            "",
            "|",
            selectedMovie?.origin_name ||
            "",
            "|",
            selectedMovie?.year ||
            0,
            "| slug:",
            movieSlug
        );


        if (
            !movieSlug
        ) {

            return streams;

        }


        // =====================================================
        // 7. DETAIL
        // =====================================================

        const detailUrl =
            "https://vsmov.com/api/phim/" +
            encodeURIComponent(
                movieSlug
            );

        console.log(
            "[VSMOV] Detail URL:",
            detailUrl
        );

        const detailRes =
            await axios.get(
                detailUrl,
                {
                    timeout: 10000,

                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

                        "Accept":
                            "application/json"
                    }
                }
            );

        const detailData =
            detailRes?.data ||
            {};

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
            "[VSMOV] Episodes:",
            episodes.length
        );


        if (
            !episodes.length
        ) {

            console.log(
                "[VSMOV] No episodes"
            );

            return streams;

        }


        // =====================================================
// 8. XỬ LÝ EPISODES
// =====================================================

// VSMov có cấu trúc:
// episodes[]
//   └── server_name
//       └── server_data[]
//           ├── episode 1
//           ├── episode 2
//           └── ...

for (
    const episodeServer
    of episodes
) {

    const serverName =
        String(
            episodeServer?.server_name ||
            episodeServer?.name ||
            "VSMov"
        )
            .replace(
                /\s+/g,
                " "
            )
            .trim();


    const serverData =
        Array.isArray(
            episodeServer?.server_data
        )
            ? episodeServer.server_data
            : [];


    console.log(
        "[VSMOV] Server:",
        serverName
    );

    console.log(
        "[VSMOV] Server episodes:",
        serverData.length
    );


    // =================================================
    // SERIES
    // =================================================

    if (
        streamType === "series"
    ) {

        const targetEpisode =
            Number(
                episodeNumber
            ) || 1;


        // ---------------------------------------------
        // TÌM ĐÚNG EPISODE
        // ---------------------------------------------

        const matchedEpisode =
            serverData.find(
                (
                    ep,
                    index
                ) => {

                    const episodeName =
                        String(
                            ep?.name ||
                            ep?.filename ||
                            ep?.slug ||
                            ""
                        ).trim();


                    let detectedEpisode =
                        0;


                    // Ví dụ:
                    // "1"
                    // "01"
                    // "Tập 1"
                    // "tap-1"
                    // "episode-1"

                    const directNumber =
                        episodeName.match(
                            /^\s*0*(\d+)\s*$/
                        );


                    if (
                        directNumber
                    ) {

                        detectedEpisode =
                            Number(
                                directNumber[1]
                            ) || 0;

                    }


                    if (
                        !detectedEpisode
                    ) {

                        const episodeMatch =
                            episodeName.match(
                                /(?:tập|tap|episode|ep\.?|part|phần)[\s_-]*0*(\d+)/i
                            );


                        if (
                            episodeMatch
                        ) {

                            detectedEpisode =
                                Number(
                                    episodeMatch[1]
                                ) || 0;

                            }

                    }


                    // Nếu API không có số rõ ràng,
                    // dùng vị trí trong server_data.

                    if (
                        !detectedEpisode
                    ) {

                        detectedEpisode =
                            index + 1;

                    }


                    return (
                        detectedEpisode ===
                        targetEpisode
                    );

                }
            );


        if (
            !matchedEpisode
        ) {

            console.log(
                "[VSMOV] Episode not found:",
                targetEpisode
            );

            continue;

        }


        const matchedName =
            String(
                matchedEpisode?.name ||
                matchedEpisode?.filename ||
                matchedEpisode?.slug ||
                ("Tập " +
                    String(
                        targetEpisode
                    ).padStart(
                        2,
                        "0"
                    ))
            ).trim();


        console.log(
            "[VSMOV] Matched episode:",
            matchedName
        );


        // =================================================
        // DIRECT M3U8
        // =================================================

        const m3u8 =
            String(
                matchedEpisode?.link_m3u8 ||
                matchedEpisode?.m3u8 ||
                ""
            ).trim();


        if (
            m3u8 &&
            /^https?:\/\//i.test(
                m3u8
            )
        ) {

            streams.push({

                name:
                    "▶️ [VSMov] " +
                    serverName,

                title:
                    "Tập " +
                    String(
                        targetEpisode
                    ).padStart(
                        2,
                        "0"
                    ),

                url:
                    m3u8,

                behaviorHints: {
                    bingeGroup:
                        "vsmov"
                }

            });


            console.log(
                "[VSMOV] M3U8:",
                m3u8
            );

            continue;

        }


        // =================================================
        // EMBED FALLBACK
        // =================================================

        const embed =
            String(
                matchedEpisode?.link_embed ||
                matchedEpisode?.embed ||
                ""
            ).trim();


        if (
            embed &&
            /^https?:\/\//i.test(
                embed
            )
        ) {

            const moviePageUrl =
                "https://vsmov.com/phim/" +
                encodeURIComponent(
                    movieSlug
                );


            const widgetUrl =
                "https://my-strem-addon.vercel.app/vsmov-player?url=" +
                encodeURIComponent(
                    embed
                ) +
                "&movie=" +
                encodeURIComponent(
                    moviePageUrl
                );


            streams.push({

                name:
                    "▶️ [VSMov] " +
                    serverName,

                title:
                    "Tập " +
                    String(
                        targetEpisode
                    ).padStart(
                        2,
                        "0"
                    ),

                externalUrl:
                    widgetUrl,

                widgetPlayer:
                    widgetUrl,

                widgetPlayerStates:
                    [
                        "replaceplayer"
                    ],

                behaviorHints: {
                    bingeGroup:
                        "vsmov"
                }

            });


            console.log(
                "[VSMOV] EMBED:",
                embed
            );

        }

    }


    // =================================================
    // MOVIE
    // =================================================

    else {

        for (
            const ep
            of serverData
        ) {

            const episodeName =
                String(
                    ep?.name ||
                    ep?.filename ||
                    "Full"
                ).trim();


            // -----------------------------------------
            // DIRECT M3U8
            // -----------------------------------------

            const m3u8 =
                String(
                    ep?.link_m3u8 ||
                    ep?.m3u8 ||
                    ""
                ).trim();


            if (
                m3u8 &&
                /^https?:\/\//i.test(
                    m3u8
                )
            ) {

                streams.push({

                    name:
                        "▶️ [VSMov] " +
                        serverName,

                    title:
                        episodeName,

                    url:
                        m3u8,

                    behaviorHints: {
                        bingeGroup:
                            "vsmov"
                    }

                });

                continue;

            }


            // -----------------------------------------
            // EMBED
            // -----------------------------------------

            const embed =
                String(
                    ep?.link_embed ||
                    ep?.embed ||
                    ""
                ).trim();


            if (
                embed &&
                /^https?:\/\//i.test(
                    embed
                )
            ) {

                const moviePageUrl =
                    "https://vsmov.com/phim/" +
                    encodeURIComponent(
                        movieSlug
                    );


                const widgetUrl =
                    "https://my-strem-addon.vercel.app/vsmov-player?url=" +
                    encodeURIComponent(
                        embed
                    ) +
                    "&movie=" +
                    encodeURIComponent(
                        moviePageUrl
                    );


                streams.push({

                    name:
                        "▶️ [VSMov] " +
                        serverName,

                    title:
                        episodeName,

                    externalUrl:
                        widgetUrl,

                    widgetPlayer:
                        widgetUrl,

                    widgetPlayerStates:
                        [
                            "replaceplayer"
                        ],

                    behaviorHints: {
                        bingeGroup:
                            "vsmov"
                    }

                });

            }

        }

    }

}


        // =====================================================
        // 10. FALLBACK MOVIE PAGE
        // =====================================================

        if (
            !streams.length
        ) {

            const moviePageUrl =
                "https://vsmov.com/phim/" +
                encodeURIComponent(
                    movieSlug
                );


            console.log(
                "[VSMOV] No direct/embed stream"
            );

            console.log(
                "[VSMOV] Movie page:",
                moviePageUrl
            );

        }


        // =====================================================
        // 11. FINAL
        // =====================================================

        console.log(
            "[VSMOV] FINAL STREAMS:",
            streams.length
        );


        return streams;


    } catch (e) {

        console.log(
            "[VSMOV ERROR]:",
            e?.response?.status ||
            e?.message ||
            e
        );

        return streams;

    }

}


/* ============================================================
   PHIM LONG TIẾNG
   Reverse-engineered from PhimLongTiengProvider
   ============================================================ */

async function scrapePhimLongTieng(movieName, episodeNumber = null, targetYear = null) {
    console.log("[PHIMLONGTIENG] Search:", movieName, "Episode:", episodeNumber, "Year:", targetYear);

    const streams = [];
    const seen = new Set();

    const timeoutMs = 20000;

    function normalizeText(s) {
        return String(s || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function slugify(s) {
        return normalizeText(s).replace(/\s+/g, "-");
    }

    function decodeHtml(s) {
        return String(s || "")
            .replace(/&amp;/g, "&")
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&#x27;/g, "'")
            .replace(/\\\//g, "/");
    }

    function absUrl(url, base) {
        try {
            return new URL(decodeHtml(url), base).href;
        } catch (_) {
            return null;
        }
    }

            function addStream(url, title, referer, sourceLabel) {

        if (!url) return;

        url = decodeHtml(url).trim();

        if (!/^https?:\/\//i.test(url)) {
            url = absUrl(
                url,
                referer || "https://www.1phim34.com/"
            );
        }

        if (!url) return;

        const key = url.trim();

        if (seen.has(key)) return;
        seen.add(key);

        // =================================================
        // XÁC ĐỊNH HOST STREAM THẬT
        // =================================================

        let streamUrl;

        try {

            streamUrl = new URL(url);

        } catch (e) {

            console.log(
                "[PHIMLONGTIENG] Invalid stream URL:",
                url
            );

            return;
        }

        const streamHost =
            streamUrl.hostname.toLowerCase();

        // =================================================
        // CHỈ PROXY CÁC SERVER PHIMLONGTIENG
        // =================================================

        const allowedHost =
            streamHost === "1phim34.com" ||
            streamHost === "www.1phim34.com" ||
            streamHost === "play.cbplay.cc" ||
            streamHost.endsWith(".cbplay.cc");

        if (!allowedHost) {

            console.log(
                "[PHIMLONGTIENG] Host không nằm trong proxy:",
                streamHost
            );

            return;
        }

        // =================================================
        // REFERER THEO HOST
        // =================================================

        let streamReferer;

        if (
            streamHost === "play.cbplay.cc" ||
            streamHost.endsWith(".cbplay.cc")
        ) {

            streamReferer =
                "https://play.cbplay.cc/";

        } else {

            streamReferer =
                "https://www.1phim34.com/";
        }

        // =================================================
        // TẠO URL PROXY VERCEL
        // =================================================

        const proxyUrl =
            "https://my-strem-addon.vercel.app/phimlongtieng/hls?url=" +
            encodeURIComponent(url);

        // =================================================
        // LOG
        // =================================================

        console.log(
            "[PHIMLONGTIENG] ADD STREAM:"
        );

        console.log(
            "  SOURCE:",
            sourceLabel
        );

        console.log(
            "  HOST:",
            streamHost
        );

        console.log(
            "  REFERER:",
            streamReferer
        );

        console.log(
            "  ORIGINAL:",
            url
        );

        console.log(
            "  PROXY:",
            proxyUrl
        );

        // ============================================================
// ADD STREAM
// ============================================================

const streamObject = {

    name:
        `⚡ [PhimLongTieng] ${sourceLabel}`,

    title:
        title ||
        `${sourceLabel} - Direct`,

    url:
        proxyUrl,

    behaviorHints: {

        // WebStremio có thể phát trực tiếp
        // thông qua URL proxy Vercel.
        notWebReady: false,

        // Cho phép Stremio gom các tập
        // của cùng nguồn vào một nhóm.
        bingeGroup:
            `phimlongtieng-${streamHost}`

    }

};

streams.push(
    streamObject
);

console.log(
    "[PHIMLONGTIENG] STREAM ADDED:"
);

console.log(
    JSON.stringify(
        streamObject,
        null,
        2
    )
);
}
    async function get(url, headers = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            return await fetch(url, {
                method: "GET",
                redirect: "follow",
                signal: controller.signal,
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
                    "Accept":
                        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    ...headers
                }
            });
        } finally {
            clearTimeout(timer);
        }
    }

    // ============================================================
    // CryptoJSAesDecrypt chính xác như site / Cloudstream
    // ============================================================

    function cryptoJSAesDecrypt(passphrase, encryptedJsonString) {
        const crypto = require("crypto");

        const obj = JSON.parse(encryptedJsonString);

        const encrypted = Buffer.from(obj.ciphertext, "base64");
        const salt = Buffer.from(obj.salt, "hex");
        const iv = Buffer.from(obj.iv, "hex");

        const key = crypto.pbkdf2Sync(
            Buffer.from(passphrase, "utf8"),
            salt,
            999,
            32,
            "sha512"
        );

        const decipher = crypto.createDecipheriv(
            "aes-256-cbc",
            key,
            iv
        );

        return Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]).toString("utf8");
    }

    // ============================================================
    // Base64 URL decoder
    // ============================================================

    function decodeBase64Url(value) {
        try {
            let s = decodeURIComponent(value || "");

            s = s.replace(/-/g, "+").replace(/_/g, "/");

            while (s.length % 4 !== 0) {
                s += "=";
            }

            return Buffer.from(s, "base64").toString("utf8");
        } catch (e) {
            console.log("[PHIMLONGTIENG] Base64 decode error:", e.message);
            return null;
        }
    }

    // ============================================================
    // Extract encrypted JSON
    // ============================================================

    function extractEncryptedJson(html) {
        const marker = "CryptoJSAesDecrypt('Encrypt', `";

        let pos = 0;
        const candidates = [];

        while (true) {
            const found = html.indexOf(marker, pos);

            if (found < 0) break;

            const start = found + marker.length;
            const end = html.indexOf("`", start);

            if (end > start) {
                const candidate = html.substring(start, end).trim();

                try {
                    const obj = JSON.parse(candidate);

                    if (
                        obj &&
                        obj.ciphertext &&
                        obj.iv &&
                        obj.salt
                    ) {
                        candidates.push(candidate);
                    }
                } catch (_) {
                    // Không phải encrypted JSON hợp lệ
                }
            }

            pos = start;
        }

        console.log(
            "[PHIMLONGTIENG] Valid encrypted JSON candidates:",
            candidates.length
        );

        if (!candidates.length) return null;

        return candidates[candidates.length - 1];
    }

    // ============================================================
    // Tìm URL play2.php?hash=...
    // ============================================================

    function extractPlay2Streams(html, baseUrl, labelPrefix = "PLAY2") {
        const found = [];
        const regex = /https?:\/\/[^"'<>\\\s]+\/play2\.php\?[^"'<>\\\s]+/gi;

        let m;

        while ((m = regex.exec(html)) !== null) {
            let url = decodeHtml(m[0]);

            url = url.replace(/[)"';,]+$/g, "");

            if (!found.includes(url)) {
                found.push(url);
            }
        }

                console.log(
            `[PHIMLONGTIENG] ${labelPrefix} play2 count:`,
            found.length
        );

        for (const play2Url of found) {
            try {
                const parsed = new URL(play2Url);

                const hash = parsed.searchParams.get("hash");

                if (!hash) {
                    console.log(
                        "[PHIMLONGTIENG] play2 WITHOUT hash:",
                        play2Url
                    );
                    continue;
                }

                const decoded = decodeBase64Url(hash);

                                console.log(
                    "[PHIMLONGTIENG] play2 decoded:",
                    decoded
                );

                if (
                    decoded &&
                    /^https?:\/\//i.test(decoded)
                ) {
                    addStream(
                        decoded,
                        `${labelPrefix} - Direct`,
                        baseUrl,
                        `${labelPrefix}`
                    );
                }
            } catch (e) {
                console.log(
                    "[PHIMLONGTIENG] play2 parse error:",
                    e.message
                );
            }
        }

        return found;
    }

    // ============================================================
    // Tìm trực tiếp các .m3u8 trong HTML/JS
    // ============================================================

    function extractDirectM3U8(html, baseUrl, label = "Direct") {
        const found = [];

        const patterns = [
            /https?:\/\/[^"'<>\\\s]+\.m3u8(?:\?[^"'<>\\\s]*)?/gi,
            /https?:\\\/\\\/[^"'<>\\\s]+\.m3u8(?:\?[^"'<>\\\s]*)?/gi
        ];

        for (const regex of patterns) {
            let m;

            while ((m = regex.exec(html)) !== null) {
                let url = m[0]
                    .replace(/\\\//g, "/")
                    .replace(/\\u0026/g, "&")
                    .replace(/[)"';,]+$/g, "");

                if (!found.includes(url)) {
                    found.push(url);
                }
            }
        }

        console.log(
            `[PHIMLONGTIENG] ${label} direct M3U8:`,
            found
        );

        for (const url of found) {
            addStream(
                url,
                `${label} - M3U8`,
                baseUrl,
                label
            );
        }

        return found;
    }

    // ============================================================
    // Tìm URL trong onclick:
    //
    // onclick="vb_load_player(this,'https://...')"
    // ============================================================

    function extractVBPlayers(html, baseUrl) {
        const players = [];

        const regex =
            /vb_load_player\s*\(\s*this\s*,\s*(['"])(.*?)\1\s*\)/gi;

        let m;

        while ((m = regex.exec(html)) !== null) {
            const raw = decodeHtml(m[2]).trim();

            if (!players.includes(raw)) {
                players.push(raw);
            }
        }

        console.log(
            "[PHIMLONGTIENG] vb_load_player explicit URLs:",
            players
        );

        for (const raw of players) {
            const url = absUrl(raw, baseUrl);

            if (!url) continue;

            console.log(
                "[PHIMLONGTIENG] VB PLAYER:",
                url
            );

            try {
                const parsed = new URL(url);

                if (
                    parsed.pathname.toLowerCase().includes("/play2.php")
                ) {
                    const hash = parsed.searchParams.get("hash");

                    if (hash) {
                        const decoded = decodeBase64Url(hash);

                        console.log(
                            "[PHIMLONGTIENG] VB play2 decoded:",
                            decoded
                        );

                        if (
                            decoded &&
                            /^https?:\/\//i.test(decoded)
                        ) {
                            addStream(
                                decoded,
                                "VB - Direct M3U8",
                                baseUrl,
                                "S1/S2"
                            );
                        }
                    }
                }
            } catch (_) {}

            if (/\.m3u8(?:[?#]|$)/i.test(url)) {
                addStream(
                    url,
                    "VB - M3U8",
                    baseUrl,
                    "VB"
                );
            }
        }

        return players;
    }

    // ============================================================
    // data-url của server
    // ============================================================

    function extractDataUrls(html, baseUrl) {
        const urls = [];

        const regex =
            /\bdata-url\s*=\s*(['"])(.*?)\1/gi;

        let m;

        while ((m = regex.exec(html)) !== null) {
            const raw = decodeHtml(m[2]).trim();

            if (!urls.includes(raw)) {
                urls.push(raw);
            }
        }

        console.log(
            "[PHIMLONGTIENG] data-url:",
            urls
        );

        for (const raw of urls) {
            const url = absUrl(raw, baseUrl);

            if (!url) continue;

            try {
                const parsed = new URL(url);

                if (
                    parsed.pathname.toLowerCase().includes("/play2.php")
                ) {
                    const hash = parsed.searchParams.get("hash");

                    if (hash) {
                        const decoded = decodeBase64Url(hash);

                        console.log(
                            "[PHIMLONGTIENG] data-url decoded:",
                            decoded
                        );

                        if (
                            decoded &&
                            /^https?:\/\//i.test(decoded)
                        ) {
                            addStream(
                                decoded,
                                "Server - Direct M3U8",
                                baseUrl,
                                "S2"
                            );
                        }
                    }
                }
            } catch (_) {}
        }
    }

    // ============================================================
// SEARCH
// ============================================================

let directUrl = "https://phimlongtieng.link";

try {

    const searchUrl =
        `${directUrl}/search/${slugify(movieName)}/`;

    console.log(
        "[PHIMLONGTIENG] Search URL:",
        searchUrl
    );

    const searchRes =
        await get(searchUrl);

    console.log(
        "[PHIMLONGTIENG] Search HTTP:",
        searchRes.status
    );

    const finalSearchUrl =
        searchRes.url || searchUrl;

    try {
        directUrl =
            new URL(finalSearchUrl).origin;
    } catch (_) {}

    console.log(
        "[PHIMLONGTIENG] directUrl:",
        directUrl
    );

    const searchHtml =
        await searchRes.text();

    // ========================================================
    // 1. LẤY TẤT CẢ SEARCH CANDIDATES
    //
    // Không loại candidate chỉ vì:
    //
    //   Journey to the West
    //        ≠
    //   Tây Du Ký
    //
    // Search chỉ có nhiệm vụ tìm ứng viên.
    // Detail page mới xác nhận phim.
    // ========================================================

    const candidates = [];

    const liRegex =
        /<li\b[^>]*>([\s\S]*?)<\/li>/gi;

    let li;

    while (
        (li = liRegex.exec(searchHtml)) !== null
    ) {

        const block =
            li[1];

        const aMatch =
            block.match(
                /<a\b[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>/i
            ) ||
            block.match(
                /<a\b[^>]*title=["']([^"']+)["'][^>]*href=["']([^"']+)["'][^>]*>/i
            );

        if (!aMatch) {
            continue;
        }

        let href;
        let title;

        if (
            /href=["'][^"']+["'][^>]*title=/i.test(
                aMatch[0]
            )
        ) {

            href =
                aMatch[1];

            title =
                aMatch[2];

        } else {

            title =
                aMatch[1];

            href =
                aMatch[2];

        }

        const text =
            block
                .replace(
                    /<[^>]+>/g,
                    " "
                )
                .replace(
                    /\s+/g,
                    " "
                )
                .trim();

        let status = "";

        if (
            /lồng tiếng|thuyết minh|uslt|ffvn/i.test(
                text
            )
        ) {

            status =
                "Lồng Tiếng";

        } else if (
            /vietsub|phụ đề/i.test(
                text
            )
        ) {

            status =
                "Vietsub";

        }

        const absoluteHref =
            absUrl(
                href,
                directUrl
            );

        if (!absoluteHref) {
            continue;
        }

        // Chỉ giữ trang phim thật.
        //
        // Loại:
        // /the-loai/...
        // /tim-phim-vietsub
        // /search/...
        //
        if (
            !/\/phim\//i.test(
                new URL(absoluteHref).pathname
            )
        ) {
            continue;
        }

        candidates.push({

            title:
                String(
                    title || ""
                ).trim(),

            href:
                absoluteHref,

            status:
                status

        });

    }

    // ========================================================
    // 2. UNIQUE CANDIDATES
    // ========================================================

    const uniqueCandidates =
        Array.from(
            new Map(
                candidates.map(
                    item => [
                        item.href,
                        item
                    ]
                )
            ).values()
        );

    console.log(
        "[PHIMLONGTIENG] Movie candidates:",
        uniqueCandidates.length
    );

    if (
        !uniqueCandidates.length
    ) {

        console.log(
            "[PHIMLONGTIENG] No movie candidates"
        );

        return [];

    }

    // ========================================================
    // 3. NORMALIZE
    // ========================================================

    const normalizePLT =
        value => {

            return String(
                value || ""
            )
                .toLowerCase()
                .normalize("NFD")
                .replace(
                    /[\u0300-\u036f]/g,
                    ""
                )
                .replace(
                    /đ/g,
                    "d"
                )
                .replace(
                    /[^a-z0-9]+/g,
                    " "
                )
                .replace(
                    /\s+/g,
                    " "
                )
                .trim();

        };

    const target =
        normalizePLT(
            movieName
        );

    const targetWords =
        target
            .split(" ")
            .filter(
                word =>
                    word.length >= 2
            );

    // ========================================================
    // 4. RANK SEARCH RESULT
    //
    // Giống tư duy VSMov / PhimHDCS:
    //
    // - exact
    // - contains
    // - reverse
    // - word overlap
    //
    // NHƯNG:
    //
    // Không dùng ranking để loại các tên Việt hóa.
    //
    // Ví dụ:
    //
    // Journey to the West
    //        ↓
    // Tây Du Ký
    //
    // vẫn được đưa vào detail validation.
    // ========================================================

    const ranked =
        uniqueCandidates
            .map(
                item => {

                    const titleNorm =
                        normalizePLT(
                            item.title
                        );

                    const hrefNorm =
                        normalizePLT(
                            item.href
                        );

                    let score =
                        0;

                    if (
                        titleNorm ===
                        target
                    ) {

                        score +=
                            5000;

                    }

                    if (
                        titleNorm.includes(
                            target
                        ) &&
                        target.length >= 4
                    ) {

                        score +=
                            2500;

                    }

                    if (
                        target.includes(
                            titleNorm
                        ) &&
                        titleNorm.length >= 4
                    ) {

                        score +=
                            1800;

                    }

                    // Word overlap
                    let overlap =
                        0;

                    for (
                        const word
                        of targetWords
                    ) {

                        if (
                            titleNorm.includes(
                                word
                            )
                        ) {

                            overlap++;

                        }

                    }

                    score +=
                        overlap * 100;

                    // URL cũng được dùng để hỗ trợ nhận diện.
                    for (
                        const word
                        of targetWords
                    ) {

                        if (
                            word.length >= 3 &&
                            hrefNorm.includes(
                                word
                            )
                        ) {

                            score +=
                                50;

                        }

                    }

                    // Ưu tiên title có dấu hiệu phiên bản
                    // rõ ràng nhưng không dùng nó để loại phim.
                    if (
                        /lồng tiếng|thuyết minh|uslt|vietsub|phụ đề|ffvn/i.test(
                            item.title +
                            " " +
                            item.status
                        )
                    ) {

                        score +=
                            10;

                    }

                    // Hạn chế phần/season khác.
                    if (
                        /(?:phần|phan)\s*(?:hai|2|ba|3|bon|4|năm|5)\b/i.test(
                            item.title
                        )
                    ) {

                        score -=
                            2500;

                    }

                    if (
                        /\b(?:part|season|mùa)\s*(?:2|3|4|5)\b/i.test(
                            item.title
                        )
                    ) {

                        score -=
                            2500;

                    }

                    return {

                        ...item,

                        score,

                        titleNorm,

                        hrefNorm

                    };

                }
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    b.score -
                    a.score
            );

    console.log(
        "[PHIMLONGTIENG] Ranked movie candidates:",
        ranked
            .slice(
                0,
                20
            )
            .map(
                item => ({
                    title:
                        item.title,

                    status:
                        item.status,

                    score:
                        item.score,

                    href:
                        item.href
                })
            )
    );

    // ========================================================
    // 5. GIỚI HẠN CANDIDATE
    //
    // Search của site thường đưa category/navigation vào.
    // Ta đã loại /the-loai/ ở trên.
    //
    // Không test vô hạn.
    //
    // 20 candidate đầu đủ để xử lý:
    //
    // Tây Du Ký:
    //   Tây Du Ký
    //   Tây Du Kí 96 USLT
    //   Tây Du Ký Thuyết Minh
    //
    // Đầu Xuân:
    //   2 version
    //
    // ========================================================

    const candidatesToTest =
        ranked.slice(
            0,
            20
        );

    console.log(
        "[PHIMLONGTIENG] Candidates to validate:",
        candidatesToTest.length
    );

    // ========================================================
    // 6. HỖ TRỢ ĐỌC NĂM TỪ DETAIL PAGE
    //
    // Search result của PhimLongTieng thường không có year.
    //
    // Vì vậy:
    //
    // SEARCH
    //   ↓
    // DETAIL
    //   ↓
    // YEAR
    //
    // Ngoài năm 4 chữ số, hỗ trợ cả:
    //
    //   Tây Du Kí 96 USLT
    //
    // → 1996
    // ========================================================

    function extractYearFromText(
        value
    ) {

        const text =
            String(
                value || ""
            );

        // Năm 4 chữ số
        const fullYear =
            text.match(
                /\b(19\d{2}|20\d{2})\b/
            );

        if (
            fullYear
        ) {

            return Number(
                fullYear[1]
            );

        }

        // Hỗ trợ năm 2 chữ số:
        //
        // 96 → 1996
        // 11 → 2011
        //
        const shortYear =
            text.match(
                /(?:^|[\s\-_.(])(\d{2})(?:[\s\-_.),]|$)/
            );

        if (
            shortYear
        ) {

            const n =
                Number(
                    shortYear[1]
                );

            if (
                n >= 40 &&
                n <= 99
            ) {

                return 1900 + n;

            }

            if (
                n >= 0 &&
                n <= 39
            ) {

                return 2000 + n;

            }

        }

        return 0;

    }

    function extractDetailYear(
        html,
        url,
        title
    ) {

        const htmlText =
            String(
                html || ""
            )
                .replace(
                    /<script[\s\S]*?<\/script>/gi,
                    " "
                )
                .replace(
                    /<style[\s\S]*?<\/style>/gi,
                    " "
                )
                .replace(
                    /<[^>]+>/g,
                    " "
                )
                .replace(
                    /\s+/g,
                    " "
                );

        // Ưu tiên các khu vực có chữ "Năm".
        const yearPatterns = [

            /năm\s*(?:sản xuất|phát hành)[^0-9]{0,80}(19\d{2}|20\d{2})/i,

            /(?:năm|year)[^0-9]{0,50}(19\d{2}|20\d{2})/i,

            /datePublished["']?\s*[:=]\s*["'](19\d{2}|20\d{2})/i,

            /releaseDate["']?\s*[:=]\s*["'](19\d{2}|20\d{2})/i

        ];

        for (
            const regex
            of yearPatterns
        ) {

            const match =
                htmlText.match(
                    regex
                );

            if (
                match
            ) {

                return Number(
                    match[1]
                );

            }

        }

        // Sau đó thử title.
        const titleYear =
            extractYearFromText(
                title
            );

        if (
            titleYear
        ) {

            return titleYear;

        }

        // Cuối cùng thử URL.
        return extractYearFromText(
            url
        );

    }

    // ========================================================
    // 7. TEST TỪNG MOVIE DETAIL
    //
    // Đây là bước quan trọng nhất.
    //
    // Không còn:
    //
    //   Relevant candidates = []
    //        ↓
    //      return []
    //
    // Mà:
    //
    //   candidate
    //      ↓
    //   movie detail
    //      ↓
    //   year
    //      ↓
    //   episodes
    //      ↓
    //   encrypted JSON
    // ========================================================

    const candidateResults =
        [];

    for (
        const selected
        of candidatesToTest
    ) {

        console.log(
            "[PHIMLONGTIENG] TEST CANDIDATE:",
            {
                title:
                    selected.title,

                status:
                    selected.status,

                score:
                    selected.score,

                href:
                    selected.href
            }
        );

        if (
            !selected.href
        ) {
            continue;
        }

        try {

            // ====================================================
            // MOVIE DETAIL
            // ====================================================

            const movieRes =
                await get(
                    selected.href,
                    {
                        Referer:
                            `${directUrl}/`
                    }
                );

            console.log(
                "[PHIMLONGTIENG] MOVIE status:",
                movieRes.status
            );

            if (
                movieRes.status &&
                Number(
                    movieRes.status
                ) >= 400
            ) {

                console.log(
                    "[PHIMLONGTIENG] Reject candidate: MOVIE HTTP",
                    movieRes.status
                );

                continue;

            }

            const movieHtml =
                await movieRes.text();

            // ====================================================
            // DETAIL TITLE
            // ====================================================

            const detailTitleMatch =
                movieHtml.match(
                    /<title[^>]*>([\s\S]*?)<\/title>/i
                );

            const detailTitle =
                detailTitleMatch
                    ? detailTitleMatch[1]
                        .replace(
                            /<[^>]+>/g,
                            " "
                        )
                        .replace(
                            /\s+/g,
                            " "
                        )
                        .trim()
                    : selected.title;

            const detailYear =
                extractDetailYear(
                    movieHtml,
                    selected.href,
                    selected.title
                );

            console.log(
                "[PHIMLONGTIENG] DETAIL:",
                {
                    searchTitle:
                        selected.title,

                    detailTitle:
                        detailTitle,

                    detailYear:
                        detailYear
                }
            );

            // ====================================================
            // YEAR VALIDATION
            //
            // Chỉ loại khi detail page xác nhận rõ năm khác.
            //
            // Nếu detail không có năm:
            //   KHÔNG loại.
            //
            // Đây là điểm quan trọng để không mất Tây Du Ký.
            // ====================================================

            if (
                targetYear &&
                detailYear
            ) {

                if (
                    detailYear !==
                    Number(
                        targetYear
                    )
                ) {

                    console.log(
                        "[PHIMLONGTIENG] Reject candidate: DETAIL YEAR MISMATCH",
                        {
                            targetYear:
                                Number(
                                    targetYear
                                ),

                            detailYear:
                                detailYear
                        }
                    );

                    continue;

                }

                console.log(
                    "[PHIMLONGTIENG] DETAIL YEAR MATCH:",
                    detailYear
                );

            }

            // ====================================================
            // EPISODES
            // ====================================================

            const episodes =
                [];

            const epLiRegex =
                /<li\b[^>]*>([\s\S]*?)<\/li>/gi;

            let ep;

            while (
                (
                    ep =
                    epLiRegex.exec(
                        movieHtml
                    )
                ) !== null
            ) {

                const block =
                    ep[1];

                const hrefMatch =
                    block.match(
                        /<a\b[^>]*href=["']([^"']+)["'][^>]*>/i
                    );

                if (
                    !hrefMatch
                ) {
                    continue;
                }

                const href =
                    absUrl(
                        hrefMatch[1],
                        selected.href
                    );

                if (
                    !href
                ) {
                    continue;
                }

                const rawText =
                    block
                        .replace(
                            /<[^>]+>/g,
                            " "
                        )
                        .replace(
                            /\s+/g,
                            " "
                        )
                        .trim();

                let number =
                    null;

                const numMatch =
                    rawText.match(
                        /(?:tập|tap|episode|ep)\s*0*(\d+)\b/i
                    ) ||
                    rawText.match(
                        /^\s*0*(\d+)\s*$/
                    );

                if (
                    numMatch
                ) {

                    number =
                        Number(
                            numMatch[1]
                        );

                }

                episodes.push({

                    name:
                        rawText ||
                        "Lồng Tiếng",

                    number,

                    href

                });

            }

            console.log(
                "[PHIMLONGTIENG] Candidate episodes:",
                episodes.length
            );

            if (
                !episodes.length
            ) {

                console.log(
                    "[PHIMLONGTIENG] Reject candidate: NO EPISODES"
                );

                continue;

            }

            // ====================================================
            // CHỈ GIỮ EPISODE THẬT
            // ====================================================

            const realEpisodes =
                episodes.filter(
                    e => {

                        if (
                            !e ||
                            !e.href
                        ) {
                            return false;
                        }

                        try {

                            const u =
                                new URL(
                                    e.href
                                );

                            return /^\/phim\/[^/]+\/tap-[^/?#]+/i.test(
                                u.pathname
                            );

                        } catch (_) {

                            return false;

                        }

                    }
                );

            console.log(
                "[PHIMLONGTIENG] REAL episodes:",
                realEpisodes.map(
                    e => ({
                        name:
                            e.name,

                        number:
                            e.number,

                        href:
                            e.href
                    })
                )
            );

            if (
                !realEpisodes.length
            ) {

                console.log(
                    "[PHIMLONGTIENG] Reject candidate: NO REAL EPISODES"
                );

                continue;

            }

            // ====================================================
            // CHỌN EPISODE
            // ====================================================

            let selectedEpisode =
                null;

            if (
                episodeNumber !== null &&
                episodeNumber !== undefined &&
                Number(
                    episodeNumber
                ) > 0
            ) {

                const wantedNumber =
                    Number(
                        episodeNumber
                    );

                selectedEpisode =
                    realEpisodes.find(
                        e =>
                            e.number ===
                            wantedNumber
                    );

                if (
                    !selectedEpisode
                ) {

                    selectedEpisode =
                        realEpisodes.find(
                            e => {

                                const text =
                                    String(
                                        e.name ||
                                        ""
                                    );

                                return new RegExp(
                                    `(?:tập|tap|episode|ep)\\s*0*${wantedNumber}\\b`,
                                    "i"
                                ).test(
                                    text
                                );

                            }
                        );

                }

            }

            // ====================================================
            // MOVIE / FULL
            // ====================================================

            if (
                !selectedEpisode
            ) {

                selectedEpisode =
                    realEpisodes.find(
                        e =>
                            /\/tap-full(?:[/?#]|$)/i.test(
                                e.href
                            )
                    ) ||
                    realEpisodes.find(
                        e =>
                            /lồng\s*tiếng|thuyết\s*minh|uslt|ffvn/i.test(
                                String(
                                    e.name ||
                                    ""
                                )
                            )
                    ) ||
                    realEpisodes.find(
                        e =>
                            /xem\s*online/i.test(
                                String(
                                    e.name ||
                                    ""
                                )
                            )
                    ) ||
                    realEpisodes[0];

            }

            if (
                !selectedEpisode
            ) {

                console.log(
                    "[PHIMLONGTIENG] Reject candidate: EPISODE NOT FOUND"
                );

                continue;

            }

            console.log(
                "[PHIMLONGTIENG] Candidate selected episode:",
                {
                    title:
                        selected.title,

                    status:
                        selected.status,

                    detailYear:
                        detailYear,

                    episode:
                        selectedEpisode.name,

                    url:
                        selectedEpisode.href
                }
            );

            // ====================================================
            // EPISODE PAGE
            // ====================================================

            const episodeRes =
                await get(
                    selectedEpisode.href,
                    {
                        Referer:
                            `${directUrl}/`
                    }
                );

            console.log(
                "[PHIMLONGTIENG] EPISODE status:",
                episodeRes.status
            );

            if (
                episodeRes.status &&
                Number(
                    episodeRes.status
                ) >= 400
            ) {

                console.log(
                    "[PHIMLONGTIENG] Reject candidate: EPISODE HTTP",
                    episodeRes.status
                );

                continue;

            }

            const episodeHtml =
                await episodeRes.text();

            // ====================================================
            // ENCRYPTED JSON
            // ====================================================

            const encryptedEpisode =
                extractEncryptedJson(
                    episodeHtml
                );

            if (
                !encryptedEpisode
            ) {

                console.log(
                    "[PHIMLONGTIENG] Reject candidate: ENCRYPTED JSON NOT FOUND"
                );

                continue;

            }

            console.log(
                "[PHIMLONGTIENG] VALID CANDIDATE:",
                {
                    title:
                        selected.title,

                    status:
                        selected.status,

                    detailYear:
                        detailYear,

                    episode:
                        selectedEpisode.name
                }
            );

            candidateResults.push({

                candidate:
                    {
                        ...selected,

                        detailTitle,

                        detailYear
                    },

                selectedEpisode,

                episodeHtml,

                encryptedEpisode,

                episodeUrl:
                    selectedEpisode.href

            });

        } catch (candidateError) {

            console.log(
                "[PHIMLONGTIENG] Candidate failed:",
                selected.title,
                "|",
                candidateError?.message ||
                candidateError
            );

        }

    }

    // ========================================================
    // 8. KHÔNG CÓ VERSION NÀO HOẠT ĐỘNG
    // ========================================================

    if (
        !candidateResults.length
    ) {

        console.log(
            "[PHIMLONGTIENG] NO VALID MOVIE VERSION"
        );

        return [];

    }

    console.log(
        "[PHIMLONGTIENG] VALID VERSIONS:",
        candidateResults.map(
            result => ({
                title:
                    result.candidate.title,

                status:
                    result.candidate.status,

                detailTitle:
                    result.candidate.detailTitle,

                year:
                    result.candidate.detailYear,

                episode:
                    result.selectedEpisode.name,

                url:
                    result.candidate.href
            })
        )
    );

    // ========================================================
    // 9. DECRYPT + PLAYER CHO TỪNG VERSION
    // ========================================================

    for (
        const result
        of candidateResults
    ) {

        const selected =
            result.candidate;

        const selectedEpisode =
            result.selectedEpisode;

        const encryptedEpisode =
            result.encryptedEpisode;

        console.log(
            "[PHIMLONGTIENG] PROCESS VERSION:",
            {
                title:
                    selected.title,

                status:
                    selected.status,

                detailTitle:
                    selected.detailTitle,

                detailYear:
                    selected.detailYear,

                movieUrl:
                    selected.href,

                episode:
                    selectedEpisode.name,

                episodeUrl:
                    selectedEpisode.href
            }
        );

        // ====================================================
        // DECRYPT
        // ====================================================

        let playerUrl =
            null;

        try {

            playerUrl =
                cryptoJSAesDecrypt(
                    "Encrypt",
                    encryptedEpisode
                ).trim();

            console.log(
                "[PHIMLONGTIENG] DECRYPTED URL:",
                playerUrl
            );

        } catch (e) {

            console.log(
                "[PHIMLONGTIENG] DECRYPT ERROR:",
                e.message
            );

            continue;

        }

        playerUrl =
            absUrl(
                playerUrl,
                directUrl
            );

        console.log(
            "[PHIMLONGTIENG] PLAYER URL:",
            playerUrl
        );

        if (
            !playerUrl
        ) {
            continue;
        }

        // ====================================================
        // PLAYER PAGE
        // ====================================================

        let playerHtml =
            "";

        let playerFinalUrl =
            playerUrl;

        try {

            const playerRes =
                await get(
                    playerUrl,
                    {
                        Referer:
                            selectedEpisode.href
                    }
                );

            console.log(
                "[PHIMLONGTIENG] PLAYER status:",
                playerRes.status
            );

            console.log(
                "[PHIMLONGTIENG] PLAYER final URL:",
                playerRes.url
            );

            if (
                playerRes.status &&
                Number(
                    playerRes.status
                ) >= 400
            ) {

                console.log(
                    "[PHIMLONGTIENG] PLAYER HTTP ERROR:",
                    playerRes.status
                );

                continue;

            }

            playerFinalUrl =
                playerRes.url ||
                playerUrl;

            playerHtml =
                await playerRes.text();

        } catch (playerError) {

            console.log(
                "[PHIMLONGTIENG] PLAYER ERROR:",
                playerError?.message ||
                playerError
            );

            continue;

        }

        console.log(
            "[PHIMLONGTIENG] PLAYER length:",
            playerHtml.length
        );

        // ====================================================
        // STREAM LABEL
        // ====================================================

        const versionLabel =
            selected.status
                ? selected.status
                : (
                    /lồng\s*tiếng|thuyết\s*minh|uslt|ffvn/i.test(
                        selected.title
                    )
                        ? "Lồng Tiếng"
                        : /vietsub|phụ đề/i.test(
                            selected.title
                        )
                            ? "Vietsub"
                            : "PhimLongTieng"
                );

        const streamPrefix =
            `▶️ [PhimLongTieng] ${versionLabel}`;

        // ====================================================
        // 1. S2 / DEFAULT PLAYER
        // ====================================================

        const beforeS2 =
            streams.length;

        extractPlay2Streams(
            playerHtml,
            playerFinalUrl,
            streamPrefix
        );

        // ====================================================
        // 2. vb_load_player
        // ====================================================

        extractVBPlayers(
            playerHtml,
            playerFinalUrl
        );

        // ====================================================
        // 3. data-url
        // ====================================================

        extractDataUrls(
            playerHtml,
            playerFinalUrl
        );

        // ====================================================
        // 4. DIRECT M3U8
        // ====================================================

        extractDirectM3U8(
            playerHtml,
            playerFinalUrl,
            streamPrefix
        );

        // ====================================================
        // 5. playerUrl ĐÃ LÀ M3U8
        // ====================================================

        if (
            /\.m3u8(?:[?#]|$)/i.test(
                playerUrl
            )
        ) {

            addStream(
                playerUrl,
                `${streamPrefix} - Decrypted M3U8`,
                playerFinalUrl,
                "S2"
            );

        }

        // ====================================================
        // 6. LOG SERVER BUTTONS
        // ====================================================

        const serverMatches = [
            ...playerHtml.matchAll(
                /<span\b[^>]*onclick=["']vb_load_player\(this,([^)]*)\)["'][^>]*>([\s\S]*?)<\/span>/gi
            )
        ];

        for (
            const match
            of serverMatches
        ) {

            const argument =
                match[1];

            const label =
                match[2]
                    .replace(
                        /<[^>]+>/g,
                        " "
                    )
                    .replace(
                        /\s+/g,
                        " "
                    )
                    .trim();

            console.log(
                "[PHIMLONGTIENG] SERVER BUTTON:",
                {
                    version:
                        versionLabel,

                    label,

                    argument
                }
            );

        }

        console.log(
            "[PHIMLONGTIENG] VERSION STREAMS:",
            {
                version:
                    versionLabel,

                title:
                    selected.title,

                detailYear:
                    selected.detailYear,

                before:
                    beforeS2,

                after:
                    streams.length
            }
        );

    }

    // ========================================================
    // FINAL
    // ========================================================

    console.log(
        "[PHIMLONGTIENG] STREAMS FOUND:",
        streams.length
    );

    console.log(
        "[PHIMLONGTIENG] FINAL STREAMS:",
        streams.map(
            s => ({
                name:
                    s.name,

                title:
                    s.title,

                url:
                    s.url
            })
        )
    );

    return streams;

    } catch (e) {
        console.log(
            "[PHIMLONGTIENG] ERROR:",
            e.message
        );

        return streams;
    }
}

/* ============================================================
   PHIMHDCS
   ============================================================ */

async function scrapePhimHDCS(
    movieName,
    movieYear = 0,
    seasonNumber = 0,
    episodeNumber = 0,
    streamType = "movie"
) {

    const streams = [];

    const BASE_URL =
        "https://phimhdcss.com";

    // ========================================================
    // HELPER
    // ========================================================

    function normalizeTitle(
        value
    ) {

        return String(
            value ||
            ""
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

    function makeAbsoluteUrl(
        value
    ) {

        let url =
            String(
                value ||
                ""
            ).trim();

        if (!url) {
            return "";
        }

        if (
            url.startsWith(
                "//"
            )
        ) {

            return "https:" +
                url;

        }

        if (
            url.startsWith(
                "http://"
            ) ||
            url.startsWith(
                "https://"
            )
        ) {

            return url;

        }

        if (
            url.startsWith(
                "/"
            )
        ) {

            return BASE_URL +
                url;

        }

        return BASE_URL +
            "/" +
            url;

    }

    function extractYear(
        value
    ) {

        const match =
            String(
                value ||
                ""
            ).match(
                /\b(19|20)\d{2}\b/
            );

        return match
            ? Number(
                match[0]
            )
            : 0;

    }

    function addFallback() {

        if (
            streams.length > 0
        ) {
            return;
        }

        streams.push({

            name:
                "🌐 [Fallback] PhimHDCS",

            title:
                "Mở trang PhimHDCS - " +
                movieName,

            externalUrl:
                BASE_URL +
                "/?search=" +
                encodeURIComponent(
                    movieName
                ).replace(
                    /%20/g,
                    "+"
                )

        });

        console.log(
            "[PHIMHDCS] SELF FALLBACK ADDED"
        );

    }

    // ========================================================
    // MAIN
    // ========================================================

    try {

        console.log(
            "[PHIMHDCS] START"
        );

        console.log(
            "[PHIMHDCS] Search:",
            movieName
        );

        console.log(
            "[PHIMHDCS] Year:",
            movieYear
        );

        console.log(
            "[PHIMHDCS] Season:",
            seasonNumber
        );

        console.log(
            "[PHIMHDCS] Episode:",
            episodeNumber
        );

        console.log(
            "[PHIMHDCS] Type:",
            streamType
        );

        // ====================================================
        // 1. SEARCH
        // ====================================================

        const searchUrl =
            BASE_URL +
            "/?search=" +
            encodeURIComponent(
                movieName
            ).replace(
                /%20/g,
                "+"
            );

        console.log(
            "[PHIMHDCS] SEARCH URL:",
            searchUrl
        );

        const searchRes =
            await axios.get(
                searchUrl,
                {
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
                        "Accept":
                            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                    },
                    timeout: 10000
                }
            );

        const searchHtml =
            String(
                searchRes.data ||
                ""
            );

        const parseSearch =
            cheerio.load(
                searchHtml
            );

        // ====================================================
        // 2. LẤY DANH SÁCH KẾT QUẢ
        // ====================================================

        const candidates = [];

        parseSearch(
            "li.item a[href]"
        ).each(
            function () {

                const node =
                    parseSearch(
                        this
                    );

                const href =
                    String(
                        node.attr(
                            "href"
                        ) ||
                        ""
                    ).trim();

                const title =
                    String(
                        node.attr(
                            "title"
                        ) ||
                        node.text() ||
                        ""
                    ).trim();

                if (
                    !href ||
                    !title
                ) {
                    return;
                }

                const url =
                    makeAbsoluteUrl(
                        href
                    );

                if (
                    !url.includes(
                        "phimhdcss.com"
                    )
                ) {
                    return;
                }

                candidates.push({

                    url:
                        url,

                    title:
                        title,

                    year:
                        extractYear(
                            title
                        )

                });

            }
        );

        // ====================================================
        // FALLBACK PARSER
        // ====================================================

        if (
            candidates.length === 0
        ) {

            const itemPattern =
                /<li\s+class="item[^"]*">[\s\S]*?<a\s+href="([^"]+)"\s+title="([^"]+)"/gi;

            let match;

            while (
                (
                    match =
                    itemPattern.exec(
                        searchHtml
                    )
                ) !== null
            ) {

                candidates.push({

                    url:
                        makeAbsoluteUrl(
                            match[1]
                        ),

                    title:
                        String(
                            match[2] ||
                            ""
                        ).trim(),

                    year:
                        extractYear(
                            match[2]
                        )

                });

            }

        }

        const uniqueCandidates =
            [];

        const seenUrls =
            new Set();

        for (
            const candidate
            of candidates
        ) {

            if (
                seenUrls.has(
                    candidate.url
                )
            ) {
                continue;
            }

            seenUrls.add(
                candidate.url
            );

            uniqueCandidates.push(
                candidate
            );

        }

        console.log(
            "[PHIMHDCS] SEARCH RESULTS:",
            uniqueCandidates.length
        );

        if (
            uniqueCandidates.length === 0
        ) {

            console.log(
                "[PHIMHDCS] NO SEARCH RESULTS"
            );

            addFallback();

            return streams;
        }

        // ====================================================
        // 3. CHỌN PHIM
        // ====================================================

        const target =
            normalizeTitle(
                movieName
            );

        let selectedMovie =
            null;

        let selectedScore =
            -Infinity;

        for (
            const candidate
            of uniqueCandidates
        ) {

            let score =
                0;

            const candidateTitle =
                normalizeTitle(
                    candidate.title
                );

            // ------------------------------------------------
            // TITLE
            // ------------------------------------------------

            if (
                candidateTitle ===
                target
            ) {

                score +=
                    1000;

            } else if (
                candidateTitle.includes(
                    target
                ) &&
                target.length >= 4
            ) {

                score +=
                    500;

            } else if (
                target.includes(
                    candidateTitle
                ) &&
                candidateTitle.length >= 4
            ) {

                score +=
                    400;

            }

            // ------------------------------------------------
            // YEAR
            // ------------------------------------------------

            if (
                movieYear > 0
            ) {

                if (
                    candidate.year ===
                    Number(
                        movieYear
                    )
                ) {

                    score +=
                        5000;

                } else if (
                    candidate.year > 0
                ) {

                    score -=
                        300;

                }

            }

            console.log(
                "[PHIMHDCS] CANDIDATE:",
                {
                    title:
                        candidate.title,
                    year:
                        candidate.year,
                    score:
                        score,
                    url:
                        candidate.url
                }
            );

            if (
                score >
                selectedScore
            ) {

                selectedScore =
                    score;

                selectedMovie =
                    candidate;

            }

        }

        if (
            !selectedMovie
        ) {

            console.log(
                "[PHIMHDCS] NO MOVIE SELECTED"
            );

            addFallback();

            return streams;
        }

        console.log(
            "[PHIMHDCS] SELECTED MOVIE:",
            selectedMovie.title,
            "|",
            selectedMovie.year,
            "|",
            selectedMovie.url
        );

        // ====================================================
        // 4. LOAD DETAIL PAGE
        // ====================================================

        const detailRes =
            await axios.get(
                selectedMovie.url,
                {
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
                        "Referer":
                            BASE_URL + "/"
                    },
                    timeout: 10000
                }
            );

        const detailHtml =
            String(
                detailRes.data ||
                ""
            );

        const parseDetail =
            cheerio.load(
                detailHtml
            );

        // ====================================================
// 5. LẤY SERVER + EPISODE
// ====================================================

const servers =
    [];


// ----------------------------------------------------
// HELPER: LẤY TÊN SERVER
// ----------------------------------------------------

function detectServerName(
    anchor
) {

    let node =
        anchor;

    for (
        let level = 0;
        level < 8 && node;
        level++
    ) {

        const text =
            String(
                parseDetail(
                    node
                ).text() ||
                ""
            )
                .replace(
                    /\s+/g,
                    " "
                )
                .trim();

        const match =
            text.match(
                /Danh sách\s+Server\s+([^:]+):/i
            );

        if (
            match
        ) {

            let serverName =
                String(
                    match[1] ||
                    ""
                ).trim();

            serverName =
                serverName
                    .replace(
                        /^Server\s+/i,
                        ""
                    )
                    .replace(
                        /^x/i,
                        ""
                    )
                    .replace(
                        /^z/i,
                        ""
                    )
                    .replace(
                        /\s*#\d+$/,
                        ""
                    )
                    .trim();

            return (
                serverName ||
                "PhimHDCS"
            );

        }

        node =
            node.parent;

    }

    return "PhimHDCS";

}


// ----------------------------------------------------
// HELPER: CHỈ NHẬN LINK EPISODE THỰC SỰ
//
// PhimHDCS hiện dùng:
//
// /phim-slug/tap-1-123456
// /phim-slug/tap-full-123456
// /phim-slug/tap-30-123456
//
// TUYỆT ĐỐI KHÔNG nhận:
// /phim-slug-123456
// /quoc-gia/...
// /the-loai/...
// /tu-khoa/...
// ----------------------------------------------------

function isEpisodeLink(
    href,
    text
) {

    const url =
        String(
            href ||
            ""
        ).trim();

    const name =
        String(
            text ||
            ""
        ).trim();

    if (
        !url
    ) {

        return false;

    }

    // -----------------------------------------------
    // Đây là điều kiện quan trọng nhất.
    //
    // Episode URL của PhimHDCS luôn có:
    //
    // /tap-
    // -----------------------------------------------

    if (
        !/\/tap-[^/?#]+/i.test(
            url
        )
    ) {

        return false;

    }

    // -----------------------------------------------
    // Chỉ chấp nhận đúng dạng episode.
    // -----------------------------------------------

    if (
        /\/tap-(?:full|\d+)(?:[-/?#]|$)/i.test(
            url
        )
    ) {

        return true;

    }

    // -----------------------------------------------
    // Một số trường hợp site có thể dùng tên tập
    // khác nhưng URL vẫn bắt đầu bằng /tap-
    // -----------------------------------------------

    if (
        /(?:tập|tap|episode|ep\.?|part|phần)/i.test(
            name
        )
    ) {

        return true;

    }

    return false;

}


// ----------------------------------------------------
// QUÉT TOÀN BỘ LINK EPISODE
// ----------------------------------------------------

const serverMap =
    new Map();

parseDetail(
    "a[href]"
).each(
    function () {

        const anchor =
            this;

        const node =
            parseDetail(
                anchor
            );

        const href =
            String(
                node.attr(
                    "href"
                ) ||
                ""
            ).trim();

        const title =
            String(
                node.attr(
                    "title"
                ) ||
                ""
            ).trim();

        const text =
            String(
                node.text() ||
                ""
            ).trim();

        const name =
            title ||
            text;

        if (
            !isEpisodeLink(
                href,
                name
            )
        ) {

            return;

        }

        const absoluteUrl =
            makeAbsoluteUrl(
                href
            );

        if (
            !absoluteUrl
        ) {

            return;

        }

        const episodeNumber =
            extractEpisodeNumber(
                name
            );

        const serverName =
            detectServerName(
                anchor
            );

        if (
            !serverMap.has(
                serverName
            )
        ) {

            serverMap.set(
                serverName,
                []
            );

        }

        const episodes =
            serverMap.get(
                serverName
            );

        const exists =
            episodes.some(
                function (
                    episode
                ) {

                    return (
                        episode.url ===
                        absoluteUrl
                    );

                }
            );

        if (
            exists
        ) {

            return;

        }

        episodes.push({

            url:
                absoluteUrl,

            name:
                name ||
                (
                    episodeNumber
                        ? "Tập " +
                          episodeNumber
                        : "Tập Full"
                ),

            number:
                episodeNumber

        });

        console.log(
            "[PHIMHDCS] EPISODE LINK:",
            {
                server:
                    serverName,

                name:
                    name,

                number:
                    episodeNumber,

                url:
                    absoluteUrl
            }
        );

    }
);


// ----------------------------------------------------
// MAP → SERVERS
// ----------------------------------------------------

for (
    const [
        serverName,
        episodes
    ]
    of serverMap.entries()
) {

    if (
        episodes.length === 0
    ) {

        continue;

    }

    // -----------------------------------------------
    // Có số tập → sắp xếp tăng dần
    // -----------------------------------------------

    const numbered =
        episodes.every(
            function (
                episode
            ) {

                return (
                    Number(
                        episode.number
                    ) > 0
                );

            }
        );

    if (
        numbered
    ) {

        episodes.sort(
            function (
                a,
                b
            ) {

                return (
                    Number(
                        a.number
                    ) -
                    Number(
                        b.number
                    )
                );

            }
        );

    }

    servers.push({

        name:
            serverName,

        episodes:
            episodes

    });

}


// ----------------------------------------------------
// LOG
// ----------------------------------------------------

console.log(
    "[PHIMHDCS] SERVERS:",
    servers.map(
        function (
            server
        ) {

            return {

                name:
                    server.name,

                episodes:
                    server.episodes.length,

                list:
                    server.episodes.map(
                        function (
                            episode
                        ) {

                            return {

                                name:
                                    episode.name,

                                number:
                                    episode.number,

                                url:
                                    episode.url

                            };

                        }
                    )

            };

        }
    )
);

       // ====================================================
// 6. CHỌN TẤT CẢ EPISODE THEO TỪNG SERVER
// ====================================================

const targetEpisode =
    Number(
        episodeNumber
    ) || 1;

const selectedEpisodes = [];

if (
    streamType ===
    "series"
) {

    for (
        const server
        of servers
    ) {

        const found =
            server.episodes.find(
                function (
                    episode
                ) {

                    return (
                        Number(
                            episode.number
                        ) ===
                        targetEpisode
                    );

                }
            );

        if (
            found
        ) {

            selectedEpisodes.push({

                server:
                    server.name,

                episode:
                    found

            });

            console.log(
                "[PHIMHDCS] SELECTED EPISODE:",
                {
                    server:
                        server.name,

                    name:
                        found.name,

                    url:
                        found.url
                }
            );

        } else {

            console.log(
                "[PHIMHDCS] EPISODE NOT FOUND ON SERVER:",
                {
                    server:
                        server.name,

                    target:
                        targetEpisode
                }
            );

        }

    }

} else {

    for (
        const server
        of servers
    ) {

        if (
            server.episodes.length >
            0
        ) {

            const found =
                server.episodes[0];

            selectedEpisodes.push({

                server:
                    server.name,

                episode:
                    found

            });

            console.log(
                "[PHIMHDCS] SELECTED MOVIE SERVER:",
                {
                    server:
                        server.name,

                    name:
                        found.name,

                    url:
                        found.url
                }
            );

        }

    }

}

if (
    selectedEpisodes.length === 0
) {

    console.log(
        "[PHIMHDCS] EPISODE NOT FOUND:",
        targetEpisode
    );

    addFallback();

    return streams;
}

console.log(
    "[PHIMHDCS] TOTAL SELECTED EPISODES:",
    selectedEpisodes.length
);

        // ====================================================
// 7. LOAD TẤT CẢ EPISODE PAGE
// ====================================================

const episodePages = [];

for (
    const selected
    of selectedEpisodes
) {

    try {

        const episodeUrl =
            selected
                .episode
                .url;

        const episodeRes =
            await axios.get(
                episodeUrl,
                {
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",

                        "Referer":
                            selectedMovie.url
                    },

                    timeout: 10000
                }
            );

        const episodeHtml =
            String(
                episodeRes.data ||
                ""
            );

        episodePages.push({

            server:
                selected.server,

            episode:
                selected.episode,

            url:
                episodeUrl,

            html:
                episodeHtml

        });

        console.log(
            "[PHIMHDCS] LOADED EPISODE PAGE:",
            {
                server:
                    selected.server,

                episode:
                    selected.episode.name,

                url:
                    episodeUrl
            }
        );

    } catch (
        episodeLoadError
    ) {

        console.warn(
            "[PHIMHDCS] EPISODE LOAD ERROR:",
            {
                server:
                    selected.server,

                url:
                    selected?.episode?.url,

                error:
                    episodeLoadError?.message ||
                    episodeLoadError
            }
        );

    }

}

console.log(
    "[PHIMHDCS] LOADED EPISODE PAGES:",
    episodePages.length
);

if (
    episodePages.length === 0
) {

    console.log(
        "[PHIMHDCS] NO EPISODE PAGE LOADED"
    );

    addFallback();

    return streams;
}

        // ====================================================
// 8. DIRECT M3U8 / MP4 TRONG HTML
// ====================================================

for (
    const page
    of episodePages
) {

    const episodeHtml =
        page.html;

    const directMatches =
        episodeHtml.match(
            /https?:\/\/[^"'\\\s<>]+?\.(?:m3u8|mp4)(?:\?[^"'\\\s<>]*)?/gi
        ) ||
        [];

    const directUrls =
        [
            ...new Set(
                directMatches
            )
        ];

    console.log(
        "[PHIMHDCS] DIRECT HTML:",
        {
            server:
                page.server,

            count:
                directUrls.length
        }
    );

    for (
        const videoUrl
        of directUrls
    ) {

        streams.push({

            name:
                "📺 [PhimHDCS] " +
                page.server +
                " Direct",

            title:
                streamType ===
                "series"
                    ? "Tập " +
                      String(
                          targetEpisode
                      ).padStart(
                          2,
                          "0"
                      ) +
                      " - " +
                      page.server +
                      " - PhimHDCS"
                    : page.server +
                      " - PhimHDCS",

            url:
                videoUrl,

            behaviorHints: {

                bingeGroup:
                    "phimhdcs-" +
                    page.server +
                    "-direct"

            }

        });

    }

}

        // ====================================================
// 9. ĐỌC _0xS
// ====================================================

const episodeData = [];

for (
    const page
    of episodePages
) {

    const episodeHtml =
        page.html;

    let saltString =
        "";

    const saltMatch =
        episodeHtml.match(
            /(?:const|let|var)\s+_0xS\s*=\s*["']([^"']+)["']/
        );

    if (
        saltMatch
    ) {

        saltString =
            saltMatch[1];

    }

    console.log(
        "[PHIMHDCS] SALT:",
        {
            server:
                page.server,

            found:
                Boolean(
                    saltMatch
                ),

            saltLength:
                saltString.length
        }
    );

    episodeData.push({

        server:
            page.server,

        episode:
            page.episode,

        url:
            page.url,

        html:
            episodeHtml,

        saltString:
            saltString,

        oxData:
            null

    });

}

        // ====================================================
        // 10. BASE64 DECODER
        // ====================================================

        function decodeBase64(
            value
        ) {

            try {

                return Buffer
                    .from(
                        String(
                            value
                        )
                            .replace(
                                /[^A-Za-z0-9+/=]/g,
                                ""
                            ),
                        "base64"
                    )
                    .toString(
                        "utf8"
                    );

            } catch (
                decodeError
            ) {

                return null;

            }

        }

        function decodeChunksWithSalt(
            chunks,
            salt
        ) {

            try {

                let base64 =
                    chunks.join("");

                base64 =
                    base64
                        .split("")
                        .reverse()
                        .join("");

                if (
                    salt
                ) {

                    base64 =
                        base64.replace(
                            salt,
                            ""
                        );

                }

                return decodeBase64(
                    base64
                );

            } catch (
                decodeError
            ) {

                return null;

            }

        }

        // ====================================================
// 11. ĐỌC realObj
// ====================================================

for (
    const data
    of episodeData
) {

    const episodeHtml =
        data.html;

    let oxData =
        null;

    const realObjMatch =
        episodeHtml.match(
            /(?:const|let|var)\s+realObj\s*=\s*JSON\.parse\(\s*atob\(\s*["']([^"']+)["']\s*\)\s*\)/i
        );

    if (
        realObjMatch
    ) {

        try {

            const decoded =
                decodeBase64(
                    realObjMatch[1]
                );

            if (
                decoded
            ) {

                oxData =
                    JSON.parse(
                        decoded
                    );

                console.log(
                    "[PHIMHDCS] realObj FOUND:",
                    data.server
                );

            }

        } catch (
            realObjError
        ) {

            console.log(
                "[PHIMHDCS] realObj ERROR:",
                {
                    server:
                        data.server,

                    error:
                        realObjError?.message ||
                        realObjError
                }
            );

        }

    }

    data.oxData =
        oxData;

}

        // ====================================================
// 12. FALLBACK _0xData
// ====================================================

for (
    const data
    of episodeData
) {

    if (
        data.oxData
    ) {

        continue;

    }

    const episodeHtml =
        data.html;

    const dataMatch =
        episodeHtml.match(
            /(?:const|let|var)\s+_0xData\s*=\s*(\{[\s\S]*?\})\s*;/
        );

    if (
        !dataMatch
    ) {

        continue;

    }

    try {

        const startIndex =
            dataMatch.index +
            dataMatch[0].indexOf(
                "{"
            );

        let braceCount =
            0;

        let jsonEnd =
            -1;

        for (
            let i =
                startIndex;

            i <
                episodeHtml.length &&
            i <
                startIndex +
                100000;

            i++
        ) {

            if (
                episodeHtml[i] ===
                "{"
            ) {

                braceCount++;

            } else if (
                episodeHtml[i] ===
                "}"
            ) {

                braceCount--;

                if (
                    braceCount ===
                    0
                ) {

                    jsonEnd =
                        i + 1;

                    break;

                }

            }

        }

        if (
            jsonEnd >
            0
        ) {

            data.oxData =
                JSON.parse(
                    episodeHtml.substring(
                        startIndex,
                        jsonEnd
                    )
                );

            console.log(
                "[PHIMHDCS] _0xData FOUND:",
                data.server
            );

        }

    } catch (
        dataError
    ) {

        console.log(
            "[PHIMHDCS] _0xData ERROR:",
            {
                server:
                    data.server,

                error:
                    dataError?.message ||
                    dataError
            }
        );

    }

}

// ====================================================
// 13. GIẢI MÃ SERVER URL
// ====================================================

for (
    const data
    of episodeData
) {

    const oxData =
        data?.oxData;

    const saltString =
        String(
            data?.saltString ||
            ""
        ).trim();

    if (
        !oxData ||
        typeof oxData !==
        "object"
    ) {

        console.log(
            "[PHIMHDCS] NO oxData:",
            data?.server
        );

        continue;

    }

    if (
        !saltString
    ) {

        console.log(
            "[PHIMHDCS] NO SALT:",
            data?.server
        );

        continue;

    }

    function decodeKey(
        key
    ) {

        if (
            !key ||
            !oxData[key] ||
            !Array.isArray(
                oxData[key]
            )
        ) {

            return null;

        }

        let decoded =
            decodeChunksWithSalt(
                oxData[key],
                saltString
            );

        if (
            decoded &&
            decoded.includes(
                "player.php?"
            )
        ) {

            const match =
                decoded.match(
                    /[?&](?:link|url)=([^&]+)/
                );

            if (
                match
            ) {

                try {

                    decoded =
                        decodeURIComponent(
                            match[1]
                        );

                } catch (
                    decodeUrlError
                ) {}

            }

        }

        return decoded;

    }

    const decodedServers = [];

    const seenServerUrls =
        new Set();

    for (
        const serverKey
        of Object.keys(
            oxData
        )
    ) {

        const decoded =
            decodeKey(
                serverKey
            );

        if (
            !decoded ||
            !decoded.startsWith(
                "http"
            )
        ) {

            continue;

        }

        const cleanUrl =
            String(
                decoded
            ).trim();

        if (
            !cleanUrl ||
            seenServerUrls.has(
                cleanUrl
            )
        ) {

            continue;

        }

        if (
            cleanUrl.includes(
                "tiktok"
            )
        ) {

            console.log(
                "[PHIMHDCS] SKIP TIKTOK:",
                cleanUrl
            );

            continue;

        }

        seenServerUrls.add(
            cleanUrl
        );

        const isDirect =
            /\.m3u8(?:[?#]|$)/i.test(
                cleanUrl
            ) ||
            /\.mp4(?:[?#]|$)/i.test(
                cleanUrl
            );

        decodedServers.push({

            url:
                cleanUrl,

            isDirect:
                isDirect

        });

        console.log(
            "[PHIMHDCS] DECODED SERVER:",
            {
                server:
                    data?.server,

                url:
                    cleanUrl,

                type:
                    isDirect
                        ? "DIRECT"
                        : "EMBED"
            }
        );

    }

    console.log(
        "[PHIMHDCS] DECODED SERVERS:",
        {
            server:
                data?.server,

            count:
                decodedServers.length
        }
    );

    for (
        let index = 0;
        index < decodedServers.length;
        index++
    ) {

        const server =
            decodedServers[index];

        const serverNumber =
            streams.length + 1;

        const languageName =
            String(
                data?.server ||
                "PhimHDCS"
            ).trim();

        if (
            server.isDirect
        ) {

            console.log(
                "[PHIMHDCS] ADD SERVER:",
                {
                    language:
                        languageName,

                    number:
                        serverNumber,

                    type:
                        "DIRECT",

                    url:
                        server.url
                }
            );

            streams.push({

                name:
                    "📺 [PhimHDCS] " +
                    languageName +
                    " - Server " +
                    serverNumber,

                title:
                    movieName +
                    " - " +
                    languageName +
                    " - Server " +
                    serverNumber,

                url:
                    server.url,

                behaviorHints: {

                    bingeGroup:
                        "phimhdcs-" +
                        serverNumber

                }

            });

        } else {

            console.log(
                "[PHIMHDCS] ADD SERVER:",
                {
                    language:
                        languageName,

                    number:
                        serverNumber,

                    type:
                        "EMBED",

                    url:
                        server.url
                }
            );

            streams.push({

                name:
                    "▶️ [PhimHDCS] " +
                    languageName +
                    " - Server " +
                    serverNumber,

                title:
                    movieName +
                    " - " +
                    languageName +
                    " - Server " +
                    serverNumber,

                externalUrl:
                    server.url,

                behaviorHints: {

                    bingeGroup:
                        "phimhdcs-" +
                        serverNumber

                }

            });

        }

    }

}

        // ====================================================
        // 14. IFRAME TĨNH
        // ====================================================

        if (
            streams.length === 0
        ) {

            const iframeMatch =
                episodeHtml.match(
                    /<iframe[^>]*src=["']([^"']+)["']/i
                );

            if (
                iframeMatch?.[1]
            ) {

                let embedUrl =
                    makeAbsoluteUrl(
                        iframeMatch[1]
                    );

                if (
                    embedUrl.includes(
                        "player.php?"
                    )
                ) {

                    const linkMatch =
                        embedUrl.match(
                            /[?&](?:link|url)=([^&]+)/
                        );

                    if (
                        linkMatch
                    ) {

                        try {

                            embedUrl =
                                decodeURIComponent(
                                    linkMatch[1]
                                );

                        } catch (
                            iframeDecodeError
                        ) {}

                    }

                }

                if (
                    embedUrl &&
                    embedUrl !==
                    episodeUrl
                ) {

                    streams.push({

                        name:
                            "▶️ [PhimHDCS] Player",

                        title:
                            streamType ===
                            "series"
                                ? "Tập " +
                                  String(
                                      targetEpisode
                                  ).padStart(
                                      2,
                                      "0"
                                  ) +
                                  " - PhimHDCS"
                                : "PhimHDCS",

                        externalUrl:
                            embedUrl

                    });

                }

            }

        }

        // ====================================================
        // 15. KHÔNG CÓ NGUỒN → TỰ FALLBACK
        // ====================================================

        if (
            streams.length === 0
        ) {

            console.log(
                "[PHIMHDCS] NO STREAM"
            );

            addFallback();

        }

        console.log(
            "[PHIMHDCS] FINAL STREAMS:",
            streams.length
        );

    } catch (e) {

        console.log(
            "[PHIMHDCS ERROR]",
            e?.response?.status ||
            e?.message ||
            e
        );

        // ====================================================
        // NGUỒN LỖI → TỰ FALLBACK
        // ====================================================

        addFallback();

    }

    return streams;


    // ========================================================
    // EPISODE NUMBER HELPER
    // ========================================================

    function extractEpisodeNumber(
        value
    ) {

        const text =
            String(
                value ||
                ""
            );

        const match =
            text.match(
                /(?:tập|tap|episode|ep\.?|phần|part)[\s._-]*(\d+)/i
            );

        if (
            match
        ) {

            return Number(
                match[1]
            ) || 0;

        }

        const direct =
            text.match(
                /^\s*0*(\d+)\s*$/
            );

        if (
            direct
        ) {

            return Number(
                direct[1]
            ) || 0;

        }

        return 0;

    }

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
    // 2. XÁC ĐỊNH TÊN + NĂM + SEASON + EPISODE
    // =====================================================

    let movieName = "";

    let movieYear = 0;

    let seasonNumber = 0;

    let episodeNumber = 0;

    // =====================================================
    // A. MOVINA SERIES VIDEO ID
    //
    // Ví dụ:
    //
    // vnwpsw:Tên phim:1:6
    //
    // => movieName    = Tên phim
    // => seasonNumber = 1
    // => episodeNumber= 6
    // =====================================================

    if (
        rawId.startsWith("vnwpsw:")
    ) {

        const movinaRaw =
            rawId.substring(
                "vnwpsw:".length
            );

        const idParts =
            movinaRaw.split(":");

        // -------------------------------------------------
        // Nếu là series video:
        //
        // vnwpsw:Tên phim:season:episode
        // -------------------------------------------------

        if (
            streamType === "series" &&
            idParts.length >= 3
        ) {

            const episodePart =
                idParts[
                    idParts.length - 1
                ];

            const seasonPart =
                idParts[
                    idParts.length - 2
                ];

            episodeNumber =
                Number(
                    episodePart
                ) || 0;

            seasonNumber =
                Number(
                    seasonPart
                ) || 1;

            // Tên phim có thể chứa ":"
            // nên ghép tất cả phần còn lại
            // trước season + episode.

            const nameParts =
                idParts.slice(
                    0,
                    -2
                );

            movieName =
                decodeURIComponent(
                    nameParts.join(":")
                );

            console.log(
                "[STREAM] MOVINA series name:",
                movieName
            );

            console.log(
                "[STREAM] MOVINA season:",
                seasonNumber
            );

            console.log(
                "[STREAM] MOVINA episode:",
                episodeNumber
            );

        } else {

            // -------------------------------------------------
            // MOVIE:
            //
            // vnwpsw:Tên phim
            // -------------------------------------------------

            movieName =
                decodeURIComponent(
                    movinaRaw
                );

            console.log(
                "[STREAM] MOVINA movie name:",
                movieName
            );

        }

    }

    // =====================================================
    // B. IMDb SERIES
    //
    // Ví dụ:
    //
    // tt1234567:1:6
    // =====================================================

    else if (
        streamType === "series" &&
        rawId.startsWith("tt")
    ) {

        const idParts =
            rawId.split(":");

        seasonNumber =
            Number(
                idParts[1]
            ) || 1;

        episodeNumber =
            Number(
                idParts[2]
            ) || 1;

        console.log(
            "[STREAM] IMDb season:",
            seasonNumber
        );

        console.log(
            "[STREAM] IMDb episode:",
            episodeNumber
        );

        const imdbId =
            idParts[0];

        // =================================================
        // IMDb → CINEMETA
        // =================================================

        const cinemetaUrl =
            "https://v3-cinemeta.strem.io/meta/" +
            "series/" +
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

            const cinemetaMeta =
                metaRes.data?.meta ||
                {};

            movieName =
                cinemetaMeta.name ||
                "";

            const rawYear =
                cinemetaMeta.year ||
                cinemetaMeta.releaseInfo ||
                cinemetaMeta.released ||
                "";

            const yearMatch =
                String(
                    rawYear
                ).match(
                    /\b(19|20)\d{2}\b/
                );

            movieYear =
                yearMatch
                    ? Number(
                        yearMatch[0]
                    )
                    : 0;

        } catch (e) {

            console.log(
                "[STREAM] Cinemeta error:",
                e?.response?.status ||
                e?.message ||
                e
            );

        }

    }

    // =====================================================
    // C. IMDb MOVIE
    // =====================================================

    else if (
        rawId.startsWith("tt")
    ) {

        const imdbId =
            rawId.split(":")[0];

        console.log(
            "[STREAM] IMDb ID:",
            imdbId
        );

        try {

            const cinemetaUrl =
                "https://v3-cinemeta.strem.io/meta/" +
                "movie/" +
                encodeURIComponent(
                    imdbId
                ) +
                ".json";

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

            const cinemetaMeta =
                metaRes.data?.meta ||
                {};

            movieName =
                cinemetaMeta.name ||
                "";

            const rawYear =
                cinemetaMeta.year ||
                cinemetaMeta.releaseInfo ||
                cinemetaMeta.released ||
                "";

            const yearMatch =
                String(
                    rawYear
                ).match(
                    /\b(19|20)\d{2}\b/
                );

            movieYear =
                yearMatch
                    ? Number(
                        yearMatch[0]
                    )
                    : 0;

        } catch (e) {

            console.log(
                "[STREAM] Cinemeta movie error:",
                e?.response?.status ||
                e?.message ||
                e
            );

        }

        // =================================================
        // IMDb Suggestion fallback
        // =================================================

        if (!movieName) {

            try {

                const imdbSuggestionUrl =
                    "https://v3.sg.media-imdb.com/suggestion/x/" +
                    encodeURIComponent(
                        imdbId
                    ) +
                    ".json";

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
                                item?.id ||
                                ""
                            ) === imdbId
                    ) ||
                    imdbItems[0];

                movieName =
                    imdbMovie?.l ||
                    "";

                if (
                    !movieYear &&
                    imdbMovie?.y
                ) {

                    movieYear =
                        Number(
                            imdbMovie.y
                        ) || 0;

                }

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

    // =====================================================
    // D. ID KHÁC
    // =====================================================

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

    // =====================================================
    // E. LOG THÔNG TIN ĐÃ RESOLVE
    // =====================================================

    console.log(
        "[STREAM] Resolved movie:",
        movieName
    );

    console.log(
        "[STREAM] Resolved year:",
        movieYear
    );

    console.log(
        "[STREAM] Resolved season:",
        seasonNumber
    );

    console.log(
        "[STREAM] Resolved episode:",
        episodeNumber
    );

    // =====================================================
    // F. CHUẨN HÓA TÊN
    // =====================================================

    movieName =
        String(
            movieName || ""
        )
            .replace(/\s+/g, " ")
            .trim();

    console.log(
        "[STREAM] Final movie name:",
        movieName
    );

    // =====================================================
    // G. NẾU VẪN KHÔNG CÓ TÊN
    // =====================================================

    if (!movieName) {

        console.log(
            "[STREAM] KHÔNG LẤY ĐƯỢC TÊN PHIM"
        );

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
    // H. TÊN RIÊNG CHO FALLBACK NGUONC
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
// 6. CHẠY KKPHIM TRƯỚC
// =====================================================
// KKPhim ưu tiên tra trực tiếp bằng IMDb ID.
// Nếu IMDb lookup không có kết quả thì fetchKKPhim()
// mới fallback sang search theo tên + năm.
// =====================================================

let kkphim = [];

try {

    kkphim =
        await fetchKKPhim(
            movieName,
            movieYear,
            seasonNumber,
            episodeNumber,
            streamType,
            rawId.startsWith("tt")
                ? rawId.split(":")[0]
                : ""
        );

} catch (e) {

    console.log(
        "[KKPHIM PRELOAD ERROR]:",
        e?.message ||
        e
    );

    kkphim = [];

}


// =====================================================
// 8. CHẠY NGUONC + CÁC NGUỒN KHÁC SONG SONG
// =====================================================
let results = [];

try {

    results =
        await Promise.allSettled([
            fetchNguonC(nguonCFallbackName),

            fetchVSMov(
                movieName,
                movieYear,
                seasonNumber,
                episodeNumber,
                streamType
            ),

            scrapePhimLongTieng(
                movieName,
                episodeNumber,
                movieYear
            ),

            scrapePhimHDCS(
                movieName,
                movieYear,
                seasonNumber,
                episodeNumber,
                streamType
            )
        ]);

} catch (e) {

    console.log(
        "[STREAM SOURCES ERROR]:",
        e?.message ||
        e
    );

}


// =====================================================
// 9. LẤY KẾT QUẢ TỪ CÁC NGUỒN
// =====================================================

const nguonc =
    results[0]?.status === "fulfilled" &&
    Array.isArray(
        results[0].value
    )
        ? results[0].value
        : [];

const vsmov =
    results[1]?.status === "fulfilled" &&
    Array.isArray(
        results[1].value
    )
        ? results[1].value
        : [];

const longtieng =
    results[2]?.status === "fulfilled" &&
    Array.isArray(
        results[2].value
    )
        ? results[2].value
        : [];

const phimhdcs =
    results[3]?.status === "fulfilled" &&
    Array.isArray(
        results[3].value
    )
        ? results[3].value
        : [];

// =====================================================
// 10. LOG
// =====================================================

console.log(
    "[STREAM] NguonC streams:",
    nguonc.length
);

console.log(
    "[STREAM] KKPhim streams:",
    kkphim.length
);

console.log(
    "[STREAM] VSMov streams:",
    vsmov.length
);

console.log(
    "[STREAM] PhimLongTieng streams:",
    longtieng.length
);

console.log(
    "[STREAM] PhimHDCS streams:",
    phimhdcs.length
);


// =====================================================
// NGUONC CLIENT WIDGET
// =====================================================
// Không gọi NguonC từ Vercel.
// Browser sẽ mở NguonC Client và tự tìm đúng phim/năm/tập.
// =====================================================

const nguoncClientUrl =
    "https://my-strem-addon.vercel.app/nguonc-player" +
    "?title=" +
    encodeURIComponent(
        movieName
    ) +
    "&year=" +
    encodeURIComponent(
        movieYear || 0
    ) +
    "&type=" +
    encodeURIComponent(
        streamType || "movie"
    ) +
    "&season=" +
    encodeURIComponent(
        seasonNumber || 0
    ) +
    "&episode=" +
    encodeURIComponent(
        episodeNumber || 0
    );

const nguoncClientStream = {

    name:
        "▶️ [NguonC] Client",

    title:
        "NguonC - " +
        movieName +
        " (" +
        (movieYear || "") +
        ")",

    externalUrl:
        nguoncClientUrl,

    widgetPlayer:
        nguoncClientUrl,

    widgetPlayerStates: [
        "replaceplayer"
    ]

};

console.log(
    "[NGUONC CLIENT] URL:",
    nguoncClientUrl
);

// =====================================================
// 11. GỘP STREAM TRỰC TIẾP
// =====================================================

const directStreams = [
    ...nguonc,

    ...kkphim,

    ...vsmov,

    ...longtieng,

    ...phimhdcs,

    nguoncClientStream
];

    // =====================================================
// 12. FALLBACK CHUNG
//
// VSMOV KHÔNG THÊM Ở ĐÂY
//
// fetchVSMov() đã tự tạo fallback của VSMov
// khi không lấy được stream.
//
// PHIMHDCS CŨNG KHÔNG THÊM Ở ĐÂY
//
// scrapePhimHDCS() đã tự tạo fallback
// khi không lấy được stream.
//
// Tổng cộng fallback chung:
//
// 1. 1Phim32
// 2. NguonC
// 3. KKPhim2
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
    // FALLBACK 3 — KKPHIM2
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
    // 13. LỌC DIRECT STREAM
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
    // 14. LỌC FALLBACK
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
    // 15. GỘP TẤT CẢ
    // =====================================================

    const allStreams = [

        ...validDirectStreams,

        ...validExternalStreams

    ];

    // =====================================================
    // 16. LOẠI URL TRÙNG
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
console.log(
    "[DEBUG] PhimLongTieng FINAL:",
    JSON.stringify(
        uniqueStreams.filter(
            stream =>
                stream?.name?.includes("[PhimLongTieng]")
        ),
        null,
        2
    )
);
    // =====================================================
    // 17. LOG CUỐI
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
    // 18. TRẢ VỀ STREMIO
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
   VSMOV EMBED INSPECT
   ĐỌC HTML PLAYER VÀ TÌM:
   - enableSignedUrl
   - signedMasterUrl
   - videoHash
   - segmentCdnHosts
   - audio
   - m3u8
   - mp4
   - source
   ============================================================ */

app.get(
    "/nguonc/vsmov-inspect",
    async (req, res) => {

        try {

            const embedUrl =
                String(
                    req.query.url || ""
                ).trim();

            if (
                !embedUrl ||
                !/^https?:\/\//i.test(embedUrl)
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Thiếu ?url=https://..."
                });

            }

            console.log(
                "[VSMOV INSPECT] URL:",
                embedUrl
            );

            const response =
                await axios.get(
                    embedUrl,
                    {
                        timeout: 15000,

                        headers: {

                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

                            "Accept":
                                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

                            "Accept-Language":
                                "vi,en-US;q=0.9,en;q=0.8",

                            "Referer":
                                "https://vsmov.com/"

                        },

                        validateStatus:
                            () => true

                    }
                );

            const html =
                String(
                    response.data || ""
                );

            // =================================================
            // HELPER
            // =================================================

            function extract(
                pattern
            ) {

                const match =
                    html.match(pattern);

                return match
                    ? match[1]
                    : null;

            }

            // =================================================
            // ENABLE SIGNED URL
            // =================================================

            const enableSignedUrl =
                extract(
                    /enableSignedUrl\s*:\s*(true|false)/i
                );

            // =================================================
            // SIGNED MASTER URL
            // =================================================

            const signedMasterUrl =
                extract(
                    /signedMasterUrl\s*:\s*["']([^"']+)["']/i
                );

            // =================================================
            // VIDEO HASH
            // =================================================

            const videoHash =
                extract(
                    /videoHash\s*:\s*["']([^"']+)["']/i
                );

            // =================================================
            // BASE URL
            // =================================================

            const baseUrl =
                extract(
                    /baseUrl\s*=\s*["']([^"']+)["']/i
                ) ||
                extract(
                    /baseUrl\s*:\s*["']([^"']+)["']/i
                );

            // =================================================
            // SEGMENT CDN HOSTS
            // =================================================

            const segmentCdnHostsMatch =
                html.match(
                    /segmentCdnHosts\s*:\s*\[([\s\S]*?)\]/i
                );

            let segmentCdnHosts = [];

            if (
                segmentCdnHostsMatch
            ) {

                const block =
                    segmentCdnHostsMatch[1];

                segmentCdnHosts =
                    [
                        ...block.matchAll(
                            /["']([^"']+)["']/g
                        )
                    ]
                    .map(
                        x => x[1]
                    );

            }

            // =================================================
            // TÌM CÁC URL MEDIA TRONG HTML
            // =================================================

            const allUrls = [];

            const urlRegex =
                /https?:\/\/[^\s"'<>\\]+/gi;

            const urlMatches =
                html.match(
                    urlRegex
                ) || [];

            urlMatches.forEach(
                url => {

                    const clean =
                        url
                            .replace(
                                /[),;]+$/,
                                ""
                            );

                    if (
                        !allUrls.includes(
                            clean
                        )
                    ) {

                        allUrls.push(
                            clean
                        );

                    }

                }
            );

            // =================================================
            // CHỈ LẤY MEDIA-RELATED URL
            // =================================================

            const mediaUrls =
                allUrls.filter(
                    url => {

                        const lower =
                            url.toLowerCase();

                        return (
                            lower.includes(
                                ".m3u8"
                            ) ||
                            lower.includes(
                                ".mp4"
                            ) ||
                            lower.includes(
                                ".mp3"
                            ) ||
                            lower.includes(
                                ".aac"
                            ) ||
                            lower.includes(
                                ".m4a"
                            ) ||
                            lower.includes(
                                "audio"
                            ) ||
                            lower.includes(
                                "stream"
                            ) ||
                            lower.includes(
                                "video"
                            )
                        );

                    }
                );

            // =================================================
            // TÌM CÁC DÒNG CÓ TỪ KHÓA AUDIO
            // =================================================

            const audioLines =
                html
                    .split(/\r?\n/)
                    .filter(
                        line =>
                            /audio|sound|mp3|m4a|aac/i.test(
                                line
                            )
                    )
                    .slice(
                        0,
                        100
                    );

            // =================================================
            // TÌM CÁC DÒNG CÓ TỪ KHÓA PLAYER
            // =================================================

            const playerLines =
                html
                    .split(/\r?\n/)
                    .filter(
                        line =>
                            /playerSource|videoSrc|source|masterUrl|signedMasterUrl|videoHash|segmentCdnHosts/i.test(
                                line
                            )
                    )
                    .slice(
                        0,
                        150
                    );

            const result = {

                success: true,

                status:
                    response.status,

                contentType:
                    response.headers[
                        "content-type"
                    ] || null,

                htmlLength:
                    html.length,

                embedUrl:

                    embedUrl,

                player: {

                    enableSignedUrl:
                        enableSignedUrl,

                    signedMasterUrl:
                        signedMasterUrl,

                    videoHash:
                        videoHash,

                    baseUrl:
                        baseUrl,

                    segmentCdnHosts:
                        segmentCdnHosts

                },

                mediaUrls:
                    mediaUrls,

                audioLines:
                    audioLines,

                playerLines:
                    playerLines

            };

            console.log(
                "[VSMOV INSPECT] RESULT:",
                JSON.stringify(
                    result
                )
            );

            return res.json(
                result
            );

        } catch (error) {

            console.log(
                "[VSMOV INSPECT ERROR]",
                error?.message ||
                error
            );

            return res.status(
                500
            ).json({

                success: false,

                error:
                    error?.message ||
                    String(error)

            });

        }

    }
);

/* ============================================================
   VSMOV ORIGIN.JS INSPECT
   ============================================================ */

app.get(
    "/nguonc/vsmov-origin-inspect",
    async (req, res) => {

        try {

            const jsUrl =
                String(
                    req.query.url || ""
                ).trim();

            if (
                !jsUrl ||
                !/^https?:\/\//i.test(jsUrl)
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Thiếu ?url=https://..."
                });

            }

            console.log(
                "[VSMOV ORIGIN INSPECT] URL:",
                jsUrl
            );

            const response =
                await axios.get(
                    jsUrl,
                    {
                        timeout: 15000,

                        headers: {

                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

                            "Accept":
                                "*/*",

                            "Referer":
                                "https://vsmov.com/"

                        },

                        validateStatus:
                            () => true

                    }
                );

            const js =
                String(
                    response.data || ""
                );

            /*
             * Tìm tất cả URL xuất hiện trong JS
             */

            const allUrls = [];

            const urlRegex =
                /https?:\/\/[^\s"'`<>\\]+/gi;

            const matches =
                js.match(
                    urlRegex
                ) || [];

            matches.forEach(
                url => {

                    const clean =
                        url
                            .replace(
                                /[),;]+$/,
                                ""
                            );

                    if (
                        !allUrls.includes(
                            clean
                        )
                    ) {

                        allUrls.push(
                            clean
                        );

                    }

                }
            );

            /*
             * Tìm những dòng đáng chú ý
             */

            const interestingLines =
                js
                    .split(/\r?\n/)
                    .filter(
                        line =>
                            /audio|sound|mp3|m4a|aac|m3u8|mp4|media|video|source|stream|playlist|hls|jwplayer|fetch\(|axios|XMLHttpRequest|ajax|segment|png/i.test(
                                line
                            )
                    )
                    .slice(
                        0,
                        300
                    );

            /*
             * Tìm đường dẫn tương đối
             */

            const relativeUrls = [];

            const relativeRegex =
                /["'`](\/[^"'`]+)["'`]/g;

            let match;

            while (
                (
                    match =
                        relativeRegex.exec(js)
                ) !== null
            ) {

                const path =
                    match[1];

                if (
                    !relativeUrls.includes(
                        path
                    )
                ) {

                    relativeUrls.push(
                        path
                    );

                }

            }

            /*
             * Tìm tên file JS khác
             */

            const jsFiles = [];

            const jsRegex =
                /["'`]([^"'`]+\.js(?:\?[^"'`]*)?)["'`]/gi;

            while (
                (
                    match =
                        jsRegex.exec(js)
                ) !== null
            ) {

                const file =
                    match[1];

                if (
                    !jsFiles.includes(
                        file
                    )
                ) {

                    jsFiles.push(
                        file
                    );

                }

            }

            const result = {

                success: true,

                status:
                    response.status,

                contentType:
                    response.headers[
                        "content-type"
                    ] || null,

                jsLength:
                    js.length,

                jsUrl:

                    jsUrl,

                allUrls:

                    allUrls,

                relativeUrls:

                    relativeUrls,

                jsFiles:

                    jsFiles,

                interestingLines:

                    interestingLines

            };

            console.log(
                "[VSMOV ORIGIN INSPECT] RESULT:",
                JSON.stringify(
                    result
                )
            );

            return res.json(
                result
            );

        } catch (error) {

            console.log(
                "[VSMOV ORIGIN INSPECT ERROR]",
                error?.message ||
                error
            );

            return res.status(
                500
            ).json({

                success: false,

                error:
                    error?.message ||
                    String(error)

            });

        }

    }
);

/* ============================================================
   VSMOV MASTER PLAYLIST INSPECT
   KIỂM TRA:
   - EXT-X-MEDIA
   - AUDIO
   - VIDEO
   - SUBTITLES
   - PNG
   - MP4
   - CODECS
   ============================================================ */

app.get(
    "/nguonc/vsmov-master-inspect",
    async (req, res) => {

        try {

            const masterUrl =
                String(
                    req.query.url || ""
                ).trim();

            if (
                !masterUrl ||
                !/^https?:\/\//i.test(masterUrl)
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Thiếu ?url=https://..."
                });

            }

            console.log(
                "[VSMOV MASTER INSPECT] URL:",
                masterUrl
            );

            const response =
                await axios.get(
                    masterUrl,
                    {
                        timeout: 15000,

                        headers: {

                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

                            "Accept":
                                "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",

                            "Referer":
                                "https://vsmov.com/"

                        },

                        validateStatus:
                            () => true

                    }
                );

            const playlist =
                String(
                    response.data || ""
                );

            const lines =
                playlist
                    .split(/\r?\n/)
                    .map(
                        line => line.trim()
                    )
                    .filter(
                        line => line.length > 0
                    );

            const mediaLines =
                lines.filter(
                    line =>
                        line.startsWith(
                            "#EXT-X-MEDIA:"
                        )
                );

            const streamInfLines =
                lines.filter(
                    line =>
                        line.startsWith(
                            "#EXT-X-STREAM-INF:"
                        )
                );

            const segmentLines =
                lines.filter(
                    line =>
                        !line.startsWith("#")
                );

            const audioLines =
                mediaLines.filter(
                    line =>
                        /TYPE=AUDIO/i.test(
                            line
                        )
                );

            const subtitleLines =
                mediaLines.filter(
                    line =>
                        /TYPE=SUBTITLES/i.test(
                            line
                        )
                );

            const videoLines =
                streamInfLines.filter(
                    line =>
                        /VIDEO|RESOLUTION|BANDWIDTH|CODECS/i.test(
                            line
                        )
                );

            const pngSegments =
                segmentLines.filter(
                    line =>
                        /\.png(?:\?|$)/i.test(
                            line
                        )
                );

            const mp4Segments =
                segmentLines.filter(
                    line =>
                        /\.mp4(?:\?|$)/i.test(
                            line
                        )
                );

            const m4aSegments =
                segmentLines.filter(
                    line =>
                        /\.m4a(?:\?|$)/i.test(
                            line
                        )
                );

            const aacSegments =
                segmentLines.filter(
                    line =>
                        /\.aac(?:\?|$)/i.test(
                            line
                        )
                );

            const tsSegments =
                segmentLines.filter(
                    line =>
                        /\.ts(?:\?|$)/i.test(
                            line
                        )
                );

            const mpegSegments =
                segmentLines.filter(
                    line =>
                        /\.m3u8(?:\?|$)/i.test(
                            line
                        )
                );

            const result = {

                success: true,

                status:
                    response.status,

                contentType:
                    response.headers[
                        "content-type"
                    ] || null,

                playlistLength:
                    playlist.length,

                totalLines:
                    lines.length,

                hasExtXMedia:
                    mediaLines.length > 0,

                hasAudio:
                    audioLines.length > 0,

                hasSubtitles:
                    subtitleLines.length > 0,

                hasVideoVariants:
                    streamInfLines.length > 0,

                mediaLines:
                    mediaLines.slice(
                        0,
                        100
                    ),

                audioLines:
                    audioLines.slice(
                        0,
                        100
                    ),

                subtitleLines:
                    subtitleLines.slice(
                        0,
                        100
                    ),

                streamInfLines:
                    streamInfLines.slice(
                        0,
                        100
                    ),

                videoLines:
                    videoLines.slice(
                        0,
                        100
                    ),

                segmentStats: {

                    total:
                        segmentLines.length,

                    png:
                        pngSegments.length,

                    mp4:
                        mp4Segments.length,

                    m4a:
                        m4aSegments.length,

                    aac:
                        aacSegments.length,

                    ts:
                        tsSegments.length,

                    m3u8:
                        mpegSegments.length

                },

                firstSegments:
                    segmentLines.slice(
                        0,
                        10
                    ),

                lastSegments:
                    segmentLines.slice(
                        -10
                    )

            };

            console.log(
                "[VSMOV MASTER INSPECT] RESULT:",
                JSON.stringify(
                    result
                )
            );

            return res.json(
                result
            );

        } catch (error) {

            console.log(
                "[VSMOV MASTER INSPECT ERROR]",
                error?.message ||
                error
            );

            return res.status(
                500
            ).json({

                success: false,

                error:
                    error?.message ||
                    String(error)

            });

        }

    }
);

/* ============================================================
   STREMIO ADDON ROUTES
   ============================================================ */

// =====================================================
// VSMOV PLAYER
// =====================================================

app.get(
    "/vsmov-player",
    (req, res) => {

        const targetUrl =
            String(
                req.query.url ||
                ""
            ).trim();

        const moviePageUrl =
            String(
                req.query.movie ||
                ""
            ).trim();

        if (!targetUrl) {

            return res
                .status(400)
                .send(
                    "Missing VSMov URL"
                );

        }

        let parsedUrl;

        try {

            parsedUrl =
                new URL(
                    targetUrl
                );

        } catch (error) {

            return res
                .status(400)
                .send(
                    "Invalid URL"
                );

        }

        // -------------------------------------------------
        // CHỈ CHO PHÉP HOST STREAM VSMOV
        // v1, v2, v3...
        // s1, s2, s3...
        // -------------------------------------------------

        const validVsmovHost =
            /^[sv]\d+\.streamvsmov\.com$/i
                .test(
                    parsedUrl.hostname
                );

        if (!validVsmovHost) {

            console.log(
                "[VSMOV PLAYER] Host blocked:",
                parsedUrl.hostname
            );

            return res
                .status(403)
                .send(
                    "Host not allowed"
                );

        }

        const iframeUrl =
            parsedUrl.href;

        console.log(
            "[VSMOV PLAYER] iframe:",
            iframeUrl
        );

        console.log(
            "[VSMOV PLAYER] Movie page:",
            moviePageUrl
        );

        res.setHeader(
            "Content-Type",
            "text/html; charset=utf-8"
        );

        res.send(`
<!DOCTYPE html>
<html>

<head>

    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>VSMov Player</title>

    <style>

        html,
        body {

            width: 100%;
            height: 100%;

            margin: 0;
            padding: 0;

            background: #000;

            overflow: hidden;

            font-family:
                Arial,
                sans-serif;

        }

        iframe {

            width: 100%;
            height: 100%;

            border: 0;

            display: block;

        }

        #fallback {

            position: fixed;

            inset: 0;

            display: none;

            align-items: center;
            justify-content: center;

            flex-direction: column;

            background: #000;

            color: #fff;

            text-align: center;

            padding: 30px;

            box-sizing: border-box;

            z-index: 9999;

        }

        #fallback h2 {

            margin:
                0 0 12px 0;

            font-size: 22px;

        }

        #fallback p {

            margin:
                0 0 24px 0;

            color: #bbb;

            line-height: 1.5;

        }

        #fallback a {

            display: inline-block;

            padding:
                14px 22px;

            background: #e50914;

            color: #fff;

            text-decoration: none;

            border-radius: 6px;

            font-weight: bold;

        }

        #fallback a:hover {

            opacity: 0.9;

        }

    </style>

</head>

<body>

    <iframe
        id="vsmovFrame"
        src="${iframeUrl}"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        allowfullscreen
        webkitallowfullscreen
        referrerpolicy="no-referrer">
    </iframe>

    <div id="fallback">

        <h2>
            ⚠️ VSMov không phản hồi
        </h2>

        <p>
            Nguồn phát hiện tại có thể đã ngừng hoạt động.<br>
            Bạn có thể mở trực tiếp trang phim trên VSMov<br>
            và thử nút Play tại đó.
        </p>

        ${
            moviePageUrl
                ? `
                    <a
                        href="${moviePageUrl}"
                        target="_blank"
                        rel="noopener noreferrer">
                        ▶️ Mở phim trên VSMov
                    </a>
                  `
                : `
                    <p>
                        Không tìm thấy trang phim VSMov.
                    </p>
                  `
        }

    </div>

    <script>

        const frame =
            document.getElementById(
                "vsmovFrame"
            );

        const fallback =
            document.getElementById(
                "fallback"
            );

        let loaded = false;

        frame.addEventListener(
            "load",
            function () {

                loaded = true;

                console.log(
                    "[VSMOV PLAYER] iframe loaded"
                );

            }
        );

        // -------------------------------------------------
        // Nếu sau 12 giây iframe vẫn chưa load
        // → coi như nguồn có vấn đề
        // → hiện nút mở trang phim VSMov
        // -------------------------------------------------

        setTimeout(
            function () {

                if (loaded) {

                    return;

                }

                console.log(
                    "[VSMOV PLAYER] Timeout"
                );

                frame.style.display =
                    "none";

                fallback.style.display =
                    "flex";

            },
            12000
        );

    </script>

</body>

</html>
        `);

    }
);

// =====================================================
// NGUONC CLIENT PLAYER
// =====================================================
// Client-side NguonC resolver.
//
// Vercel KHÔNG gọi NguonC.
// Browser của người dùng sẽ gọi trực tiếp NguonC API.
//
// Luồng:
// title
//   -> search
//   -> chọn phim
//   -> detail
//   -> lấy embed / m3u8
//   -> tự phát
// =====================================================

app.get(
    "/nguonc-player",
    function (req, res) {

        const title =
            String(
                req.query.title ||
                ""
            ).trim();

        res.setHeader(
            "Content-Type",
            "text/html; charset=utf-8"
        );

        res.setHeader(
            "Cache-Control",
            "no-store"
        );

        const safeTitle =
            title
                .replace(/\\/g, "\\\\")
                .replace(/`/g, "\\`")
                .replace(/\$/g, "\\$");

        res.send(`
<!DOCTYPE html>
<html lang="vi">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>NguonC Client</title>

<style>

html,
body {

    margin: 0;
    padding: 0;

    width: 100%;
    height: 100%;

    background: #000;

    color: #fff;

    font-family:
        Arial,
        sans-serif;

    overflow: hidden;

}

#status {

    position: absolute;

    inset: 0;

    display: flex;

    align-items: center;

    justify-content: center;

    text-align: center;

    padding: 30px;

    box-sizing: border-box;

    background: #000;

    z-index: 10;

}

#video {

    width: 100%;
    height: 100%;

    display: none;

    border: 0;

    background: #000;

}

#fallback {

    display: none;

    position: absolute;

    left: 50%;
    top: 50%;

    transform:
        translate(
            -50%,
            -50%
        );

    text-align: center;

    padding: 20px;

    width: 90%;

    max-width: 600px;

}

button {

    margin-top: 15px;

    padding:
        12px 20px;

    border: 0;

    border-radius: 8px;

    cursor: pointer;

    font-size: 16px;

}

</style>

</head>

<body>

<div id="status">
    Đang tìm phim trên NguonC...
</div>

<video
    id="video"
    controls
    autoplay
    playsinline
    webkit-playsinline
></video>

<div id="fallback">

    <div id="errorText"></div>

    <button
        id="openNguonC"
    >
        Mở NguonC
    </button>

</div>

<script>

const params =
    new URLSearchParams(
        window.location.search
    );

const MOVIE_TITLE =
    \`${safeTitle}\`;

const MOVIE_YEAR =
    Number(
        params.get("year") ||
        0
    );

const STREAM_TYPE =
    params.get("type") ||
    "movie";

const SEASON_NUMBER =
    Number(
        params.get("season") ||
        0
    );

const EPISODE_NUMBER =
    Number(
        params.get("episode") ||
        0
    );

const API_BASE =
    "https://phim.nguonc.com/api";

const statusEl =
    document.getElementById(
        "status"
    );

const videoEl =
    document.getElementById(
        "video"
    );

const fallbackEl =
    document.getElementById(
        "fallback"
    );

const errorTextEl =
    document.getElementById(
        "errorText"
    );

const openNguonC =
    document.getElementById(
        "openNguonC"
    );


// =====================================================
// NORMALIZE TITLE
// =====================================================

function normalizeTitle(
    value
) {

    return String(
        value ||
        ""
    )
        .normalize("NFD")
        .replace(
            /[\\\\u0300-\\\\u036f]/g,
            ""
        )
        .toLowerCase()
        .replace(
            /[^a-z0-9]+/g,
            " "
        )
        .replace(
            /\\\\s+/g,
            " "
        )
        .trim();

}


// =====================================================
// SCORE NGUONC SEARCH RESULT
// =====================================================
// TITLE = tiêu chí chính.
// YEAR  = tiêu chí ưu tiên, không phải điều kiện bắt buộc.
// =====================================================

function scoreMovie(
    item
) {

    const target =
        normalizeTitle(
            MOVIE_TITLE
        );

    const name =
        normalizeTitle(
            item?.name
        );

    const origin =
        normalizeTitle(
            item?.origin_name ||
            item?.original_name
        );

    const itemYear =
        Number(
            item?.year ||
            item?.release_year ||
            item?.releaseYear ||
            0
        );

    const rawName =
        String(
            item?.name ||
            ""
        ).trim();

    let score = 0;

    // =================================================
    // TITLE MATCH
    // =================================================

    if (name === target) {
        score += 1000;
    }

    if (origin === target) {
        score += 1000;
    }

    if (
        name.includes(target) &&
        target.length >= 4
    ) {
        score += 300;
    }

    if (
        target.includes(name) &&
        name.length >= 4
    ) {
        score += 250;
    }

    if (
        origin.includes(target) &&
        target.length >= 4
    ) {
        score += 300;
    }

    if (
        target.includes(origin) &&
        origin.length >= 4
    ) {
        score += 250;
    }

    // =================================================
    // YEAR
    // =================================================
    // Đúng năm  → cộng điểm rất cao.
    // Sai năm   → chỉ giảm nhẹ.
    // Không có năm → không phạt.
    //
    // Như vậy:
    // - Có bản đúng năm → ưu tiên bản đó.
    // - Không có bản đúng năm → vẫn chọn được phim.
    // =================================================

    if (MOVIE_YEAR > 0) {

        if (itemYear === MOVIE_YEAR) {

            score += 5000;

        } else if (itemYear > 0) {

            score -= 500;

        }

        // -------------------------------------------------
        // Kiểm tra năm nằm trong tên phim
        // Ví dụ:
        // Tây Du Ký Phần 1 (1996)
        // -------------------------------------------------

        const yearMatch =
            rawName.match(
                /((19|20)[0-9]{2})/
            );

        if (yearMatch) {

            const nameYear =
                Number(
                    yearMatch[0].replace(
                        /[^0-9]/g,
                        ""
                    )
                );

            console.log(
                "[NGUONC CLIENT] NAME YEAR:",
                rawName,
                "=>",
                nameYear
            );

            if (nameYear === MOVIE_YEAR) {

                score += 7000;

            } else {

                score -= 500;

            }
        }
    }

    return score;
}


// =====================================================
// SHOW ERROR
// =====================================================

function showError(
    message
) {

    statusEl.style.display =
        "none";

    fallbackEl.style.display =
        "block";

    errorTextEl.textContent =
        message;

}


// =====================================================
// OPEN FALLBACK
// =====================================================

openNguonC.onclick =
    function () {

        const url =
            "https://nguonc.com/tim-kiem?keyword=" +
            encodeURIComponent(
                MOVIE_TITLE
            );

        window.location.href =
            url;

    };


// =====================================================
// FIND EMBED / M3U8
// =====================================================

function findVideoUrlForEpisode(
    detail,
    seasonNumber,
    episodeNumber,
    streamType
) {

    const movie =
        detail?.movie ||
        detail?.data?.movie ||
        detail?.data?.item ||
        detail?.data ||
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

        return null;

    }

    // =================================================
    // MOVIE
    // =================================================

    if (
        streamType !==
        "series"
    ) {

        for (
            const server
            of episodes
        ) {

            const items =
                server?.items ||
                server?.server_data ||
                [];

            if (
                !Array.isArray(
                    items
                )
            ) {

                continue;

            }

            for (
                const episode
                of items
            ) {

                const m3u8 =
                    String(
                        episode?.m3u8 ||
                        episode?.link_m3u8 ||
                        ""
                    ).trim();

                if (
                    m3u8
                ) {

                    return {
                        type:
                            "m3u8",

                        url:
                            m3u8
                    };

                }

                const embed =
                    String(
                        episode?.embed ||
                        episode?.link_embed ||
                        ""
                    ).trim();

                if (
                    embed
                ) {

                    return {
                        type:
                            "embed",

                        url:
                            embed
                    };

                }

            }

        }

        return null;

    }

    // =================================================
    // SERIES
    // =================================================

    const targetEpisode =
        Number(
            episodeNumber
        ) || 1;

    console.log(
        "[NGUONC CLIENT] TARGET:",
        {
            season:
                seasonNumber,

            episode:
                targetEpisode
        }
    );

    // =================================================
    // DUYỆT SERVER
    // =================================================

    for (
        const server
        of episodes
    ) {

        const serverName =
            String(
                server?.server_name ||
                server?.name ||
                "NguonC"
            ).trim();

        const items =
            server?.items ||
            server?.server_data ||
            [];

        if (
            !Array.isArray(
                items
            )
        ) {

            continue;

        }

        console.log(
            "[NGUONC CLIENT] SERVER:",
            serverName,
            "EPISODES:",
            items.length
        );

        // =================================================
        // TÌM EPISODE
        // =================================================

        for (
            let index = 0;
            index < items.length;
            index++
        ) {

            const episode =
                items[index];

            const episodeName =
                String(
                    episode?.name ||
                    episode?.episode_name ||
                    episode?.slug ||
                    episode?.filename ||
                    ""
                ).trim();

            let detectedEpisode =
                0;

            // Ví dụ: "01"
            const directNumber =
                episodeName.match(
                    /^\s*0*(\d+)\s*$/
                );

            if (
                directNumber
            ) {

                detectedEpisode =
                    Number(
                        directNumber[1]
                    ) || 0;

            }

            // Ví dụ:
            // Tập 1
            // Tap 01
            // Episode 1
            // Ep 1
            // Part 1
            // Phần 1

            if (
                !detectedEpisode
            ) {

                const episodeMatch =
                    episodeName.match(
                        /(?:tập|tap|episode|ep\.?|part|phần)[\s_-]*0*(\d+)/i
                    );

                if (
                    episodeMatch
                ) {

                    detectedEpisode =
                        Number(
                            episodeMatch[1]
                        ) || 0;

                }

            }

            // =================================================
            // NẾU NGUONC KHÔNG GHI SỐ TẬP
            // DÙNG VỊ TRÍ TRONG DANH SÁCH
            // =================================================

            if (
                !detectedEpisode
            ) {

                detectedEpisode =
                    index + 1;

            }

            console.log(
                "[NGUONC CLIENT] CHECK EPISODE:",
                {
                    server:
                        serverName,

                    name:
                        episodeName,

                    detected:
                        detectedEpisode,

                    target:
                        targetEpisode
                }
            );

            if (
                detectedEpisode !==
                targetEpisode
            ) {

                continue;

            }

            console.log(
                "[NGUONC CLIENT] MATCH EPISODE:",
                episodeName
            );

            // =================================================
            // M3U8
            // =================================================

            const m3u8 =
                String(
                    episode?.m3u8 ||
                    episode?.link_m3u8 ||
                    ""
                ).trim();

            if (
                m3u8
            ) {

                return {
                    type:
                        "m3u8",

                    url:
                        m3u8
                };

            }

            // =================================================
            // EMBED
            // =================================================

            const embed =
                String(
                    episode?.embed ||
                    episode?.link_embed ||
                    ""
                ).trim();

            if (
                embed
            ) {

                return {
                    type:
                        "embed",

                    url:
                        embed
                };

            }

        }

    }

    return null;

}


// =====================================================
// PLAY EMBED
// =====================================================

function playEmbed(
    url
) {

    statusEl.style.display =
        "none";

    videoEl.style.display =
        "none";

    const iframe =
        document.createElement(
            "iframe"
        );

    iframe.src =
        url;

    iframe.allow =
        "autoplay; fullscreen; encrypted-media; picture-in-picture";

    iframe.allowFullscreen =
        true;

    iframe.style.position =
        "absolute";

    iframe.style.inset =
        "0";

    iframe.style.width =
        "100%";

    iframe.style.height =
        "100%";

    iframe.style.border =
        "0";

    iframe.style.background =
        "#000";

    document.body.appendChild(
        iframe
    );

}


// =====================================================
// PLAY M3U8
// =====================================================

function playM3U8(
    url
) {

    statusEl.style.display =
        "none";

    videoEl.style.display =
        "block";

    videoEl.src =
        url;

    videoEl.play()
        .catch(
            function () {

                // Một số thiết bị
                // chặn autoplay.
                // Controls vẫn hiện.

            }
        );

}


// =====================================================
// SEARCH
// =====================================================

async function searchNguonC() {

    const keywords = [];

    function addKeyword(value) {

        const keyword =
            String(value || "").trim();

        if (
            keyword &&
            !keywords.includes(keyword)
        ) {
            keywords.push(keyword);
        }
    }

    // =================================================
    // TỪ KHÓA GỐC
    // =================================================

    addKeyword(MOVIE_TITLE);

    // =================================================
    // BIẾN THỂ CHO JOURNEY TO THE WEST
    // Không dùng normalizeTitle() ở đây.
    // =================================================

    const rawTitle =
        String(
            MOVIE_TITLE || ""
        )
            .trim()
            .toLowerCase();

    if (
        rawTitle.includes(
            "journey to the west"
        )
    ) {

        addKeyword(
            "Tây Du Ký"
        );

        addKeyword(
            "Tây Du Ký Phần 1"
        );

        addKeyword(
            "Tây Du Ký 1996"
        );
    }

    console.log(
        "[NGUONC CLIENT] SEARCH KEYWORDS:",
        keywords
    );

    let allItems = [];

    // =================================================
    // CHẠY TỪNG TỪ KHÓA
    // =================================================

    for (
        const keyword of keywords
    ) {

        const searchUrl =
            API_BASE +
            "/films/search?keyword=" +
            encodeURIComponent(
                keyword
            ) +
            "&page=1";

        console.log(
            "[NGUONC CLIENT] SEARCH:",
            keyword
        );

        const response =
            await fetch(
                searchUrl,
                {
                    method: "GET",
                    headers: {
                        "Accept":
                            "application/json"
                    },
                    cache: "no-store"
                }
            );

        if (!response.ok) {

            console.warn(
                "[NGUONC CLIENT] SEARCH FAILED:",
                keyword,
                response.status
            );

            continue;
        }

        const data =
            await response.json();

        let items = [];

        if (
            Array.isArray(
                data?.items
            )
        ) {

            items =
                data.items;

        } else if (
            Array.isArray(
                data?.data
            )
        ) {

            items =
                data.data;

        } else if (
            Array.isArray(
                data?.data?.items
            )
        ) {

            items =
                data.data.items;
        }

        console.log(
            "[NGUONC CLIENT] SEARCH RESULT:",
            keyword,
            items.length
        );

        allItems =
            allItems.concat(
                items
            );
    }

    // =================================================
    // LOẠI BỎ KẾT QUẢ TRÙNG
    // =================================================

    const unique =
        [];

    const seen =
        new Set();

    for (
        const item of allItems
    ) {

        const slug =
            String(
                item?.slug ||
                ""
            ).trim();

        const key =
            slug ||
            JSON.stringify(
                item
            );

        if (
            seen.has(key)
        ) {
            continue;
        }

        seen.add(key);

        unique.push(
            item
        );
    }

    console.log(
        "[NGUONC CLIENT] TOTAL UNIQUE RESULTS:",
        unique.length
    );

    return unique;
}


// =====================================================
// LOAD DETAIL
// =====================================================

async function loadDetail(
    slug
) {

    const detailUrl =
        API_BASE +
        "/film/" +
        encodeURIComponent(
            slug
        );

    const response =
        await fetch(
            detailUrl,
            {
                method:
                    "GET",

                headers: {

                    "Accept":
                        "application/json"

                },

                cache:
                    "no-store"

            }
        );

    if (
        !response.ok
    ) {

        throw new Error(
            "NguonC detail HTTP " +
            response.status
        );

    }

    return await response.json();

}


// =====================================================
// MAIN
// =====================================================

async function startNguonC() {

    if (
        !MOVIE_TITLE
    ) {

        throw new Error(
            "Thiếu tên phim."
        );

    }

    statusEl.textContent =
        "Đang tìm: " +
        MOVIE_TITLE;

    const items =
        await searchNguonC();

    if (
        !items.length
    ) {

        throw new Error(
            "NguonC không trả về kết quả."
        );

    }

    const ranked =
        items
            .map(
                function (item) {

                    return {

                        item:
                            item,

                        score:
                            scoreMovie(
                                item
                            )

                    };

                }
            )
            .sort(
                function (a, b) {

                    return (
                        b.score -
                        a.score
                    );

                }
            );

    console.log(
        "[NGUONC CLIENT] SEARCH RESULTS:",
        ranked.map(
            function (entry) {

                return {

                    name:
                        entry.item?.name,

                    origin_name:
                        entry.item?.origin_name ||
                        entry.item?.original_name,

                    year:
                        entry.item?.year ||
                        entry.item?.release_year ||
                        entry.item?.releaseYear,

                    slug:
                        entry.item?.slug,

                    score:
                        entry.score

                };

            }
        )
    );

    // =====================================================
// CHỌN PHIM NGUONC
// =====================================================
// Tên phim là tiêu chí chính.
// Năm chỉ dùng để ưu tiên phiên bản đúng năm.
// Không loại bỏ phim chỉ vì NguonC thiếu/khác year.
// =====================================================

let selectedEntry = null;
let selectedDetail = null;

// -----------------------------------------------------
// 1. ƯU TIÊN KẾT QUẢ ĐÚNG NĂM
// -----------------------------------------------------

if (MOVIE_YEAR > 0) {

    selectedEntry =
        ranked.find(function (entry) {

            const item =
                entry.item || {};

            const itemYear =
                Number(
                    item?.year ||
                    item?.release_year ||
                    item?.releaseYear ||
                    0
                );

            const rawName =
                String(
                    item?.name ||
                    ""
                ).trim();

            const yearMatch =
                rawName.match(
                    /\((19|20)[0-9]{2}\)/
                );

            let nameYear = 0;

            if (yearMatch) {
                nameYear =
                    Number(
                        yearMatch[0].replace(
                            /[^0-9]/g,
                            ""
                        )
                    );
            }

            if (
                itemYear === MOVIE_YEAR ||
                nameYear === MOVIE_YEAR
            ) {

                console.log(
                    "[NGUONC CLIENT] EXACT YEAR MATCH:",
                    {
                        name: rawName,
                        apiYear: itemYear,
                        nameYear: nameYear,
                        targetYear: MOVIE_YEAR
                    }
                );

                return true;
            }

            return false;
        });

    console.log(
        "[NGUONC CLIENT] SELECTED BY YEAR:",
        selectedEntry?.item
            ? {
                name: selectedEntry.item.name,
                origin_name:
                    selectedEntry.item.origin_name ||
                    selectedEntry.item.original_name,
                year:
                    selectedEntry.item.year ||
                    selectedEntry.item.release_year ||
                    selectedEntry.item.releaseYear,
                slug: selectedEntry.item.slug
            }
            : null
    );
}

// -----------------------------------------------------
// 2. KHÔNG CÓ BẢN ĐÚNG NĂM
// -----------------------------------------------------
// Không báo lỗi.
// Dùng kết quả phù hợp nhất theo TITLE SCORE.
// -----------------------------------------------------

if (!selectedEntry) {

    selectedEntry =
        ranked.find(function (entry) {

            const item =
                entry.item || {};

            return Boolean(
                item?.slug
            );

        }) || null;

    console.log(
        "[NGUONC CLIENT] FALLBACK BY TITLE:",
        selectedEntry?.item
            ? {
                name: selectedEntry.item.name,
                origin_name:
                    selectedEntry.item.origin_name ||
                    selectedEntry.item.original_name,
                year:
                    selectedEntry.item.year ||
                    selectedEntry.item.release_year ||
                    selectedEntry.item.releaseYear,
                slug: selectedEntry.item.slug
            }
            : null
    );
}

// -----------------------------------------------------
// 3. HOÀN TOÀN KHÔNG CÓ KẾT QUẢ
// -----------------------------------------------------

if (!selectedEntry) {

    throw new Error(
        "NguonC có kết quả nhưng không tìm được phim phù hợp."
    );
}

const selected =
    selectedEntry?.item ||
    null;

if (!selected?.slug) {

    throw new Error(
        "Không tìm được slug phim trên NguonC."
    );

}
    console.log(
        "[NGUONC CLIENT] SELECTED:",
        {
            name:
                selected?.name,

            origin_name:
                selected?.origin_name ||
                selected?.original_name,

            year:
                selected?.year ||
                selected?.release_year ||
                selected?.releaseYear,

            slug:
                selected?.slug
        }
    );

    statusEl.textContent =
    "Đã tìm thấy: " +
    (
        selected.name ||
        MOVIE_TITLE
    ) +
    " - Đang tải video...";

    const detail =
    selectedDetail ||
    await loadDetail(
        selected.slug
    );

    const video =
        findVideoUrlForEpisode(
            detail,
            SEASON_NUMBER,
            EPISODE_NUMBER,
            STREAM_TYPE
        );

    if (
        !video
    ) {

        throw new Error(
            "Phim có trên NguonC nhưng không tìm thấy link phát cho tập " +
            (
                EPISODE_NUMBER ||
                1
            ) +
            "."
        );

    }

    if (
        video.type ===
        "m3u8"
    ) {

        playM3U8(
            video.url
        );

        return;

    }

    if (
        video.type ===
        "embed"
    ) {

        playEmbed(
            video.url
        );

        return;

    }

    throw new Error(
        "Không xác định được loại video."
    );

}


// =====================================================
// START
// =====================================================

startNguonC()
    .catch(
        function (error) {

            console.error(
                "[NGUONC CLIENT]",
                error
            );

            showError(
                "Không thể tự phát NguonC.\\n\\n" +
                (
                    error?.message ||
                    "Lỗi không xác định."
                )
            );

        }
    );

</script>

</body>
</html>
        `);

    }
);

// ============================================================
// PHIM LONG TIẾNG - HLS VIDEO INTERCEPTOR
//
// Android Provider:
//     M3U8
//       ↓
//     VideoInterceptor
//       ↓
//     upstream server
//
// Vercel:
//     Stremio
//       ↓
//     /phimlongtieng/hls
//       ↓
//     upstream M3U8 / segment
//
// ============================================================

// ============================================================
// PHIM LONG TIẾNG - HLS HEAD CHECK
//
// Một số web player kiểm tra URL bằng HEAD trước khi GET.
// Không cần fetch upstream ở đây.
// Chỉ xác nhận endpoint tồn tại và cho phép CORS.
// ============================================================

app.head(
    "/phimlongtieng/hls",
    (req, res) => {

        console.log(
            "[PLT PROXY] HEAD REQUEST:",
            req.query?.url || ""
        );

        res.setHeader(
            "Access-Control-Allow-Origin",
            "*"
        );

        res.setHeader(
            "Access-Control-Allow-Headers",
            "*"
        );

        res.setHeader(
            "Content-Type",
            "application/vnd.apple.mpegurl"
        );

        return res
            .status(200)
            .end();
    }
);

app.get(
    "/phimlongtieng/hls",
    async (req, res) => {

        try {

            const rawUrl =
                String(
                    req.query?.url || ""
                ).trim();

            if (!rawUrl) {

                return res
                    .status(400)
                    .send(
                        "Missing url"
                    );
            }

            // =================================================
            // PARSE UPSTREAM URL
            // =================================================

            let targetUrl;

            try {

                targetUrl =
                    new URL(rawUrl);

            } catch (_) {

                return res
                    .status(400)
                    .send(
                        "Invalid url"
                    );
            }

            const hostname =
                targetUrl.hostname
                    .toLowerCase();

            // =================================================
            // CHỈ CHO PHÉP SERVER PHIMLONGTIENG
            //
            // Tránh biến endpoint này thành open proxy.
            // =================================================

            const allowedHost =
                hostname === "1phim34.com" ||
                hostname === "www.1phim34.com" ||
                hostname === "play.cbplay.cc" ||
                hostname.endsWith(".cbplay.cc");

            if (!allowedHost) {

                console.log(
                    "[PLT PROXY] BLOCKED HOST:",
                    hostname
                );

                return res
                    .status(403)
                    .send(
                        "Host not allowed"
                    );
            }

            // =================================================
            // REFERER
            // =================================================

            let referer;

            if (
                hostname === "play.cbplay.cc" ||
                hostname.endsWith(".cbplay.cc")
            ) {

                referer =
                    "https://play.cbplay.cc/";

            } else {

                referer =
                    "https://www.1phim34.com/";
            }

            // =================================================
            // USER AGENT
            // =================================================

            const userAgent =
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/131.0.0.0 Safari/537.36";

            // =================================================
            // RANGE
            //
            // HLS segment đôi khi player gửi Range.
            // =================================================

            const requestHeaders = {

                "User-Agent":
                    userAgent,

                "Accept":
                    "*/*",

                "Referer":
                    referer,

                "Origin":
                    new URL(referer).origin,

                "Connection":
                    "keep-alive"

            };

            if (req.headers.range) {

                requestHeaders.Range =
                    req.headers.range;
            }

            console.log(
                "[PLT PROXY] REQUEST:"
            );

            console.log(
                "  HOST:",
                hostname
            );

            console.log(
                "  REFERER:",
                referer
            );

            console.log(
                "  URL:",
                targetUrl.href
            );

            // =================================================
            // FETCH UPSTREAM
            // =================================================

            const upstream =
                await fetch(
                    targetUrl.href,
                    {
                        method: "GET",

                        redirect:
                            "follow",

                        headers:
                            requestHeaders
                    }
                );

            console.log(
                "[PLT PROXY] UPSTREAM STATUS:",
                upstream.status
            );

            console.log(
                "[PLT PROXY] FINAL URL:",
                upstream.url
            );

            if (
                !upstream.ok
            ) {

                return res
                    .status(
                        upstream.status
                    )
                    .send(
                        `Upstream HTTP ${upstream.status}`
                    );
            }

            // =================================================
            // CONTENT TYPE
            // =================================================

            const contentType =
                String(
                    upstream.headers.get(
                        "content-type"
                    ) || ""
                ).toLowerCase();

            const finalUrl =
                upstream.url ||
                targetUrl.href;

            const isM3U8 =
                contentType.includes(
                    "mpegurl"
                ) ||
                /\.m3u8(?:[?#]|$)/i.test(
                    finalUrl
                );

            // =================================================
// M3U8
//
// Phần quan trọng nhất:
//
// master.m3u8
//     ↓
// child.m3u8
//     ↓
// segment.ts
//
// Tất cả URL bên trong playlist
// đều được đưa trở lại proxy.
// =================================================

if (isM3U8) {

    const playlist =
        await upstream.text();

    console.log(
        "[PLT PROXY] M3U8 LENGTH:",
        playlist.length
    );

    // ============================================================
    // DEBUG M3U8 CONTENT
    // ============================================================

    const m3u8Lines =
        playlist
            .split(/\r?\n/)
            .filter(Boolean);

    console.log(
        "[PLT PROXY] M3U8 FIRST 10 LINES:",
        m3u8Lines
            .slice(0, 10)
            .join("\n")
    );

    console.log(
        "[PLT PROXY] M3U8 URI SAMPLE:",
        m3u8Lines
            .filter(line =>
                !line.startsWith("#")
            )
            .slice(0, 5)
    );

    console.log(
        "[PLT PROXY] M3U8 HAS EXTINF:",
        playlist.includes("#EXTINF")
    );

    console.log(
        "[PLT PROXY] M3U8 HAS M3U8:",
        /\.m3u8/i.test(playlist)
    );

    const baseUrl =
        finalUrl;

                // =================================================
                // PROXY URL HELPER
                // =================================================

                function proxyChildUrl(
                    rawChildUrl
                ) {

                    if (
                        !rawChildUrl
                    ) {
                        return rawChildUrl;
                    }

                    const value =
                        String(
                            rawChildUrl
                        ).trim();

                    if (
                        !value ||
                        value.startsWith("data:")
                    ) {
                        return value;
                    }

                    try {

                        const absolute =
                            new URL(
                                value,
                                baseUrl
                            );

                        const childHost =
                            absolute.hostname
                                .toLowerCase();

                        const childAllowed =
                            childHost ===
                                "1phim34.com" ||

                            childHost ===
                                "www.1phim34.com" ||

                            childHost ===
                                "play.cbplay.cc" ||

                            childHost.endsWith(
                                ".cbplay.cc"
                            );

                        if (
                            !childAllowed
                        ) {

                            return absolute.href;
                        }

                        return (
                            "/phimlongtieng/hls?url=" +
                            encodeURIComponent(
                                absolute.href
                            )
                        );

                    } catch (_) {

                        return value;
                    }
                }

                // =================================================
                // REWRITE URI="..."
                //
                // Dùng cho:
                //
                // #EXT-X-KEY
                // #EXT-X-MAP
                // #EXT-X-MEDIA
                // ...
                // =================================================

                let rewritten =
                    playlist.replace(
                        /URI="([^"]+)"/gi,
                        (full, uri) => {

                            return (
                                'URI="' +
                                proxyChildUrl(
                                    uri
                                ) +
                                '"'
                            );
                        }
                    );

                // =================================================
                // REWRITE CÁC DÒNG URL
                //
                // Ví dụ:
                //
                // segment001.ts
                // https://.../segment002.ts
                // child/index.m3u8
                //
                // Không đụng vào dòng #EXT...
                // =================================================

                rewritten =
                    rewritten
                        .split(/\r?\n/)
                        .map(line => {

                            const trimmed =
                                line.trim();

                            if (
                                !trimmed ||
                                trimmed.startsWith("#")
                            ) {
                                return line;
                            }

                            return proxyChildUrl(
                                trimmed
                            );
                        })
                        .join("\n");

                // =================================================
                // RESPONSE
                // =================================================

                res.status(
                    upstream.status
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

                res.setHeader(
                    "Access-Control-Allow-Headers",
                    "*"
                );

                return res.send(
                    rewritten
                );
            }

            // =================================================
            // VIDEO / TS / BINARY
            //
            // Ví dụ:
            //
            // .ts
            // .aac
            // .mp4
            // key.bin
            //
            // Không rewrite.
            // Chỉ relay binary về Stremio.
            // =================================================

            const buffer =
                Buffer.from(
                    await upstream.arrayBuffer()
                );

            // =================================================
            // COPY MỘT SỐ RESPONSE HEADERS
            // =================================================

            const responseContentType =
                upstream.headers.get(
                    "content-type"
                );

            if (
                responseContentType
            ) {

                res.setHeader(
                    "Content-Type",
                    responseContentType
                );
            }

            const contentLength =
                upstream.headers.get(
                    "content-length"
                );

            if (
                contentLength
            ) {

                res.setHeader(
                    "Content-Length",
                    contentLength
                );
            }

            const contentRange =
                upstream.headers.get(
                    "content-range"
                );

            if (
                contentRange
            ) {

                res.setHeader(
                    "Content-Range",
                    contentRange
                );
            }

            const acceptRanges =
                upstream.headers.get(
                    "accept-ranges"
                );

            if (
                acceptRanges
            ) {

                res.setHeader(
                    "Accept-Ranges",
                    acceptRanges
                );
            }

            res.setHeader(
                "Cache-Control",
                "no-store"
            );

            res.setHeader(
                "Access-Control-Allow-Origin",
                "*"
            );

            res.setHeader(
                "Access-Control-Allow-Headers",
                "*"
            );

            return res
                .status(
                    upstream.status
                )
                .send(buffer);

        } catch (e) {

            console.log(
                "[PLT PROXY] ERROR:",
                e?.message ||
                e
            );

            if (
                !res.headersSent
            ) {

                return res
                    .status(502)
                    .send(
                        "PhimLongTieng proxy error"
                    );
            }
        }
    }
);

// =====================================================
// STREMIO ADDON ROUTER
// =====================================================

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
