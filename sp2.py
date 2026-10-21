import re
from urllib.parse import parse_qs, unquote, urlparse


def parse_google_maps_url(url: str, resolver=None) -> dict:
    # 1. 若是短網址 (maps.app.goo.gl 或 goo.gl)，先追蹤轉址取得完整長網址
    target_url = url
    html_content = ""

    if "goo.gl" in url:
        try:
            if resolver is None:
                from maps_urls import resolve_short_url
                resolver = resolve_short_url
            target_url, html_content = resolver(url)

            # 備援：若仍停留在短網址，從 HTML 的 a 標籤提取真實目標
            if "goo.gl" in target_url:
                html_link = re.search(
                    r'<a\s+(?:[^>]*?\s+)?href="([^"]*google\.com/maps[^"]*)"',
                    html_content,
                )
                if html_link:
                    target_url = html_link.group(1)
        except Exception as e:
            raise ValueError("短網址轉址失敗，請確認網路或改貼完整 Google 地圖網址。") from e

    # 2. 提取關鍵字 / 店名 (優先從 /place/ 或 /search/ 抓取)
    target_url = unquote(target_url)
    name = None
    name_match = re.search(r"/(?:place|search)/([^/@?]+)", target_url)
    if name_match:
        name = unquote(name_match.group(1)).replace("+", " ").strip()

    # 3. 按照精準度優先級提取經緯度
    lat, lng = None, None
    location_kind = None

    # (A) 優先：精確地標釘選點 (!3d緯度!4d經度)
    m = re.search(r"!3d([-0-9.]+)!4d([-0-9.]+)", target_url)
    if m:
        lat, lng = float(m.group(1)), float(m.group(2))
        location_kind = "pin"

    # (B) 次選：嵌入式地圖 (!1d經度!2d緯度 或 !3d緯度!2d經度)
    if lat is None:
        m = re.search(r"!3d([-0-9.]+)!2d([-0-9.]+)", target_url)
        if m:
            lat, lng = float(m.group(1)), float(m.group(2))
        else:
            m = re.search(r"!2d([-0-9.]+)!3d([-0-9.]+)", target_url)
            if m:
                lng, lat = float(m.group(1)), float(m.group(2))

    # (C) 三選：Query 參數 (?q=緯度,經度 或 ll=緯度,經度)
    if lat is None:
        parsed_query = parse_qs(urlparse(target_url).query)
        coord_query = parsed_query.get("q", [None])[0] or parsed_query.get(
            "ll", [None]
        )[0]
        if coord_query:
            m = re.search(r"^([-0-9.]+),([-0-9.]+)$", coord_query)
            if m:
                lat, lng = float(m.group(1)), float(m.group(2))
            elif not name:
                # 若 q 參數不是經緯度而是文字搜尋詞，拿來當名稱
                name = unquote(coord_query).replace("+", " ").strip()

    # Google Maps API query=lat,lng、ll=lat,lng、嵌入 q=... 補充。
    parsed_query = parse_qs(urlparse(target_url).query)
    if lat is None:
        for key in ("query", "q", "ll"):
            value = parsed_query.get(key, [""])[0].strip()
            m = re.fullmatch(r"([-+0-9.]+)\s*,\s*([-+0-9.]+)", value)
            if m:
                lat, lng = float(m.group(1)), float(m.group(2))
                location_kind = "query-coordinate"
                break
    if not name:
        value = parsed_query.get("query", parsed_query.get("q", [""]))[0]
        if value and not re.fullmatch(r"[-+0-9.]+\s*,\s*[-+0-9.]+", value):
            name = value.strip()

    # (D) 底線備援：地圖視窗中心點 (@緯度,經度)
    if lat is None:
        m = re.search(r"@([-0-9.]+),([-0-9.]+)", target_url)
        if m:
            lat, lng = float(m.group(1)), float(m.group(2))
            location_kind = "map-center"

    # 4. 若網址抓不到名稱但有抓到 HTML，嘗試從網頁 <title> 補回名稱
    if not name and html_content:
        title_match = re.search(r"<title>(.*?)</title>", html_content)
        if title_match:
            raw_title = title_match.group(1)
            name = re.sub(
                r"\s*-\s*Google\s*(?:地圖|Maps).*", "", raw_title
            ).strip()

    return {"name": name, "lat": lat, "lng": lng, "resolved_url": target_url, "locationKind": location_kind}

if __name__ == "__main__":
    urls = [
        # 1. 手機短網址
        "https://maps.app.goo.gl/BduuXLStMNQ1723X7",
        # 2. 電腦版完整地標長網址
        "https://www.google.com/maps/place/Oniku+no+Isshin/@26.2138897,127.6749745,17z/data=!3m2!4b1!5s0x34e5699c2368be7f:0xd4d1a4f82b8aabec!4m6!3m5!1s0x34e5699c235bc62d:0xbc3576aac053eb4!8m2!3d26.2138849!4d127.6775494!16s%2Fg%2F1thc_kll",
        # 3. 搜尋帶座標參數的網址
        "https://www.google.com/maps?q=25.033964,121.564468",
        # 4. 純視窗中心點（無店名）
        "https://www.google.com/maps/@25.033964,121.564468,17z",
        # 5. 嵌入式地圖網址
        "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3615.002!2d121.564468!3d25.033964!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMjXCsDAyJzAyLjMiTiAxMjHCsDMzJzUyLjEiRQ!5e0!3m2!1szh-TW!2stw!4v1234567890",
    ]

    for u in urls:
        result = parse_google_maps_url(u)
        print(f"名稱: {result['name']} | 座標: ({result['lat']}, {result['lng']})")

    # 如果找不到座標就顯示無法取得地址
    # 如果名稱是 None 名稱輸入框就留空白讓使用者自己填
