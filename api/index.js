const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

const crypto = require('crypto');
const http2 = require('http2');
const express = require('express');

const manifest = {

    id:
        "community.paproplayer.multisource.v2000",

    version:
        "0.1.0",

    name:
        "MOVINA",

    description:
        "He thong gop nguon truc tiep",

    resources: [
        "catalog",
        "meta",
        "stream"
    ],

    types: [
        "movie",
        "series",
        "tv",
        "MOVINA"
    ],

    idPrefixes: [
        "tt",
        "vnwpsw:",
        "vmttv:"
    ],

    catalogs: [

        // =====================================================
        // VOD
        // =====================================================

        {
            type: "MOVINA",
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
            type: "MOVINA",
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
            type: "MOVINA",
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
            type: "MOVINA",
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
            type: "MOVINA",
            id: "pa_animation_new",
            name: "🐼 Hoạt hình - New",
            extra: [
                {
                    name: "search",
                    isRequired: false
                }
            ]
        },

        // =====================================================
        // LIVE TV
        // =====================================================

        {
            type: "tv",

            id: "pa_vmttv",

            name: "🔴 VMT TV",

            extra: [
                {
                    name: "search",
                    isRequired: false
                },

                {
    name: "genre",
    isRequired: false,

    options: [
        "FIFA WORLD CUP 2026",
        "Sự Kiện",
        "THỂ THAO QT",
        "⚽ Thể thao QT",
        "TVB",
        "LIVE EVENTS 🔴",
        "Sự Kiện TV360",
        "Sự Kiện VTVPrime",
        "Rạp Phim",
        "VTV",
        "VTVcab",
        "SCTV",
        "📦 In The Box",
        "HTV",
        "HTVC",
        "🌐 Thiết yếu",
        "Địa phương",
        "Quốc Tế",
        "Radio",
        "🇻🇳 Vietnam Radio",
        "🇬🇧 UK Radio",
        "🇰🇷 Hàn Quốc",
        "🇨🇳 Trung Quốc",
        "🇹🇭 Thái Lan",
        "🇰🇭 Campuchia"
    ],

    optionsLimit: 1
}
            ]
        }
    ]
};

const builder =
    new addonBuilder(manifest);


/* ============================================================
   1.UTILITY
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
   2. POSTER
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
3. CATALOG
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

/* ============================================================
   4. CATALOG POSTER
   ============================================================ */

function catalogPoster(item) {

    const raw =
        item?.poster_url ||
        item?.thumb_url ||
        item?.poster ||
        "";

    if (!raw) {
        return "";
    }

    const value =
        String(raw).trim();

    /*
       Đã là URL đầy đủ.
    */

    if (
        /^https?:\/\//i.test(value)
    ) {
        return value;
    }

    /*
       Protocol-relative URL.
    */

    if (
        value.startsWith("//")
    ) {
        return "https:" + value;
    }

    /*
       Poster dạng uploads/movies/...
       thường thuộc phimapi.com.
    */

    if (
        value.startsWith(
            "uploads/movies/"
        )
    ) {
        return (
            "https://phimapi.com/" +
            value
        );
    }

    /*
       Poster dạng upload/vod/...
       thường thuộc phimimg.com.
    */

    if (
        value.startsWith(
            "upload/vod/"
        )
    ) {
        return (
            "https://phimimg.com/" +
            value
        );
    }

    /*
       Fallback.
    */

    return (
        "https://phimimg.com/" +
        value.replace(/^\/+/, "")
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

    if (!item) {
        return false;
    }

    /*
       Nếu item được tạo từ nguồn hoạt hình
       riêng thì tin cậy tuyệt đối.
    */

    if (
        item.__isAnimation === true
    ) {
        return true;
    }

    const categories =
        catalogCategoryNames(item);

    return categories.some(
        x =>
            x === "hoat hinh" ||
            x === "animation" ||
            x === "anime" ||
            x.includes("hoat hinh")
    );
}

function isJapanese(item) {

    const countries =
        catalogCountryNames(item);

    return countries.some(
        country =>
            country === "nhat ban" ||
            country === "japan"
    );
}

function isAmericanWestern(item) {

    const countries =
        catalogCountryNames(item);

    /*
       Nhóm Mỹ / Âu / phương Tây.

       Không dùng includes("my"), includes("anh")...
       vì có thể nhận nhầm tên quốc gia khác.

       PhimAPI thường dùng "Âu Mỹ" cho nhóm
       phim Mỹ / Âu.
    */

    const westernCountries = new Set([
        "au my",
        "my",
        "hoa ky",
        "united states",
        "united states of america",
        "usa",
        "anh",
        "vuong quoc anh",
        "united kingdom",
        "uk",
        "phap",
        "duc",
        "canada",
        "uc",
        "australia",
        "new zealand",
        "italia",
        "y",
        "tay ban nha",
        "tbn",
        "spain",
        "bo dao nha",
        "ireland",
        "tho nhi ky",
        "netherlands",
        "ha lan",
        "belgium",
        "bi",
        "sweden",
        "thuy dien",
        "norway",
        "na uy",
        "denmark",
        "phan lan",
        "finland",
        "switzerland",
        "ao",
        "austria"
    ]);

    return countries.some(
        country =>
            westernCountries.has(
                country
            )
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
   5. XÁC ĐỊNH MOVIE / SERIES
   ============================================================ */

function isSeriesItem(item) {

    if (!item) {
        return false;
    }

    /*
       ========================================================
       5.1. TYPE NỘI BỘ DO CHÚNG TA GÁN
       ========================================================
    */

    if (
        item.__catalogType ===
        "series"
    ) {
        return true;
    }

    if (
        item.__catalogType ===
        "movie"
    ) {
        return false;
    }

    /*
       ========================================================
       5.2. TYPE CỦA PHIMAPI
       ========================================================
    */

    const rawType =
        String(
            item?.type ||
            ""
        )
            .trim()
            .toLowerCase();

    if (
        rawType === "series" ||
        rawType === "tvshows" ||
        rawType === "tvshow"
    ) {
        return true;
    }

    if (
        rawType === "single" ||
        rawType === "movie"
    ) {
        return false;
    }

    /*
       "hoathinh" chỉ cho biết đây là hoạt hình,
       KHÔNG tự nó cho biết movie hay series.
    */

    /*
       ========================================================
       5.3. TMDB TYPE
       ========================================================
    */

    const tmdbType =
        String(
            item?.tmdb?.type ||
            ""
        )
            .trim()
            .toLowerCase();

    if (
        tmdbType === "tv" ||
        tmdbType === "series"
    ) {
        return true;
    }

    if (
        tmdbType === "movie"
    ) {
        return false;
    }

    /*
       ========================================================
       5.4. DẤU HIỆU PHỤ TỪ SỐ TẬP
       ========================================================
    */

    const episodeCurrent =
        String(
            item?.episode_current ||
            ""
        )
            .trim()
            .toLowerCase();

    const episodeTotal =
        String(
            item?.episode_total ||
            ""
        )
            .trim()
            .toLowerCase();

    const looksLikeSeries =
        (
            episodeTotal &&
            episodeTotal !== "1" &&
            episodeTotal !== "full"
        ) ||
        (
            episodeCurrent &&
            episodeCurrent !== "full" &&
            /\d/.test(
                episodeCurrent
            )
        );

    if (
        looksLikeSeries
    ) {
        return true;
    }

    /*
       Không đủ bằng chứng
       => movie.
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
6. MOVIE TRENDING
============================================================ */

async function fetchMovieTrending() {

    const pages = [];

    /*
       Lấy nhiều trang phim chiếu rạp
       để có đủ dữ liệu mới nhất.
    */

    for (
        let page = 1;
        page <= 6;
        page++
    ) {

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
        await Promise.all(
            pages
        );

    let items =
        catalogDedupe(
            groups.flat()
        );

    /*
       Chỉ lấy phim lẻ.
    */

    items =
        items.filter(
            item =>
                !isSeriesItem(item)
        );

    /*
       Ưu tiên phim mới:
       1. Năm phát hành mới hơn
       2. Ngày cập nhật mới hơn
    */

    items =
        items.sort(
            (a, b) => {

                const yearA =
                    itemYear(a);

                const yearB =
                    itemYear(b);

                if (
                    yearB !==
                    yearA
                ) {
                    return (
                        yearB -
                        yearA
                    );
                }

                const modifiedA =
                    Date.parse(
                        a?.modified?.time ||
                        ""
                    ) || 0;

                const modifiedB =
                    Date.parse(
                        b?.modified?.time ||
                        ""
                    ) || 0;

                return (
                    modifiedB -
                    modifiedA
                );
            }
        );

    return items.slice(
        0,
        CATALOG_TARGET
    );

}

/* ============================================================
7. SERIES TRENDING
============================================================ */

/*
   phim-bo-dang-chieu KHÔNG tồn tại ở endpoint hiện tại.

   Dùng phim-bo + year/modified để ưu tiên
   các phim bộ mới nhất.
*/

async function fetchSeriesTrending() {

    const pages = [];

    /*
       Lấy nhiều trang hơn để có đủ dữ liệu
       trước khi chọn 50 phim bộ.
    */

    for (
        let page = 1;
        page <= 6;
        page++
    ) {

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
        await Promise.all(
            pages
        );

    let items =
        catalogDedupe(
            groups.flat()
        );

    /*
       Chỉ giữ phim bộ.
    */

    items =
        items.filter(
            item =>
                isSeriesItem(item)
        );

    /*
       Ưu tiên phim mới:
       1. Năm phát hành mới hơn
       2. Ngày cập nhật mới hơn
    */

    items =
        items.sort(
            (a, b) => {

                const yearA =
                    itemYear(a);

                const yearB =
                    itemYear(b);

                if (
                    yearB !==
                    yearA
                ) {
                    return (
                        yearB -
                        yearA
                    );
                }

                const modifiedA =
                    Date.parse(
                        a?.modified?.time ||
                        ""
                    ) || 0;

                const modifiedB =
                    Date.parse(
                        b?.modified?.time ||
                        ""
                    ) || 0;

                return (
                    modifiedB -
                    modifiedA
                );
            }
        );

    return items.slice(
        0,
        CATALOG_TARGET
    );

}

/* ============================================================
   8. TVB
   ============================================================ */

async function fetchTVB() {

    const seriesPages = [];
    const moviePages = [];

    /*
       Lấy nhiều trang để có đủ dữ liệu.

       Mục tiêu:
       - 25 phim bộ
       - 25 phim lẻ
       - Tổng 50 item
       - 35 mới
       - 15 cũ

       Quy ước:
       - Mới = năm hiện tại hoặc năm trước
       - Cũ = các năm trước đó
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
       ========================================================
       8.1 PHÂN LOẠI MỚI / CŨ
       ========================================================
    */

    const currentYear =
        new Date().getFullYear();

    const isNew =
        item =>
            itemYear(item) >=
            currentYear - 1;

    const isOld =
        item =>
            itemYear(item) > 0 &&
            itemYear(item) <
            currentYear - 1;

    const seriesNew =
        hkSeries.filter(isNew);

    const seriesOld =
        hkSeries.filter(isOld);

    const moviesNew =
        hkMovies.filter(isNew);

    const moviesOld =
        hkMovies.filter(isOld);

    console.log(
        "[TVB] New:",
        seriesNew.length +
        moviesNew.length,
        "| Old:",
        seriesOld.length +
        moviesOld.length
    );

    /*
       ========================================================
       8.2 MỤC TIÊU
       ========================================================

       25 series:
       - 18 mới
       - 7 cũ

       25 movie:
       - 17 mới
       - 8 cũ

       Tổng:
       - 35 mới
       - 15 cũ
    */

    const selectedSeriesNew =
        stableShuffle(
            seriesNew,
            "tvb|series|new"
        ).slice(
            0,
            18
        );

    const selectedSeriesOld =
        stableShuffle(
            seriesOld,
            "tvb|series|old"
        ).slice(
            0,
            7
        );

    const selectedMoviesNew =
        stableShuffle(
            moviesNew,
            "tvb|movies|new"
        ).slice(
            0,
            17
        );

    const selectedMoviesOld =
        stableShuffle(
            moviesOld,
            "tvb|movies|old"
        ).slice(
            0,
            8
        );

    let selectedSeries =
        [
            ...selectedSeriesNew,
            ...selectedSeriesOld
        ];

    let selectedMovies =
        [
            ...selectedMoviesNew,
            ...selectedMoviesOld
        ];

    /*
       ========================================================
       8.3 BÙ NẾU MỚI / CŨ KHÔNG ĐỦ
       ========================================================

       Ưu tiên vẫn giữ:
       - 25 series
       - 25 movie
       - đủ 50 item nếu nguồn cho phép.
    */

    if (
        selectedSeries.length <
        25
    ) {

        const used =
            new Set(
                selectedSeries.map(
                    catalogKey
                )
            );

        const fallbackSeries =
            stableShuffle(
                hkSeries.filter(
                    item =>
                        !used.has(
                            catalogKey(item)
                        )
                ),
                "tvb|series|fallback"
            );

        selectedSeries.push(
            ...fallbackSeries.slice(
                0,
                25 -
                selectedSeries.length
            )
        );
    }

    if (
        selectedMovies.length <
        25
    ) {

        const used =
            new Set(
                selectedMovies.map(
                    catalogKey
                )
            );

        const fallbackMovies =
            stableShuffle(
                hkMovies.filter(
                    item =>
                        !used.has(
                            catalogKey(item)
                        )
                ),
                "tvb|movies|fallback"
            );

        selectedMovies.push(
            ...fallbackMovies.slice(
                0,
                25 -
                selectedMovies.length
            )
        );
    }

    /*
       Giữ đúng tối đa:
       - 25 series
       - 25 movie
    */

    selectedSeries =
        catalogDedupe(
            selectedSeries
        ).slice(
            0,
            25
        );

    selectedMovies =
        catalogDedupe(
            selectedMovies
        ).slice(
            0,
            25
        );

    /*
       ========================================================
       8.4 NẾU MỘT BÊN THIẾU
       ========================================================
    */

    let result =
        catalogDedupe([
            ...selectedSeries,
            ...selectedMovies
        ]);

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
       Cuối cùng chỉ giữ 50.
    */

    result =
        catalogDedupe(
            result
        ).slice(
            0,
            CATALOG_TARGET
        );

    /*
       Trộn phim bộ + phim lẻ
       để giao diện không chia thành
       25 series rồi 25 movie.
    */

    result =
        stableShuffle(
            result,
            "tvb|final"
        );

    const finalNew =
        result.filter(
            isNew
        ).length;

    const finalOld =
        result.filter(
            isOld
        ).length;

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
        ).length,
        "| New:",
        finalNew,
        "| Old:",
        finalOld
    );

    return result;
}

/* ============================================================
9. DAILY
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

    /*
       ========================================================
       9.1 TIÊU CHÍ
       ========================================================

       Tổng:
       - 50 item
       - 45 Movie
       - 5 Series

       Trong đó:
       - đúng 1 Animation
       - Animation được tính là Movie
       - 49 item thường:
         + 44 Movie
         + 5 Series
       - IMDb >= 6.0
       - 49 item thường chia đều theo thập niên
       - Không giới hạn quốc gia
       - Random ổn định theo ngày
    */

    /*
       ========================================================
       9.2 NGUỒN PHIM THƯỜNG
       ========================================================
    */

    const normalSources = [];

    for (
        let page = 1;
        page <= 5;
        page++
    ) {

        normalSources.push(
            catalogFetch(
                "https://phimapi.com/v1/api/" +
                "danh-sach/phim-le" +
                "?page=" +
                page +
                "&limit=24"
            )
                .then(
                    items =>
                        items.map(
                            item => ({
                                ...item,
                                __catalogType:
                                    "movie"
                            })
                        )
                )
        );

        normalSources.push(
            catalogFetch(
                "https://phimapi.com/v1/api/" +
                "danh-sach/phim-bo" +
                "?page=" +
                page +
                "&limit=24"
            )
                .then(
                    items =>
                        items.map(
                            item => ({
                                ...item,
                                __catalogType:
                                    "series"
                            })
                        )
                )
        );
    }

    /*
   ========================================================
   9.3 NGUỒN HOẠT HÌNH
   ========================================================

   Dùng endpoint trực tiếp /danh-sach/hoat-hinh.

   Endpoint này chứa cả:
   - Anime / hoạt hình Nhật
   - Cartoon / hoạt hình Mỹ, Âu-Mỹ
   - Hoạt hình các nước khác

   Dùng isSeriesItem() để xác định Movie / Series.
*/

const animationSources = [];

for (
    let page = 1;
    page <= 12;
    page++
) {

    animationSources.push(
        catalogFetch(
            "https://phimapi.com/v1/api/" +
            "danh-sach/hoat-hinh" +
            "?page=" +
            page +
            "&limit=24"
        )
            .then(
                items =>
                    items.map(
                        item => {

                            const series =
                                isSeriesItem(
                                    item
                                );

                            return {
                                ...item,

                                __catalogType:
                                    series
                                        ? "series"
                                        : "movie",

                                __isAnimation:
                                    true
                            };
                        }
                    )
            )
    );
}

    const [
        normalGroups,
        animationGroups
    ] =
        await Promise.all([
            Promise.all(
                normalSources
            ),
            Promise.all(
                animationSources
            )
        ]);

    /*
       ========================================================
       9.4 IMDb >= 6.0
       ========================================================
    */

    function imdbRating(item) {

        const raw =
            item?.imdb?.vote_average ??
            item?.imdb?.rating ??
            null;

        if (
            raw === null ||
            raw === undefined ||
            raw === ""
        ) {
            return 0;
        }

        const rating =
            Number(raw);

        return Number.isFinite(rating)
            ? rating
            : 0;
    }

    function hasGoodIMDb(item) {

        return (
            imdbRating(item) >=
            6.0
        );
    }

    const normal =
        catalogDedupe(
            normalGroups.flat()
        )
            .filter(
                item =>
                    !isAnimation(item) &&
                    hasGoodIMDb(item)
            );

    const animation =
        catalogDedupe(
            animationGroups.flat()
        )
            .filter(
                item =>
                    item.__isAnimation === true &&
                    hasGoodIMDb(item)
            );

    console.log(
        "[DAILY] IMDb >= 6:",
        normal.length,
        "| Animation:",
        animation.length
    );

    /*
       ========================================================
       9.5 49 ITEM THƯỜNG
       ========================================================

       Mục tiêu:
       - 44 Movie
       - 5 Series
       - tổng 49

       Đồng thời chia đều theo các thập niên
       có đủ dữ liệu.
    */

    const decadePools =
        new Map();

    for (
        const item
        of normal
    ) {

        const decade =
            decadeOf(item);

        if (!decade) {
            continue;
        }

        if (
            !decadePools.has(
                decade
            )
        ) {

            decadePools.set(
                decade,
                {
                    movies: [],
                    series: []
                }
            );
        }

        if (
            isSeriesItem(item)
        ) {

            decadePools
                .get(decade)
                .series
                .push(item);

        } else {

            decadePools
                .get(decade)
                .movies
                .push(item);
        }
    }

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

    /*
       Nếu có 7 thập niên như dữ liệu hiện tại:
       49 / 7 = 7 item mỗi thập niên.

       Nếu số thập niên thay đổi,
       vẫn chia tương đối đều.
    */

    const targetNormal = 49;

    const decadeTargets =
        new Map();

    if (
        decades.length
    ) {

        const base =
            Math.floor(
                targetNormal /
                decades.length
            );

        let remainder =
            targetNormal %
            decades.length;

        for (
            const decade
            of decades
        ) {

            let target =
                base;

            if (
                remainder > 0
            ) {

                target++;
                remainder--;
            }

            decadeTargets.set(
                decade,
                target
            );
        }
    }

    /*
       ========================================================
       9.6 PHÂN BỔ MOVIE / SERIES
       ========================================================

       49 item thường:
       - 44 Movie
       - 5 Series

       Series được rải đều vào các thập niên,
       không dồn thành một nhóm.
    */

    const seriesQuota =
        new Map();

    let remainingSeries = 5;

    for (
        const decade
        of decades
    ) {

        if (
            remainingSeries <= 0
        ) {
            seriesQuota.set(
                decade,
                0
            );
            continue;
        }

        const target =
            decadeTargets.get(
                decade
            ) || 0;

        /*
           Mỗi thập niên tối đa 1 series
           để danh sách nhìn tự nhiên hơn.
        */

        const quota =
            Math.min(
                1,
                target
            );

        seriesQuota.set(
            decade,
            quota
        );

        remainingSeries -=
            quota;
    }

    /*
       Nếu có ít hơn 5 thập niên,
       phân bổ phần series còn thiếu.
    */

    if (
        remainingSeries > 0
    ) {

        for (
            const decade
            of decades
        ) {

            if (
                remainingSeries <= 0
            ) {
                break;
            }

            const target =
                decadeTargets.get(
                    decade
                ) || 0;

            const current =
                seriesQuota.get(
                    decade
                ) || 0;

            if (
                current <
                target
            ) {

                seriesQuota.set(
                    decade,
                    current + 1
                );

                remainingSeries--;
            }
        }
    }

    /*
       ========================================================
       9.7 CHỌN 49 ITEM
       ========================================================
    */

    const selected = [];

    for (
        const decade
        of decades
    ) {

        const pool =
            decadePools.get(
                decade
            );

        const target =
            decadeTargets.get(
                decade
            ) || 0;

        const targetSeries =
            Math.min(
                seriesQuota.get(
                    decade
                ) || 0,
                pool.series.length
            );

        const targetMovies =
            Math.max(
                0,
                target -
                targetSeries
            );

        const series =
            stableShuffle(
                pool.series,
                today +
                "|daily|" +
                decade +
                "|series"
            )
                .slice(
                    0,
                    targetSeries
                );

        const movies =
            stableShuffle(
                pool.movies,
                today +
                "|daily|" +
                decade +
                "|movies"
            )
                .slice(
                    0,
                    targetMovies
                );

        selected.push(
            ...series,
            ...movies
        );

        console.log(
            "[DAILY] Decade",
            decade,
            "| Target:",
            target,
            "| Movies:",
            movies.length,
            "| Series:",
            series.length
        );
    }

    let result =
        catalogDedupe(
            selected
        );

    /*
   ========================================================
   9.8 BÙ ITEM THƯỜNG
   ========================================================

   Mục tiêu cuối cùng:
   - 49 item thường
   - 44 Movie
   - 5 Series
   - tất cả IMDb >= 6

   Nếu các thập niên cũ không đủ item,
   lấy phần thiếu từ các thập niên khác.
*/

if (
    result.length <
    targetNormal
) {

    const used =
        new Set(
            result.map(
                catalogKey
            )
        );

    const fallback =
        stableShuffle(
            normal.filter(
                item =>
                    !used.has(
                        catalogKey(item)
                    )
            ),
            today +
            "|daily-fallback"
        );

    result.push(
        ...fallback.slice(
            0,
            targetNormal -
            result.length
        )
    );
}

result =
    catalogDedupe(
        result
    );

/*
   ========================================================
   9.10 ĐIỀU CHỈNH TYPE
   ========================================================

   Bảo đảm chính xác:
   - 44 Movie
   - 5 Series
   - tổng 49 item thường
*/

/*
   --------------------------------------------------------
   BƯỚC 1: TÁCH MOVIE / SERIES
   --------------------------------------------------------
*/

let normalMovies =
    result.filter(
        item =>
            !isSeriesItem(item)
    );

let normalSeries =
    result.filter(
        isSeriesItem
    );

/*
   --------------------------------------------------------
   BƯỚC 2: BẢO ĐẢM 5 SERIES
   --------------------------------------------------------
*/

if (
    normalSeries.length <
    5
) {

    const used =
        new Set(
            result.map(
                catalogKey
            )
        );

    const extraSeries =
        stableShuffle(
            normal.filter(
                item =>
                    isSeriesItem(item) &&
                    !used.has(
                        catalogKey(item)
                    )
            ),
            today +
            "|daily|extra-series"
        );

    const need =
        5 -
        normalSeries.length;

    const add =
        extraSeries.slice(
            0,
            need
        );

    result.push(
        ...add
    );

    normalSeries =
        [
            ...normalSeries,
            ...add
        ];
}

/*
   --------------------------------------------------------
   BƯỚC 3: CHỈ GIỮ 5 SERIES
   --------------------------------------------------------
*/

normalSeries =
    stableShuffle(
        normalSeries,
        today +
        "|daily|series-final"
    )
        .slice(
            0,
            5
        );

/*
   --------------------------------------------------------
   BƯỚC 4: BỔ SUNG MOVIE ĐỂ ĐỦ 44
   --------------------------------------------------------
*/

const seriesKeys =
    new Set(
        normalSeries.map(
            catalogKey
        )
    );

const currentMovies =
    result.filter(
        item =>
            !isSeriesItem(item) &&
            !seriesKeys.has(
                catalogKey(item)
            )
    );

let selectedMovies =
    stableShuffle(
        currentMovies,
        today +
        "|daily|movies-final"
    )
        .slice(
            0,
            44
        );

/*
   Nếu sau khi loại Series dư mà Movie
   chưa đủ 44, lấy thêm Movie IMDb >= 6
   từ toàn bộ nguồn.
*/

if (
    selectedMovies.length <
    44
) {

    const used =
        new Set(
            [
                ...selectedMovies,
                ...normalSeries
            ].map(
                catalogKey
            )
        );

    const extraMovies =
        stableShuffle(
            normal.filter(
                item =>
                    !isSeriesItem(item) &&
                    !used.has(
                        catalogKey(item)
                    )
            ),
            today +
            "|daily|extra-movies"
        );

    selectedMovies.push(
        ...extraMovies.slice(
            0,
            44 -
            selectedMovies.length
        )
    );
}

/*
   --------------------------------------------------------
   BƯỚC 5: GHÉP LẠI ĐÚNG 49 ITEM
   --------------------------------------------------------
*/

result =
    catalogDedupe([
        ...selectedMovies,
        ...normalSeries
    ])
        .slice(
            0,
            49
        );

console.log(
    "[DAILY] Normal final:",
    result.length,
    "| Movies:",
    result.filter(
        item =>
            !isSeriesItem(item)
    ).length,
    "| Series:",
    result.filter(
        isSeriesItem
    ).length
);

    /*
       ========================================================
       9.11 CHÍNH XÁC 1 ANIMATION
       ========================================================

       Animation được tính là Movie
       để đạt tổng:
       45 Movie + 5 Series.

       Ưu tiên animation Nhật chỉ là lựa chọn
       ngẫu nhiên trong nguồn animation,
       KHÔNG áp dụng giới hạn quốc gia cho Daily.
    */

    const oneAnimation =
        stableShuffle(
            animation,
            today +
            "|daily-animation"
        )[0];

    if (
        oneAnimation
    ) {

        result.push(
            {
                ...oneAnimation,

                __catalogType:
                    "movie",

                __isAnimation:
                    true
            }
        );

    } else {

        console.log(
            "[DAILY] WARNING: " +
            "khong tim thay animation IMDb >= 6"
        );
    }

    /*
       ========================================================
       9.12 FINAL
       ========================================================
    */

    result =
        catalogDedupe(
            result
        );

    /*
       Bảo đảm chỉ lấy tối đa 50.
    */

    result =
        stableShuffle(
            result,
            today +
            "|daily-final"
        )
            .slice(
                0,
                CATALOG_TARGET
            );

    /*
       ========================================================
       9.13 KIỂM TRA FINAL
       ========================================================
    */

    console.log(
        "[DAILY] Final:",
        result.length,
        "| Normal:",
        result.filter(
            item =>
                !item.__isAnimation
        ).length,
        "| Animation:",
        result.filter(
            item =>
                item.__isAnimation === true
        ).length,
        "| Movies:",
        result.filter(
            item =>
                !isSeriesItem(item)
        ).length,
        "| Series:",
        result.filter(
            isSeriesItem
        ).length,
        "| IMDb<6:",
        result.filter(
            item =>
                imdbRating(item) < 6
        ).length
    );

    return result;
}

/* ============================================================
 10. ANIMATION NEW
   ============================================================ */

async function fetchAnimationNew() {

    const sources = [];

    /*
       Dùng endpoint HOẠT HÌNH trực tiếp.

       Không dùng:
       phim-le?category=hoat-hinh
       phim-bo?category=hoat-hinh

       vì hai endpoint đó trước đây chỉ trả
       rất ít dữ liệu.
    */

    for (
        let page = 1;
        page <= 12;
        page++
    ) {

        sources.push(
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
            sources
        );

    const all =
        catalogDedupe(
            groups.flat()
        )
            .map(
                item => {

                    const series =
                        isSeriesItem(
                            item
                        );

                    return {
                        ...item,

                        __catalogType:
                            series
                                ? "series"
                                : "movie",

                        __isAnimation:
                            true
                    };
                }
            );

    console.log(
        "[ANIME] Source:",
        all.length,

        "| Movies:",
        all.filter(
            item =>
                item.__catalogType ===
                "movie"
        ).length,

        "| Series:",
        all.filter(
            item =>
                item.__catalogType ===
                "series"
        ).length
    );

    /*
       --------------------------------------------------------
       10.1 PHÂN NHÓM QUỐC GIA
       --------------------------------------------------------

       Chỉ dùng 3 nhóm:

       1. Japan
       2. USA
       3. Other

       Không gom toàn bộ Western vào USA.
    */

    function isUSA(item) {

    const countries =
        catalogCountryNames(
            item
        );

    const westernCountries =
        new Set([
            "au my",
            "my",
            "hoa ky",
            "united states",
            "united states of america",
            "usa",
            "anh",
            "vuong quoc anh",
            "united kingdom",
            "uk",
            "phap",
            "duc",
            "canada",
            "uc",
            "australia",
            "new zealand",
            "italia",
            "y",
            "tay ban nha",
            "tbn",
            "spain",
            "bo dao nha",
            "ireland",
            "tho nhi ky",
            "netherlands",
            "ha lan",
            "belgium",
            "bi",
            "sweden",
            "thuy dien",
            "norway",
            "na uy",
            "denmark",
            "phan lan",
            "finland",
            "switzerland",
            "ao",
            "austria"
        ]);

    return countries.some(
        country =>
            westernCountries.has(
                country
            )
    );
}

    function isJapan(item) {

        const countries =
            catalogCountryNames(
                item
            );

        return countries.some(
            country =>
                country ===
                    "nhat ban" ||
                country ===
                    "japan"
        );
    }

    function isOther(item) {

        return (
            !isJapan(item) &&
            !isUSA(item)
        );
    }

    const japanItems =
        all.filter(
            isJapan
        );

    const usaItems =
        all.filter(
            isUSA
        );

    const otherItems =
        all.filter(
            isOther
        );

    console.log(
        "[ANIME] Country:",
        "Japan",
        japanItems.length,

        "| USA",
        usaItems.length,

        "| Other",
        otherItems.length
    );

    /*
       --------------------------------------------------------
       10.2 TÁCH MOVIE / SERIES
       --------------------------------------------------------
    */

    function splitType(items) {

        return {

            movies:
                items.filter(
                    item =>
                        item.__catalogType ===
                        "movie"
                ),

            series:
                items.filter(
                    item =>
                        item.__catalogType ===
                        "series"
                )
        };
    }

    const japan =
        splitType(
            japanItems
        );

    const usa =
        splitType(
            usaItems
        );

    const other =
        splitType(
            otherItems
        );

    console.log(
        "[ANIME] Japan:",
        "Movies",
        japan.movies.length,
        "| Series",
        japan.series.length
    );

    console.log(
        "[ANIME] USA:",
        "Movies",
        usa.movies.length,
        "| Series",
        usa.series.length
    );

    console.log(
        "[ANIME] Other:",
        "Movies",
        other.movies.length,
        "| Series",
        other.series.length
    );

   /*
       --------------------------------------------------------
       10.3 LẤY CÓ ƯU TIÊN
       --------------------------------------------------------

       Mục tiêu:
       - Tổng 50 item
       - Japan khoảng 23
       - USA khoảng 22
       - Other khoảng 5
       - Ưu tiên phim mới
       - Nhật ưu tiên SERIES
       - Tổng thể cố cân bằng Movie / Series
    */

    /*
       --------------------------------------------------------
       10.4 SẮP XẾP THEO ĐỘ MỚI
       --------------------------------------------------------

       Ưu tiên:
       1. Năm mới hơn
       2. modified mới hơn
       3. stableShuffle để vẫn có sự thay đổi
          nhưng ổn định trong cùng một lần chạy
    */

    function sortRecent(
        items,
        seed
    ) {

        return stableShuffle(
            items,
            seed +
            "|shuffle"
        ).sort(
            (a, b) => {

                const ya =
                    itemYear(a);

                const yb =
                    itemYear(b);

                if (
                    yb !== ya
                ) {
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
    }

    /*
       --------------------------------------------------------
       10.5 LẤY SERIES ƯU TIÊN
       --------------------------------------------------------

       Dùng cho Japan.

       Nhật có rất nhiều Series nên ưu tiên
       Series mới trước, sau đó mới lấy Movie.
    */

    function takeSeriesPriority(
        group,
        target,
        seed
    ) {

        const result = [];

        const series =
            sortRecent(
                group.series,
                seed +
                "|series"
            );

        const movies =
            sortRecent(
                group.movies,
                seed +
                "|movies"
            );

        /*
           Ưu tiên khoảng 60% Series.
        */

        const seriesTarget =
            Math.min(
                series.length,
                Math.ceil(
                    target * 0.60
                )
            );

        result.push(
            ...series.slice(
                0,
                seriesTarget
            )
        );

        /*
           Phần còn lại lấy Movie.
        */

        const movieTarget =
            Math.min(
                movies.length,
                target -
                result.length
            );

        result.push(
            ...movies.slice(
                0,
                movieTarget
            )
        );

        /*
           Nếu thiếu thì lấy tiếp từ loại còn lại.
        */

        if (
            result.length <
            target
        ) {

            const used =
                new Set(
                    result.map(
                        catalogKey
                    )
                );

            const remaining =
                sortRecent(
                    [
                        ...series,
                        ...movies
                    ].filter(
                        item =>
                            !used.has(
                                catalogKey(item)
                            )
                    ),
                    seed +
                    "|fallback"
                );

            result.push(
                ...remaining.slice(
                    0,
                    target -
                    result.length
                )
            );
        }

        return result;
    }

    /*
       --------------------------------------------------------
       10.6 LẤY CÂN BẰNG MOVIE / SERIES
       --------------------------------------------------------
    */

    function takeBalanced(
        group,
        target,
        seed
    ) {

        let movieTarget =
            Math.floor(
                target / 2
            );

        let seriesTarget =
            target -
            movieTarget;

        /*
           Nếu Movie không đủ,
           chuyển phần thiếu sang Series.
        */

        if (
            group.movies.length <
            movieTarget
        ) {

            const shortage =
                movieTarget -
                group.movies.length;

            movieTarget =
                group.movies.length;

            seriesTarget +=
                shortage;
        }

        /*
           Nếu Series không đủ,
           chuyển phần thiếu sang Movie.
        */

        if (
            group.series.length <
            seriesTarget
        ) {

            const shortage =
                seriesTarget -
                group.series.length;

            seriesTarget =
                group.series.length;

            movieTarget +=
                shortage;
        }

        const movies =
            sortRecent(
                group.movies,
                seed +
                "|movies"
            )
                .slice(
                    0,
                    movieTarget
                );

        const series =
            sortRecent(
                group.series,
                seed +
                "|series"
            )
                .slice(
                    0,
                    seriesTarget
                );

        return [
            ...movies,
            ...series
        ];
    }

    /*
       --------------------------------------------------------
       10.7 TARGET QUỐC GIA
       --------------------------------------------------------

       Japan = 23
       USA   = 22
       Other = 5

       Tổng = 50
    */

    let result = [];

    result.push(
        ...takeSeriesPriority(
            japan,
            23,
            "anime|japan"
        )
    );

    result.push(
        ...takeBalanced(
            usa,
            22,
            "anime|usa"
        )
    );

    result.push(
        ...takeBalanced(
            other,
            5,
            "anime|other"
        )
    );

    /*
       --------------------------------------------------------
       10.8 FALLBACK QUỐC GIA
       --------------------------------------------------------

       Nếu một nhóm không đủ item,
       lấy phần thiếu từ các nhóm còn lại.

       Ưu tiên item mới.
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

        const remaining =
            sortRecent(
                [
                    ...japanItems,
                    ...usaItems,
                    ...otherItems
                ].filter(
                    item =>
                        !used.has(
                            catalogKey(item)
                        )
                ),
                "anime|fallback"
            );

        result.push(
            ...remaining.slice(
                0,
                CATALOG_TARGET -
                result.length
            )
        );
    }

    /*
       --------------------------------------------------------
       10.9 ĐIỀU CHỈNH MOVIE / SERIES
       --------------------------------------------------------

       Mục tiêu cuối:
       - khoảng 25 Movie
       - khoảng 25 Series

       Không phá ưu tiên quốc gia ở trên.
    */

    let movies =
        result.filter(
            item =>
                item.__catalogType ===
                "movie"
        );

    let series =
        result.filter(
            item =>
                item.__catalogType ===
                "series"
        );

    /*
       --------------------------------------------------------
       BƯỚC 1: NẾU SERIES QUÁ NHIỀU
       --------------------------------------------------------
    */

    if (
        series.length >
        25
    ) {

        const removeCount =
            series.length -
            25;

        const removableSeries =
            sortRecent(
                series,
                "anime|remove-series"
            )
                .slice(
                    0,
                    removeCount
                );

        const removeKeys =
            new Set(
                removableSeries.map(
                    catalogKey
                )
            );

        result =
            result.filter(
                item =>
                    !removeKeys.has(
                        catalogKey(item)
                    )
            );

        /*
           Bổ sung Movie mới nhất
           từ toàn bộ nguồn chưa dùng.
        */

        const used =
            new Set(
                result.map(
                    catalogKey
                )
            );

        const extraMovies =
            sortRecent(
                [
                    ...japan.movies,
                    ...usa.movies,
                    ...other.movies
                ].filter(
                    item =>
                        !used.has(
                            catalogKey(item)
                        )
                ),
                "anime|extra-movies"
            );

        const need =
            Math.min(
                removeCount,
                extraMovies.length
            );

        result.push(
            ...extraMovies.slice(
                0,
                need
            )
        );
    }

    /*
       --------------------------------------------------------
       BƯỚC 2: NẾU MOVIE QUÁ NHIỀU
       --------------------------------------------------------
    */

    movies =
        result.filter(
            item =>
                item.__catalogType ===
                "movie"
        );

    series =
        result.filter(
            item =>
                item.__catalogType ===
                "series"
        );

    if (
        movies.length >
        25
    ) {

        const removeCount =
            movies.length -
            25;

        const removableMovies =
            sortRecent(
                movies,
                "anime|remove-movies"
            )
                .slice(
                    0,
                    removeCount
                );

        const removeKeys =
            new Set(
                removableMovies.map(
                    catalogKey
                )
            );

        result =
            result.filter(
                item =>
                    !removeKeys.has(
                        catalogKey(item)
                    )
            );

        /*
           Bổ sung Series mới nhất
           từ toàn bộ nguồn chưa dùng.
        */

        const used =
            new Set(
                result.map(
                    catalogKey
                )
            );

        const extraSeries =
            sortRecent(
                [
                    ...japan.series,
                    ...usa.series,
                    ...other.series
                ].filter(
                    item =>
                        !used.has(
                            catalogKey(item)
                        )
                ),
                "anime|extra-series"
            );

        const need =
            Math.min(
                removeCount,
                extraSeries.length
            );

        result.push(
            ...extraSeries.slice(
                0,
                need
            )
        );
    }

    /*
       --------------------------------------------------------
       BƯỚC 3: NẾU SAU ĐIỀU CHỈNH CHƯA ĐỦ 50
       --------------------------------------------------------
    */

    result =
        catalogDedupe(
            result
        );

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

        const remaining =
            sortRecent(
                all.filter(
                    item =>
                        !used.has(
                            catalogKey(item)
                        )
                ),
                "anime|final-fallback"
            );

        result.push(
            ...remaining.slice(
                0,
                CATALOG_TARGET -
                result.length
            )
        );
    }

    /*
       --------------------------------------------------------
       10.10 GIỚI HẠN ĐÚNG 50
       --------------------------------------------------------
    */

    result =
        catalogDedupe(
            result
        )
            .slice(
                0,
                CATALOG_TARGET
            );

    /*
       --------------------------------------------------------
       10.11 TRỘN THỨ TỰ CUỐI
       --------------------------------------------------------

       Không để row bị chia:
       Japan → USA → Other.

       Stable shuffle giúp thứ tự ổn định.
    */

    result =
        stableShuffle(
            result,
            "anime|final"
        );


    /*
       --------------------------------------------------------
       10.12 LOG CUỐI
       --------------------------------------------------------
    */

    console.log(
        "[ANIME] Final:",
        result.length,

        "| Movies:",
        result.filter(
            item =>
                item.__catalogType ===
                "movie"
        ).length,

        "| Series:",
        result.filter(
            item =>
                item.__catalogType ===
                "series"
        ).length,

        "| Japan:",
        result.filter(
            isJapan
        ).length,

        "| USA:",
        result.filter(
            isUSA
        ).length,

        "| Other:",
        result.filter(
            isOther
        ).length
    );

    return result;
}

/* ============================================================
11. CATALOG META
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

    /*
     * Nếu catalog đã có IMDb ID hợp lệ,
     * dùng IMDb ID làm ID chung cho Stremio.
     *
     * Nếu chưa có IMDb ID,
     * giữ nguyên ID vnwpsw hiện tại.
     */

    const metaId =
        /^tt\d+$/i.test(
            String(imdbId)
        )
            ? String(imdbId)
            : (
                "vnwpsw:" +
                encodeURIComponent(
                    String(
                        item?.name ||
                        item?.origin_name ||
                        ""
                    )
                )
            );

    console.log(
        "[CATALOG META] Name:",
        item?.name ||
        item?.origin_name ||
        "Unknown"
    );

    console.log(
        "[CATALOG META] IMDb:",
        imdbId ||
        "NONE"
    );

    console.log(
        "[CATALOG META] Final ID:",
        metaId
    );

    return {

        id:
            metaId,

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
   12. DEFINE CATALOG HANDLER
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

            const searchQuery =
                String(
                    args.extra?.search ||
                    ""
                ).trim();

            /* ========================================================
               12.0 VMT TV
               ======================================================== */

            if (
                args.id ===
                "pa_vmttv"
            ) {

                console.log(
                    "[CATALOG] Mode: VMT TV"
                );

                /*
                   VMT TV sử dụng M3U trực tiếp.
                   Không cần EPG ở giai đoạn này.

                   Nếu có genre:
                   Stremio gửi args.extra.genre
                   và ta lọc theo group-title của M3U.
                */

                try {

                    const channels =
                        await fetchVmtTvChannels();

                    console.log(
                        "[VMTTV CATALOG] Total channels:",
                        channels.length
                    );

                    let filteredChannels =
                        channels;

                    const genre =
                        String(
                            args.extra?.genre ||
                            ""
                        ).trim();

                    if (
                        genre
                    ) {

                        filteredChannels =
                            channels.filter(
                                channel =>
                                    String(
                                        channel.group ||
                                        ""
                                    ).trim() ===
                                    genre
                            );

                        console.log(
                            "[VMTTV CATALOG] Genre:",
                            genre,
                            "| Results:",
                            filteredChannels.length
                        );

                    }

                    /*
                       Search riêng cho VMT TV.
                    */

                    const searchQuery =
                        String(
                            args.extra?.search ||
                            ""
                        ).trim()
                        .toLowerCase();

                    if (
                        searchQuery
                    ) {

                        filteredChannels =
                            filteredChannels.filter(
                                channel =>
                                    String(
                                        channel.name ||
                                        ""
                                    )
                                    .toLowerCase()
                                    .includes(
                                        searchQuery
                                    )
                            );

                        console.log(
                            "[VMTTV CATALOG] Search:",
                            searchQuery,
                            "| Results:",
                            filteredChannels.length
                        );

                    }

                    const metas =
                        filteredChannels
                            .slice(
                                0,
                                CATALOG_TARGET
                            )
                            .map(
                                channel =>
                                    makeVmtTvCatalogMeta(
                                        channel
                                    )
                            )
                            .filter(
                                meta =>
                                    meta?.id &&
                                    meta?.name
                            );

                    console.log(
                        "[VMTTV CATALOG] Metas:",
                        metas.length
                    );

                    return {
                        metas
                    };

                } catch (e) {

                    console.error(
                        "[VMTTV CATALOG ERROR]",
                        e?.message ||
                        e
                    );

                    return {
                        metas: []
                    };

                }
            }

            /* ========================================================
               12.1 MOVIE TRENDING
               ======================================================== */

            if (
                args.id ===
                "pa_movies_trending"
            ) {

                console.log(
                    "[CATALOG] Mode: MOVIE TRENDING"
                );

                /*
                   Search chung của Stremio không
                   hiển thị kết quả ở mục này.
                */

                if (
                    searchQuery
                ) {

                    console.log(
                        "[CATALOG] Movie Trending search ignored."
                    );

                    return {
                        metas: []
                    };

                }

                items =
                    await fetchMovieTrending();

                forcedType =
                    "movie";

            /* ========================================================
               12.2 SERIES TRENDING
               ======================================================== */

            } else if (
                args.id ===
                "pa_series_trending"
            ) {

                console.log(
                    "[CATALOG] Mode: SERIES TRENDING"
                );

                /*
                   Search chung của Stremio không
                   hiển thị kết quả ở mục này.
                */

                if (
                    searchQuery
                ) {

                    console.log(
                        "[CATALOG] Series Trending search ignored."
                    );

                    return {
                        metas: []
                    };

                }

                items =
                    await fetchSeriesTrending();

                forcedType =
                    "series";

            /* ========================================================
               12.3 TVB
               ======================================================== */

            } else if (
                args.id ===
                "pa_tvb"
            ) {

                console.log(
                    "[CATALOG] Mode: TVB"
                );

                /*
                   TVB không nhận Search chung.
                */

                if (
                    searchQuery
                ) {

                    console.log(
                        "[CATALOG] TVB search ignored."
                    );

                    return {
                        metas: []
                    };

                }

                items =
                    await fetchTVB();

                forcedType =
                    null;

            /* ========================================================
               12.4 DAILY
               ======================================================== */

            } else if (
                args.id ===
                "pa_daily"
            ) {

                console.log(
                    "[CATALOG] Mode: DAILY / SEARCH"
                );

                /*
                   =====================================================
                   SEARCH CHUNG CỦA STREMIO
                   =====================================================

                   Nếu Stremio gửi search query,
                   dùng chính mục "Phim trong ngày"
                   để trả kết quả Search MOVINA.

                   Không phân biệt:
                   - Movie
                   - Series
                   - Animation
                   - TVB

                   makeCatalogMeta() sẽ tự xác định
                   movie / series.
                */

                if (
                    searchQuery
                ) {

                    console.log(
                        "[CATALOG] SEARCH MOVINA:",
                        searchQuery
                    );

                    const searchUrl =
                        "https://phimapi.com/v1/api/tim-kiem?keyword=" +
                        encodeURIComponent(
                            searchQuery
                        ) +
                        "&limit=24";

                    console.log(
                        "[CATALOG] Search URL:",
                        searchUrl
                    );

                    const searchRes =
                        await axios.get(
                            searchUrl,
                            {
                                timeout:
                                    10000,

                                headers: {
                                    "User-Agent":
                                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

                                    "Accept":
                                        "application/json"
                                }
                            }
                        );

                    const searchData =
                        searchRes?.data ||
                        {};

                    items =
                        searchData?.data?.items ||
                        searchData?.items ||
                        searchData?.results ||
                        [];

                    if (
                        !Array.isArray(
                            items
                        )
                    ) {

                        items = [];

                    }

                    console.log(
                        "[CATALOG] Search results:",
                        items.length
                    );

                    /*
                       Không ép movie / series.
                    */

                    forcedType =
                        null;

                } else {

                    /*
                       Không có search query:
                       giữ nguyên chức năng
                       "Phim trong ngày".
                    */

                    items =
                        await fetchDailyCatalog();

                    forcedType =
                        null;

                }

            /* ========================================================
               12.5 ANIMATION NEW
               ======================================================== */

            } else if (
                args.id ===
                "pa_animation_new"
            ) {

                console.log(
                    "[CATALOG] Mode: ANIME NEW"
                );

                /*
                   Search chung của Stremio không
                   hiển thị kết quả ở mục này.
                */

                if (
                    searchQuery
                ) {

                    console.log(
                        "[CATALOG] Animation search ignored."
                    );

                    return {
                        metas: []
                    };

                }

                items =
                    await fetchAnimationNew();

                forcedType =
                    null;

            /* ========================================================
               12.6 UNKNOWN
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
               12.7 TYPE FILTER
               ======================================================== */

            /*
               Chỉ lọc type cho hai catalog
               có type cố định.

               SEARCH MOVINA / DAILY:
                   Không lọc.

               TVB:
                   Movie + Series.

               Animation:
                   Giữ nguyên danh sách.
            */

            if (
                args.id ===
                "pa_movies_trending"
            ) {

                items =
                    items.filter(
                        item =>
                            !isSeriesItem(
                                item
                            )
                    );

            } else if (
                args.id ===
                "pa_series_trending"
            ) {

                items =
                    items.filter(
                        item =>
                            isSeriesItem(
                                item
                            )
                    );

            }

            /* ========================================================
               12.8 BUILD METAS
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
               12.9 LOG
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
                        x.type ===
                        "movie"
                ).length,

                "| Series:",

                metas.filter(
                    x =>
                        x.type ===
                        "series"
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
   13. META
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
        // 13.0. VMT TV META
        // =====================================================

        if (
            rawId.startsWith("vmttv:") &&
            String(args.type || "").trim() === "tv"
        ) {

            console.log(
                "[META] VMT TV channel:",
                rawId
            );

            try {

                const channelId =
                    decodeVmtTvStremioId(
                        rawId
                    );

                if (!channelId) {

                    console.log(
                        "[VMTTV META] Empty channel ID"
                    );

                    return {
                        meta: null
                    };

                }

                const channels =
                    await fetchVmtTvChannels();

                const channel =
                    vmtTvFindChannelById(
                        channels,
                        channelId
                    );

                if (!channel) {

                    console.log(
                        "[VMTTV META] Channel not found:",
                        channelId
                    );

                    return {
                        meta: null
                    };

                }

                const meta =
                    makeVmtTvMeta(
                        channel
                    );

                console.log(
                    "[VMTTV META] OK:",
                    meta?.name ||
                    channel.name
                );

                return {
                    meta
                };

            } catch (e) {

                console.error(
                    "[VMTTV META ERROR]",
                    e?.message ||
                    e
                );

                return {
                    meta: null
                };

            }
        }

        // =====================================================
        // 13.1. GIẢI MÃ TÊN PHIM
        // =====================================================

        let movieName = "";

        // IMDb ID thực tế mà MOVINA sẽ dùng làm meta ID
        let imdbId = "";

        // ID cuối cùng dùng cho Meta + Video
        let metaId = rawId;

        if (rawId.startsWith("vnwpsw:")) {

            movieName =
                decodeURIComponent(
                    rawId.substring(
                        "vnwpsw:".length
                    )
                );

        } else if (rawId.startsWith("tt")) {

            imdbId =
                rawId.split(":")[0];

            metaId =
                imdbId;

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
                        encodeURIComponent(
                            imdbId
                        ) +
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
        // 13.2. TÌM PHIM TRÊN PHIMAPI
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
        // 13.3. CHỌN KẾT QUẢ KHỚP TÊN
        // =====================================================

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

        const normalizedName =
            normalizeTitle(
                movieName
            );

        let item = null;

        if (Array.isArray(items)) {

            // -------------------------------------------------
            // A. TÊN VIỆT KHỚP CHÍNH XÁC
            // -------------------------------------------------

            item =
                items.find(x => {

                    const name =
                        normalizeTitle(
                            x?.name
                        );

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
                            normalizeTitle(
                                x?.origin_name ||
                                x?.original_name
                            );

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

                                return (
                                    normalizeTitle(
                                        alt
                                    ) ===
                                    normalizedName
                                );

                            }
                        );

                    });

            }

            // -------------------------------------------------
            // D. KHÔNG CÓ KHỚP TUYỆT ĐỐI
            // -------------------------------------------------

            if (
                !item &&
                items.length > 0
            ) {

                item =
                    items[0];

            }

        }

        if (!item) {

            console.log(
                "[META] Không tìm thấy:",
                movieName
            );

            return {
                meta: {
                    id:
                        metaId,

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
        // 13.4. LẤY DETAIL PHIM
        // =====================================================

        let detail =
            item;

        const slug =
            item.slug ||
            "";

        if (slug) {

            try {

                const detailRes =
                    await axios.get(
                        "https://phimapi.com/v1/api/phim/" +
                        encodeURIComponent(
                            slug
                        ),
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
        // 13.5. XÁC ĐỊNH TYPE THỰC
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
        // 13.6. POSTER
        // =====================================================

        const poster =
            makePosterUrl(detail) ||
            makePosterUrl(item);

        // =====================================================
        // 13.7. BACKGROUND
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
        // 13.8. NỘI DUNG THẬT
        // =====================================================

        let description =
            detail?.content ||
            item?.content ||
            "";

        description =
            String(description || "")
                .replace(
                    /<br\s*\/?>/gi,
                    "\n"
                )
                .replace(
                    /<\/p>/gi,
                    "\n"
                )
                .replace(
                    /<[^>]*>/g,
                    ""
                )
                .replace(
                    /&nbsp;/gi,
                    " "
                )
                .replace(
                    /&amp;/gi,
                    "&"
                )
                .replace(
                    /&quot;/gi,
                    '"'
                )
                .replace(
                    /&#39;/gi,
                    "'"
                )
                .replace(
                    /\n{3,}/g,
                    "\n\n"
                )
                .trim();

        if (!description) {

            description =
                "Đang cập nhật nội dung phim.";

        }

        // =====================================================
        // 13.9. IMDb TỪ PHIMAPI
        // =====================================================

        if (!imdbId) {

            imdbId =
                detail?.imdb?.id ||
                detail?.imdb_id ||
                detail?.imdbId ||
                item?.imdb?.id ||
                item?.imdb_id ||
                item?.imdbId ||
                "";

        }

        imdbId =
            String(
                imdbId ||
                ""
            ).trim();

        if (
            imdbId.startsWith("tt")
        ) {

            metaId =
                imdbId;

        }

        // =====================================================
        // 13.10. NẾU PHIMAPI KHÔNG CÓ IMDb
        //         → TÌM IMDb QUA CINEMETA
        //
        // Ưu tiên:
        //   1. Tên gốc + năm
        //   2. Tên Việt + năm
        //   3. Tên gốc
        //   4. Tên Việt
        // =====================================================

        let imdbResolvedByCinemeta =
            false;

        if (
            !imdbId
        ) {

            const cinemetaQueries = [];

            const originName =
                String(
                    detail?.origin_name ||
                    item?.origin_name ||
                    detail?.original_name ||
                    item?.original_name ||
                    ""
                ).trim();

            const vietnameseName =
                String(
                    detail?.name ||
                    item?.name ||
                    movieName ||
                    ""
                ).trim();

            if (
                originName
            ) {

                cinemetaQueries.push(
                    originName
                );

            }

            if (
                vietnameseName &&
                normalizeTitle(
                    vietnameseName
                ) !==
                normalizeTitle(
                    originName
                )
            ) {

                cinemetaQueries.push(
                    vietnameseName
                );

            }

            const targetYear =
                Number(
                    detail?.year ||
                    item?.year ||
                    0
                ) || 0;

            console.log(
                "[META CINEMETA RESOLVE] Queries:",
                cinemetaQueries
            );

            console.log(
                "[META CINEMETA RESOLVE] Target year:",
                targetYear
            );

            const cinemetaCandidates =
                [];

            for (
                const query
                of cinemetaQueries
            ) {

                try {

                    const cmSearchUrl =
                        "https://v3-cinemeta.strem.io/catalog/" +
                        metaType +
                        "/top/search=" +
                        encodeURIComponent(
                            query
                        ) +
                        ".json";

                    console.log(
                        "[META CINEMETA SEARCH]:",
                        cmSearchUrl
                    );

                    const cmSearchRes =
                        await axios.get(
                            cmSearchUrl,
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

                    const cmMetas =
                        cmSearchRes.data?.metas ||
                        [];

                    console.log(
                        "[META CINEMETA RESULTS]:",
                        Array.isArray(
                            cmMetas
                        )
                            ? cmMetas.length
                            : 0
                    );

                    if (
                        Array.isArray(
                            cmMetas
                        )
                    ) {

                        cmMetas.forEach(
                            candidate => {

                                const candidateId =
                                    String(
                                        candidate?.id ||
                                        ""
                                    ).trim();

                                if (
                                    !candidateId.startsWith(
                                        "tt"
                                    )
                                ) {

                                    return;

                                }

                                const candidateName =
                                    normalizeTitle(
                                        candidate?.name
                                    );

                                const candidateYear =
                                    Number(
                                        String(
                                            candidate?.releaseInfo ||
                                            ""
                                        ).match(
                                            /\d{4}/
                                        )?.[0] ||
                                        0
                                    );

                                let score = 0;

                                // Tên gốc khớp
                                if (
                                    originName &&
                                    candidateName ===
                                    normalizeTitle(
                                        originName
                                    )
                                ) {

                                    score += 1000;

                                }

                                // Tên Việt khớp
                                if (
                                    vietnameseName &&
                                    candidateName ===
                                    normalizeTitle(
                                        vietnameseName
                                    )
                                ) {

                                    score += 900;

                                }

                                // Năm khớp
                                if (
                                    targetYear &&
                                    candidateYear ===
                                    targetYear
                                ) {

                                    score += 3000;

                                } else if (
                                    targetYear &&
                                    candidateYear &&
                                    candidateYear !==
                                    targetYear
                                ) {

                                    score -= 3000;

                                }

                                cinemetaCandidates.push({
                                    candidate,
                                    score,
                                    query
                                });

                            }
                        );

                    }

                } catch (e) {

                    console.log(
                        "[META CINEMETA SEARCH ERROR]",
                        query,
                        e?.response?.status ||
                        e?.message ||
                        e
                    );

                }

            }

            // -------------------------------------------------
            // Sắp xếp ứng viên Cinemeta
            // -------------------------------------------------

            cinemetaCandidates.sort(
                (a, b) =>
                    b.score -
                    a.score
            );

            console.log(
                "[META CINEMETA RANKED]:",
                cinemetaCandidates
                    .slice(0, 10)
                    .map(
                        x => ({
                            id:
                                x.candidate?.id,

                            name:
                                x.candidate?.name,

                            releaseInfo:
                                x.candidate?.releaseInfo,

                            score:
                                x.score,

                            query:
                                x.query
                        })
                    )
            );

            // -------------------------------------------------
            // Chỉ nhận ứng viên có điểm hợp lệ
            //
            // Nếu có năm mục tiêu:
            // phải khớp năm.
            // -------------------------------------------------

            let selectedCinemeta =
                null;

            if (
                targetYear
            ) {

                selectedCinemeta =
                    cinemetaCandidates.find(
                        x =>
                            Number(
                                String(
                                    x.candidate?.releaseInfo ||
                                    ""
                                ).match(
                                    /\d{4}/
                                )?.[0] ||
                                0
                            ) ===
                            targetYear
                    );

            } else {

                selectedCinemeta =
                    cinemetaCandidates[0] ||
                    null;

            }

            if (
                selectedCinemeta
            ) {

                const resolvedId =
                    String(
                        selectedCinemeta.candidate?.id ||
                        ""
                    ).trim();

                if (
                    resolvedId.startsWith(
                        "tt"
                    )
                ) {

                    imdbId =
                        resolvedId;

                    metaId =
                        resolvedId;

                    imdbResolvedByCinemeta =
                        true;

                    console.log(
                        "[META CINEMETA RESOLVED IMDb]:",
                        imdbId
                    );

                }

            } else {

                console.log(
                    "[META CINEMETA] No safe IMDb match"
                );

            }

        }

        // =====================================================
        // 13.11. IMDb RATING
        // =====================================================

        let imdbRating = null;

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

        // -----------------------------------------------------
        // Nếu đã có IMDb nhưng PhimAPI không có rating,
        // lấy rating từ Cinemeta.
        // -----------------------------------------------------

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
                        encodeURIComponent(
                            imdbId
                        ) +
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

                const cmMeta =
                    cmRes.data?.meta ||
                    {};

                const cmRating =
                    Number(
                        cmMeta.imdbRating
                    );

                if (
                    Number.isFinite(
                        cmRating
                    ) &&
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

        console.log(
            "[META] Final meta ID:",
            metaId
        );

        if (
            imdbResolvedByCinemeta
        ) {

            console.log(
                "[META] IMDb resolved through Cinemeta"
            );

        }

        // =====================================================
        // 13.12. THỂ LOẠI
        // =====================================================

        const genres =
            Array.isArray(
                detail?.category
            )
                ? detail.category
                    .map(
                        x =>
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
                            .map(
                                x =>
                                    typeof x === "string"
                                        ? x
                                        : x?.name
                            )
                            .filter(Boolean)
                        : undefined
                );

        // =====================================================
        // 13.13. VIDEOS CHO SERIES
        //
        // Stremio:
        //   video.id = metaId:season:episode
        //
        // Nếu Cinemeta resolve được IMDb:
        //   tt26258200:1:1
        //
        // Nếu không:
        //   vnwpsw:...:1:1
        // =====================================================

        let videos =
            undefined;

        if (
            isSeries
        ) {

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

                    if (
                        !rawEpisodeName
                    ) {

                        continue;

                    }

                    const match =
                        rawEpisodeName.match(
                            /(?:tập|tap|episode|ep)?\s*0*(\d+)\b/i
                        );

                    if (
                        !match
                    ) {

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
                                    rawEpisodeName,

                                released:
                                    ep?.released ||
                                    ep?.air_date ||
                                    ep?.release_date ||
                                    ep?.created_at ||
                                    null
                            }
                        );

                    }

                }

            }

            // -------------------------------------------------
            // Năm fallback cho released
            // -------------------------------------------------

            const fallbackYear =
                Number(
                    detail?.year ||
                    item?.year ||
                    new Date().getFullYear()
                );

            const fallbackReleased =
                Number.isFinite(
                    fallbackYear
                )
                    ? new Date(
                        Date.UTC(
                            fallbackYear,
                            0,
                            1
                        )
                    ).toISOString()
                    : new Date().toISOString();

            videos =
                Array.from(
                    episodeMap.values()
                )
                    .sort(
                        (a, b) =>
                            a.number -
                            b.number
                    )
                    .map(
                        ep => {

                            const videoId =
                                metaId +
                                ":1:" +
                                ep.number;

                            let released =
                                ep.released;

                            if (
                                released
                            ) {

                                const parsedDate =
                                    new Date(
                                        released
                                    );

                                if (
                                    !Number.isNaN(
                                        parsedDate.getTime()
                                    )
                                ) {

                                    released =
                                        parsedDate.toISOString();

                                } else {

                                    released =
                                        fallbackReleased;

                                }

                            } else {

                                released =
                                    fallbackReleased;

                            }

                            return {

                                id:
                                    videoId,

                                title:
                                    "Tập " +
                                    ep.number,

                                released:
                                    released,

                                season:
                                    1,

                                episode:
                                    ep.number,

                                number:
                                    ep.number,

                                name:
                                    "Tập " +
                                    ep.number

                            };

                        }
                    );

            console.log(
                "[META] Series episodes:",
                videos.length
            );

            console.log(
                "[META] Video ID base:",
                metaId
            );

        }

        // =====================================================
        // 13.14. META SERIES - THÔNG TIN + VIDEOS
        // =====================================================

        const meta = {

            id:
                metaId,

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
                    )

        };

        if (
            isSeries &&
            Array.isArray(
                videos
            )
        ) {

            meta.videos =
                videos.map(
                    video => ({

                        id:
                            video.id,

                        title:
                            video.title,

                        released:
                            video.released,

                        season:
                            video.season,

                        episode:
                            video.episode

                    })
                );

        }

        console.log(
            "[META] TEST VIDEOS:",
            JSON.stringify(
                meta
            )
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


// ============================================================
// NORMALIZED STREAM CONTRACT + RESOLVER REGISTRY
// ============================================================
//
// Kiến trúc chung:
//
//   PROVIDER
//      ↓
//   RAW STREAM
//      ↓
//   RESOLVER
//      ↓
//   NORMALIZED STREAM
//      ↓
//   STREMIO
//
// Provider chỉ có nhiệm vụ tìm nguồn.
// Resolver chịu trách nhiệm xử lý đặc thù của nguồn:
//   - headers / referer / origin
//   - HLS proxy
//   - fake container / byte transform
//   - embed
//   - token / signed URL
//
// ============================================================


// ============================================================
// 1. NORMALIZED STREAM CONTRACT
// ============================================================

function createNormalizedStream(input = {}) {
    if (!input || typeof input !== "object") {
        return null;
    }

    const url = String(input.url || "").trim();
    const externalUrl = String(input.externalUrl || "").trim();

    if (!url && !externalUrl) {
        return null;
    }

    const stream = {
        url: url || undefined,
        externalUrl: externalUrl || undefined,

        title: String(input.title || "").trim(),
        name: String(input.name || "").trim(),

        type: String(input.type || "unknown").trim(),

        source: String(input.source || "").trim(),
        provider: String(input.provider || "").trim(),

        serverName: String(input.serverName || "").trim(),

        headers:
            input.headers && typeof input.headers === "object"
                ? { ...input.headers }
                : {},

        subtitles:
            Array.isArray(input.subtitles)
                ? input.subtitles
                : [],

        resolver:
            String(input.resolver || "").trim(),

        resolverOptions:
            input.resolverOptions &&
            typeof input.resolverOptions === "object"
                ? { ...input.resolverOptions }
                : {},

        behaviorHints:
            input.behaviorHints &&
            typeof input.behaviorHints === "object"
                ? { ...input.behaviorHints }
                : {}
    };

    // Xóa field undefined để object sạch hơn.
    if (!stream.url) delete stream.url;
    if (!stream.externalUrl) delete stream.externalUrl;
    if (!stream.title) delete stream.title;
    if (!stream.name) delete stream.name;
    if (!stream.serverName) delete stream.serverName;
    if (!stream.resolver) delete stream.resolver;

    return stream;
}


// ============================================================
// 2. NORMALIZE RAW STREAM
// ============================================================

function normalizeStream(input = {}, defaults = {}) {
    if (!input || typeof input !== "object") {
        return null;
    }

    return createNormalizedStream({
        ...defaults,
        ...input,

        headers: {
            ...(defaults.headers || {}),
            ...(input.headers || {})
        },

        behaviorHints: {
            ...(defaults.behaviorHints || {}),
            ...(input.behaviorHints || {})
        },

        resolverOptions: {
            ...(defaults.resolverOptions || {}),
            ...(input.resolverOptions || {})
        }
    });
}


function normalizeStreams(streams, defaults = {}) {
    if (!Array.isArray(streams)) {
        return [];
    }

    return streams
        .map(stream => normalizeStream(stream, defaults))
        .filter(Boolean);
}


// ============================================================
// 3. RESOLVER REGISTRY
// ============================================================

const STREAM_RESOLVER_REGISTRY = new Map();


// ------------------------------------------------------------
// createStreamResolver()
// ------------------------------------------------------------

function createStreamResolver({
    id,
    name = "",
    description = "",
    canResolve = null,
    resolve = null,
    priority = 0
} = {}) {

    if (!id) {
        throw new Error("Stream resolver requires id");
    }

    if (typeof resolve !== "function") {
        throw new Error(
            "Stream resolver '" + id + "' requires resolve()"
        );
    }

    return {
        id: String(id),
        name: String(name || id),
        description: String(description || ""),
        priority: Number(priority) || 0,

        canResolve:
            typeof canResolve === "function"
                ? canResolve
                : () => true,

        resolve
    };
}


// ------------------------------------------------------------
// registerStreamResolver()
// ------------------------------------------------------------

function registerStreamResolver(resolver) {
    if (!resolver || !resolver.id) {
        throw new Error("Invalid stream resolver");
    }

    STREAM_RESOLVER_REGISTRY.set(
        String(resolver.id),
        resolver
    );

    console.log(
        "[RESOLVER] Registered:",
        resolver.id
    );

    return resolver;
}


// ------------------------------------------------------------
// getStreamResolver()
// ------------------------------------------------------------

function getStreamResolver(id) {
    if (!id) {
        return null;
    }

    return STREAM_RESOLVER_REGISTRY.get(
        String(id)
    ) || null;
}


// ------------------------------------------------------------
// getAllStreamResolvers()
// ------------------------------------------------------------

function getAllStreamResolvers() {
    return Array.from(
        STREAM_RESOLVER_REGISTRY.values()
    ).sort(
        (a, b) =>
            Number(b.priority || 0) -
            Number(a.priority || 0)
    );
}


// ============================================================
// 4. RESOLVER EXECUTION
// ============================================================

async function resolveNormalizedStream(stream, context = {}) {

    if (!stream || typeof stream !== "object") {
        return null;
    }

    const resolverId =
        String(stream.resolver || "").trim();

    // Không có resolver:
    // stream đã có thể dùng trực tiếp.
    if (!resolverId) {
        return createNormalizedStream(stream);
    }

    const resolver =
        getStreamResolver(resolverId);

    if (!resolver) {
        console.log(
            "[RESOLVER] NOT FOUND:",
            resolverId
        );

        return createNormalizedStream(stream);
    }

    try {

        const canResolve =
            await resolver.canResolve(
                stream,
                context
            );

        if (!canResolve) {
            console.log(
                "[RESOLVER] SKIP:",
                resolver.id
            );

            return createNormalizedStream(stream);
        }

        console.log(
            "[RESOLVER] RUN:",
            resolver.id
        );

        const result =
            await resolver.resolve(
                stream,
                context
            );

        if (!result) {
            console.log(
                "[RESOLVER] EMPTY:",
                resolver.id
            );

            return null;
        }

        return createNormalizedStream({
            ...stream,
            ...result,

            headers: {
                ...(stream.headers || {}),
                ...(result.headers || {})
            },

            behaviorHints: {
                ...(stream.behaviorHints || {}),
                ...(result.behaviorHints || {})
            },

            resolverOptions: {
                ...(stream.resolverOptions || {}),
                ...(result.resolverOptions || {})
            }
        });

    } catch (error) {

        console.log(
            "[RESOLVER ERROR]",
            resolver.id,
            error?.message || error
        );

        return null;
    }
}


// ============================================================
// 5. RESOLVE MANY STREAMS
// ============================================================

async function resolveNormalizedStreams(
    streams,
    context = {}
) {

    if (!Array.isArray(streams)) {
        return [];
    }

    const results =
        await Promise.allSettled(
            streams.map(stream =>
                resolveNormalizedStream(
                    stream,
                    context
                )
            )
        );

    return results
        .filter(
            result =>
                result.status === "fulfilled" &&
                result.value
        )
        .map(
            result =>
                result.value
        );
}


// ============================================================
// 6. STREAM → STREMIO
// ============================================================

function normalizedStreamToStremio(stream) {

    if (!stream || typeof stream !== "object") {
        return null;
    }

    const url =
        String(stream.url || "").trim();

    const externalUrl =
        String(stream.externalUrl || "").trim();

    if (!url && !externalUrl) {
        return null;
    }

    const result = {};

    if (stream.name) {
        result.name = stream.name;
    }

    if (stream.title) {
        result.title = stream.title;
    }

    if (url) {
        result.url = url;
    }

    if (externalUrl) {
        result.externalUrl = externalUrl;
    }

    if (
        stream.headers &&
        typeof stream.headers === "object" &&
        Object.keys(stream.headers).length
    ) {
        result.behaviorHints = {
            ...(result.behaviorHints || {}),
            proxyHeaders: {
                request: stream.headers
            }
        };
    }

    if (
        stream.behaviorHints &&
        typeof stream.behaviorHints === "object"
    ) {
        result.behaviorHints = {
            ...(result.behaviorHints || {}),
            ...stream.behaviorHints
        };
    }

    if (
        Array.isArray(stream.subtitles) &&
        stream.subtitles.length
    ) {
        result.subtitles = stream.subtitles;
    }

    return result;
}


function normalizedStreamsToStremio(streams) {

    if (!Array.isArray(streams)) {
        return [];
    }

    return streams
        .map(normalizedStreamToStremio)
        .filter(Boolean);
}


// ============================================================
// 7. RESOLVER REGISTRY INFO
// ============================================================

function getStreamResolverInfo() {

    return getAllStreamResolvers().map(
        resolver => ({
            id: resolver.id,
            name: resolver.name,
            description: resolver.description,
            priority: resolver.priority
        })
    );
}


function logStreamResolverRegistry() {

    console.log(
        "[RESOLVER REGISTRY]",
        getStreamResolverInfo()
    );
}


// ============================================================
// 8. BUILT-IN PASSTHROUGH RESOLVER
// ============================================================
//
// Resolver này không xử lý gì cả.
//
// Nó tồn tại để sau này mọi source đều có thể đi qua cùng
// một pipeline:
//
// Provider → Resolver → NormalizedStream → Stremio
//
// ============================================================

registerStreamResolver(
    createStreamResolver({

        id: "passthrough",

        name: "Passthrough",

        description:
            "Use the stream URL directly without transformation.",

        priority: 0,

        canResolve: () => true,

        async resolve(stream) {

            return {
                url: stream.url,
                externalUrl: stream.externalUrl,
                headers: stream.headers || {},
                subtitles: stream.subtitles || [],
                behaviorHints:
                    stream.behaviorHints || {}
            };
        }
    })
);


// ============================================================
// 9. INITIAL REGISTRY LOG
// ============================================================

logStreamResolverRegistry();

// ============================================================
// VSMOV RESOLVER
// ============================================================
//
// BƯỚC 2 — ĐƯA VSMOV VÀO RESOLVER ENGINE
//
// Kiến trúc:
//
//   VSMov Provider
//        ↓
//   Normalized Stream
//        ↓
//   resolver: "vsmov"
//        ↓
//   VSMov Resolver
//        ↓
//   Normalized Stream
//        ↓
//   Stremio Adapter
//
// IMPORTANT:
//
// Resolver này ở BƯỚC 2 chưa xử lý lại HLS / MPEG-TS.
//
// Toàn bộ logic VSMov hiện tại:
//
//   - resolveVSMovEmbed()
//   - makeVSMovHlsProxyUrl()
//   - /vsmov-hls-proxy
//   - /vsmov-segment-proxy
//   - fake PNG → MPEG-TS
//
// vẫn được giữ nguyên.
//
// Resolver chỉ làm nhiệm vụ:
//
//   1. nhận Normalized Stream
//   2. xác nhận đây là stream của VSMov
//   3. giữ nguyên URL / headers / metadata
//   4. trả stream lại cho pipeline chung
//
// Sau khi VSMov chạy ổn qua pipeline này,
// resolver sẽ được mở rộng ở các bước sau nếu cần.
// ============================================================


registerStreamResolver(
    createStreamResolver({

        id: "vsmov",

        name: "VSMov Resolver",

        description:
            "VSMov stream resolver. Preserves the existing VSMov stream and proxy pipeline.",

        priority: 100,

        // ----------------------------------------------------
        // CAN RESOLVE
        // ----------------------------------------------------

        canResolve: (
            stream,
            context = {}
        ) => {

            if (
                !stream ||
                typeof stream !== "object"
            ) {
                return false;
            }

            return (
                String(
                    stream.provider || ""
                ).toLowerCase() ===
                "vsmov"
            );
        },

        // ----------------------------------------------------
        // RESOLVE
        // ----------------------------------------------------

        async resolve(
            stream,
            context = {}
        ) {

            console.log(
                "[VSMOV RESOLVER] START:",
                stream.title ||
                stream.name ||
                "Untitled"
            );

            console.log(
                "[VSMOV RESOLVER] Type:",
                stream.type ||
                "unknown"
            );

            console.log(
                "[VSMOV RESOLVER] URL:",
                stream.url ||
                stream.externalUrl ||
                ""
            );

            // ------------------------------------------------
            // BƯỚC 2:
            // KHÔNG thay đổi URL.
            //
            // VSMov đã tạo proxy URL ở Provider layer.
            // Resolver không được proxy lần thứ hai.
            // ------------------------------------------------

            const result = {

                url:
                    stream.url,

                externalUrl:
                    stream.externalUrl,

                title:
                    stream.title,

                name:
                    stream.name,

                type:
                    stream.type,

                source:
                    stream.source ||
                    "vsmov",

                provider:
                    "vsmov",

                serverName:
                    stream.serverName,

                headers:
                    stream.headers || {},

                subtitles:
                    Array.isArray(
                        stream.subtitles
                    )
                        ? stream.subtitles
                        : [],

                behaviorHints:
                    stream.behaviorHints || {},

                resolverOptions:
                    stream.resolverOptions || {}
            };

            console.log(
                "[VSMOV RESOLVER] PASS:",
                result.url ||
                result.externalUrl ||
                ""
            );

            return result;
        }
    })
);


// ============================================================
// VSMOV RESOLVER REGISTRY CHECK
// ============================================================

console.log(
    "[VSMOV RESOLVER] Registered:",
    !!getStreamResolver("vsmov")
);

// ============================================================
// ANIME47 RESOLVER
// ============================================================
//
// BƯỚC 3 — ĐƯA ANIME47 VÀO RESOLVER ENGINE
//
// Anime47 có một số đặc thù:
//
//   - stream URL
//   - server_name
//   - player_type
//   - subtitles
//   - header/interceptor cho nonprofit.asia
//   - một số CDN có wrapper MPEG-TS giả
//
// Ở BƯỚC 3 này:
//
// Provider:
//     chỉ cung cấp raw stream
//
// Resolver:
//     nhận raw stream và chuẩn hóa metadata
//
// QUAN TRỌNG:
//
// Chưa thay đổi logic Anime47 hiện tại.
// Chưa tự động xử lý lại byte-transform ở đây nếu
// provider hiện tại đã xử lý nó.
//
// Mục tiêu trước tiên:
//
//     Anime47
//        ↓
//     Normalized Stream
//        ↓
//     Anime47 Resolver
//        ↓
//     Normalized Stream
//
// ============================================================

registerStreamResolver(
    createStreamResolver({

        id: "anime47",

        name: "Anime47 Resolver",

        description:
            "Anime47 stream resolver. Preserves Anime47 stream URL, headers, subtitles and server metadata.",

        priority: 90,

        canResolve: (
            stream,
            context = {}
        ) => {

            if (
                !stream ||
                typeof stream !== "object"
            ) {
                return false;
            }

            return (
                String(
                    stream.provider ||
                    stream.source ||
                    ""
                )
                .toLowerCase()
                .trim()
                === "anime47"
            );
        },

        async resolve(
            stream,
            context = {}
        ) {

            console.log(
                "[ANIME47 RESOLVER] START:",
                stream.title ||
                stream.name ||
                "Untitled"
            );

            console.log(
                "[ANIME47 RESOLVER] SERVER:",
                stream.serverName ||
                stream.server_name ||
                ""
            );

            console.log(
                "[ANIME47 RESOLVER] TYPE:",
                stream.type ||
                stream.player_type ||
                "unknown"
            );

            console.log(
                "[ANIME47 RESOLVER] URL:",
                stream.url ||
                stream.externalUrl ||
                ""
            );


            // ------------------------------------------------
            // Headers
            // ------------------------------------------------
            //
            // Giữ nguyên headers mà Anime47 provider đã
            // chuẩn bị.
            //
            // Resolver không tự thêm header mới ở BƯỚC 3,
            // nhằm tránh thay đổi hành vi hiện tại.
            // ------------------------------------------------

            const headers =
                stream.headers &&
                typeof stream.headers === "object"
                    ? {
                        ...stream.headers
                    }
                    : {};


            // ------------------------------------------------
            // Subtitles
            // ------------------------------------------------

            const subtitles =
                Array.isArray(
                    stream.subtitles
                )
                    ? stream.subtitles
                    : [];


            // ------------------------------------------------
            // Behavior hints
            // ------------------------------------------------

            const behaviorHints =
                stream.behaviorHints &&
                typeof stream.behaviorHints === "object"
                    ? {
                        ...stream.behaviorHints
                    }
                    : {};


            // ------------------------------------------------
            // Resolver result
            // ------------------------------------------------

            const result = {

                url:
                    stream.url,

                externalUrl:
                    stream.externalUrl,

                title:
                    stream.title,

                name:
                    stream.name,

                type:
                    stream.type ||
                    stream.player_type ||
                    "unknown",

                source:
                    stream.source ||
                    "anime47",

                provider:
                    "anime47",

                serverName:
                    stream.serverName ||
                    stream.server_name,

                headers,

                subtitles,

                behaviorHints,

                resolverOptions:
                    stream.resolverOptions &&
                    typeof stream.resolverOptions === "object"
                        ? {
                            ...stream.resolverOptions
                        }
                        : {}
            };


            console.log(
                "[ANIME47 RESOLVER] PASS:",
                result.url ||
                result.externalUrl ||
                ""
            );


            return result;
        }

    })
);


console.log(
    "[ANIME47 RESOLVER] Registered:",
    !!getStreamResolver("anime47")
);

// ============================================================
// ANIME47 PROVIDER
// ============================================================
//
// REVERSE ENGINEERED FROM Anime47 classes.dex
//
// API:
//
//   https://anime47.love/api
//
// Search:
//   /search/full/?lang=vi&keyword={keyword}&page=1
//
// Info:
//   /anime/info/{animeId}?lang=vi
//
// Episodes:
//   /anime/{animeId}/episodes?lang=vi
//
// Watch:
//   /anime/watch/episode/{episodeId}?lang=vi
//
// Authentication:
//
//   POST /auth/login
//   {
//       email,
//       password
//   }
//
// Response:
//   access_token
//
// Protected requests:
//   Authorization: Bearer <access_token>
//
// ============================================================

const ANIME47_CONFIG = {

    apiBase:
        "https://anime47.love/api",

    webBase:
        "https://anime47.best",

    language:
        "vi",

    timeout:
        15000,

    userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/120.0.0.0 Safari/537.36",

    /*
     * Anime47 requires an account for protected
     * Info / Episodes / Watch API calls.
     *
     * Recommended on Vercel:
     *
     * ANIME47_EMAIL
     * ANIME47_PASSWORD
     */

    email:
        String(
            process.env.ANIME47_EMAIL || ""
        ).trim(),

    password:
        String(
            process.env.ANIME47_PASSWORD || ""
        )

};


let ANIME47_ACCESS_TOKEN = "";


let ANIME47_TOKEN_PROMISE = null;


// ============================================================
// ANIME47 COMMON HEADERS
// ============================================================

function getAnime47CommonHeaders(
    extra = {}
) {

    return {

        "User-Agent":
            ANIME47_CONFIG.userAgent,

        "Accept":
            "application/json, text/plain, */*",

        "Origin":
            ANIME47_CONFIG.webBase,

        "Referer":
            ANIME47_CONFIG.webBase + "/",

        ...extra

    };

}


// ============================================================
// ANIME47 LOGIN
// ============================================================

async function loginAnime47() {

    if (
        !ANIME47_CONFIG.email ||
        !ANIME47_CONFIG.password
    ) {

        throw new Error(
            "Anime47 requires ANIME47_EMAIL and ANIME47_PASSWORD"
        );

    }


    console.log(
        "[ANIME47 AUTH] LOGIN..."
    );


    const response =
        await axios.post(

            ANIME47_CONFIG.apiBase +
            "/auth/login",

            {

                email:
                    ANIME47_CONFIG.email,

                password:
                    ANIME47_CONFIG.password

            },

            {

                timeout:
                    ANIME47_CONFIG.timeout,

                headers:
                    getAnime47CommonHeaders({

                        "Content-Type":
                            "application/json"

                    })

            }

        );


    const accessToken =
        String(
            response?.data?.access_token ||
            response?.data?.data?.access_token ||
            response?.data?.token ||
            response?.data?.data?.token ||
            ""
        ).trim();


    if (
        !accessToken
    ) {

        console.log(
            "[ANIME47 AUTH] LOGIN RESPONSE:",
            JSON.stringify(
                response?.data || {}
            )
        );

        throw new Error(
            "Anime47 login returned no access_token"
        );

    }


    ANIME47_ACCESS_TOKEN =
        accessToken;


    console.log(
        "[ANIME47 AUTH] LOGIN SUCCESS"
    );


    return accessToken;

}


// ============================================================
// ANIME47 ENSURE TOKEN
// ============================================================

async function ensureAnime47Token() {

    if (
        ANIME47_ACCESS_TOKEN
    ) {

        return ANIME47_ACCESS_TOKEN;

    }


    if (
        ANIME47_TOKEN_PROMISE
    ) {

        return ANIME47_TOKEN_PROMISE;

    }


    ANIME47_TOKEN_PROMISE =
        loginAnime47()
            .catch(
                error => {

                    ANIME47_ACCESS_TOKEN =
                        "";

                    throw error;

                }
            )
            .finally(
                () => {

                    ANIME47_TOKEN_PROMISE =
                        null;

                }
            );


    return ANIME47_TOKEN_PROMISE;

}


// ============================================================
// ANIME47 AUTH HEADERS
// ============================================================

async function getAnime47AuthHeaders() {

    const token =
        await ensureAnime47Token();


    return {

        "Authorization":
            "Bearer " +
            token

    };

}


// ============================================================
// ANIME47 REQUEST
// ============================================================
//
// Protected endpoints:
//
//   info
//   episodes
//   watch
//
// Search itself also works without authentication,
// but we attach auth when available.
//
// On 401:
//   clear token
//   login again
//   retry once
// ============================================================

async function anime47Request(
    method,
    path,
    options = {},
    retry = true
) {

    const requiresAuth =
        options.requiresAuth !== false;


    let authHeaders = {};


    if (
        requiresAuth
    ) {

        authHeaders =
            await getAnime47AuthHeaders();

    } else {

        /*
         * If a token already exists, use it.
         * This mirrors the provider behaviour while
         * still allowing public search.
         */

        if (
            ANIME47_ACCESS_TOKEN
        ) {

            authHeaders = {

                "Authorization":
                    "Bearer " +
                    ANIME47_ACCESS_TOKEN

            };

        }

    }


    const url =
        ANIME47_CONFIG.apiBase +
        path;


    const headers =
        getAnime47CommonHeaders({

            ...authHeaders,

            ...(options.headers || {})

        });


    console.log(
        "[ANIME47 API] " +
        String(method).toUpperCase() +
        ":",
        url
    );


    try {

        const response =
            await axios({

                method,

                url,

                timeout:
                    ANIME47_CONFIG.timeout,

                headers,

                data:
                    options.data,

                params:
                    options.params,

                validateStatus:
                    () => true

            });


        if (
            response.status === 401 &&
            requiresAuth &&
            retry
        ) {

            console.log(
                "[ANIME47 AUTH] 401 -> REFRESH TOKEN"
            );


            ANIME47_ACCESS_TOKEN =
                "";


            await ensureAnime47Token();


            return anime47Request(
                method,
                path,
                options,
                false
            );

        }


        if (
            response.status < 200 ||
            response.status >= 300
        ) {

            throw new Error(
                "HTTP " +
                response.status
            );

        }


        return response.data;

    } catch (error) {

        throw error;

    }

}


// ============================================================
// ANIME47 SEARCH
// ============================================================

async function searchAnime47(
    movieName
) {

    const keyword =
        String(
            movieName || ""
        ).trim();


    if (
        !keyword
    ) {

        return [];

    }


    const encodedKeyword =
        encodeURIComponent(
            keyword
        );


    const path =
        "/search/full/?lang=" +
        ANIME47_CONFIG.language +
        "&keyword=" +
        encodedKeyword +
        "&page=1";


    const data =
        await anime47Request(
            "GET",
            path,
            {
                requiresAuth:
                    false
            }
        );


    const items =
        Array.isArray(data)
            ? data
            : Array.isArray(data?.data)
                ? data.data
                : Array.isArray(data?.results)
                    ? data.results
                    : Array.isArray(data?.data?.results)
                        ? data.data.results
                        : [];


    console.log(
        "[ANIME47] SEARCH RESULTS:",
        items.length
    );


    return items;

}


// ============================================================
// ANIME47 TITLE NORMALIZATION
// ============================================================

function normalizeAnime47Title(
    text
) {

    return String(
        text || ""
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
        .trim()
        .replace(
            /\s+/g,
            " "
        );

}


// ============================================================
// ANIME47 PICK SEARCH RESULT
// ============================================================

function pickAnime47Result(
    items,
    movieName
) {

    if (
        !Array.isArray(items) ||
        !items.length
    ) {

        return null;

    }


    const target =
        normalizeAnime47Title(
            movieName
        );


    let best =
        null;

    let bestScore =
        -Infinity;


    for (
        const item of items
    ) {

        const titles = [

            item?.title,

            ...(Array.isArray(
                item?.titles
            )
                ? item.titles.map(
                    x => x?.title
                )
                : [])

        ]
            .filter(Boolean)
            .map(
                normalizeAnime47Title
            );


        let score =
            Number(
                item?.relevance_score ||
                0
            );


        if (
            titles.includes(
                target
            )
        ) {

            score += 10000;

        }


        if (
            titles.some(
                title =>
                    title === target
            )
        ) {

            score += 5000;

        }


        if (
            titles.some(
                title =>
                    title.includes(
                        target
                    ) ||
                    target.includes(
                        title
                    )
            )
        ) {

            score += 1000;

        }


        if (
            score >
            bestScore
        ) {

            bestScore =
                score;

            best =
                item;

        }

    }


    return best;

}


// ============================================================
// ANIME47 INFO
// ============================================================

async function getAnime47Info(
    anime
) {

    const animeId =
        Number(
            anime?.id ||
            anime?.legacy_id ||
            0
        );


    if (
        !animeId
    ) {

        throw new Error(
            "Anime47 info: missing anime id"
        );

    }


    const path =
        "/anime/info/" +
        animeId +
        "?lang=" +
        ANIME47_CONFIG.language;


    const data =
        await anime47Request(
            "GET",
            path,
            {
                requiresAuth:
                    true
            }
        );


    console.log(
        "[ANIME47] INFO OK:",
        animeId
    );


    return data;

}


// ============================================================
// ANIME47 EPISODE EXTRACTION
// ============================================================
//
// Actual DEX model:
//
// ApiEpisodeResponse
//     -> teams[]
//          -> groups[]
//               -> episodes[]
//
// EpisodeListItem:
//
//     id
//     number
//     title
//
// ============================================================

function extractAnime47Episodes(
    response
) {

    const root =
        response?.data ||
        response;


    const teams =
        Array.isArray(
            root?.teams
        )
            ? root.teams
            : [];


    const episodes =
        [];


    const seen =
        new Set();


    for (
        const team of teams
    ) {

        const groups =
            Array.isArray(
                team?.groups
            )
                ? team.groups
                : [];


        for (
            const group of groups
        ) {

            const groupEpisodes =
                Array.isArray(
                    group?.episodes
                )
                    ? group.episodes
                    : [];


            for (
                const episode of groupEpisodes
            ) {

                const id =
                    Number(
                        episode?.id ||
                        0
                    );


                const number =
                    Number(
                        episode?.number ||
                        0
                    );


                if (
                    !id
                ) {

                    continue;

                }


                if (
                    seen.has(id)
                ) {

                    continue;

                }


                seen.add(id);


                episodes.push({

                    id,

                    number,

                    title:
                        episode?.title ||
                        (
                            number
                                ? "Episode " +
                                  number
                                : "Episode"
                        ),

                    teamName:
                        team?.team_name ||
                        "",

                    groupName:
                        group?.name ||
                        ""

                });

            }

        }

    }


    episodes.sort(
        (a, b) =>
            Number(a.number || 0) -
            Number(b.number || 0)
    );


    return episodes;

}


// ============================================================
// ANIME47 EPISODES
// ============================================================

async function getAnime47Episodes(
    anime
) {

    const animeId =
        Number(
            anime?.id ||
            anime?.legacy_id ||
            0
        );


    if (
        !animeId
    ) {

        throw new Error(
            "Anime47 episodes: missing anime id"
        );

    }


    /*
     * IMPORTANT:
     *
     * DEX confirms:
     *
     * /anime/{animeId}/episodes?lang=vi
     *
     * NOT:
     *
     * /episodes?id={animeId}
     */

    const path =
        "/anime/" +
        animeId +
        "/episodes?lang=" +
        ANIME47_CONFIG.language;


    const data =
        await anime47Request(
            "GET",
            path,
            {
                requiresAuth:
                    true
            }
        );


    const episodes =
        extractAnime47Episodes(
            data
        );


    console.log(
        "[ANIME47] EPISODES:",
        episodes.length
    );


    return episodes;

}


// ============================================================
// ANIME47 PICK EPISODE
// ============================================================

function pickAnime47Episode(
    episodes,
    episodeNumber
) {

    if (
        !Array.isArray(episodes) ||
        !episodes.length
    ) {

        return null;

    }


    const wanted =
        Number(
            episodeNumber || 0
        );


    if (
        wanted > 0
    ) {

        const exact =
            episodes.find(
                episode =>
                    Number(
                        episode.number || 0
                    ) === wanted
            );


        if (
            exact
        ) {

            return exact;

        }

    }


    return episodes[0];

}


// ============================================================
// ANIME47 WATCH
// ============================================================

async function getAnime47Watch(
    episode
) {

    const episodeId =
        Number(
            episode?.id ||
            0
        );


    if (
        !episodeId
    ) {

        throw new Error(
            "Anime47 watch: missing episode id"
        );

    }


    const path =
        "/anime/watch/episode/" +
        episodeId +
        "?lang=" +
        ANIME47_CONFIG.language;


    const data =
        await anime47Request(
            "GET",
            path,
            {
                requiresAuth:
                    true
            }
        );


    console.log(
        "[ANIME47] WATCH OK:",
        episodeId
    );


    return data;

}


// ============================================================
// ANIME47 EXTRACT STREAMS
// ============================================================

function extractAnime47Streams(
    watchData
) {

    const streams =
        watchData?.streams ||
        watchData?.data?.streams ||
        watchData?.result?.streams ||
        watchData?.data?.result?.streams ||
        [];


    return Array.isArray(
        streams
    )
        ? streams
        : [];

}


// ============================================================
// ANIME47 JWPLAYER HEADERS
// ============================================================
//
// DEX loadLinks() adds these when
// player_type == "jwplayer".
//
// ============================================================

function getAnime47PlayerHeaders(
    rawStream
) {

    const playerType =
        String(
            rawStream?.player_type ||
            ""
        )
        .toLowerCase()
        .trim();


    if (
        playerType !==
        "jwplayer"
    ) {

        return {};

    }


    return {

        "Referer":
            ANIME47_CONFIG.webBase +
            "/",

        "User-Agent":
            "Mozilla/5.0 (Linux; Android 10; K) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/120.0.0.0 Mobile Safari/537.36",

        "sec-ch-ua":
            "\"Chromium\";v=\"120\", " +
            "\"Not?A_Brand\";v=\"24\"",

        "sec-ch-ua-mobile":
            "?1",

        "sec-ch-ua-platform":
            "\"Android\""

    };

}


// ============================================================
// ANIME47 NORMALIZE STREAM
// ============================================================

function normalizeAnime47Stream(
    rawStream,
    context = {}
) {

    if (
        !rawStream ||
        typeof rawStream !==
        "object"
    ) {

        return null;

    }


    const url =
        String(
            rawStream?.url ||
            ""
        ).trim();


    if (
        !url
    ) {

        return null;

    }


    const serverName =
        String(
            rawStream?.server_name ||
            ""
        ).trim();


    const playerType =
        String(
            rawStream?.player_type ||
            ""
        ).trim();


    const subtitles =
        Array.isArray(
            rawStream?.subtitles
        )
            ? rawStream.subtitles
            : [];


    const headers =
        getAnime47PlayerHeaders(
            rawStream
        );


    return createNormalizedStream({

        url,

        title:
            "[Anime47] " +
            (
                serverName ||
                "Anime47"
            ),

        name:
            "[Anime47] " +
            (
                serverName ||
                "Anime47"
            ),

        type:
            playerType ||
            "hls",

        source:
            "anime47",

        provider:
            "anime47",

        serverName,

        headers,

        subtitles,

        behaviorHints:
            {},

        resolver:
            "anime47",

        resolverOptions: {

            playerType,

            serverName,

            episodeId:
                context?.episodeId ||
                0

        }

    });

}


// ============================================================
// ANIME47 PROVIDER
// ============================================================

async function fetchAnime47(
    movieName,
    seasonNumber = 0,
    episodeNumber = 0,
    streamType = "series"
) {

    console.log(
        "========== ANIME47 =========="
    );


    console.log(
        "[ANIME47] Name:",
        movieName
    );

    console.log(
        "[ANIME47] Season:",
        seasonNumber
    );

    console.log(
        "[ANIME47] Episode:",
        episodeNumber
    );

    console.log(
        "[ANIME47] Type:",
        streamType
    );


    try {

        // ----------------------------------------------------
        // 1. SEARCH
        // ----------------------------------------------------

        const searchResults =
            await searchAnime47(
                movieName
            );


        console.log(
            "[ANIME47] SEARCH RESULTS:",
            searchResults.length
        );


        if (
            !searchResults.length
        ) {

            console.log(
                "[ANIME47] No search result"
            );

            return [];

        }


        // ----------------------------------------------------
        // 2. SELECT ANIME
        // ----------------------------------------------------

        const anime =
            pickAnime47Result(
                searchResults,
                movieName
            );


        if (
            !anime
        ) {

            console.log(
                "[ANIME47] No selected anime"
            );

            return [];

        }


        console.log(
            "[ANIME47] SELECTED:",
            JSON.stringify(
                anime
            )
        );


        // ----------------------------------------------------
        // 3. INFO + EPISODES
        // ----------------------------------------------------

        let info =
            null;

        try {

            info =
                await getAnime47Info(
                    anime
                );

        } catch (e) {

            console.log(
                "[ANIME47 INFO ERROR]:",
                e?.message ||
                e
            );

        }


        let episodes =
            [];


        try {

            episodes =
                await getAnime47Episodes(
                    anime
                );

        } catch (e) {

            console.log(
                "[ANIME47 EPISODES ERROR]:",
                e?.message ||
                e
            );

        }


        /*
         * If Info is unavailable but Episodes works,
         * continue anyway.
         */

        if (
            !episodes.length
        ) {

            console.log(
                "[ANIME47] No episodes"
            );

            return [];

        }


        // ----------------------------------------------------
        // 4. PICK EPISODE
        // ----------------------------------------------------

        const episode =
            pickAnime47Episode(
                episodes,
                episodeNumber
            );


        if (
            !episode
        ) {

            console.log(
                "[ANIME47] No matching episode"
            );

            return [];

        }


        console.log(
            "[ANIME47] SELECTED EPISODE:",
            JSON.stringify(
                episode
            )
        );


        // ----------------------------------------------------
        // 5. WATCH
        // ----------------------------------------------------

        const watchData =
            await getAnime47Watch(
                episode
            );


        // ----------------------------------------------------
        // 6. RAW STREAMS
        // ----------------------------------------------------

        const rawStreams =
            extractAnime47Streams(
                watchData
            );


        console.log(
            "[ANIME47] RAW STREAM COUNT:",
            rawStreams.length
        );


        // ----------------------------------------------------
        // 7. NORMALIZE
        // ----------------------------------------------------

        const normalizedStreams =
            rawStreams
                .map(
                    rawStream =>
                        normalizeAnime47Stream(
                            rawStream,
                            {

                                movieName,

                                movieYear:
                                    0,

                                seasonNumber,

                                episodeNumber,

                                streamType,

                                animeId:
                                    Number(
                                        anime?.id ||
                                        anime?.legacy_id ||
                                        0
                                    ),

                                episodeId:
                                    Number(
                                        episode?.id ||
                                        0
                                    )

                            }
                        )
                )
                .filter(Boolean);


        console.log(
            "[ANIME47] NORMALIZED STREAM COUNT:",
            normalizedStreams.length
        );


        // ----------------------------------------------------
        // 8. RESOLVER ENGINE
        // ----------------------------------------------------

        if (
            normalizedStreams.length
        ) {

            try {

                const resolvedStreams =
                    await resolveNormalizedStreams(
                        normalizedStreams,
                        {

                            provider:
                                "anime47",

                            movieName,

                            seasonNumber,

                            episodeNumber,

                            streamType

                        }
                    );


                console.log(
                    "[ANIME47] RESOLVED STREAM COUNT:",
                    resolvedStreams.length
                );


                return resolvedStreams;

            } catch (resolverError) {

                console.log(
                    "[ANIME47 RESOLVER PIPELINE ERROR]:",
                    resolverError?.message ||
                    resolverError
                );

            }

        }


        return normalizedStreams;

    } catch (e) {

        console.log(
            "[ANIME47 ERROR]:",
            e?.stack ||
            e?.message ||
            e
        );


        return [];

    }

}


console.log(
    "[ANIME47 PROVIDER] Registered"
);

// ============================================================
// BL-MOVINA SOURCE / PROVIDER REGISTRY
// ============================================================
//
// Mục tiêu:
// - Registry trung tâm của toàn bộ source/provider trong MOVINA.
// - Không phụ thuộc riêng vào Movie / CS3 / LIVE.
// - User Configure sau này sẽ quản lý source tại đây.
//
// Category:
//
//   native
//       → Native Movie / Video
//
//   cs3
//       → CloudStream / CS3
//
//   tv
//       → TV / IPTV
//
// kind là loại implementation nội bộ:
//
//   api
//   scrape
//   plugin
//   m3u
//   iptv
//   ...
//
// Registry này KHÔNG thay thế các registry chuyên biệt hiện tại.
// Ví dụ:
//
//   MOVINA PROVIDER REGISTRY
//          ↓
//   category: "tv"
//          ↓
//   LIVE_PROVIDER_REGISTRY
//          ↓
//   VMT TV
//
// ============================================================

const MOVINA_PROVIDER_REGISTRY = new Map();


// ============================================================
// bn-1. MOVINA PROVIDER CONTRACT
// ============================================================

function createMovinaProvider(provider) {

    if (!provider || typeof provider !== "object") {

        throw new Error(
            "[MOVINA PROVIDER] Invalid provider"
        );
    }

    const id =
        String(
            provider.id || ""
        ).trim();

    if (!id) {

        throw new Error(
            "[MOVINA PROVIDER] Provider ID is required"
        );
    }

    const name =
        String(
            provider.name ||
            id
        ).trim();

    const category =
        String(
            provider.category ||
            ""
        ).trim().toLowerCase();

    const allowedCategories = [
        "native",
        "cs3",
        "tv"
    ];

    if (
        !allowedCategories.includes(
            category
        )
    ) {

        throw new Error(
            `[MOVINA PROVIDER] Invalid category: ${category}`
        );
    }

    const kind =
        String(
            provider.kind ||
            ""
        ).trim().toLowerCase();

    return {

        id,

        name,

        category,

        kind,

        sourceUrl:
            String(
                provider.sourceUrl ||
                ""
            ).trim(),

        enabled:
            provider.enabled !== false,

        iconUrl:
            String(
                provider.iconUrl ||
                ""
            ).trim(),

        capabilities:
            provider.capabilities &&
            typeof provider.capabilities === "object"
                ? {
                    ...provider.capabilities
                }
                : {},

        adapter:
            provider.adapter ||
            null,

        resolver:
            provider.resolver ||
            null,

        metadata:
            provider.metadata &&
            typeof provider.metadata === "object"
                ? {
                    ...provider.metadata
                }
                : {}
    };
}


// ============================================================
// bn-2. REGISTER MOVINA PROVIDER
// ============================================================

function registerMovinaProvider(provider) {

    const normalized =
        createMovinaProvider(
            provider
        );

    MOVINA_PROVIDER_REGISTRY.set(
        normalized.id,
        normalized
    );

    console.log(
        "[MOVINA PROVIDER] REGISTERED:",
        normalized.id,
        "|",
        normalized.name,
        "|",
        normalized.category,
        "|",
        normalized.kind,
        "| enabled:",
        normalized.enabled
    );

    return normalized;
}


// ============================================================
// bn-3. GET MOVINA PROVIDER
// ============================================================

function getMovinaProvider(providerId) {

    const id =
        String(
            providerId || ""
        ).trim();

    if (!id) {
        return null;
    }

    return (
        MOVINA_PROVIDER_REGISTRY.get(
            id
        ) || null
    );
}


// ============================================================
// bn-4. GET ALL MOVINA PROVIDERS
// ============================================================

function getAllMovinaProviders() {

    return Array.from(
        MOVINA_PROVIDER_REGISTRY.values()
    );
}


// ============================================================
// bn-5. GET PROVIDERS BY CATEGORY
// ============================================================

function getMovinaProvidersByCategory(
    category
) {

    const normalizedCategory =
        String(
            category || ""
        ).trim().toLowerCase();

    if (!normalizedCategory) {
        return [];
    }

    return getAllMovinaProviders()
        .filter(
            provider =>
                provider.category ===
                normalizedCategory
        );
}


// ============================================================
// bn-6. ENABLE PROVIDER
// ============================================================

function enableMovinaProvider(
    providerId
) {

    const provider =
        getMovinaProvider(
            providerId
        );

    if (!provider) {

        console.log(
            "[MOVINA PROVIDER] ENABLE FAILED:",
            providerId
        );

        return null;
    }

    provider.enabled = true;

    console.log(
        "[MOVINA PROVIDER] ENABLED:",
        provider.id,
        provider.name
    );

    return provider;
}


// ============================================================
// bn-7. DISABLE PROVIDER
// ============================================================

function disableMovinaProvider(
    providerId
) {

    const provider =
        getMovinaProvider(
            providerId
        );

    if (!provider) {

        console.log(
            "[MOVINA PROVIDER] DISABLE FAILED:",
            providerId
        );

        return null;
    }

    provider.enabled = false;

    console.log(
        "[MOVINA PROVIDER] DISABLED:",
        provider.id,
        provider.name
    );

    return provider;
}


// ============================================================
// bn-8. REMOVE PROVIDER
// ============================================================

function removeMovinaProvider(
    providerId
) {

    const id =
        String(
            providerId || ""
        ).trim();

    if (!id) {
        return false;
    }

    const existed =
        MOVINA_PROVIDER_REGISTRY.has(
            id
        );

    if (!existed) {

        console.log(
            "[MOVINA PROVIDER] REMOVE FAILED:",
            id
        );

        return false;
    }

    MOVINA_PROVIDER_REGISTRY.delete(
        id
    );

    console.log(
        "[MOVINA PROVIDER] REMOVED:",
        id
    );

    return true;
}


// ============================================================
// bn-9. PROVIDER STATUS
// ============================================================

function getMovinaProviderInfo(
    providerId
) {

    const provider =
        getMovinaProvider(
            providerId
        );

    if (!provider) {
        return null;
    }

    return {

        id:
            provider.id,

        name:
            provider.name,

        category:
            provider.category,

        kind:
            provider.kind,

        sourceUrl:
            provider.sourceUrl,

        enabled:
            provider.enabled,

        iconUrl:
            provider.iconUrl,

        capabilities:
            {
                ...provider.capabilities
            }
    };
}


// ============================================================
// bn-10. DEBUG MOVINA PROVIDER REGISTRY
// ============================================================

function logMovinaProviderRegistry() {

    const providers =
        getAllMovinaProviders();

    console.log(
        "[MOVINA PROVIDER] TOTAL:",
        providers.length
    );

    for (
        const provider
        of providers
    ) {

        console.log(
            "[MOVINA PROVIDER]",
            provider.id,
            "|",
            provider.name,
            "| category:",
            provider.category,
            "| kind:",
            provider.kind,
            "| enabled:",
            provider.enabled
        );
    }
}

// ============================================================
// LIVE PROVIDER CONTRACT
// ============================================================
//
// Mục tiêu:
// - Chuẩn hóa mọi nguồn truyền hình / IPTV / Live Event.
// - VMT TV chỉ là provider đầu tiên.
// - Sau này provider khác có thể được nạp từ Configure/Repository
//   mà không phải viết lại Stream Handler.
//
// Pipeline:
//
//   LIVE PROVIDER
//        ↓
//   LIVE ITEM
//        ↓
//   LIVE STREAM
//        ↓
//   NORMALIZED STREAM
//        ↓
//   STREMIO
//
// ============================================================

const LIVE_PROVIDER_REGISTRY = new Map();

// ============================================================
// 1. LIVE PROVIDER CONTRACT
// ============================================================

function createLiveProvider(provider) {

    if (!provider || typeof provider !== "object") {
        throw new Error("Invalid LIVE provider");
    }

    const requiredFunctions = [
        "getManifest",
        "getHomeSections",
        "getPrimaryCategories",
        "getUrlList",
        "getUrlSearch",
        "getUrlDetail",
        "parseListResponse",
        "parseSearchResponse",
        "parseMovieDetail",
        "parseDetailResponse"
    ];

    for (const fn of requiredFunctions) {

        if (typeof provider[fn] !== "function") {
            throw new Error(
                `[LIVE PROVIDER] Missing function: ${fn}`
            );
        }
    }

    return {

        type: "LIVE",

        id:
            String(provider.id || "")
                .trim(),

        name:
            String(provider.name || provider.id || "LIVE")
                .trim(),

        iconUrl:
            String(provider.iconUrl || "")
                .trim(),

        manifest:
            provider.manifest || null,

        getManifest:
            provider.getManifest,

        getHomeSections:
            provider.getHomeSections,

        getPrimaryCategories:
            provider.getPrimaryCategories,

        getFilterConfig:
            typeof provider.getFilterConfig === "function"
                ? provider.getFilterConfig
                : () => JSON.stringify({}),

        getUrlList:
            provider.getUrlList,

        getUrlSearch:
            provider.getUrlSearch,

        getUrlDetail:
            provider.getUrlDetail,

        getUrlCategories:
            typeof provider.getUrlCategories === "function"
                ? provider.getUrlCategories
                : () => "",

        getUrlCountries:
            typeof provider.getUrlCountries === "function"
                ? provider.getUrlCountries
                : () => "",

        getUrlYears:
            typeof provider.getUrlYears === "function"
                ? provider.getUrlYears
                : () => "",

        parseListResponse:
            provider.parseListResponse,

        parseSearchResponse:
            provider.parseSearchResponse,

        parseMovieDetail:
            provider.parseMovieDetail,

        parseDetailResponse:
            provider.parseDetailResponse,

        parseCategoriesResponse:
            typeof provider.parseCategoriesResponse === "function"
                ? provider.parseCategoriesResponse
                : () => [],

        parseCountriesResponse:
            typeof provider.parseCountriesResponse === "function"
                ? provider.parseCountriesResponse
                : () => [],

        parseYearsResponse:
            typeof provider.parseYearsResponse === "function"
                ? provider.parseYearsResponse
                : () => []
    };
}


// ============================================================
// 2. REGISTER LIVE PROVIDER
// ============================================================

function registerLiveProvider(provider) {

    const normalized =
        createLiveProvider(provider);

    if (!normalized.id) {
        throw new Error(
            "[LIVE PROVIDER] Provider ID is required"
        );
    }

    LIVE_PROVIDER_REGISTRY.set(
        normalized.id,
        normalized
    );

    console.log(
        "[LIVE PROVIDER] REGISTERED:",
        normalized.id,
        normalized.name
    );

    return normalized;
}


// ============================================================
// 3. GET LIVE PROVIDER
// ============================================================

function getLiveProvider(providerId) {

    const id =
        String(providerId || "")
            .trim();

    if (!id) {
        return null;
    }

    return (
        LIVE_PROVIDER_REGISTRY.get(id)
        || null
    );
}


// ============================================================
// 4. GET ALL LIVE PROVIDERS
// ============================================================

function getAllLiveProviders() {

    return Array.from(
        LIVE_PROVIDER_REGISTRY.values()
    );
}


// ============================================================
// 5. NORMALIZED LIVE ITEM
// ============================================================
//
// Mọi provider LIVE cuối cùng nên đưa dữ liệu về dạng này:
//
// {
//     id,
//     provider,
//     title,
//     posterUrl,
//     backdropUrl,
//     description,
//     year,
//     quality,
//     episode_current,
//     lang,
//     category,
//     country,
//     type: "LIVE"
// }
//
// ============================================================

function normalizeLiveItem(item, providerId) {

    if (!item || typeof item !== "object") {
        return null;
    }

    const title =
        String(
            item.title ||
            item.name ||
            ""
        ).trim();

    if (!title) {
        return null;
    }

    return {

        id:
            String(item.id || "").trim(),

        provider:
            String(
                item.provider ||
                providerId ||
                ""
            ).trim(),

        title,

        posterUrl:
            String(
                item.posterUrl ||
                item.poster ||
                item.logo ||
                ""
            ).trim(),

        backdropUrl:
            String(
                item.backdropUrl ||
                item.backdrop ||
                item.posterUrl ||
                item.logo ||
                ""
            ).trim(),

        description:
            String(
                item.description ||
                ""
            ).trim(),

        year:
            Number(item.year || 0),

        quality:
            String(
                item.quality ||
                "LIVE"
            ).trim(),

        episode_current:
            String(
                item.episode_current ||
                "Live"
            ).trim(),

        lang:
            String(
                item.lang ||
                ""
            ).trim(),

        category:
            String(
                item.category ||
                item.group ||
                ""
            ).trim(),

        country:
            String(
                item.country ||
                ""
            ).trim(),

        type: "LIVE"
    };
}


// ============================================================
// 6. NORMALIZED LIVE STREAM
// ============================================================
//
// Đây là format chung mà Stremio Adapter sẽ nhận.
//
// url:
//     M3U8 / MP4 / stream URL thực tế.
//
// externalUrl:
//     Player / WebView fallback.
//
// headers:
//     User-Agent / Referer / token headers.
//
// streamType:
//     direct | hls | embed | player
//
// ============================================================

function normalizeLiveStream(stream, providerId) {

    if (!stream || typeof stream !== "object") {
        return null;
    }

    const url =
        String(
            stream.url ||
            ""
        ).trim();

    const externalUrl =
        String(
            stream.externalUrl ||
            ""
        ).trim();

    if (!url && !externalUrl) {
        return null;
    }

    const headers =
        stream.headers &&
        typeof stream.headers === "object"
            ? stream.headers
            : {};

    return {

        provider:
            String(
                stream.provider ||
                providerId ||
                ""
            ).trim(),

        title:
            String(
                stream.title ||
                "LIVE"
            ).trim(),

        url,

        externalUrl,

        headers,

        streamType:
            String(
                stream.streamType ||
                stream.type ||
                (url ? "direct" : "player")
            ).trim(),

        transformer:
            stream.transformer || null,

        playerUrl:
            String(
                stream.playerUrl ||
                ""
            ).trim(),

        type: "LIVE"
    };
}


// ============================================================
// 7. LIVE PROVIDER → NORMALIZED ITEMS
// ============================================================

function normalizeLiveItems(items, providerId) {

    if (!Array.isArray(items)) {
        return [];
    }

    return items
        .map(item =>
            normalizeLiveItem(
                item,
                providerId
            )
        )
        .filter(Boolean);
}


// ============================================================
// 8. LIVE PROVIDER → NORMALIZED STREAMS
// ============================================================

function normalizeLiveStreams(streams, providerId) {

    if (!Array.isArray(streams)) {
        return [];
    }

    return streams
        .map(stream =>
            normalizeLiveStream(
                stream,
                providerId
            )
        )
        .filter(Boolean);
}


// ============================================================
// 9. LIVE PROVIDER STATUS
// ============================================================

function getLiveProviderInfo(providerId) {

    const provider =
        getLiveProvider(providerId);

    if (!provider) {
        return null;
    }

    return {

        id: provider.id,

        name: provider.name,

        iconUrl: provider.iconUrl,

        type: "LIVE",

        enabled: true
    };
}


// ============================================================
// 10. DEBUG REGISTRY
// ============================================================

function logLiveProviderRegistry() {

    const providers =
        getAllLiveProviders();

    console.log(
        "[LIVE PROVIDER] TOTAL:",
        providers.length
    );

    for (const provider of providers) {

        console.log(
            "[LIVE PROVIDER]",
            provider.id,
            "|",
            provider.name
        );
    }
}

// ============================================================
// 11. VMT TV - LIVE PROVIDER
// ============================================================
//
// VMT TV là LIVE provider đầu tiên của MOVINA.
//
// Provider này đọc M3U từ repository VMT TV và chuyển toàn bộ
// dữ liệu về LIVE Provider Contract.
//
// Sau này các provider truyền hình khác chỉ cần tạo adapter
// cùng contract này và register vào LIVE_PROVIDER_REGISTRY.
//
// ============================================================


// ============================================================
// 11.1. VMT TV - MANIFEST
// ============================================================

const VMTTV_M3U_URL =
    "https://raw.githubusercontent.com/vuminhthanh12/vuminhthanh12/refs/heads/main/vmttv";


function vmtTvGetManifest() {

    return JSON.stringify({

        id: "vmttv",

        name: "VMT TV",

        version: "1.0.2",

        baseUrl:
            "https://raw.githubusercontent.com/vuminhthanh12/vuminhthanh12/refs/heads/main",

        iconUrl:
            "https://raw.githubusercontent.com/vuminhthanh12/vuminhthanh12/refs/heads/main/Logo.png",

        isEnabled: true,

        type: "VIDEO",

        layoutType: "HORIZONTAL",

        playerType: "exoplayer"
    });
}


// ============================================================
// 11.2. VMT TV - HOME
// ============================================================

function vmtTvGetHomeSections() {

    return JSON.stringify([

        {
            slug: "su-kien",

            title: "🔴 Sự Kiện",

            type: "Grid",

            path: "vmttv"
        }

    ]);
}


// ============================================================
// 11.3. VMT TV - CATEGORIES
// ============================================================

function vmtTvGetPrimaryCategories() {

    return JSON.stringify([

        { name: "FIFA WORLD CUP 2026", slug: "fifa-world-cup-2026" },
        { name: "Sự Kiện", slug: "su-kien" },
        { name: "THỂ THAO QT", slug: "the-thao-quoc-te" },
        { name: "⚽ Thể thao QT", slug: "bong-da-quoc-te" },
        { name: "TVB", slug: "tvb" },
        { name: "LIVE EVENTS 🔴", slug: "live-events" },
        { name: "Sự Kiện TV360", slug: "su-kien-tv360" },
        { name: "Sự Kiện VTVPrime", slug: "su-kien-vtvprime" },
        { name: "Rạp Phim", slug: "rap-phim" },
        { name: "VTV", slug: "vtv" },
        { name: "VTVcab", slug: "vtvcab" },
        { name: "SCTV", slug: "sctv" },
        { name: "📦 In The Box", slug: "in-the-box" },
        { name: "HTV", slug: "htv" },
        { name: "HTVC", slug: "htvc" },
        { name: "🌐 Thiết yếu", slug: "thiet-yeu" },
        { name: "Địa phương", slug: "dia-phuong" },
        { name: "Quốc Tế", slug: "quoc-te" },
        { name: "Radio", slug: "radio" },
        { name: "🇻🇳 Vietnam Radio", slug: "vietnam-radio" },
        { name: "🇬🇧 UK Radio", slug: "uk-radio" },
        { name: "🇰🇷 Hàn Quốc", slug: "han-quoc" },
        { name: "🇨🇳 Trung Quốc", slug: "trung-quoc" },
        { name: "🇹🇭 Thái Lan", slug: "thai-lan" },
        { name: "🇰🇭 Campuchia", slug: "campuchia" }

    ]);
}


function vmtTvGetFilterConfig() {

    return JSON.stringify({});
}


// ============================================================
// 11.4. VMT TV - CATEGORY MAP
// ============================================================
//
// IMPORTANT:
// Các value bên dưới phải khớp EXACT với group-title trong M3U
// và với tên category trong vmtTvGetPrimaryCategories().
//
// Không thêm dấu "|" vào tên category.
//
// ============================================================

const VMTTV_CATEGORY_MAP = {

    "fifa-world-cup-2026":
        "FIFA WORLD CUP 2026",

    "su-kien":
        "Sự Kiện",

    "the-thao-quoc-te":
        "THỂ THAO QT",

    "bong-da-quoc-te":
        "⚽ Thể thao QT",

    "tvb":
        "TVB",

    "live-events":
        "LIVE EVENTS 🔴",

    "su-kien-tv360":
        "Sự Kiện TV360",

    "su-kien-vtvprime":
        "Sự Kiện VTVPrime",

    "rap-phim":
        "Rạp Phim",

    "vtv":
        "VTV",

    "vtvcab":
        "VTVcab",

    "sctv":
        "SCTV",

    "in-the-box":
        "📦 In The Box",

    "htv":
        "HTV",

    "htvc":
        "HTVC",

    "thiet-yeu":
        "🌐 Thiết yếu",

    "dia-phuong":
        "Địa phương",

    "quoc-te":
        "Quốc Tế",

    "radio":
        "Radio",

    "vietnam-radio":
        "🇻🇳 Vietnam Radio",

    "uk-radio":
        "🇬🇧 UK Radio",

    "han-quoc":
        "🇰🇷 Hàn Quốc",

    "trung-quoc":
        "🇨🇳 Trung Quốc",

    "thai-lan":
        "🇹🇭 Thái Lan",

    "campuchia":
        "🇰🇭 Campuchia"
};


// ============================================================
// 11.5. VMT TV - URL BUILDERS
// ============================================================

function vmtTvGetUrlList(slug, filtersJson) {

    if (
        slug &&
        slug !== "all"
    ) {

        return (
            VMTTV_M3U_URL +
            "?cat=" +
            encodeURIComponent(slug)
        );
    }

    return VMTTV_M3U_URL;
}


function vmtTvGetUrlSearch(keyword, filtersJson) {

    return (
        VMTTV_M3U_URL +
        "?search=" +
        encodeURIComponent(keyword)
    );
}


function vmtTvGetUrlDetail(slug) {

    if (
        String(slug || "")
            .indexOf("http") === 0
    ) {

        return slug;
    }

    return (
        VMTTV_M3U_URL +
        "?id=" +
        encodeURIComponent(slug)
    );
}


function vmtTvGetUrlCategories() {

    return "";
}


function vmtTvGetUrlCountries() {

    return "";
}


function vmtTvGetUrlYears() {

    return "";
}


// ============================================================
// 11.6. VMT TV - M3U PARSER
// ============================================================

function vmtTvParseM3U(text) {

    const lines =
        String(text || "")
            .split(/\r?\n/);

    const channels = [];

    let current = null;

    for (
        let i = 0;
        i < lines.length;
        i++
    ) {

        const line =
            String(lines[i] || "")
                .trim();

        if (!line) {
            continue;
        }


        // ----------------------------------------------------
        // EXTINF
        // ----------------------------------------------------

        if (
            line.indexOf("#EXTINF:") === 0
        ) {

            const commaIndex =
                line.lastIndexOf(",");

            const info =
                commaIndex >= 0
                    ? line.substring(
                        0,
                        commaIndex
                    )
                    : line;

            const name =
                commaIndex >= 0
                    ? line.substring(
                        commaIndex + 1
                    ).trim()
                    : "";


            const groupMatch =
                info.match(
                    /group-title="([^"]*)"/i
                );

            const logoMatch =
                info.match(
                    /tvg-logo="([^"]*)"/i
                );

            const tvgIdMatch =
                info.match(
                    /tvg-id="([^"]*)"/i
                );


            current = {

                group:
                    groupMatch
                        ? groupMatch[1]
                        : "",

                logo:
                    logoMatch
                        ? logoMatch[1]
                        : "",

                tvgId:
                    tvgIdMatch
                        ? tvgIdMatch[1]
                        : "",

                name,

                index:
                    channels.length,

                url: "",

                userAgent: ""
            };

            continue;
        }


        // ----------------------------------------------------
        // VLC USER-AGENT
        // ----------------------------------------------------

        if (
            line.indexOf(
                "#EXTVLCOPT:http-user-agent="
            ) === 0
        ) {

            if (current) {

                current.userAgent =
                    line.substring(
                        "#EXTVLCOPT:http-user-agent="
                            .length
                    ).trim();
            }

            continue;
        }


        // ----------------------------------------------------
        // IGNORE OTHER DIRECTIVES
        // ----------------------------------------------------

        if (
            line.charAt(0) === "#"
        ) {

            continue;
        }


        // ----------------------------------------------------
        // STREAM URL
        // ----------------------------------------------------

        if (
            line.indexOf("http") === 0 ||
            line.indexOf("//") === 0
        ) {

            if (current) {

                current.url =
                    line.indexOf("//") === 0
                        ? "https:" + line
                        : line;

                channels.push(current);

                current = null;
            }
        }
    }

    return channels;
}


// ============================================================
// 11.7. VMT TV - CHANNEL ID
// ============================================================

function vmtTvMakeChannelId(channel) {

    if (
        channel &&
        channel.tvgId
    ) {

        return channel.tvgId;
    }

    return (
        (channel?.group || "unknown") +
        "::" +
        (channel?.name || "") +
        "::" +
        (channel?.index ?? 0)
    );
}


function vmtTvFindChannelById(
    channels,
    channelId
) {

    if (!Array.isArray(channels)) {
        return null;
    }

    for (
        let i = 0;
        i < channels.length;
        i++
    ) {

        if (
            vmtTvMakeChannelId(channels[i]) ===
            channelId
        ) {

            return channels[i];
        }
    }

    return null;
}


// ============================================================
// 11.8. VMT TV - LIST RESPONSE
// ============================================================

function vmtTvParseListResponse(
    apiResponseJson,
    apiUrl
) {

    const channels =
        vmtTvParseM3U(
            apiResponseJson
        );


    let filtered =
        channels;


    // --------------------------------------------------------
    // CATEGORY FILTER
    // --------------------------------------------------------

    try {

        const parsedUrl =
            new URL(apiUrl);

        const categorySlug =
            parsedUrl.searchParams.get("cat");

        if (
            categorySlug &&
            VMTTV_CATEGORY_MAP[categorySlug]
        ) {

            const categoryName =
                VMTTV_CATEGORY_MAP[
                    categorySlug
                ];

            filtered =
                channels.filter(channel =>
                    String(
                        channel.group || ""
                    ).trim() ===
                    categoryName
                );
        }

    } catch (e) {

        console.log(
            "[VMTTV] CATEGORY PARSE ERROR:",
            e?.message || e
        );
    }


    // --------------------------------------------------------
    // SEARCH FILTER
    // --------------------------------------------------------

    try {

        const parsedUrl =
            new URL(apiUrl);

        const search =
            String(
                parsedUrl.searchParams.get("search") ||
                ""
            )
            .trim()
            .toLowerCase();

        if (search) {

            filtered =
                filtered.filter(channel =>
                    String(
                        channel.name || ""
                    )
                    .toLowerCase()
                    .includes(search)
                );
        }

    } catch (e) {

        console.log(
            "[VMTTV] SEARCH PARSE ERROR:",
            e?.message || e
        );
    }


    return filtered.map(channel => ({

        id:
            vmtTvMakeChannelId(
                channel
            ),

        title:
            channel.name,

        posterUrl:
            channel.logo || "",

        backdropUrl:
            channel.logo || "",

        year: 0,

        quality: "LIVE",

        episode_current:
            channel.group || "Live",

        lang:
            channel.group || ""
    }));
}


// ============================================================
// 11.9. VMT TV - SEARCH RESPONSE
// ============================================================

function vmtTvParseSearchResponse(
    apiResponseJson,
    apiUrl
) {

    return vmtTvParseListResponse(
        apiResponseJson,
        apiUrl
    );
}


// ============================================================
// 11.10. VMT TV - DETAIL RESPONSE
// ============================================================

function vmtTvParseMovieDetail(
    apiResponseJson,
    apiUrl
) {

    const channels =
        vmtTvParseM3U(
            apiResponseJson
        );


    let channelId = "";


    try {

        const parsedUrl =
            new URL(apiUrl);

        channelId =
            parsedUrl.searchParams.get("id") ||
            "";

    } catch (e) {

        console.log(
            "[VMTTV] DETAIL URL ERROR:",
            e?.message || e
        );
    }


    let channel =
        vmtTvFindChannelById(
            channels,
            channelId
        );


    // --------------------------------------------------------
    // FALLBACK BY INDEX
    // --------------------------------------------------------

    if (!channel && channelId) {

        const parts =
            channelId.split("::");

        const last =
            parts[parts.length - 1];

        const index =
            Number(last);

        if (
            Number.isInteger(index) &&
            channels[index]
        ) {

            channel =
                channels[index];
        }
    }


    // --------------------------------------------------------
    // FALLBACK BY CHANNEL NAME
    // --------------------------------------------------------

    if (!channel && channelId) {

        const parts =
            channelId.split("::");

        if (parts.length >= 2) {

            const name =
                parts[
                    parts.length - 2
                ];

            channel =
                channels.find(item =>
                    String(
                        item.name || ""
                    ) === name
                );
        }
    }


    if (!channel) {

        return null;
    }


    let episodeId =
        channel.url || "";


    if (
        channel.userAgent
    ) {

        episodeId +=
            "|ua=" +
            encodeURIComponent(
                channel.userAgent
            );
    }


    return {

        title:
            channel.name,

        posterUrl:
            channel.logo || "",

        backdropUrl:
            channel.logo || "",

        description:
            "LIVE - " +
            (channel.group || "VMT TV"),

        year: 0,

        quality: "LIVE",

        episode_current: "Live",

        lang:
            channel.group || "",

        category:
            channel.group || "",

        country: "",

        director:
            "VMT TV",

        servers: [

            {

                name:
                    channel.group ||
                    "Live Source",

                episodes: [

                    {

                        id:
                            episodeId,

                        title:
                            channel.name,

                        name:
                            channel.name
                    }

                ]
            }

        ]
    };
}


// ============================================================
// 11.11. VMT TV - STREAM DETAIL
// ============================================================

function vmtTvParseDetailResponse(
    apiResponseJson,
    apiUrl
) {

    const raw =
        String(
            apiUrl || ""
        ).trim();

    if (!raw) {
        return null;
    }


    let streamUrl =
        raw;

    let userAgent =
        "";


    // --------------------------------------------------------
    // EXTRACT |ua=
    // --------------------------------------------------------

    const uaIndex =
        raw.indexOf("|ua=");

    if (uaIndex >= 0) {

        streamUrl =
            raw.substring(
                0,
                uaIndex
            );

        userAgent =
            decodeURIComponent(
                raw.substring(
                    uaIndex + 4
                )
            );
    }


    if (!userAgent) {

        userAgent =
            "Mozilla/5.0 (Linux; Android 10; K) " +
            "AppleWebKit/537.36 " +
            "(KHTML, like Gecko) " +
            "Chrome/131.0.0.0 Mobile Safari/537.36";
    }


    return {

        url:
            streamUrl,

        headers: {

            "User-Agent":
                userAgent
        },

        subtitles: [],

        type: "LIVE"
    };
}


// ============================================================
// 11.12. VMT TV - OPTIONAL PARSERS
// ============================================================

function vmtTvParseCategoriesResponse() {

    return Object.keys(
        VMTTV_CATEGORY_MAP
    ).map(slug => ({

        id: slug,

        name:
            VMTTV_CATEGORY_MAP[slug]
    }));
}


function vmtTvParseCountriesResponse() {

    return [];
}


function vmtTvParseYearsResponse() {

    return [];
}


// ============================================================
// 11.13. REGISTER VMT TV
// ============================================================

const VMTTV_PROVIDER =
    registerLiveProvider({

        id: "vmttv",

        name: "VMT TV",

        iconUrl:
            "https://raw.githubusercontent.com/vuminhthanh12/vuminhthanh12/refs/heads/main/Logo.png",

        manifest:
            vmtTvGetManifest(),

        getManifest:
            vmtTvGetManifest,

        getHomeSections:
            vmtTvGetHomeSections,

        getPrimaryCategories:
            vmtTvGetPrimaryCategories,

        getFilterConfig:
            vmtTvGetFilterConfig,

        getUrlList:
            vmtTvGetUrlList,

        getUrlSearch:
            vmtTvGetUrlSearch,

        getUrlDetail:
            vmtTvGetUrlDetail,

        getUrlCategories:
            vmtTvGetUrlCategories,

        getUrlCountries:
            vmtTvGetUrlCountries,

        getUrlYears:
            vmtTvGetUrlYears,

        parseListResponse:
            vmtTvParseListResponse,

        parseSearchResponse:
            vmtTvParseSearchResponse,

        parseMovieDetail:
            vmtTvParseMovieDetail,

        parseDetailResponse:
            vmtTvParseDetailResponse,

        parseCategoriesResponse:
            vmtTvParseCategoriesResponse,

        parseCountriesResponse:
            vmtTvParseCountriesResponse,

        parseYearsResponse:
            vmtTvParseYearsResponse
    });


console.log(
    "[VMTTV] LIVE PROVIDER READY:",
    VMTTV_PROVIDER.id,
    VMTTV_PROVIDER.name
);

// ============================================================
// VMT TV → STREMIO TV ADAPTER
// ============================================================
//
// VMT TV Provider vẫn giữ nguyên contract LIVE.
// Block này chỉ chuyển LIVE Provider → Stremio.
//
// Pipeline:
//
// VMTTV_PROVIDER
//      ↓
// M3U
//      ↓
// LIVE ITEM
//      ↓
// NORMALIZED LIVE STREAM
//      ↓
// STREMIO tv
//
// ============================================================


async function fetchVmtTvChannels() {

    try {

        const response =
            await axios.get(
                VMTTV_M3U_URL,
                {
                    timeout: 15000,

                    headers: {
                        "User-Agent":
                            "Mozilla/5.0",

                        "Accept":
                            "*/*"
                    }
                }
            );

        return vmtTvParseM3U(
            response.data
        );

    } catch (e) {

        console.log(
            "[VMTTV STREMIO] M3U ERROR:",
            e?.response?.status ||
            e?.message ||
            e
        );

        return [];
    }
}


// ============================================================
// VMT TV CHANNEL ID
// ============================================================
//
// Stremio ID:
//
//     vmttv:<encoded-channel-id>
//
// Ví dụ:
//
//     vmttv:TVB%3A%3ATVB%20Jade%3A%3A12
//
// ============================================================

function makeVmtTvStremioId(channelId) {

    return (
        "vmttv:" +
        encodeURIComponent(
            String(
                channelId || ""
            )
        )
    );
}


function decodeVmtTvStremioId(id) {

    const raw =
        String(id || "")
            .trim();

    if (
        !raw.startsWith("vmttv:")
    ) {
        return "";
    }

    try {

        return decodeURIComponent(
            raw.substring(
                "vmttv:".length
            )
        );

    } catch (e) {

        return raw.substring(
            "vmttv:".length
        );
    }
}


// ============================================================
// VMT TV → STREMIO META PREVIEW
// ============================================================

function makeVmtTvCatalogMeta(channel) {

    if (!channel) {
        return null;
    }

    const channelId =
        vmtTvMakeChannelId(
            channel
        );

    const title =
        String(
            channel.name ||
            "VMT TV"
        ).trim();

    const poster =
        String(
            channel.logo ||
            ""
        ).trim();

    const category =
        String(
            channel.group ||
            "LIVE"
        ).trim();

    return {

        id:
            makeVmtTvStremioId(
                channelId
            ),

        type:
            "tv",

        name:
            title,

        poster:
            poster,

        posterShape:
            "square",

        description:
            "🔴 LIVE • " +
            category,

        genres: [
            category
        ],

        releaseInfo:
            "LIVE",

        behaviorHints: {
            isLive: true
        }
    };
}


// ============================================================
// VMT TV → STREMIO FULL META
// ============================================================

function makeVmtTvMeta(channel) {

    const preview =
        makeVmtTvCatalogMeta(
            channel
        );

    if (!preview) {
        return null;
    }

    return {

        ...preview,

        background:
            channel.logo ||
            "",

        logo:
            channel.logo ||
            "",

        country:
            "",

        language:
            "",

        videos: [
            {
                id:
                    preview.id,

                title:
                    channel.name,

                released:
                    new Date().toISOString(),

                thumbnail:
                    channel.logo ||
                    "",

                available:
                    true
            }
        ]
    };
}


// ============================================================
// VMT TV → NORMALIZED STREAM
// ============================================================

async function resolveVmtTvChannel(
    channelId
) {

    const channels =
        await fetchVmtTvChannels();

    const channel =
        vmtTvFindChannelById(
            channels,
            channelId
        );

    if (!channel) {

        console.log(
            "[VMTTV STREMIO] CHANNEL NOT FOUND:",
            channelId
        );

        return [];
    }

    if (!channel.url) {

        console.log(
            "[VMTTV STREMIO] CHANNEL HAS NO URL:",
            channel.name
        );

        return [];
    }

    const rawStream = {

        url:
            channel.url,

        headers:
            channel.userAgent
                ? {
                    "User-Agent":
                        channel.userAgent
                }
                : {},

        title:
            channel.name,

        type:
            "LIVE"
    };


    const normalized =
        normalizeLiveStream(
            rawStream,
            "vmttv"
        );

    if (!normalized) {
        return [];
    }

    return [
        normalized
    ];
}


console.log(
    "[VMTTV STREMIO ADAPTER] READY"
);

// =====================================================
// 14. NGUONC - API SEARCH + API DETAIL
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
        // 14.1. SEARCH API
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
        // 14.2. LẤY DANH SÁCH KẾT QUẢ
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
        // 14.3. NORMALIZE TITLE
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
        // 14.4. CHỌN PHIM
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
        // 14.5. DETAIL API
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
        // 14.6. CHUẨN HÓA MOVIE
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
        // 14.7. DUYỆT SERVER
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
            // 14.8. DUYỆT EPISODE
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
                // 14.9. ƯU TIÊN M3U8 TRỰC TIẾP
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
                // 14.10. EMBED
                // =================================================

                if (
                    !embedUrl
                ) {

                    continue;

                }

                // =================================================
                // 14.11. THỬ RESOLVE EMBED BẰNG
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
                // 14.12. FALLBACK EMBED
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
   15. KKPHiM / PHIMAPI
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
// 15. 1. IMDb LOOKUP → FALLBACK SEARCH
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
    // 15.2 NORMALIZE TITLE
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
    // 15.3 RANK CÁC KẾT QUẢ
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
    // 15.4 CHỌN PHIM THEO TITLE + YEAR
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
// 15.5 KHÔNG CÓ MOVIE
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
// 15.6 . MOVIE ĐÃ ĐƯỢC CHỌN
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
        // A. SLUG
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
        // B. DETAIL
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
        // C. XỬ LÝ TỪNG SERVER
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
                // D. MOVIE
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
                // E. SERIES → CHỈ LẤY EPISODE ĐƯỢC YÊU CẦU
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
        // F. FINAL LOG
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
   16. VSMOV API
   SEARCH API
   DETAIL API
   RESOLVE EMBED → M3U8
   VSMOV HLS PROXY
   VSMOV MPEG-TS / PNG PREFIX STRIP
   ƯU TIÊN SIGNED MASTER
   FALLBACK BASEURL + VIDEOHASH
   FALLBACK VIDEOSRC
   FALLBACK LEGACY M3U8
   GIỮ CẢ DIRECT M3U8 + EMBED PLAYER
   GIỮ CẢ VIETSUB / 4K
   MATCH THEO TÊN + NĂM + SEASON + EPISODE
   ============================================================ */

// =====================================================
// 16.0. VSMOV HELPERS
// =====================================================

// =====================================================
// VSMOV STREAM HOST VALIDATION
// =====================================================

function isVSMovStreamHost(
    hostname
) {

    const host =
        String(
            hostname ||
            ""
        )
            .toLowerCase()
            .trim();

    return (
        host === "streamvsmov.com" ||
        host.endsWith(
            ".streamvsmov.com"
        )
    );

}


// =====================================================
// VSMOV URL VALIDATION
// =====================================================

function isValidVSMovStreamUrl(
    value
) {

    try {

        const url =
            new URL(
                String(
                    value ||
                    ""
                ).trim()
            );


        if (
            !/^https?:$/i.test(
                url.protocol
            )
        ) {

            return false;

        }


        return isVSMovStreamHost(
            url.hostname
        );


    } catch (e) {

        return false;

    }

}


// =====================================================
// VSMOV PROXY BASE
// =====================================================

const VSMOV_PROXY_BASE =
    "https://my-strem-addon.vercel.app";


function makeVSMovHlsProxyUrl(
    m3u8Url,
    referer = "https://vsmov.com/"
) {

    if (
        !m3u8Url ||
        !isValidVSMovStreamUrl(
            m3u8Url
        )
    ) {

        return "";

    }


    return (
        VSMOV_PROXY_BASE +
        "/vsmov-hls-proxy/master.m3u8?url=" +
        encodeURIComponent(
            String(
                m3u8Url
            ).trim()
        ) +
        "&ref=" +
        encodeURIComponent(
            String(
                referer ||
                "https://vsmov.com/"
            ).trim()
        )
    );

}


// =====================================================
// CREATE SEGMENT PROXY URL
// =====================================================

function makeVSMovSegmentProxyUrl(
    segmentUrl,
    referer = "https://vsmov.com/"
) {

    if (
        !segmentUrl ||
        !isValidVSMovStreamUrl(
            segmentUrl
        )
    ) {

        return "";

    }


    return (
        VSMOV_PROXY_BASE +
        "/vsmov-segment-proxy?url=" +
        encodeURIComponent(
            String(
                segmentUrl
            ).trim()
        ) +
        "&ref=" +
        encodeURIComponent(
            String(
                referer ||
                "https://vsmov.com/"
            ).trim()
        )
    );

}


// =====================================================
// 16.0.1. FIND FAKE PNG PREFIX
//
// GIỐNG LOGIC CloudStream:
//
// response
//   ↓
// tìm byte 0x47
//   ↓
// kiểm tra:
//   pos
//   pos + 188
//   pos + 376
//   pos + 564
//   pos + 752
//   pos + 940
// đều = 0x47
//
// 0x47 = MPEG-TS sync byte
// 188   = MPEG-TS packet size
// =====================================================

function findVSMovPngPrefixLength(
    buffer
) {

    if (
        !Buffer.isBuffer(
            buffer
        ) ||
        !buffer.length
    ) {

        return 0;

    }


    const total =
        buffer.length;


    const REQUIRED_DISTANCE =
        188;


    const REQUIRED_PACKETS =
        6;


    const REQUIRED_SPAN =
        REQUIRED_DISTANCE *
        REQUIRED_PACKETS;


    let start =
        -1;


    for (
        let pos = 0;
        pos + REQUIRED_SPAN <= total;
        pos++
    ) {

        // -------------------------------------------------
        // MPEG-TS SYNC BYTE
        // -------------------------------------------------

        if (
            buffer[pos] !==
            0x47
        ) {

            continue;

        }


        let valid =
            true;


        // -------------------------------------------------
        // KIỂM TRA 6 SYNC BYTE
        // -------------------------------------------------

        for (
            let packet = 1;
            packet < REQUIRED_PACKETS;
            packet++
        ) {

            const checkPos =
                pos +
                packet *
                REQUIRED_DISTANCE;


            if (
                buffer[checkPos] !==
                0x47
            ) {

                valid = false;

                break;

            }

        }


        if (
            valid
        ) {

            start =
                pos;

            break;

        }

    }


    // -------------------------------------------------
    // GIỐNG CLOUDSTREAM:
    //
    // nếu prefix <= 0
    // → không cắt
    // -------------------------------------------------

    if (
        start <= 0
    ) {

        return 0;

    }


    return start;

}


// =====================================================
// 16.0.2. GET VSMOV REFERER
// =====================================================

function normalizeVSMovReferer(
    value
) {

    const fallback =
        "https://vsmov.com/";


    try {

        const url =
            new URL(
                String(
                    value ||
                    ""
                ).trim()
            );


        if (
            !/^https?:$/i.test(
                url.protocol
            )
        ) {

            return fallback;

        }


        return url.toString();

    } catch (e) {

        return fallback;

    }

}


// =====================================================
// 16.0.3. REWRITE ONE VSMOV SEGMENT
//
// VSMov dùng segment .png nhưng payload thật là MPEG-TS.
//
// Thay vì trả:
//
// /vsmov-segment-proxy?url=...png
//
// ta trả:
//
// /vsmov-segment-proxy/segment.ts?url=...png
//
// để HLS player nhận diện đây là media segment.
// =====================================================

function rewriteVSMovSegmentUrl(
    rawUrl,
    baseUrl,
    referer
) {

    try {

        const value =
            String(
                rawUrl ||
                ""
            ).trim();


        if (
            !value
        ) {

            return value;

        }


        const absoluteUrl =
            new URL(
                value,
                baseUrl
            ).toString();


        if (
            !isValidVSMovStreamUrl(
                absoluteUrl
            )
        ) {

            return value;

        }


        const proxyUrl =
            VSMOV_PROXY_BASE +
            "/vsmov-segment-proxy/segment.ts?url=" +
            encodeURIComponent(
                absoluteUrl
            ) +
            "&ref=" +
            encodeURIComponent(
                String(
                    referer ||
                    "https://vsmov.com/"
                ).trim()
            );


        return proxyUrl;


    } catch (e) {

        return rawUrl;

    }

}


// =====================================================
// VSMOV M3U8 REWRITE
// =====================================================

function rewriteVSMovM3u8(
    playlist,
    baseUrl,
    referer
) {

    const source =
        String(
            playlist ||
            ""
        );


    if (
        !source.trim()
    ) {

        return source;

    }


    const lines =
        source.split(
            /\r?\n/
        );


    const output = [];


    let rewrittenCount =
        0;


    let urlCount =
        0;


    for (
        let i = 0;
        i < lines.length;
        i++
    ) {

        const originalLine =
            lines[i];


        const line =
            String(
                originalLine ||
                ""
            ).trim();


        // -------------------------------------------------
        // EMPTY LINE
        // -------------------------------------------------

        if (
            !line
        ) {

            output.push(
                originalLine
            );

            continue;

        }


        // -------------------------------------------------
        // HLS TAG / COMMENT
        // -------------------------------------------------

        if (
            line.startsWith(
                "#"
            )
        ) {

            const rewrittenLine =
                line.replace(
                    /URI="([^"]+)"/gi,
                    (
                        match,
                        rawUri
                    ) => {

                        try {

                            const absoluteUri =
                                new URL(
                                    String(
                                        rawUri
                                    ).trim(),
                                    baseUrl
                                ).toString();


                            if (
                                !isValidVSMovStreamUrl(
                                    absoluteUri
                                )
                            ) {

                                return match;

                            }


                            const proxyUri =
                                rewriteVSMovSegmentUrl(
                                    absoluteUri,
                                    baseUrl,
                                    referer
                                );


                            if (
                                !proxyUri ||
                                proxyUri === absoluteUri
                            ) {

                                return match;

                            }


                            rewrittenCount++;


                            console.log(
                                "[VSMOV HLS PROXY] URI REWRITE:",
                                absoluteUri,
                                "=>",
                                proxyUri
                            );


                            return (
                                'URI="' +
                                proxyUri +
                                '"'
                            );


                        } catch (e) {

                            return match;

                        }

                    }
                );


            output.push(
                rewrittenLine
            );


            continue;

        }


        // -------------------------------------------------
        // MEDIA URL
        // -------------------------------------------------

        urlCount++;


        try {

            const absoluteUrl =
                new URL(
                    line,
                    baseUrl
                ).toString();


            /*
             * Chỉ rewrite URL thuộc VSMov.
             */

            if (
                !isValidVSMovStreamUrl(
                    absoluteUrl
                )
            ) {

                output.push(
                    originalLine
                );

                continue;

            }


            const proxyUrl =
                rewriteVSMovSegmentUrl(
                    absoluteUrl,
                    baseUrl,
                    referer
                );


            if (
                !proxyUrl ||
                proxyUrl === absoluteUrl
            ) {

                output.push(
                    originalLine
                );

                continue;

            }


            rewrittenCount++;


            if (
                rewrittenCount === 1
            ) {

                console.log(
                    "[VSMOV HLS PROXY] FIRST SEGMENT:",
                    absoluteUrl
                );


                console.log(
                    "[VSMOV HLS PROXY] FIRST PROXY:",
                    proxyUrl
                );

            }


            output.push(
                proxyUrl
            );


        } catch (e) {

            output.push(
                originalLine
            );

        }

    }


    const result =
        output.join(
            "\n"
        );


    console.log(
        "[VSMOV HLS PROXY] URL LINES:",
        urlCount
    );


    console.log(
        "[VSMOV HLS PROXY] REWRITTEN:",
        rewrittenCount
    );


    console.log(
        "[VSMOV HLS PROXY] OUTPUT FIRST LINES:",
        result
            .split("\n")
            .slice(
                0,
                14
            )
            .join("\n")
    );


    return result;

}


// =====================================================
// 16.1. VSMOV EMBED RESOLVER
// =====================================================

async function resolveVSMovEmbed(
    embedUrl
) {

    try {

        if (
            !embedUrl ||
            !/^https?:\/\//i.test(
                String(
                    embedUrl
                )
            )
        ) {

            return null;

        }


        const url =
            String(
                embedUrl
            ).trim();


        console.log(
            "[VSMOV RESOLVE] START:",
            url
        );


        // -------------------------------------------------
        // HEADERS GIỐNG CLOUDSTREAM
        // -------------------------------------------------

        const response =
            await axios.get(
                url,
                {
                    timeout:
                        12000,

                    headers: {

                        "Referer":
                            "https://vsmov.com/",

                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

                        "Accept":
                            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"

                    },

                    responseType:
                        "text"

                }
            );


        const html =
            String(
                response?.data ||
                ""
            );


        if (
            !html
        ) {

            console.log(
                "[VSMOV RESOLVE] Empty HTML"
            );

            return null;

        }


        console.log(
            "[VSMOV RESOLVE] HTML length:",
            html.length
        );


        // =================================================
        // HELPER: EXTRACT JS VARIABLE
        // =================================================

        const extractJsVar =
            (
                source,
                variableName
            ) => {

                if (
                    !source ||
                    !variableName
                ) {

                    return "";

                }


                const escapedName =
                    variableName.replace(
                        /[.*+?^${}()|[\]\\]/g,
                        "\\$&"
                    );


                const patterns = [

                    new RegExp(
                        "(?:const|let|var)\\s+" +
                        escapedName +
                        "\\s*=\\s*[`'\"]([^`'\"]+)[`'\"]",
                        "i"
                    ),

                    new RegExp(
                        escapedName +
                        "\\s*:\\s*[`'\"]([^`'\"]+)[`'\"]",
                        "i"
                    ),

                    new RegExp(
                        "[\"']" +
                        escapedName +
                        "[\"']\\s*:\\s*[`'\"]([^`'\"]+)[`'\"]",
                        "i"
                    )

                ];


                for (
                    const pattern
                    of patterns
                ) {

                    const match =
                        source.match(
                            pattern
                        );


                    if (
                        match &&
                        match[1]
                    ) {

                        return String(
                            match[1]
                        ).trim();

                    }

                }


                return "";

            };


        // =================================================
        // 16.1.1. BASE URL
        // =================================================

        let baseUrl =
            extractJsVar(
                html,
                "baseUrl"
            );


        // =================================================
        // 16.1.2. VIDEO HASH
        // =================================================

        let videoHash =
            extractJsVar(
                html,
                "videoHash"
            );


        // =================================================
        // 16.1.3. VIDEO SRC
        // =================================================

        let videoSrc =
            extractJsVar(
                html,
                "videoSrc"
            );


        // =================================================
        // 16.1.4. SIGNED MASTER URL
        // =================================================

        let signedMasterUrl =
            extractJsVar(
                html,
                "signedMasterUrl"
            );


        // =================================================
        // 16.1.5. ENABLE SIGNED URL
        // =================================================

        let enableSignedUrl =
            extractJsVar(
                html,
                "enableSignedUrl"
            );


        const enableSigned =
            /^(true|1|yes)$/i.test(
                String(
                    enableSignedUrl ||
                    ""
                ).trim()
            );


        console.log(
            "[VSMOV RESOLVE] baseUrl:",
            baseUrl
        );

        console.log(
            "[VSMOV RESOLVE] videoHash:",
            videoHash
        );

        console.log(
            "[VSMOV RESOLVE] videoSrc:",
            videoSrc
        );

        console.log(
            "[VSMOV RESOLVE] signedMasterUrl:",
            signedMasterUrl
        );

        console.log(
            "[VSMOV RESOLVE] enableSignedUrl:",
            enableSigned
        );


        // =================================================
        // 16.1.6. NORMALIZE BASE URL
        // =================================================

        baseUrl =
            String(
                baseUrl ||
                ""
            )
                .trim()
                .replace(
                    /\/+$/,
                    ""
                );


        // =================================================
        // 16.1.7. MAIN PLAYER SOURCE
        // =================================================

        let playerSource =
            "";


        if (
            enableSigned &&
            signedMasterUrl
        ) {

            playerSource =
                String(
                    signedMasterUrl
                ).trim();


            console.log(
                "[VSMOV RESOLVE] SOURCE = SIGNED MASTER"
            );

        }


        if (
            !playerSource &&
            baseUrl &&
            videoHash
        ) {

            playerSource =
                baseUrl +
                "/stream/" +
                encodeURIComponent(
                    String(
                        videoHash
                    ).trim()
                ) +
                "/master.m3u8";


            console.log(
                "[VSMOV RESOLVE] SOURCE = BASE + HASH"
            );

        }


        // =================================================
        // 16.1.8. VIDEOSRC FALLBACK
        // =================================================

        if (
            !playerSource &&
            videoSrc
        ) {

            playerSource =
                String(
                    videoSrc
                ).trim();


            console.log(
                "[VSMOV RESOLVE] SOURCE = VIDEOSRC"
            );

        }


        // =================================================
        // 16.1.9. LEGACY M3U8 FALLBACK
        // =================================================

        if (
            !playerSource
        ) {

            const legacyRegex =
                /(?:const|let|var)\s+url\s*=\s*[`'"](https?:\/\/[^`'"]+\.m3u8[^`'"]*)[`'"]/i;


            const legacyMatch =
                html.match(
                    legacyRegex
                );


            if (
                legacyMatch &&
                legacyMatch[1]
            ) {

                playerSource =
                    String(
                        legacyMatch[1]
                    ).trim();


                console.log(
                    "[VSMOV RESOLVE] SOURCE = LEGACY URL"
                );

            }

        }


        // =================================================
        // 16.1.10. FINAL VALIDATION
        // =================================================

        if (
            !playerSource ||
            !/^https?:\/\//i.test(
                playerSource
            )
        ) {

            console.log(
                "[VSMOV RESOLVE] NO M3U8 FOUND"
            );

            return null;

        }


        console.log(
            "[VSMOV RESOLVE] FINAL M3U8:",
            playerSource
        );


        // =================================================
        // 16.1.11. QUALITY
        // =================================================

        let quality =
            0;


        const headEnd =
            html
                .toLowerCase()
                .indexOf(
                    "</head>"
                );


        const qualitySource =
            headEnd >= 0
                ? html.slice(
                    0,
                    headEnd
                )
                : html;


        const qualityMatch =
            qualitySource.match(
                /(\d{3,4})p|4k/i
            );


        if (
            qualityMatch
        ) {

            if (
                qualityMatch[1]
            ) {

                quality =
                    Number(
                        qualityMatch[1]
                    ) || 0;

            } else {

                quality =
                    2160;

            }

        }


        console.log(
            "[VSMOV RESOLVE] Quality:",
            quality || "Unknown"
        );


        return {

            url:
                playerSource,

            referer:
                url,

            quality

        };


    } catch (e) {

        console.log(
            "[VSMOV RESOLVE ERROR]:",
            e?.response?.status ||
            e?.message ||
            e
        );

        return null;

    }

}


// =====================================================
// 16. VSMOV FETCH
// =====================================================
//
// KIẾN TRÚC:
// VSMov Provider
//      ↓
// normalizedStreams
//      ↓
// Stremio adapter
//
// Bản này vẫn giữ nguyên output của fetchVSMov()
// để Block 8 hiện tại không cần sửa.
// =====================================================

async function fetchVSMov(
    movieName,
    movieYear = 0,
    seasonNumber = 0,
    episodeNumber = 0,
    streamType = "movie"
) {

    // =====================================================
    // 16.0. PROVIDER IDENTITY
    // =====================================================

    const providerId = "vsmov";
    const providerName = "VSMov";

    // =====================================================
    // 16.0.A. NORMALIZED STREAM HELPER
    // =====================================================
    //
    // Đây là format trung gian mà Provider Manager
    // sau này sẽ dùng chung cho mọi provider.
    //
    // Provider không cần biết Stremio cần object gì.
    // Nó chỉ cần trả về normalized stream.
    // =====================================================

    const normalizedStreams = [];

    const addNormalizedStream = ({
        title = "",
        url = "",
        type = "hls",
        referer = "",
        headers = {},
        episode = 0,
        season = 0,
        externalUrl = "",
        playerUrl = "",
        serverName = ""
    }) => {

        const cleanUrl =
            String(url || "").trim();

        const cleanExternalUrl =
            String(externalUrl || "").trim();

        if (!cleanUrl && !cleanExternalUrl) {
            return;
        }

        normalizedStreams.push({
            provider: providerId,
            providerName,

            title: String(title || "").trim(),

            url: cleanUrl,
            externalUrl: cleanExternalUrl,

            type: String(type || "hls").trim(),

            referer:
                String(referer || "").trim(),

            headers:
                headers &&
                typeof headers === "object"
                    ? headers
                    : {},

            episode:
                Number(episode) || 0,

            season:
                Number(season) || 0,

            serverName:
                String(serverName || "").trim(),

            playerUrl:
                String(playerUrl || "").trim()
        });
    };

    // =====================================================
// 16.0.B. NORMALIZED → STREMIO
// =====================================================

const toStremioStream = stream => {

    if (!stream || typeof stream !== "object") {
        return null;
    }

    const url =
        String(stream.url || "").trim();

    const externalUrl =
        String(stream.externalUrl || "").trim();

    if (!url && !externalUrl) {
        return null;
    }

    // -------------------------------------------------
    // SOURCE TYPE
    // -------------------------------------------------
    //
    // Giữ rõ nguồn để Stremio hiển thị:
    //
    // vsmov-api
    //      → link_m3u8 trực tiếp từ API
    //
    // vsmov-direct
    //      → embed được resolve thành M3U8
    //
    // vsmov-player
    //      → mở embed player
    // -------------------------------------------------

    let streamLabel = "[VSMov]";

    if (stream.type === "embed") {

        streamLabel =
            "[VSMov Player]";

    } else if (
        stream.type === "hls" &&
        stream.referer &&
        stream.referer !== "https://vsmov.com/"
    ) {

        streamLabel =
            "[VSMov Direct]";

    } else if (
        stream.type === "hls"
    ) {

        streamLabel =
            "[VSMov]";

    }

    const result = {
        name:
            "▶️ " +
            streamLabel +
            (
                stream.serverName
                    ? " " + stream.serverName
                    : ""
            ),

        title:
            String(
                stream.title ||
                "Full"
            ).trim()
    };

    // -------------------------------------------------
    // DIRECT URL
    // -------------------------------------------------

    if (url) {
        result.url = url;
    }

    // -------------------------------------------------
    // EXTERNAL / PLAYER URL
    // -------------------------------------------------

    if (externalUrl) {
        result.externalUrl = externalUrl;
    }

    // -------------------------------------------------
    // HEADERS
    // -------------------------------------------------

    if (
        stream.headers &&
        typeof stream.headers === "object" &&
        Object.keys(stream.headers).length
    ) {

        result.behaviorHints = {
            ...(result.behaviorHints || {}),

            proxyHeaders: {
                request:
                    stream.headers
            }
        };
    }

    // -------------------------------------------------
    // BINGE GROUP
    // -------------------------------------------------

    if (
        stream.type === "embed"
    ) {

        result.behaviorHints = {
            ...(result.behaviorHints || {}),

            bingeGroup:
                "vsmov"
        };

    } else {

        result.behaviorHints = {
            ...(result.behaviorHints || {}),

            bingeGroup:
                "vsmov-hls"
        };
    }

    // -------------------------------------------------
    // WIDGET PLAYER
    // -------------------------------------------------

    if (stream.playerUrl) {

        result.externalUrl =
            stream.playerUrl;

        result.widgetPlayer =
            stream.playerUrl;

        result.widgetPlayerStates =
            ["replaceplayer"];
    }

    return result;
};

    const streams = [];

    try {

        console.log("========================================");
        console.log("[VSMOV] START");
        console.log("[VSMOV] Provider:", providerId);
        console.log("[VSMOV] Search:", movieName);
        console.log("[VSMOV] Year:", movieYear);
        console.log("[VSMOV] Season:", seasonNumber);
        console.log("[VSMOV] Episode:", episodeNumber);
        console.log("[VSMOV] Type:", streamType);

        if (!movieName) {
            return streams;
        }

        // =====================================================
        // 16.1. TITLE VARIANTS
        // =====================================================

        const titleVariants = [];

        const addVariant = value => {

            const text =
                String(value || "").trim();

            if (
                text &&
                !titleVariants.includes(text)
            ) {
                titleVariants.push(text);
            }
        };

        addVariant(movieName);

        console.log(
            "[VSMOV] Title variants:",
            titleVariants
        );

        // =====================================================
        // 16.2. SEARCH VSMOV
        // =====================================================

        const candidates = [];

        for (const variant of titleVariants) {

            try {

                const searchUrl =
                    "https://vsmov.com/api/tim-kiem?keyword=" +
                    encodeURIComponent(variant) +
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
                    res?.data || {};

                const items =
                    data?.data?.items ||
                    data?.items ||
                    data?.results ||
                    [];

                if (Array.isArray(items)) {

                    items.forEach(item => {

                        if (
                            item &&
                            item.slug
                        ) {
                            candidates.push(item);
                        }

                    });
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
        // 16.3. UNIQUE CANDIDATES
        // =====================================================

        const uniqueCandidates =
            Array.from(
                new Map(
                    candidates.map(item => [
                        item.slug,
                        item
                    ])
                ).values()
            );

        console.log(
            "[VSMOV] Candidates:",
            uniqueCandidates.length
        );

        // =====================================================
        // 16.4. NORMALIZE HELPER
        // =====================================================

        const cleanTitle = value => {

            return String(value || "")
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

        const inputTitle =
            cleanTitle(movieName);

        const inputWords =
            inputTitle
                .split(" ")
                .filter(Boolean);

        // =====================================================
        // 16.5. RANK CANDIDATES
        // =====================================================

        const ranked =
            uniqueCandidates
                .map(item => {

                    const name =
                        String(
                            item?.name || ""
                        ).trim();

                    const originName =
                        String(
                            item?.origin_name ||
                            item?.original_name ||
                            ""
                        ).trim();

                    const itemSlug =
                        String(
                            item?.slug || ""
                        ).trim();

                    const normalizedName =
                        cleanTitle(name);

                    const normalizedOrigin =
                        cleanTitle(originName);

                    const normalizedSlug =
                        cleanTitle(itemSlug);

                    let score = 0;

                    if (
                        normalizedName ===
                        inputTitle
                    ) {
                        score += 1000;
                    }

                    if (
                        normalizedOrigin ===
                        inputTitle
                    ) {
                        score += 950;
                    }

                    if (
                        normalizedName.includes(
                            inputTitle
                        )
                    ) {
                        score += 500;
                    }

                    if (
                        inputTitle.includes(
                            normalizedName
                        )
                    ) {
                        score += 400;
                    }

                    if (
                        normalizedOrigin.includes(
                            inputTitle
                        )
                    ) {
                        score += 450;
                    }

                    let overlap = 0;

                    for (
                        const word of inputWords
                    ) {

                        if (
                            word.length < 2
                        ) {
                            continue;
                        }

                        if (
                            normalizedName.includes(word) ||
                            normalizedOrigin.includes(word) ||
                            normalizedSlug.includes(word)
                        ) {
                            overlap++;
                        }
                    }

                    score +=
                        overlap * 25;

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
                            Number(movieYear)
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

                })
                .sort(
                    (a, b) =>
                        b.score - a.score
                );

        console.log(
            "[VSMOV] RANKED:"
        );

        ranked
            .slice(0, 10)
            .forEach(row => {

                console.log(
                    " ",
                    row.item?.year || 0,
                    row.item?.name || "",
                    "|",
                    row.item?.origin_name || "",
                    "| score:",
                    row.score
                );

            });

        // =====================================================
        // 16.6. SELECT CANDIDATE
        // =====================================================

        let selected = null;

        if (movieYear) {

            const yearMatches =
                ranked.filter(
                    row =>
                        Number(
                            row.itemYear
                        ) ===
                        Number(movieYear)
                );

            console.log(
                "[VSMOV] Year matches:",
                yearMatches.length
            );

            if (yearMatches.length) {

                selected =
                    yearMatches[0];

            } else {

                console.log(
                    "[VSMOV] NO EXACT YEAR MATCH:",
                    movieYear
                );
            }
        }

        if (
            !selected &&
            !movieYear
        ) {

            selected =
                ranked[0] || null;
        }

        if (!selected) {

            console.log(
                "[VSMOV] REFUSING MISMATCHED VERSION"
            );

            return streams;
        }

        const selectedMovie =
            selected.item;

        const movieSlug =
            String(
                selectedMovie?.slug || ""
            ).trim();

        console.log(
            "[VSMOV] Selected:",
            selectedMovie?.name || "",
            "|",
            selectedMovie?.origin_name || "",
            "|",
            selectedMovie?.year || 0,
            "| slug:",
            movieSlug
        );

        if (!movieSlug) {
            return streams;
        }

        // =====================================================
        // 16.7. DETAIL
        // =====================================================

        const detailUrl =
            "https://vsmov.com/api/phim/" +
            encodeURIComponent(movieSlug);

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
            "[VSMOV] Episodes:",
            episodes.length
        );

        if (!episodes.length) {

            console.log(
                "[VSMOV] No episodes"
            );

            return streams;
        }

        // =====================================================
        // 16.8. EPISODES
        // =====================================================

        for (
            const episodeServer of episodes
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
            // 16.9. SERIES
            // =================================================

            if (
                streamType ===
                "series"
            ) {

                const targetEpisode =
                    Number(episodeNumber) ||
                    1;

                const matchedEpisode =
                    serverData.find(
                        (ep, index) => {

                            const episodeName =
                                String(
                                    ep?.name ||
                                    ep?.filename ||
                                    ep?.slug ||
                                    ""
                                ).trim();

                            let detectedEpisode =
                                0;

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

                if (!matchedEpisode) {

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
                        (
                            "Tập " +
                            String(
                                targetEpisode
                            ).padStart(
                                2,
                                "0"
                            )
                        )
                    ).trim();

                console.log(
                    "[VSMOV] Matched episode:",
                    matchedName
                );

                // =============================================
                // 16.9.A. DIRECT API M3U8
                // =============================================

                const apiM3u8 =
                    String(
                        matchedEpisode?.link_m3u8 ||
                        matchedEpisode?.m3u8 ||
                        ""
                    ).trim();

                if (
                    apiM3u8 &&
                    /^https?:\/\//i.test(
                        apiM3u8
                    )
                ) {

                    const apiProxyUrl =
                        isValidVSMovStreamUrl(
                            apiM3u8
                        )
                            ? makeVSMovHlsProxyUrl(
                                apiM3u8,
                                "https://vsmov.com/"
                            )
                            : apiM3u8;

                    addNormalizedStream({

                        title:
                            "Tập " +
                            String(
                                targetEpisode
                            ).padStart(
                                2,
                                "0"
                            ),

                        url:
                            apiProxyUrl,

                        type:
                            "hls",

                        referer:
                            "https://vsmov.com/",

                        episode:
                            targetEpisode,

                        season:
                            Number(
                                seasonNumber
                            ) || 0,

                        serverName
                    });

                    console.log(
                        "[VSMOV] API M3U8:",
                        apiM3u8
                    );

                    if (
                        apiProxyUrl !==
                        apiM3u8
                    ) {

                        console.log(
                            "[VSMOV] API M3U8 PROXY:",
                            apiProxyUrl
                        );
                    }
                }

                // =============================================
                // 16.9.B. EMBED → RESOLVE M3U8
                // =============================================

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

                    const resolved =
                        await resolveVSMovEmbed(
                            embed
                        );

                    if (
                        resolved?.url
                    ) {

                        const directProxyUrl =
                            isValidVSMovStreamUrl(
                                resolved.url
                            )
                                ? makeVSMovHlsProxyUrl(
                                    resolved.url,
                                    resolved.referer
                                )
                                : resolved.url;

                        addNormalizedStream({

                            title:
                                "Tập " +
                                String(
                                    targetEpisode
                                ).padStart(
                                    2,
                                    "0"
                                ),

                            url:
                                directProxyUrl,

                            type:
                                "hls",

                            referer:
                                resolved.referer ||
                                "https://vsmov.com/",

                            episode:
                                targetEpisode,

                            season:
                                Number(
                                    seasonNumber
                                ) || 0,

                            serverName
                        });

                        console.log(
                            "[VSMOV] RESOLVED M3U8:",
                            resolved.url
                        );

                        console.log(
                            "[VSMOV] PROXY M3U8:",
                            directProxyUrl
                        );
                    }

                    // =========================================
                    // 16.9.C. EMBED PLAYER FALLBACK
                    // =========================================

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

                    addNormalizedStream({

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

                        playerUrl:
                            widgetUrl,

                        type:
                            "embed",

                        episode:
                            targetEpisode,

                        season:
                            Number(
                                seasonNumber
                            ) || 0,

                        serverName
                    });

                    console.log(
                        "[VSMOV] EMBED FALLBACK:",
                        embed
                    );
                }
            }

            // =================================================
            // 16.10. MOVIE
            // =================================================

            else {

                for (
                    const ep of serverData
                ) {

                    const episodeName =
                        String(
                            ep?.name ||
                            ep?.filename ||
                            "Full"
                        ).trim();

                    // =========================================
                    // 16.10.A. DIRECT API M3U8
                    // =========================================

                    const apiM3u8 =
                        String(
                            ep?.link_m3u8 ||
                            ep?.m3u8 ||
                            ""
                        ).trim();

                    if (
                        apiM3u8 &&
                        /^https?:\/\//i.test(
                            apiM3u8
                        )
                    ) {

                        const apiProxyUrl =
                            isValidVSMovStreamUrl(
                                apiM3u8
                            )
                                ? makeVSMovHlsProxyUrl(
                                    apiM3u8,
                                    "https://vsmov.com/"
                                )
                                : apiM3u8;

                        addNormalizedStream({

                            title:
                                episodeName,

                            url:
                                apiProxyUrl,

                            type:
                                "hls",

                            referer:
                                "https://vsmov.com/",

                            season:
                                Number(
                                    seasonNumber
                                ) || 0,

                            serverName
                        });

                        console.log(
                            "[VSMOV] API M3U8:",
                            apiM3u8
                        );

                        if (
                            apiProxyUrl !==
                            apiM3u8
                        ) {

                            console.log(
                                "[VSMOV] API M3U8 PROXY:",
                                apiProxyUrl
                            );
                        }
                    }

                    // =========================================
                    // 16.10.B. EMBED → RESOLVE M3U8
                    // =========================================

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

                        const resolved =
                            await resolveVSMovEmbed(
                                embed
                            );

                        if (
                            resolved?.url
                        ) {

                            const directProxyUrl =
                                isValidVSMovStreamUrl(
                                    resolved.url
                                )
                                    ? makeVSMovHlsProxyUrl(
                                        resolved.url,
                                        resolved.referer
                                    )
                                    : resolved.url;

                            addNormalizedStream({

                                title:
                                    episodeName,

                                url:
                                    directProxyUrl,

                                type:
                                    "hls",

                                referer:
                                    resolved.referer ||
                                    "https://vsmov.com/",

                                season:
                                    Number(
                                        seasonNumber
                                    ) || 0,

                                serverName
                            });

                            console.log(
                                "[VSMOV] RESOLVED M3U8:",
                                resolved.url
                            );

                            console.log(
                                "[VSMOV] PROXY M3U8:",
                                directProxyUrl
                            );
                        }

                        // =====================================
                        // 16.10.C. EMBED PLAYER FALLBACK
                        // =====================================

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

                        addNormalizedStream({

                            title:
                                episodeName,

                            externalUrl:
                                widgetUrl,

                            playerUrl:
                                widgetUrl,

                            type:
                                "embed",

                            season:
                                Number(
                                    seasonNumber
                                ) || 0,

                            serverName
                        });

                        console.log(
                            "[VSMOV] EMBED FALLBACK:",
                            embed
                        );
                    }
                }
            }
        }

        // =====================================================
// 16.11. NORMALIZED RESULT
// =====================================================
//
// BƯỚC 2:
// Đưa Normalized Streams của VSMov qua Resolver Registry
// trước khi chuyển sang object Stremio.
//
// QUAN TRỌNG:
//
// Không gọi lại:
//   - resolveVSMovEmbed()
//   - makeVSMovHlsProxyUrl()
//   - vsmov-hls-proxy
//   - vsmov-segment-proxy
//
// Những phần đó đã được xử lý ở phía trên.
// Resolver chỉ nhận kết quả đã có.
// =====================================================

console.log(
    "[VSMOV] NORMALIZED STREAMS BEFORE RESOLVER:",
    JSON.stringify(
        normalizedStreams,
        null,
        2
    )
);


// =====================================================
// 16.12. ATTACH VSMOV RESOLVER
// =====================================================
//
// Mọi stream VSMov đi vào Resolver Engine đều được đánh dấu:
//
//     resolver: "vsmov"
//
// Các field khác giữ nguyên.
// =====================================================

const resolverInputStreams =
    normalizedStreams.map(
        stream =>
            createNormalizedStream({

                ...stream,

                provider:
                    stream.provider ||
                    "vsmov",

                source:
                    stream.source ||
                    "vsmov",

                resolver:
                    "vsmov"
            })
    ).filter(Boolean);


// =====================================================
// 16.13. RESOLVE THROUGH REGISTRY
// =====================================================

let resolvedNormalizedStreams = [];

try {

    resolvedNormalizedStreams =
        await resolveNormalizedStreams(
            resolverInputStreams,
            {
                provider:
                    "vsmov",

                movieName,
                movieYear,
                seasonNumber,
                episodeNumber,
                streamType
            }
        );

} catch (resolverError) {

    console.log(
        "[VSMOV RESOLVER PIPELINE ERROR]:",
        resolverError?.message ||
        resolverError
    );

    // -------------------------------------------------
    // SAFETY FALLBACK
    // -------------------------------------------------
    //
    // Nếu Resolver Engine có vấn đề,
    // giữ nguyên normalizedStreams cũ.
    //
    // Điều này giúp BƯỚC 2 không làm mất VSMov.
    // -------------------------------------------------

    resolvedNormalizedStreams =
        resolverInputStreams;
}


console.log(
    "[VSMOV] RESOLVED NORMALIZED STREAMS:",
    JSON.stringify(
        resolvedNormalizedStreams,
        null,
        2
    )
);


// =====================================================
// 16.14. NORMALIZED → STREMIO
// =====================================================
//
// Vẫn dùng toStremioStream() cũ của VSMov.
//
// Đây là chủ ý.
//
// BƯỚC 2 chỉ kiểm chứng:
//
//     Provider
//        ↓
//     Normalized Stream
//        ↓
//     Resolver Registry
//        ↓
//     Normalized Stream
//
// Chưa thay đổi adapter Stremio riêng của VSMov.
//
// Nhờ vậy các behavior hiện tại:
//
//   - [VSMov]
//   - [VSMov Direct]
//   - [VSMov Player]
//   - bingeGroup
//   - proxyHeaders
//   - widgetPlayer
//
// vẫn được giữ nguyên.
// =====================================================

for (
    const normalized
    of resolvedNormalizedStreams
) {

    const stremioStream =
        toStremioStream(
            normalized
        );

    if (
        stremioStream
    ) {

        streams.push(
            stremioStream
        );
    }
}


// =====================================================
// 16.15. FINAL
// =====================================================

if (!streams.length) {

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


console.log(
    "[VSMOV] NORMALIZED COUNT:",
    resolvedNormalizedStreams.length
);


console.log(
    "[VSMOV] FINAL STREMIO STREAM OBJECTS:",
    JSON.stringify(
        streams,
        null,
        2
    )
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

async function scrapePhimLongTieng(
    movieName,
    episodeNumber = null,
    targetYear = null,
    supportContext = null
) {

    console.log(
        "[PHIMLONGTIENG] Search:",
        movieName,
        "Episode:",
        episodeNumber,
        "Year:",
        targetYear
    );

    const streams = [];
    const seen = new Set();

    const timeoutMs = 20000;

    // ============================================================
    // 1. SUPPORT CONTEXT
    //
    // PhimLongTieng vẫn tự match độc lập.
    //
    // KKPHiM / NguonC / VSMOV / PhimHDCS chỉ cung cấp
    // thêm bằng chứng để tăng độ chính xác.
    // ============================================================

    const context =
        supportContext &&
        typeof supportContext === "object"
            ? supportContext
            : {};

    const supportOriginalName =
        String(
            context.originalName ||
            movieName ||
            ""
        ).trim();

    const supportTargetYear =
        context.targetYear ||
        targetYear ||
        null;

    const supportSeasonNumber =
        context.seasonNumber !== undefined &&
        context.seasonNumber !== null
            ? Number(context.seasonNumber)
            : null;

    const supportEpisodeNumber =
        context.episodeNumber !== undefined &&
        context.episodeNumber !== null
            ? Number(context.episodeNumber)
            : (
                episodeNumber !== null &&
                episodeNumber !== undefined
                    ? Number(episodeNumber)
                    : null
            );

    const supportStreamType =
        String(
            context.streamType ||
            ""
        ).toLowerCase();

    const supportSources = {

        kkphim:
            Array.isArray(context.kkphim)
                ? context.kkphim
                : [],

        nguonc:
            Array.isArray(context.nguonc)
                ? context.nguonc
                : [],

        vsmov:
            Array.isArray(context.vsmov)
                ? context.vsmov
                : [],

        phimhdcs:
            Array.isArray(context.phimhdcs)
                ? context.phimhdcs
                : []

    };

    console.log(
        "[PHIMLONGTIENG] Support context:",
        {
            originalName:
                supportOriginalName,

            targetYear:
                supportTargetYear,

            seasonNumber:
                supportSeasonNumber,

            episodeNumber:
                supportEpisodeNumber,

            streamType:
                supportStreamType,

            kkphim:
                supportSources.kkphim.length,

            nguonc:
                supportSources.nguonc.length,

            vsmov:
                supportSources.vsmov.length,

            phimhdcs:
                supportSources.phimhdcs.length
        }
    );

    // ============================================================
    // 2. HELPERS
    // ============================================================

    function normalizeText(s) {

        return String(s || "")
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
                /[^a-z0-9]+/g,
                " "
            )
            .replace(
                /\s+/g,
                " "
            )
            .trim();

    }

    function slugify(s) {

        return normalizeText(s)
            .replace(
                /\s+/g,
                "-"
            );

    }

    function decodeHtml(s) {

        return String(s || "")
            .replace(
                /&amp;/g,
                "&"
            )
            .replace(
                /&#39;/g,
                "'"
            )
            .replace(
                /&quot;/g,
                '"'
            )
            .replace(
                /&#x27;/g,
                "'"
            )
            .replace(
                /\\\//g,
                "/"
            );

    }

    function absUrl(
        url,
        base
    ) {

        try {

            return new URL(
                decodeHtml(url),
                base
            ).href;

        } catch (_) {

            return null;

        }

    }

    // ============================================================
    // 3. ADD STREAM
    // ============================================================

    function addStream(
        url,
        title,
        referer,
        sourceLabel
    ) {

        if (!url) return;

        url =
            decodeHtml(url).trim();

        if (
            !/^https?:\/\//i.test(url)
        ) {

            url =
                absUrl(
                    url,
                    referer ||
                    "https://www.1phim35.com/"
                );

        }

        if (!url) return;

        const key =
            url.trim();

        if (
            seen.has(key)
        ) {
            return;
        }

        seen.add(key);

        // =================================================
        // XÁC ĐỊNH HOST STREAM THẬT
        // =================================================

        let streamUrl;

        try {

            streamUrl =
                new URL(url);

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
            streamHost ===
                "1phim34.com" ||

            streamHost ===
                "www.1phim34.com" ||

            streamHost ===
                "1phim35.com" ||

            streamHost ===
                "www.1phim35.com" ||

            streamHost ===
                "play.cbplay.cc" ||

            streamHost.endsWith(
                ".cbplay.cc"
            );

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
            streamHost ===
                "play.cbplay.cc" ||

            streamHost.endsWith(
                ".cbplay.cc"
            )
        ) {

            streamReferer =
                "https://play.cbplay.cc/";

        } else if (
            streamHost ===
                "1phim35.com" ||

            streamHost ===
                "www.1phim35.com"
        ) {

            streamReferer =
                "https://www.1phim35.com/";

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

        // =================================================
        // ADD STREAM
        // =================================================

        const streamObject = {

            name:
                `⚡ [PhimLongTieng] ${sourceLabel}`,

            title:
                title ||
                `${sourceLabel} - Direct`,

            url:
                proxyUrl,

            behaviorHints: {

                notWebReady:
                    false,

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

    // ============================================================
    // 4. GET
    // ============================================================

    async function get(
        url,
        headers = {}
    ) {

        const controller =
            new AbortController();

        const timer =
            setTimeout(
                () =>
                    controller.abort(),
                timeoutMs
            );

        try {

            return await fetch(
                url,
                {
                    method:
                        "GET",

                    redirect:
                        "follow",

                    signal:
                        controller.signal,

                    headers: {

                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",

                        "Accept":
                            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

                        ...headers

                    }

                }
            );

        } finally {

            clearTimeout(
                timer
            );

        }

    }

    // ============================================================
    // 5. CRYPTO
    // ============================================================

    function cryptoJSAesDecrypt(
        passphrase,
        encryptedJsonString
    ) {

        const crypto =
            require("crypto");

        const obj =
            JSON.parse(
                encryptedJsonString
            );

        const encrypted =
            Buffer.from(
                obj.ciphertext,
                "base64"
            );

        const salt =
            Buffer.from(
                obj.salt,
                "hex"
            );

        const iv =
            Buffer.from(
                obj.iv,
                "hex"
            );

        const key =
            crypto.pbkdf2Sync(
                Buffer.from(
                    passphrase,
                    "utf8"
                ),
                salt,
                999,
                32,
                "sha512"
            );

        const decipher =
            crypto.createDecipheriv(
                "aes-256-cbc",
                key,
                iv
            );

        return Buffer.concat([
            decipher.update(
                encrypted
            ),
            decipher.final()
        ]).toString(
            "utf8"
        );

    }

    // ============================================================
    // 6. BASE64 URL
    // ============================================================

    function decodeBase64Url(
        value
    ) {

        try {

            let s =
                decodeURIComponent(
                    value || ""
                );

            s =
                s.replace(
                    /-/g,
                    "+"
                )
                .replace(
                    /_/g,
                    "/"
                );

            while (
                s.length % 4 !== 0
            ) {

                s += "=";

            }

            return Buffer.from(
                s,
                "base64"
            ).toString(
                "utf8"
            );

        } catch (e) {

            console.log(
                "[PHIMLONGTIENG] Base64 decode error:",
                e.message
            );

            return null;

        }

    }

    // ============================================================
    // 7. ENCRYPTED JSON
    // ============================================================

    function extractEncryptedJson(
        html
    ) {

        const marker =
            "CryptoJSAesDecrypt('Encrypt', `";

        let pos = 0;

        const candidates = [];

        while (true) {

            const found =
                html.indexOf(
                    marker,
                    pos
                );

            if (found < 0) {
                break;
            }

            const start =
                found +
                marker.length;

            const end =
                html.indexOf(
                    "`",
                    start
                );

            if (
                end > start
            ) {

                const candidate =
                    html.substring(
                        start,
                        end
                    ).trim();

                try {

                    const obj =
                        JSON.parse(
                            candidate
                        );

                    if (
                        obj &&
                        obj.ciphertext &&
                        obj.iv &&
                        obj.salt
                    ) {

                        candidates.push(
                            candidate
                        );

                    }

                } catch (_) {}

            }

            pos =
                start;

        }

        console.log(
            "[PHIMLONGTIENG] Valid encrypted JSON candidates:",
            candidates.length
        );

        if (
            !candidates.length
        ) {

            return null;

        }

        return candidates[
            candidates.length - 1
        ];

    }

    // ============================================================
    // 8. PLAY2
    // ============================================================

    function extractPlay2Streams(
        html,
        baseUrl,
        labelPrefix = "PLAY2"
    ) {

        const found = [];

        const regex =
            /https?:\/\/[^"'<>\\\s]+\/play2\.php\?[^"'<>\\\s]+/gi;

        let m;

        while (
            (m = regex.exec(html)) !== null
        ) {

            let url =
                decodeHtml(
                    m[0]
                );

            url =
                url.replace(
                    /[)"';,]+$/g,
                    ""
                );

            if (
                !found.includes(url)
            ) {

                found.push(
                    url
                );

            }

        }

        console.log(
            `[PHIMLONGTIENG] ${labelPrefix} play2 count:`,
            found.length
        );

        for (
            const play2Url
            of found
        ) {

            try {

                const parsed =
                    new URL(
                        play2Url
                    );

                const hash =
                    parsed.searchParams.get(
                        "hash"
                    );

                if (!hash) {

                    console.log(
                        "[PHIMLONGTIENG] play2 WITHOUT hash:",
                        play2Url
                    );

                    continue;

                }

                const decoded =
                    decodeBase64Url(
                        hash
                    );

                console.log(
                    "[PHIMLONGTIENG] play2 decoded:",
                    decoded
                );

                if (
                    decoded &&
                    /^https?:\/\//i.test(
                        decoded
                    )
                ) {

                    addStream(
                        decoded,
                        `${labelPrefix} - Direct`,
                        baseUrl,
                        labelPrefix
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
    // 9. DIRECT M3U8
    // ============================================================

    function extractDirectM3U8(
        html,
        baseUrl,
        label = "Direct"
    ) {

        const found = [];

        const patterns = [

            /https?:\/\/[^"'<>\\\s]+\.m3u8(?:\?[^"'<>\\\s]*)?/gi,

            /https?:\\\/\\\/[^"'<>\\\s]+\.m3u8(?:\?[^"'<>\\\s]*)?/gi

        ];

        for (
            const regex
            of patterns
        ) {

            let m;

            while (
                (m = regex.exec(html)) !== null
            ) {

                let url =
                    m[0]
                        .replace(
                            /\\\//g,
                            "/"
                        )
                        .replace(
                            /\\u0026/g,
                            "&"
                        )
                        .replace(
                            /[)"';,]+$/g,
                            ""
                        );

                if (
                    !found.includes(url)
                ) {

                    found.push(
                        url
                    );

                }

            }

        }

        console.log(
            `[PHIMLONGTIENG] ${label} direct M3U8:`,
            found
        );

        for (
            const url
            of found
        ) {

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
    // 10. VB PLAYER
    // ============================================================

    function extractVBPlayers(
        html,
        baseUrl
    ) {

        const players = [];

        const regex =
            /vb_load_player\s*\(\s*this\s*,\s*(['"])(.*?)\1\s*\)/gi;

        let m;

        while (
            (m = regex.exec(html)) !== null
        ) {

            const raw =
                decodeHtml(
                    m[2]
                ).trim();

            if (
                !players.includes(raw)
            ) {

                players.push(
                    raw
                );

            }

        }

        console.log(
            "[PHIMLONGTIENG] vb_load_player explicit URLs:",
            players
        );

        for (
            const raw
            of players
        ) {

            const url =
                absUrl(
                    raw,
                    baseUrl
                );

            if (!url) {
                continue;
            }

            console.log(
                "[PHIMLONGTIENG] VB PLAYER:",
                url
            );

            try {

                const parsed =
                    new URL(
                        url
                    );

                if (
                    parsed.pathname
                        .toLowerCase()
                        .includes(
                            "/play2.php"
                        )
                ) {

                    const hash =
                        parsed.searchParams.get(
                            "hash"
                        );

                    if (hash) {

                        const decoded =
                            decodeBase64Url(
                                hash
                            );

                        console.log(
                            "[PHIMLONGTIENG] VB play2 decoded:",
                            decoded
                        );

                        if (
                            decoded &&
                            /^https?:\/\//i.test(
                                decoded
                            )
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

            if (
                /\.m3u8(?:[?#]|$)/i.test(
                    url
                )
            ) {

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
    // 11. DATA URL
    // ============================================================

    function extractDataUrls(
        html,
        baseUrl
    ) {

        const urls = [];

        const regex =
            /\bdata-url\s*=\s*(['"])(.*?)\1/gi;

        let m;

        while (
            (m = regex.exec(html)) !== null
        ) {

            const raw =
                decodeHtml(
                    m[2]
                ).trim();

            if (
                !urls.includes(raw)
            ) {

                urls.push(
                    raw
                );

            }

        }

        console.log(
            "[PHIMLONGTIENG] data-url:",
            urls
        );

        for (
            const raw
            of urls
        ) {

            const url =
                absUrl(
                    raw,
                    baseUrl
                );

            if (!url) {
                continue;
            }

            try {

                const parsed =
                    new URL(
                        url
                    );

                if (
                    parsed.pathname
                        .toLowerCase()
                        .includes(
                            "/play2.php"
                        )
                ) {

                    const hash =
                        parsed.searchParams.get(
                            "hash"
                        );

                    if (hash) {

                        const decoded =
                            decodeBase64Url(
                                hash
                            );

                        console.log(
                            "[PHIMLONGTIENG] data-url decoded:",
                            decoded
                        );

                        if (
                            decoded &&
                            /^https?:\/\//i.test(
                                decoded
                            )
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
    // 12. SUPPORT CONTEXT HELPERS
    // ============================================================

    function collectObjectStrings(
        value,
        output = []
    ) {

        if (
            value === null ||
            value === undefined
        ) {

            return output;

        }

        if (
            typeof value === "string"
        ) {

            const s =
                value.trim();

            if (s.length >= 2) {

                output.push(
                    s
                );

            }

            return output;

        }

        if (
            typeof value === "number" ||
            typeof value === "boolean"
        ) {

            output.push(
                String(value)
            );

            return output;

        }

        if (
            Array.isArray(value)
        ) {

            for (
                const item
                of value
            ) {

                collectObjectStrings(
                    item,
                    output
                );

            }

            return output;

        }

        if (
            typeof value === "object"
        ) {

            for (
                const [key, item]
                of Object.entries(value)
            ) {

                // URL stream không phải title.
                // Nhưng các field tên phim vẫn được đọc.
                if (
                    /^(url|stream|link|src|proxy|hls)$/i.test(
                        key
                    )
                ) {

                    continue;

                }

                if (
                    typeof item === "string" &&
                    item.length > 500
                ) {

                    continue;

                }

                collectObjectStrings(
                    item,
                    output
                );

            }

        }

        return output;

    }

    function getContextTitles(
        sourceArray
    ) {

        const titles = [];

        if (
            !Array.isArray(
                sourceArray
            )
        ) {

            return titles;

        }

        for (
            const item
            of sourceArray
        ) {

            if (
                !item ||
                typeof item !== "object"
            ) {

                continue;

            }

            const possibleKeys = [

                "title",
                "name",
                "movieName",
                "movie_name",
                "originalName",
                "original_name",
                "showName",
                "show_name",
                "seriesName",
                "series_name",
                "metaName",
                "meta_name"

            ];

            for (
                const key
                of possibleKeys
            ) {

                if (
                    typeof item[key] ===
                    "string"
                ) {

                    const value =
                        item[key].trim();

                    if (
                        value.length >= 2
                    ) {

                        titles.push(
                            value
                        );

                    }

                }

            }

        }

        return Array.from(
            new Set(
                titles
            )
        );

    }

    const contextTitleSets = {

        kkphim:
            getContextTitles(
                supportSources.kkphim
            ),

        nguonc:
            getContextTitles(
                supportSources.nguonc
            ),

        vsmov:
            getContextTitles(
                supportSources.vsmov
            ),

        phimhdcs:
            getContextTitles(
                supportSources.phimhdcs
            )

    };

    const contextTitles = [

        ...contextTitleSets.kkphim,

        ...contextTitleSets.nguonc,

        ...contextTitleSets.vsmov,

        ...contextTitleSets.phimhdcs

    ];

    const uniqueContextTitles =
        Array.from(
            new Set(
                contextTitles
            )
        );

    console.log(
        "[PHIMLONGTIENG] Resolved context titles:",
        uniqueContextTitles
    );

    function extractYearFromText(
        value
    ) {

        const text =
            String(
                value || ""
            );

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

        const titleYear =
            extractYearFromText(
                title
            );

        if (
            titleYear
        ) {

            return titleYear;

        }

        return extractYearFromText(
            url
        );

    }

    function scoreTitleSimilarity(
        candidateTitle,
        referenceTitle
    ) {

        const a =
            normalizeText(
                candidateTitle
            );

        const b =
            normalizeText(
                referenceTitle
            );

        if (
            !a ||
            !b
        ) {

            return 0;

        }

        if (
            a === b
        ) {

            return 1;

        }

        if (
            a.includes(b) ||
            b.includes(a)
        ) {

            return 0.75;

        }

        const aWords =
            new Set(
                a
                    .split(" ")
                    .filter(
                        x =>
                            x.length >= 2
                    )
            );

        const bWords =
            new Set(
                b
                    .split(" ")
                    .filter(
                        x =>
                            x.length >= 2
                    )
            );

        if (
            !aWords.size ||
            !bWords.size
        ) {

            return 0;

        }

        let overlap = 0;

        for (
            const word
            of aWords
        ) {

            if (
                bWords.has(
                    word
                )
            ) {

                overlap++;

            }

        }

        return (
            overlap /
            Math.max(
                aWords.size,
                bWords.size
            )
        );

    }

    // ============================================================
    // 13. SEARCH
    // ============================================================

    let directUrl =
        "https://phimlongtieng.link";

    try {

        const searchUrl =
            `${directUrl}/search/${slugify(movieName)}/`;

        console.log(
            "[PHIMLONGTIENG] Search URL:",
            searchUrl
        );

        const searchRes =
            await get(
                searchUrl
            );

        console.log(
            "[PHIMLONGTIENG] Search HTTP:",
            searchRes.status
        );

        const finalSearchUrl =
            searchRes.url ||
            searchUrl;

        try {

            directUrl =
                new URL(
                    finalSearchUrl
                ).origin;

        } catch (_) {}

        console.log(
            "[PHIMLONGTIENG] directUrl:",
            directUrl
        );

        const searchHtml =
            await searchRes.text();

        // ========================================================
        // 13.1. SEARCH CANDIDATES
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

            try {

                if (
                    !/\/phim\//i.test(
                        new URL(
                            absoluteHref
                        ).pathname
                    )
                ) {

                    continue;

                }

            } catch (_) {

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
        // 13.2. UNIQUE
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
        // 13.3. TARGET WORDS
        // ========================================================

        const target =
            normalizeText(
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
        // 13.4. INITIAL RANK
        //
        // Đây chỉ là ranking để quyết định candidate nào
        // được kiểm tra trước.
        //
        // KHÔNG phải kết quả cuối.
        // ========================================================

        const ranked =
            uniqueCandidates
                .map(
                    item => {

                        const titleNorm =
                            normalizeText(
                                item.title
                            );

                        const hrefNorm =
                            normalizeText(
                                item.href
                            );

                        let score = 0;

                        if (
                            titleNorm ===
                            target
                        ) {

                            score +=
                                5000;

                        }

                        if (
                            target.length >= 4 &&
                            titleNorm.includes(
                                target
                            )
                        ) {

                            score +=
                                2500;

                        }

                        if (
                            titleNorm.length >= 4 &&
                            target.includes(
                                titleNorm
                            )
                        ) {

                            score +=
                                1800;

                        }

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

                        if (
                            /lồng tiếng|thuyết minh|uslt|ffvn/i.test(
                                item.title +
                                " " +
                                item.status
                            )
                        ) {

                            score +=
                                100;

                        }

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

        const candidatesToTest =
            ranked.slice(
                0,
                20
            );

        // ========================================================
        // 14. VALIDATE CANDIDATES
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

                // ==================================================
                // 14.1. DETAIL
                // ==================================================

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

                // ==================================================
                // 14.2. DETAIL TITLE
                // ==================================================

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

                // ==================================================
                // 14.3. TITLE SCORE
                // ==================================================

                let finalScore =
                    selected.score;

                const originalSimilarity =
                    scoreTitleSimilarity(
                        detailTitle,
                        supportOriginalName
                    );

                if (
                    originalSimilarity >= 1
                ) {

                    finalScore +=
                        5000;

                } else if (
                    originalSimilarity >= 0.75
                ) {

                    finalScore +=
                        3000;

                } else if (
                    originalSimilarity >= 0.5
                ) {

                    finalScore +=
                        1200;

                } else {

                    finalScore -=
                        1500;

                }

                // ==================================================
                // 14.4. SO SÁNH VỚI CÁC NGUỒN ĐÃ RESOLVE
                //
                // Đây là phần context quan trọng.
                //
                // Không bắt buộc phải khớp.
                // Nhưng nếu nhiều nguồn cùng xác nhận một tên
                // tương đương thì candidate đó được tăng điểm mạnh.
                // ==================================================

                let contextBestSimilarity =
                    0;

                let contextMatchedSource =
                    null;

                for (
                    const sourceName
                    of uniqueContextTitles
                ) {

                    const similarity =
                        Math.max(

                            scoreTitleSimilarity(
                                selected.title,
                                sourceName
                            ),

                            scoreTitleSimilarity(
                                detailTitle,
                                sourceName
                            )

                        );

                    if (
                        similarity >
                        contextBestSimilarity
                    ) {

                        contextBestSimilarity =
                            similarity;

                        contextMatchedSource =
                            sourceName;

                    }

                }

                if (
                    contextBestSimilarity >= 1
                ) {

                    finalScore +=
                        6000;

                } else if (
                    contextBestSimilarity >= 0.75
                ) {

                    finalScore +=
                        4000;

                } else if (
                    contextBestSimilarity >= 0.5
                ) {

                    finalScore +=
                        1800;

                }

                // ==================================================
                // 14.5. YEAR
                // ==================================================

                let yearScore =
                    0;

                if (
                    supportTargetYear &&
                    detailYear
                ) {

                    if (
                        Number(
                            detailYear
                        ) ===
                        Number(
                            supportTargetYear
                        )
                    ) {

                        yearScore =
                            4500;

                        finalScore +=
                            yearScore;

                    } else {

                        yearScore =
                            -6000;

                        finalScore +=
                            yearScore;

                        console.log(
                            "[PHIMLONGTIENG] Reject candidate: DETAIL YEAR MISMATCH",
                            {
                                targetYear:
                                    Number(
                                        supportTargetYear
                                    ),

                                detailYear:
                                    detailYear
                            }
                        );

                        continue;

                    }

                }

                console.log(
                    "[PHIMLONGTIENG] DETAIL MATCH SCORE:",
                    {
                        searchTitle:
                            selected.title,

                        detailTitle:
                            detailTitle,

                        detailYear:
                            detailYear,

                        originalSimilarity:
                            originalSimilarity,

                        contextSimilarity:
                            contextBestSimilarity,

                        contextMatchedSource:
                            contextMatchedSource,

                        yearScore:
                            yearScore,

                        finalScore:
                            finalScore
                    }
                );

                // ==================================================
                // 14.6. EPISODES
                // ==================================================

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

                // ==================================================
                // 14.7. REAL EPISODES
                // ==================================================

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

                // ==================================================
                // 14.8. SELECT EPISODE
                // ==================================================

                let selectedEpisode =
                    null;

                const wantedEpisode =
                    supportEpisodeNumber &&
                    Number(
                        supportEpisodeNumber
                    ) > 0
                        ? Number(
                            supportEpisodeNumber
                        )
                        : null;

                if (
                    wantedEpisode !== null
                ) {

                    selectedEpisode =
                        realEpisodes.find(
                            e =>
                                e.number ===
                                wantedEpisode
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
                                        `(?:tập|tap|episode|ep)\\s*0*${wantedEpisode}\\b`,
                                        "i"
                                    ).test(
                                        text
                                    );

                                }
                            );

                    }

                    // Với series, không tìm được đúng tập
                    // thì candidate này KHÔNG phải candidate hợp lệ.
                    if (
                        !selectedEpisode
                    ) {

                        console.log(
                            "[PHIMLONGTIENG] Reject candidate: REQUESTED EPISODE NOT FOUND",
                            wantedEpisode
                        );

                        continue;

                    }

                    finalScore +=
                        3500;

                } else {

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

                // ==================================================
                // 14.9. EPISODE PAGE
                // ==================================================

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

                // ==================================================
                // 14.10. ENCRYPTED JSON
                // ==================================================

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

                // ==================================================
                // 14.11. FINAL CANDIDATE SCORE
                // ==================================================

                // Ưu tiên rõ ràng Lồng Tiếng / Thuyết Minh.
                if (
                    /lồng\s*tiếng|thuyết\s*minh|uslt|ffvn/i.test(
                        selected.title +
                        " " +
                        selected.status +
                        " " +
                        selectedEpisode.name
                    )
                ) {

                    finalScore +=
                        700;

                }

                if (
                    /vietsub|phụ\s*đề/i.test(
                        selected.title +
                        " " +
                        selected.status +
                        " " +
                        selectedEpisode.name
                    )
                ) {

                    finalScore -=
                        500;

                }

                console.log(
                    "[PHIMLONGTIENG] VALID CANDIDATE:",
                    {
                        title:
                            selected.title,

                        detailTitle:
                            detailTitle,

                        status:
                            selected.status,

                        detailYear:
                            detailYear,

                        contextSimilarity:
                            contextBestSimilarity,

                        contextMatchedSource:
                            contextMatchedSource,

                        episode:
                            selectedEpisode.name,

                        finalScore:
                            finalScore
                    }
                );

                candidateResults.push({

                    candidate:
                        {
                            ...selected,

                            detailTitle,

                            detailYear,

                            finalScore,

                            contextSimilarity:
                                contextBestSimilarity,

                            contextMatchedSource:
                                contextMatchedSource
                        },

                    selectedEpisode,

                    episodeHtml,

                    encryptedEpisode,

                    episodeUrl:
                        selectedEpisode.href

                });

            } catch (
                candidateError
            ) {

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
        // 15. KHÔNG CÓ VERSION HỢP LỆ
        // ========================================================

        if (
            !candidateResults.length
        ) {

            console.log(
                "[PHIMLONGTIENG] NO VALID MOVIE VERSION"
            );

            return [];

        }

        candidateResults.sort(
    (
        a,
        b
    ) =>
        Number(
            b.candidate.finalScore ||
            0
        ) -
        Number(
            a.candidate.finalScore ||
            0
        )
);

console.log(
    "[PHIMLONGTIENG] CANDIDATE RANKING:",
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

            score:
                result.candidate.finalScore,

            contextSimilarity:
                result.candidate.contextSimilarity,

            contextMatchedSource:
                result.candidate.contextMatchedSource
        })
    )
);

if (
    !candidateResults.length
) {

    console.log(
        "[PHIMLONGTIENG] NO VALID CANDIDATE"
    );

    return [];

}


// ========================================================
// 17. CONFIDENCE CHECK CHUNG
//
// Confidence dùng để xác định:
//   "đúng phim hay không"
//
// Không dùng confidence để loại Vietsub/Lồng Tiếng
// chỉ vì một version có score thấp hơn version kia.
//
// Đây là điểm quan trọng:
//   score dùng để xác định candidate đúng phim,
//   KHÔNG dùng để chỉ lấy 1 version.
// ========================================================

const hasSupportContext =
    uniqueContextTitles.length > 0 ||
    !!supportTargetYear;

const minimumScore =
    hasSupportContext
        ? 6500
        : 7000;

const highestScore =
    Number(
        candidateResults[0]
            .candidate
            .finalScore ||
        0
    );

if (
    highestScore <
    minimumScore
) {

    console.log(
        "[PHIMLONGTIENG] REJECT ALL CANDIDATES: LOW CONFIDENCE",
        {
            highestScore:
                highestScore,

            minimumScore:
                minimumScore
        }
    );

    return [];

}


// ========================================================
// 18. LỌC CANDIDATE ĐỦ ĐỘ TIN CẬY
//
// Không yêu cầu mọi version phải có score bằng nhau.
//
// Ví dụ:
//   Lồng Tiếng = 9400
//   Vietsub    = 7500
//
// Cả hai vẫn có thể là cùng một phim thật.
//
// Chỉ loại candidate nếu score thấp hơn ngưỡng
// hoặc rõ ràng là candidate yếu.
// ========================================================

const validResults =
    candidateResults.filter(
        result => {

            const score =
                Number(
                    result.candidate.finalScore ||
                    0
                );

            if (
                score <
                minimumScore
            ) {

                console.log(
                    "[PHIMLONGTIENG] SKIP VERSION: LOW CONFIDENCE",
                    {
                        title:
                            result.candidate.title,

                        status:
                            result.candidate.status,

                        score:
                            score,

                        minimumScore:
                            minimumScore
                    }
                );

                return false;

            }

            return true;

        }
    );

if (
    !validResults.length
) {

    console.log(
        "[PHIMLONGTIENG] NO CANDIDATE AFTER CONFIDENCE FILTER"
    );

    return [];

}


// ========================================================
// 19. LOG CÁC VERSION SẼ ĐƯỢC XỬ LÝ
// ========================================================

console.log(
    "[PHIMLONGTIENG] VALID VERSIONS TO PROCESS:",
    validResults.map(
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

            score:
                result.candidate.finalScore
        })
    )
);


// ========================================================
// 20. PROCESS TỪNG VERSION ĐỘC LẬP
//
// Mỗi candidate:
//   1. decrypt
//   2. mở player
//   3. lấy play2
//   4. lấy VB player
//   5. lấy data-url
//   6. lấy direct m3u8
//
// Một version lỗi KHÔNG làm mất các version khác.
//
// Ví dụ:
//   Lồng Tiếng lỗi
//   Vietsub OK
//
// → vẫn trả Vietsub.
//
// Hoặc:
//   Lồng Tiếng OK
//   Vietsub OK
//
// → trả cả hai.
// ========================================================

for (
    const result
    of validResults
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
                selectedEpisode.href,

            score:
                selected.finalScore,

            contextMatchedSource:
                selected.contextMatchedSource
        }
    );


    // ======================================================
    // 20.1. DECRYPT
    // ======================================================

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
            {
                version:
                    selected.status,

                url:
                    playerUrl
            }
        );

    } catch (e) {

        console.log(
            "[PHIMLONGTIENG] DECRYPT ERROR:",
            {
                version:
                    selected.status,

                error:
                    e?.message ||
                    e
            }
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
        {
            version:
                selected.status,

            url:
                playerUrl
        }
    );

    if (
        !playerUrl
    ) {

        console.log(
            "[PHIMLONGTIENG] SKIP VERSION: EMPTY PLAYER URL",
            selected.status
        );

        continue;

    }


    // ======================================================
    // 20.2. PLAYER PAGE
    // ======================================================

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
            {
                version:
                    selected.status,

                status:
                    playerRes.status
            }
        );

        console.log(
            "[PHIMLONGTIENG] PLAYER final URL:",
            {
                version:
                    selected.status,

                url:
                    playerRes.url
            }
        );

        if (
            playerRes.status &&
            Number(
                playerRes.status
            ) >= 400
        ) {

            console.log(
                "[PHIMLONGTIENG] SKIP VERSION: PLAYER HTTP ERROR",
                {
                    version:
                        selected.status,

                    status:
                        playerRes.status
                }
            );

            continue;

        }

        playerFinalUrl =
            playerRes.url ||
            playerUrl;

        playerHtml =
            await playerRes.text();

    } catch (
        playerError
    ) {

        console.log(
            "[PHIMLONGTIENG] PLAYER ERROR:",
            {
                version:
                    selected.status,

                error:
                    playerError?.message ||
                    playerError
            }
        );

        continue;

    }

    console.log(
        "[PHIMLONGTIENG] PLAYER length:",
        {
            version:
                selected.status,

            length:
                playerHtml.length
        }
    );


    // ======================================================
    // 20.3. STREAM LABEL
    // ======================================================

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


    // ======================================================
    // 20.4. STREAM COUNT TRƯỚC VERSION
    // ======================================================

    const beforeVersion =
        streams.length;


    // ======================================================
    // 20.5. S2 / DEFAULT PLAYER
    // ======================================================

    extractPlay2Streams(
        playerHtml,
        playerFinalUrl,
        streamPrefix
    );


    // ======================================================
    // 20.6. VB LOAD PLAYER
    // ======================================================

    extractVBPlayers(
        playerHtml,
        playerFinalUrl
    );


    // ======================================================
    // 20.7. DATA URL
    // ======================================================

    extractDataUrls(
        playerHtml,
        playerFinalUrl
    );


    // ======================================================
    // 20.8. DIRECT M3U8
    // ======================================================

    extractDirectM3U8(
        playerHtml,
        playerFinalUrl,
        streamPrefix
    );


    // ======================================================
    // 20.9. PLAYER URL ĐÃ LÀ M3U8
    // ======================================================

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


    // ======================================================
    // 20.10. LOG SERVER BUTTONS
    // ======================================================

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


    // ======================================================
    // 20.11. LOG KẾT QUẢ VERSION
    // ======================================================

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
                beforeVersion,

            after:
                streams.length,

            added:
                streams.length -
                beforeVersion
        }
    );

}


// ========================================================
// 21. FINAL DEDUPE
//
// Các parser khác nhau có thể tìm cùng một M3U8:
//
//   play2
//   vb_load_player
//   data-url
//
// Vì vậy dedupe lần cuối theo URL.
//
// Không dùng title/name làm key vì Vietsub và Lồng Tiếng
// phải được giữ riêng.
// ========================================================

const finalSeen =
    new Set();

const finalStreams =
    [];

for (
    const stream
    of streams
) {

    if (
        !stream ||
        !stream.url
    ) {

        continue;

    }

    const key =
        String(
            stream.url
        ).trim();

    if (
        !key ||
        finalSeen.has(key)
    ) {

        continue;

    }

    finalSeen.add(
        key
    );

    finalStreams.push(
        stream
    );

}


// ========================================================
// 22. FINAL LOG
// ========================================================

console.log(
    "[PHIMLONGTIENG] STREAMS FOUND:",
    finalStreams.length
);

console.log(
    "[PHIMLONGTIENG] FINAL STREAMS:",
    finalStreams.map(
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

return finalStreams;

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
        // VMT TV LIVE STREAM
        // =====================================================

        if (
            streamType === "tv" &&
            rawId.startsWith("vmttv:")
        ) {

            console.log(
                "[STREAM] VMT TV request:",
                rawId
            );

            try {

                const channelId =
                    decodeVmtTvStremioId(
                        rawId
                    );

                if (!channelId) {

                    console.log(
                        "[VMTTV STREAM] Empty channel ID"
                    );

                    return {
                        streams: []
                    };

                }

                const liveStreams =
                    await resolveVmtTvChannel(
                        channelId
                    );

                const streams =
                    normalizedStreamsToStremio(
                        liveStreams
                    );

                console.log(
                    "[VMTTV STREAM] Channel:",
                    channelId
                );

                console.log(
                    "[VMTTV STREAM] Streams:",
                    streams.length
                );

                return {
                    streams
                };

            } catch (e) {

                console.error(
                    "[VMTTV STREAM ERROR]",
                    e?.message ||
                    e
                );

                return {
                    streams: []
                };

            }
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

    // -------------------------------------------------
    // 8.1. Chạy các nguồn độc lập trước
    // -------------------------------------------------

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


// -----------------------------------------------------
// 8.2. Lấy kết quả tạm của các nguồn hỗ trợ PLT
// -----------------------------------------------------

const nguoncSupport =
    results[0]?.status === "fulfilled" &&
    Array.isArray(
        results[0].value
    )
        ? results[0].value
        : [];

const vsmovSupport =
    results[1]?.status === "fulfilled" &&
    Array.isArray(
        results[1].value
    )
        ? results[1].value
        : [];

const phimhdcsSupport =
    results[2]?.status === "fulfilled" &&
    Array.isArray(
        results[2].value
    )
        ? results[2].value
        : [];


// -----------------------------------------------------
// 8.3. Context hỗ trợ từ các nguồn đã resolve
// -----------------------------------------------------

const phimLongTiengSupportContext = {

    originalName:
        movieName,

    targetYear:
        movieYear,

    seasonNumber:
        seasonNumber,

    episodeNumber:
        episodeNumber,

    streamType:
        streamType,

    kkphim:
        Array.isArray(kkphim)
            ? kkphim
            : [],

    nguonc:
        nguoncSupport,

    vsmov:
        vsmovSupport,

    phimhdcs:
        phimhdcsSupport
};


// -----------------------------------------------------
// 8.4. Chạy PhimLongTieng sau khi đã có context
// -----------------------------------------------------

let longtiengResult = [];

try {

    longtiengResult =
        await scrapePhimLongTieng(
            movieName,
            episodeNumber,
            movieYear,
            phimLongTiengSupportContext
        );

} catch (e) {

    console.log(
        "[PHIM LONG TIENG ERROR]:",
        e?.message ||
        e
    );

}


// -----------------------------------------------------
// 8.5. Đưa kết quả PLT vào vị trí cũ của results
// -----------------------------------------------------

results = [

    results[0],
    results[1],

    {
        status:
            "fulfilled",

        value:
            Array.isArray(longtiengResult)
                ? longtiengResult
                : []
    },

    results[2]
];


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
// 10.1. ANIME47 PROVIDER TEST
// =====================================================
//
// BƯỚC 3B — TEST PROVIDER ĐỘC LẬP
//
// Tạm thời CHỈ gọi Anime47 Provider để kiểm tra:
//
//     movieName
//          ↓
//     Anime47 Search
//          ↓
//     Anime Info
//          ↓
//     Episodes
//          ↓
//     Watch Episode
//          ↓
//     Raw Streams
//          ↓
//     Normalized Streams
//
// Chưa đưa Anime47 vào streams của Stremio.
//
// Mục đích:
//
//     - kiểm tra API
//     - kiểm tra search
//     - kiểm tra chọn đúng anime
//     - kiểm tra episode
//     - kiểm tra watch
//     - kiểm tra raw streams
//     - kiểm tra Normalized Stream
//
// VSMov không bị thay đổi.
// =====================================================

let anime47TestStreams = [];

try {

    anime47TestStreams =
        await fetchAnime47(
            movieName,
            seasonNumber,
            episodeNumber,
            streamType
        );

} catch (e) {

    console.log(
        "[ANIME47 TEST ERROR]:",
        e?.message ||
        e
    );

    anime47TestStreams = [];
}


// =====================================================
// 10.2. ANIME47 TEST RESULT
// =====================================================

console.log(
    "[ANIME47 TEST] STREAM COUNT:",
    anime47TestStreams.length
);


console.log(
    "[ANIME47 TEST] STREAMS:",
    JSON.stringify(
        anime47TestStreams,
        null,
        2
    )
);


// =====================================================
// 10.3. ANIME47 TEST SUMMARY
// =====================================================

if (
    anime47TestStreams.length
) {

    console.log(
        "[ANIME47 TEST] SUCCESS — NORMALIZED STREAMS FOUND"
    );

} else {

    console.log(
        "[ANIME47 TEST] NO NORMALIZED STREAM FOUND"
    );
}

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
// 1. PhimLongTieng
// 2. NguonC
// 3. KKPhim2
// =====================================================

const externalStreams = [

    // -------------------------------------------------
    // FALLBACK 1 — PHIMLONGTIENG
    // -------------------------------------------------

    {
        name:
            "🌐 [Fallback] PhimLongTieng",

        title:
            "Mở trang tìm kiếm PhimLongTieng - " +
            movieName,

        externalUrl:
            "https://phimlongtieng.link/search/" +
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
// 16.0.5. VSMOV HLS PROXY
//
// MASTER M3U8
//      ↓
// GET playlist
//      ↓
// validate HLS
//      ↓
// rewrite .png → /vsmov-segment-proxy/segment.ts
//      ↓
// return HLS playlist
//
// Hỗ trợ:
//
// /vsmov-hls-proxy?url=...master.m3u8
//
// và:
//
// /vsmov-hls-proxy/master.m3u8?url=...
// =====================================================

app.get(
    [
        "/vsmov-hls-proxy",
        "/vsmov-hls-proxy/master.m3u8"
    ],
    async (
        req,
        res
    ) => {

        try {

            const targetUrl =
                String(
                    req.query?.url ||
                    ""
                ).trim();


            const referer =
                normalizeVSMovReferer(
                    req.query?.ref
                );


            console.log(
                "[VSMOV HLS PROXY] PATH:",
                req.path
            );


            console.log(
                "[VSMOV HLS PROXY] URL:",
                targetUrl
            );


            console.log(
                "[VSMOV HLS PROXY] REFERER:",
                referer
            );


            // -------------------------------------------------
            // VALIDATE TARGET
            // -------------------------------------------------

            if (
                !targetUrl ||
                !isValidVSMovStreamUrl(
                    targetUrl
                )
            ) {

                console.log(
                    "[VSMOV HLS PROXY] INVALID TARGET"
                );


                return res
                    .status(
                        400
                    )
                    .type(
                        "text/plain"
                    )
                    .send(
                        "Invalid VSMov HLS URL"
                    );

            }


            // -------------------------------------------------
            // GET MASTER M3U8
            // -------------------------------------------------

            const response =
                await axios.get(
                    targetUrl,
                    {
                        timeout:
                            15000,

                        responseType:
                            "text",

                        headers: {

                            "Referer":
                                referer,

                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

                            "Accept":
                                "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*"

                        }

                    }
                );


            const playlist =
                String(
                    response?.data ||
                    ""
                ).trim();


            console.log(
                "[VSMOV HLS PROXY] SOURCE STATUS:",
                response?.status
            );


            console.log(
                "[VSMOV HLS PROXY] SOURCE TYPE:",
                response?.headers?.["content-type"] ||
                ""
            );


            console.log(
                "[VSMOV HLS PROXY] PLAYLIST LENGTH:",
                playlist.length
            );


            if (
                !playlist
            ) {

                console.log(
                    "[VSMOV HLS PROXY] EMPTY PLAYLIST"
                );


                return res
                    .status(
                        502
                    )
                    .type(
                        "text/plain"
                    )
                    .send(
                        "Empty VSMov playlist"
                    );

            }


            // -------------------------------------------------
            // BASIC HLS VALIDATION
            // -------------------------------------------------

            const isHls =
                playlist
                    .startsWith(
                        "#EXTM3U"
                    );


            const hasExtInf =
                playlist.includes(
                    "#EXTINF:"
                );


            const hasSegmentUrl =
                /https?:\/\/[^\s]+/i
                    .test(
                        playlist
                    );


            const hasEndList =
                playlist.includes(
                    "#EXT-X-ENDLIST"
                );


            console.log(
                "[VSMOV HLS PROXY] HLS CHECK:",
                {
                    isHls,
                    hasExtInf,
                    hasSegmentUrl,
                    hasEndList
                }
            );


            if (
                !isHls ||
                !hasExtInf ||
                !hasSegmentUrl
            ) {

                console.log(
                    "[VSMOV HLS PROXY] INVALID HLS PLAYLIST"
                );


                console.log(
                    "[VSMOV HLS PROXY] BODY:",
                    playlist.slice(
                        0,
                        1000
                    )
                );


                return res
                    .status(
                        502
                    )
                    .type(
                        "text/plain"
                    )
                    .send(
                        "Invalid VSMov HLS playlist"
                    );

            }


            // -------------------------------------------------
            // REWRITE PLAYLIST
            // -------------------------------------------------

            const rewritten =
                rewriteVSMovM3u8(
                    playlist,
                    targetUrl,
                    referer
                );


            const rewrittenText =
                String(
                    rewritten ||
                    ""
                ).trim();


            console.log(
                "[VSMOV HLS PROXY] PLAYLIST:",
                playlist.length,
                "→",
                rewrittenText.length
            );


            // -------------------------------------------------
            // DEBUG FIRST LINES
            // -------------------------------------------------

            const outputLines =
                rewrittenText
                    .split("\n");


            console.log(
                "[VSMOV HLS PROXY] OUTPUT:",
                outputLines
                    .slice(
                        0,
                        14
                    )
                    .join("\n")
            );


            // -------------------------------------------------
            // DEBUG LAST LINES
            // -------------------------------------------------

            console.log(
                "[VSMOV HLS PROXY] OUTPUT TAIL:",
                outputLines
                    .slice(
                        -6
                    )
                    .join("\n")
            );


            // -------------------------------------------------
            // FINAL VALIDATION
            // -------------------------------------------------

            const rewrittenIsHls =
                rewrittenText
                    .startsWith(
                        "#EXTM3U"
                    );


            const rewrittenHasExtInf =
                rewrittenText.includes(
                    "#EXTINF:"
                );


            const rewrittenHasProxy =
                rewrittenText.includes(
                    "/vsmov-segment-proxy/segment.ts?"
                );


            const rewrittenHasEndList =
                rewrittenText.includes(
                    "#EXT-X-ENDLIST"
                );


            const rewrittenUrlCount =
                (
                    rewrittenText.match(
                        /https?:\/\/[^\s]+/gi
                    ) ||
                    []
                ).length;


            console.log(
                "[VSMOV HLS PROXY] FINAL CHECK:",
                {
                    rewrittenIsHls,
                    rewrittenHasExtInf,
                    rewrittenHasProxy,
                    rewrittenHasEndList,
                    rewrittenUrlCount
                }
            );


            if (
                !rewrittenIsHls ||
                !rewrittenHasExtInf ||
                !rewrittenHasProxy
            ) {

                console.log(
                    "[VSMOV HLS PROXY] REWRITE FAILED"
                );


                return res
                    .status(
                        502
                    )
                    .type(
                        "text/plain"
                    )
                    .send(
                        "Invalid rewritten VSMov HLS playlist"
                    );

            }


            // -------------------------------------------------
            // RESPONSE HEADERS
            // -------------------------------------------------

            const playlistBuffer =
                Buffer.from(
                    rewrittenText,
                    "utf8"
                );


            res.status(
                200
            );


            res.set(
                "Content-Type",
                "application/vnd.apple.mpegurl"
            );


            res.set(
                "Content-Length",
                String(
                    playlistBuffer.length
                )
            );


            res.set(
                "Content-Disposition",
                "inline; filename=\"master.m3u8\""
            );


            res.set(
                "Access-Control-Allow-Origin",
                "*"
            );


            res.set(
                "Access-Control-Allow-Headers",
                "*"
            );


            res.set(
                "Access-Control-Allow-Methods",
                "GET, HEAD, OPTIONS"
            );


            res.set(
                "Cache-Control",
                "no-cache, no-store, must-revalidate"
            );


            res.set(
                "Pragma",
                "no-cache"
            );


            res.set(
                "Expires",
                "0"
            );


            res.set(
                "Accept-Ranges",
                "none"
            );


            res.set(
                "X-Content-Type-Options",
                "nosniff"
            );


            // -------------------------------------------------
            // DEBUG RESPONSE
            // -------------------------------------------------

            console.log(
                "[VSMOV HLS PROXY] RESPONSE:",
                {
                    contentType:
                        "application/vnd.apple.mpegurl",
                    contentLength:
                        playlistBuffer.length,
                    proxySegments:
                        rewrittenUrlCount
                }
            );


            // -------------------------------------------------
            // SEND HLS PLAYLIST
            // -------------------------------------------------

            return res.send(
                playlistBuffer
            );


        } catch (e) {

            console.log(
                "[VSMOV HLS PROXY ERROR]:",
                e?.response?.status ||
                e?.message ||
                e
            );


            if (
                e?.response?.data
            ) {

                console.log(
                    "[VSMOV HLS PROXY ERROR BODY]:",
                    String(
                        e.response.data
                    ).slice(
                        0,
                        500
                    )
                );

            }


            if (
                !res.headersSent
            ) {

                return res
                    .status(
                        502
                    )
                    .type(
                        "text/plain"
                    )
                    .send(
                        "VSMov HLS proxy error"
                    );

            }

        }

    }
);


// =====================================================
// 16.0.6. VSMOV SEGMENT PROXY
//
// VSMov trả về file .png giả nhưng payload thật là MPEG-TS.
//
// Mục tiêu:
//
// SOURCE VSMov
//      ↓
// responseType = stream
//      ↓
// bỏ fake PNG prefix
//      ↓
// MPEG-TS stream
//      ↓
// Stremio
//
// Không chờ tải xong toàn bộ segment mới bắt đầu gửi.
//
// CACHE:
// - chỉ cache segment đã tải hoàn chỉnh
// - TTL 45 giây
// - tối đa 5 segment
//
// IN-FLIGHT:
// - request đầu tiên stream trực tiếp
// - request trùng trong lúc đang tải sẽ chờ request đầu
// - sau khi hoàn tất, request chờ nhận payload hoàn chỉnh
// =====================================================


// =====================================================
// NODE STREAM
// =====================================================

const {
    Transform
} = require("stream");


// =====================================================
// VSMOV SEGMENT CACHE
// =====================================================

const VSMOV_SEGMENT_CACHE =
    new Map();

const VSMOV_SEGMENT_CACHE_TTL =
    45 * 1000; // 45 giây

const VSMOV_SEGMENT_CACHE_MAX =
    5; // giữ tối đa 5 segment


// =====================================================
// VSMOV SEGMENT IN-FLIGHT
//
// Map:
// targetUrl -> Promise<Buffer>
//
// Promise chỉ dùng cho các request trùng.
// Request đầu tiên KHÔNG await Promise này để stream.
//
// =====================================================

const VSMOV_SEGMENT_INFLIGHT =
    new Map();


// =====================================================
// VSMOV SEGMENT CACHE GET
// =====================================================

function getVSMovSegmentCache(
    targetUrl
) {

    try {

        const entry =
            VSMOV_SEGMENT_CACHE.get(
                targetUrl
            );


        if (!entry) {
            return null;
        }


        const age =
            Date.now() -
            Number(
                entry.createdAt || 0
            );


        if (
            age >
            VSMOV_SEGMENT_CACHE_TTL
        ) {

            VSMOV_SEGMENT_CACHE.delete(
                targetUrl
            );


            console.log(
                "[VSMOV SEGMENT CACHE] EXPIRED:",
                targetUrl
            );


            return null;
        }


        console.log(
            "[VSMOV SEGMENT CACHE] HIT:",
            "ageMs=" + age,
            "bytes=" +
                (
                    entry.buffer?.length ||
                    0
                )
        );


        return entry.buffer;

    } catch (e) {

        console.log(
            "[VSMOV SEGMENT CACHE] GET ERROR:",
            e?.message || e
        );


        return null;
    }
}


// =====================================================
// VSMOV SEGMENT CACHE SET
// =====================================================

function setVSMovSegmentCache(
    targetUrl,
    buffer
) {

    try {

        if (
            !targetUrl ||
            !buffer ||
            !buffer.length
        ) {
            return;
        }


        // Đưa entry mới nhất về cuối Map
        VSMOV_SEGMENT_CACHE.delete(
            targetUrl
        );


        VSMOV_SEGMENT_CACHE.set(
            targetUrl,
            {
                buffer,
                createdAt:
                    Date.now()
            }
        );


        // Giới hạn số segment trong RAM
        while (
            VSMOV_SEGMENT_CACHE.size >
            VSMOV_SEGMENT_CACHE_MAX
        ) {

            const oldestKey =
                VSMOV_SEGMENT_CACHE
                    .keys()
                    .next()
                    .value;


            if (!oldestKey) {
                break;
            }


            const oldest =
                VSMOV_SEGMENT_CACHE.get(
                    oldestKey
                );


            console.log(
                "[VSMOV SEGMENT CACHE] EVICT:",
                oldestKey,
                "bytes=" +
                    (
                        oldest?.buffer?.length ||
                        0
                    )
            );


            VSMOV_SEGMENT_CACHE.delete(
                oldestKey
            );
        }


        console.log(
            "[VSMOV SEGMENT CACHE] STORED:",
            "bytes=" +
                buffer.length,
            "entries=" +
                VSMOV_SEGMENT_CACHE.size
        );

    } catch (e) {

        console.log(
            "[VSMOV SEGMENT CACHE] SET ERROR:",
            e?.message || e
        );
    }
}


// =====================================================
// VSMOV MPEG-TS TRANSFORM
//
// Nhiệm vụ:
//
// 1. Nhận chunk từ VSMov.
// 2. Tìm fake PNG prefix.
// 3. Khi tìm thấy MPEG-TS:
//      -> bỏ prefix
//      -> push MPEG-TS ngay xuống response
// 4. Đồng thời giữ lại payload để cache.
//
// Không cần đợi toàn bộ source tải xong.
// =====================================================

class VSMovMpegTsTransform
    extends Transform {

    constructor(options = {}) {

        super(options);


        this.pending =
            Buffer.alloc(0);


        this.prefixResolved =
            false;


        this.outputChunks =
            [];


        this.outputBytes =
            0;


        // Không giữ vô hạn nếu source bất thường.
        this.maxProbeBytes =
            128 * 1024;
    }


    pushPayload(
        buffer
    ) {

        if (
            !buffer ||
            !buffer.length
        ) {
            return;
        }


        this.outputChunks.push(
            buffer
        );


        this.outputBytes +=
            buffer.length;


        // Gửi ngay xuống response
        this.push(
            buffer
        );
    }


    _transform(
        chunk,
        encoding,
        callback
    ) {

        try {

            const incoming =
                Buffer.isBuffer(chunk)
                    ? chunk
                    : Buffer.from(chunk);


            if (
                !incoming.length
            ) {
                return callback();
            }


            // =============================================
            // ĐÃ TÌM THẤY MPEG-TS
            // =============================================

            if (
                this.prefixResolved
            ) {

                this.pushPayload(
                    incoming
                );


                return callback();
            }


            // =============================================
            // GỘP CHUNK
            // =============================================

            this.pending =
                this.pending.length
                    ? Buffer.concat([
                        this.pending,
                        incoming
                    ])
                    : incoming;


            const pending =
                this.pending;


            // =============================================
            // SOURCE ĐÃ LÀ MPEG-TS
            // =============================================

            if (
                pending.length >= 188 &&
                pending[0] === 0x47
            ) {

                this.prefixResolved =
                    true;


                console.log(
                    "[VSMOV STREAM] MPEG-TS START: prefix=0"
                );


                this.pushPayload(
                    pending
                );


                this.pending =
                    Buffer.alloc(0);


                return callback();
            }


            // =============================================
            // TÌM FAKE PNG PREFIX
            // =============================================

            const prefix =
                findVSMovPngPrefixLength(
                    pending
                );


            if (
                prefix > 0 &&
                prefix < pending.length
            ) {

                this.prefixResolved =
                    true;


                const payload =
                    pending.slice(
                        prefix
                    );


                console.log(
                    "[VSMOV STREAM] PNG PREFIX FOUND:",
                    "prefix=",
                    prefix,
                    "payload=",
                    payload.length
                );


                this.pushPayload(
                    payload
                );


                this.pending =
                    Buffer.alloc(0);


                return callback();
            }


            // =============================================
            // CHƯA TÌM ĐƯỢC PREFIX
            //
            // Chờ thêm chunk.
            // =============================================

            if (
                this.pending.length >
                this.maxProbeBytes
            ) {

                return callback(
                    new Error(
                        "VSMov MPEG-TS prefix not found"
                    )
                );
            }


            callback();

        } catch (e) {

            callback(e);
        }
    }


    _flush(
        callback
    ) {

        try {

            if (
                !this.prefixResolved &&
                this.pending.length
            ) {

                // Source kết thúc mà byte đầu đã là MPEG-TS
                if (
                    this.pending[0] === 0x47
                ) {

                    this.prefixResolved =
                        true;


                    this.pushPayload(
                        this.pending
                    );


                    this.pending =
                        Buffer.alloc(0);

                } else {

                    return callback(
                        new Error(
                            "VSMov stream ended before MPEG-TS payload"
                        )
                    );
                }
            }


            callback();

        } catch (e) {

            callback(e);
        }
    }


    getOutputBuffer() {

        if (
            !this.outputChunks.length
        ) {

            return Buffer.alloc(0);
        }


        return Buffer.concat(
            this.outputChunks,
            this.outputBytes
        );
    }
}


// =====================================================
// VSMOV DOWNLOAD + STREAM SESSION
//
// Chỉ có nhiệm vụ:
//
// - mở connection tới VSMov
// - trả source stream
// - transform source thành MPEG-TS
// - tạo Promise để cache/in-flight
//
// Request đầu tiên sẽ pipe transform -> res trực tiếp.
// =====================================================

async function startVSMovSegmentStream(
    targetUrl,
    referer
) {

    const startedAt =
        Date.now();


    console.log(
        "[VSMOV SEGMENT SOURCE] STREAM START:",
        targetUrl
    );


    const response =
        await axios.get(
            targetUrl,
            {
                timeout:
                    30000,

                responseType:
                    "stream",

                headers: {
                    "Referer":
                        referer,

                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

                    "Accept":
                        "*/*"
                },

                validateStatus:
                    status =>
                        status >= 200 &&
                        status < 300
            }
        );


    const sourceStream =
        response?.data;


    if (
        !sourceStream ||
        typeof sourceStream.pipe !==
            "function"
    ) {

        throw new Error(
            "Invalid VSMov source stream"
        );
    }


    const transform =
        new VSMovMpegTsTransform();


    sourceStream.on(
        "error",
        error => {

            console.log(
                "[VSMOV SEGMENT SOURCE] STREAM ERROR:",
                error?.message || error
            );


            transform.destroy(
                error
            );
        }
    );


    sourceStream.pipe(
        transform
    );


    // =============================================
    // PROMISE CHO CACHE / IN-FLIGHT
    //
    // Request đầu tiên không await Promise này.
    // =============================================

    let resolveFinished;
    let rejectFinished;


    const finishedPromise =
        new Promise(
            (resolve, reject) => {

                resolveFinished =
                    resolve;

                rejectFinished =
                    reject;
            }
        );


    // =============================================
    // SOURCE / TRANSFORM ERROR
    // =============================================

    const handleError =
        error => {

            rejectFinished(
                error instanceof Error
                    ? error
                    : new Error(
                        String(
                            error ||
                            "VSMov stream error"
                        )
                    )
            );
        };


    sourceStream.once(
        "error",
        handleError
    );


    transform.once(
        "error",
        handleError
    );


    // =============================================
    // TRANSFORM FINISH
    //
    // Chỉ lúc này mới cache.
    // =============================================

    transform.once(
        "finish",
        () => {

            try {

                const output =
                    transform.getOutputBuffer();


                const sourceMs =
                    Date.now() -
                    startedAt;


                if (
                    !output ||
                    !output.length
                ) {

                    throw new Error(
                        "Empty VSMov MPEG-TS output"
                    );
                }


                const looksLikeTs =
                    output.length >= 188 &&
                    output[0] === 0x47;


                console.log(
                    "[VSMOV SEGMENT SOURCE] STREAM DONE:",
                    {
                        sourceMs,
                        outputBytes:
                            output.length,
                        mpegTs:
                            looksLikeTs
                    }
                );


                if (
                    !looksLikeTs
                ) {

                    throw new Error(
                        "VSMov output is not MPEG-TS"
                    );
                }


                // Cache chỉ sau khi toàn bộ segment hoàn tất
                setVSMovSegmentCache(
                    targetUrl,
                    output
                );


                resolveFinished(
                    output
                );

            } catch (e) {

                rejectFinished(
                    e
                );
            }
        }
    );


    return {
        sourceStream,
        transform,
        finishedPromise
    };
}


// =====================================================
// 16.0.6. VSMOV SEGMENT PROXY ROUTE
// =====================================================

app.get(
    [
        "/vsmov-segment-proxy",
        "/vsmov-segment-proxy/segment.ts"
    ],

    async (
        req,
        res
    ) => {

        const requestStartedAt =
            Date.now();


        let sourceStream = null;
        let transform = null;


        try {

            const targetUrl =
                String(
                    req.query?.url || ""
                ).trim();


            const referer =
                normalizeVSMovReferer(
                    req.query?.ref
                );


            console.log(
                "[VSMOV SEGMENT PROXY] PATH:",
                req.path
            );


            console.log(
                "[VSMOV SEGMENT PROXY] URL:",
                targetUrl
            );


            console.log(
                "[VSMOV SEGMENT PROXY] REFERER:",
                referer
            );


            // =============================================
            // VALIDATE TARGET
            // =============================================

            if (
                !targetUrl ||
                !isValidVSMovStreamUrl(
                    targetUrl
                )
            ) {

                console.log(
                    "[VSMOV SEGMENT PROXY] INVALID TARGET"
                );


                return res
                    .status(400)
                    .type("text/plain")
                    .send(
                        "Invalid VSMov segment URL"
                    );
            }


            // =============================================
            // CACHE HIT
            // =============================================

            const cached =
                getVSMovSegmentCache(
                    targetUrl
                );


            if (cached) {

                const cacheStartedAt =
                    Date.now();


                res.removeHeader(
                    "Content-Range"
                );


                res.removeHeader(
                    "Content-Length"
                );


                res.removeHeader(
                    "Transfer-Encoding"
                );


                res.set(
                    "Content-Type",
                    "video/mp2t"
                );


                res.set(
                    "Content-Length",
                    String(
                        cached.length
                    )
                );


                res.set(
                    "Accept-Ranges",
                    "none"
                );


                res.set(
                    "Access-Control-Allow-Origin",
                    "*"
                );


                res.set(
                    "Access-Control-Allow-Headers",
                    "*"
                );


                res.set(
                    "Access-Control-Allow-Methods",
                    "GET, HEAD, OPTIONS"
                );


                res.set(
                    "Cache-Control",
                    "no-store, no-cache, must-revalidate"
                );


                res.set(
                    "Pragma",
                    "no-cache"
                );


                res.set(
                    "Expires",
                    "0"
                );


                res.once(
                    "finish",
                    () => {

                        const finishedAt =
                            Date.now();


                        console.log(
                            "[VSMOV SEGMENT PROXY] CACHE RESPONSE FINISH:",
                            "sendMs=" +
                                (
                                    finishedAt -
                                    cacheStartedAt
                                ),
                            "totalMs=" +
                                (
                                    finishedAt -
                                    requestStartedAt
                                ),
                            "bytes=" +
                                cached.length
                        );
                    }
                );


                return res.send(
                    cached
                );
            }


            // =============================================
            // IN-FLIGHT HIT
            //
            // Request đầu tiên đang stream segment này.
            // Request hiện tại chờ Promise hoàn tất.
            // =============================================

            const inflight =
                VSMOV_SEGMENT_INFLIGHT.get(
                    targetUrl
                );


            if (inflight) {

                console.log(
                    "[VSMOV SEGMENT PROXY] IN-FLIGHT HIT:",
                    targetUrl
                );


                try {

                    const output =
                        await inflight;


                    if (
                        !output ||
                        !output.length
                    ) {

                        throw new Error(
                            "Empty in-flight VSMov segment"
                        );
                    }


                    res.removeHeader(
                        "Content-Range"
                    );


                    res.removeHeader(
                        "Content-Length"
                    );


                    res.removeHeader(
                        "Transfer-Encoding"
                    );


                    res.set(
                        "Content-Type",
                        "video/mp2t"
                    );


                    res.set(
                        "Content-Length",
                        String(
                            output.length
                        )
                    );


                    res.set(
                        "Accept-Ranges",
                        "none"
                    );


                    res.set(
                        "Access-Control-Allow-Origin",
                        "*"
                    );


                    res.set(
                        "Access-Control-Allow-Headers",
                        "*"
                    );


                    res.set(
                        "Access-Control-Allow-Methods",
                        "GET, HEAD, OPTIONS"
                    );


                    res.set(
                        "Cache-Control",
                        "no-store, no-cache, must-revalidate"
                    );


                    res.set(
                        "Pragma",
                        "no-cache"
                    );


                    res.set(
                        "Expires",
                        "0"
                    );


                    console.log(
                        "[VSMOV SEGMENT PROXY] IN-FLIGHT SEND:",
                        "bytes=" +
                            output.length,
                        "waitMs=" +
                            (
                                Date.now() -
                                requestStartedAt
                            )
                    );


                    return res.send(
                        output
                    );

                } catch (e) {

                    console.log(
                        "[VSMOV SEGMENT PROXY] IN-FLIGHT ERROR:",
                        e?.message || e
                    );


                    if (
                        !res.headersSent
                    ) {

                        return res
                            .status(502)
                            .type("text/plain")
                            .send(
                                "VSMov in-flight segment error"
                            );
                    }


                    return;
                }
            }


            // =============================================
            // FIRST REQUEST
            //
            // Mở source stream.
            // =============================================

            const session =
                await startVSMovSegmentStream(
                    targetUrl,
                    referer
                );


            sourceStream =
                session.sourceStream;


            transform =
                session.transform;


            const finishedPromise =
                session.finishedPromise;


            // =============================================
            // ĐĂNG KÝ IN-FLIGHT
            // =============================================

            VSMOV_SEGMENT_INFLIGHT.set(
                targetUrl,
                finishedPromise
            );


            console.log(
                "[VSMOV SEGMENT PROXY] IN-FLIGHT START:",
                targetUrl
            );


            // Tránh unhandled rejection.
            // Request đầu tiên vẫn stream trực tiếp.
            finishedPromise.catch(
                () => {}
            );


            // =============================================
            // RESPONSE HEADERS
            //
            // Streaming nên không set Content-Length.
            // =============================================

            res.removeHeader(
                "Content-Range"
            );


            res.removeHeader(
                "Content-Length"
            );


            res.removeHeader(
                "Transfer-Encoding"
            );


            res.set(
                "Content-Type",
                "video/mp2t"
            );


            res.set(
                "Accept-Ranges",
                "none"
            );


            res.set(
                "Access-Control-Allow-Origin",
                "*"
            );


            res.set(
                "Access-Control-Allow-Headers",
                "*"
            );


            res.set(
                "Access-Control-Allow-Methods",
                "GET, HEAD, OPTIONS"
            );


            res.set(
                "Cache-Control",
                "no-store, no-cache, must-revalidate"
            );


            res.set(
                "Pragma",
                "no-cache"
            );


            res.set(
                "Expires",
                "0"
            );


            // =============================================
            // RESPONSE FINISH
            // =============================================

            res.once(
                "finish",
                () => {

                    const finishedAt =
                        Date.now();


                    console.log(
                        "[VSMOV SEGMENT PROXY] RESPONSE FINISH:",
                        {
                            sourceOrInflight:
                                "SOURCE-STREAM",

                            responseMs:
                                finishedAt -
                                requestStartedAt,

                            totalMs:
                                finishedAt -
                                requestStartedAt,

                            bytes:
                                transform
                                    ?.outputBytes ||
                                0
                        }
                    );
                }
            );


            // =============================================
            // RESPONSE CLOSE
            // =============================================

            res.once(
                "close",
                () => {

                    console.log(
                        "[VSMOV SEGMENT PROXY] RESPONSE CLOSE:",
                        "totalMs=" +
                            (
                                Date.now() -
                                requestStartedAt
                            )
                    );
                }
            );


            // =============================================
            // TRANSFORM ERROR
            // =============================================

            transform.once(
                "error",
                error => {

                    console.log(
                        "[VSMOV SEGMENT PROXY] TRANSFORM ERROR:",
                        error?.message || error
                    );


                    if (
                        !res.headersSent
                    ) {

                        return res
                            .status(502)
                            .type("text/plain")
                            .send(
                                "VSMov segment transform error"
                            );
                    }


                    try {
                        res.destroy(
                            error
                        );
                    } catch (_) {}
                }
            );


            // =============================================
            // SOURCE ERROR
            // =============================================

            sourceStream.once(
                "error",
                error => {

                    console.log(
                        "[VSMOV SEGMENT PROXY] SOURCE ERROR:",
                        error?.message || error
                    );


                    if (
                        !res.headersSent
                    ) {

                        return res
                            .status(502)
                            .type("text/plain")
                            .send(
                                "VSMov source stream error"
                            );
                    }


                    try {
                        res.destroy(
                            error
                        );
                    } catch (_) {}
                }
            );


            // =============================================
            // IN-FLIGHT CLEANUP
            //
            // Promise hoàn tất sau khi source đã tải xong.
            // =============================================

            finishedPromise
                .finally(
                    () => {

                        if (
                            VSMOV_SEGMENT_INFLIGHT.get(
                                targetUrl
                            ) ===
                            finishedPromise
                        ) {

                            VSMOV_SEGMENT_INFLIGHT.delete(
                                targetUrl
                            );


                            console.log(
                                "[VSMOV SEGMENT PROXY] IN-FLIGHT CLEAR:",
                                targetUrl
                            );
                        }
                    }
                )
                .catch(
                    () => {}
                );


            // =============================================
            // STREAM
            //
            // Đây là điểm quan trọng:
            //
            // transform -> res
            //
            // Không await finishedPromise.
            // Không res.send().
            //
            // Stremio nhận MPEG-TS ngay khi transform
            // tìm được payload.
            // =============================================

            console.log(
                "[VSMOV SEGMENT PROXY] STREAM PIPE:",
                targetUrl
            );


            transform.pipe(
                res
            );


            return;

        } catch (e) {

            console.log(
                "[VSMOV SEGMENT PROXY ERROR]:",
                e?.response?.status ||
                    e?.message ||
                    e
            );


            console.log(
                "[VSMOV SEGMENT PROXY ERROR] TOTAL MS:",
                Date.now() -
                    requestStartedAt
            );


            if (
                !res.headersSent
            ) {

                return res
                    .status(502)
                    .type("text/plain")
                    .send(
                        "VSmov segment proxy error"
                    );
            }


            try {

                res.destroy(
                    e
                );

            } catch (_) {}
        }
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
