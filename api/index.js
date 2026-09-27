/* ============================================================
   VSMOV API
   SEARCH API
   DETAIL API
   ƯU TIÊN M3U8 TRỰC TIẾP
   FALLBACK EMBED
   GIỮ CẢ VIETSUB / 4K
   ============================================================ */

async function fetchVSMov(movieName) {

    const streams = [];

    try {

        console.log("========================================");
        console.log("[VSMOV] START");
        console.log("[VSMOV] Search:", movieName);

        if (!movieName) {
            return streams;
        }

        // ====================================================
        // 1. TITLE VARIANTS
        // ====================================================

        const original =
            String(movieName || "")
                .trim();

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

        // ====================================================
        // 2. NORMALIZE TITLE
        // ====================================================

        function normalizeTitle(text) {

            return String(text || "")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase()
                .replace(/đ/g, "d")
                .replace(/[^a-z0-9\s]/g, " ")
                .replace(/\s+/g, " ")
                .trim();

        }

        // ====================================================
        // 3. SEARCH VSMOV
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
                                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

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
                    "[VSMOV] SEARCH ERROR:",
                    e?.response?.status ||
                    e?.message ||
                    e
                );

            }

        }

        // ====================================================
        // 4. UNIQUE
        // ====================================================

        const uniqueCandidates = [];

        const seen =
            new Set();

        candidates.forEach(
            item => {

                const slug =
                    String(
                        item?.slug || ""
                    ).trim();

                if (
                    !slug ||
                    seen.has(slug)
                ) {
                    return;
                }

                seen.add(slug);

                uniqueCandidates.push(
                    item
                );

            }
        );

        // ====================================================
// 5. RANK
// ====================================================
//
// Ưu tiên:
// 1. origin_name khớp chính xác
// 2. name khớp chính xác
// 3. origin_name chứa title tìm kiếm
// 4. name chứa title tìm kiếm
//
// Rất quan trọng:
// Cinemeta thường gửi tên tiếng Anh.
// VSMov thường có:
//   name        = tên tiếng Việt
//   origin_name = tên gốc tiếng Anh
// ====================================================

const ranked =
    uniqueCandidates
        .map(item => {

            const normalizedName =
                normalizeTitle(
                    item?.name
                );

            const normalizedOrigin =
                normalizeTitle(
                    item?.origin_name ||
                    item?.original_name ||
                    ""
                );

            let score = 0;

            titleVariants.forEach(
                variant => {

                    const v =
                        normalizeTitle(
                            variant
                        );

                    if (!v) {
                        return;
                    }

                    // -----------------------------------------
                    // ORIGIN NAME
                    // -----------------------------------------

                    if (
                        normalizedOrigin === v
                    ) {

                        score += 1000;

                    }
                    else if (
                        normalizedOrigin.includes(v)
                    ) {

                        score += 300;

                    }
                    else if (
                        v.includes(normalizedOrigin) &&
                        normalizedOrigin.length >= 3
                    ) {

                        score += 150;

                    }

                    // -----------------------------------------
                    // VIETNAMESE / DISPLAY NAME
                    // -----------------------------------------

                    if (
                        normalizedName === v
                    ) {

                        score += 500;

                    }
                    else if (
                        normalizedName.includes(v)
                    ) {

                        score += 100;

                    }
                    else if (
                        v.includes(normalizedName) &&
                        normalizedName.length >= 3
                    ) {

                        score += 50;

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

                origin:
                    x.item?.origin_name ||
                    x.item?.original_name ||
                    "",

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
        // 7. SELECT
        // ====================================================

        const selected =
            ranked[0].item;

        const movieSlug =
            String(
                selected?.slug || ""
            ).trim();

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

        // ====================================================
        // 8. DETAIL API
        // ====================================================

        const detailUrl =
            "https://vsmov.com/api/phim/" +
            encodeURIComponent(
                movieSlug
            );

        let detailRes;

        try {

            detailRes =
                await axios.get(
                    detailUrl,
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

        } catch (e) {

            console.log(
                "[VSMOV] DETAIL ERROR:",
                e?.response?.status ||
                e?.message ||
                e
            );

            detailRes = null;

        }

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
        // 9. PROCESS SERVERS
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
                );

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
                    );

                // =================================================
                // A. DIRECT M3U8
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
                        episodeName
                    );

                    console.log(
                        "[VSMOV] M3U8:",
                        m3u8
                    );

                    streams.push({

                        name:
                            "⚡ [VSMov M3U8] " +
                            serverName,

                        title:
                            episodeName +
                            " - " +
                            serverName,

                        url:
                            m3u8,

                        behaviorHints: {

                            bingeGroup:
                                "vsmov-m3u8-" +
                                normalizeTitle(
                                    serverName
                                )

                        }

                    });

                    continue;

                }

                // =================================================
// B. EMBED FALLBACK
// =================================================

const embed =
    String(
        ep?.link_embed ||
        ep?.embed ||
        ""
    ).trim();

if (
    embed &&
    /^https?:\/\//i.test(embed)
) {

    console.log(
        "[VSMOV] EMBED FALLBACK:",
        serverName,
        episodeName
    );

    console.log(
        "[VSMOV] EMBED:",
        embed
    );

    const widgetUrl =
        "https://my-strem-addon.vercel.app/vsmov-player?url=" +
        encodeURIComponent(embed);

    console.log(
        "[VSMOV] WIDGET:",
        widgetUrl
    );

    streams.push({
    name:
        "▶️ [VSMov] " +
        serverName,

    title:
        episodeName ||
        "Full",

    externalUrl:
        widgetUrl,

    widgetPlayer:
        widgetUrl,

    widgetPlayerStates: [
        "replaceplayer"
    ]
});
}
}
}
        // ====================================================
        // 10. FALLBACK ĐÚNG TRANG PHIM
        // ====================================================

        if (
            streams.length === 0
        ) {

            const movieUrl =
                "https://vsmov.com/phim/" +
                encodeURIComponent(
                    movieSlug
                );

            console.log(
                "[VSMOV] No stream."
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
        // 11. FINAL
        // ====================================================

        console.log(
            "[VSMOV] FINAL STREAM COUNT:",
            streams.length
        );

        console.log(
            "[VSMOV] FINAL STREAMS:",
            JSON.stringify(
                streams
            )
        );

        return streams;

    } catch (e) {

        console.log(
            "[VSMOV FATAL]",
            e?.response?.status ||
            e?.message ||
            e
        );

        streams.push({

            name:
                "🔎 [Fallback Search] VSmov",

            title:
                "Tìm phim trên VSmov - " +
                movieName,

            externalUrl:
                "https://vsmov.com/?search=" +
                encodeURIComponent(
                    movieName
                )

        });

        return streams;

    }

}
