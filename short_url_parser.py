import re
from urllib.parse import unquote
import requests


def parse_google_maps_short_url(short_url: str):
    # 1. 追蹤短網址轉址，取得展開後的完整 URL
    # headers 模擬一般瀏覽器，避免被阻擋
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
    }
    response = requests.head(
        short_url, allow_redirects=True, headers=headers, timeout=10
    )
    long_url = response.url

    # 2. 從長網址抓取店名
    name_match = re.search(r"/place/([^/@?]+)", long_url)
    place_name = (
        unquote(name_match.group(1)).replace("+", " ") if name_match else None
    )

    # 3. 抓取精確標記座標 (!3d 緯度, !4d 經度)
    coord_match = re.search(r"!3d([-0-9.]+)!4d([-0-9.]+)", long_url)

    if coord_match:
        lat = float(coord_match.group(1))
        lng = float(coord_match.group(2))
    else:
        # 備援：若部分地點網址只有 @lat,lng 視窗中心點
        center_match = re.search(r"@([-0-9.]+),([-0-9.]+)", long_url)
        lat = float(center_match.group(1)) if center_match else None
        lng = float(center_match.group(2)) if center_match else None

    return {
        "name": place_name,
        "lat": lat,
        "lng": lng,
        "expanded_url": long_url,
    }


# 測試手機分享的短網址
short_url = "https://maps.app.goo.gl/qcLQB2qV68gbqo4D7"  # 替換為你的短網址
result = parse_google_maps_short_url(short_url)

print(result)
# 輸出範例：{'name': '店名', 'lat': 26.2138849, 'lng': 127.6775494, 'expanded_url': '...'}