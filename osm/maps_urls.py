from datasets import inside as inside_dataset
"""Validate Google Maps URLs and expose sp2's parsing to the local demo."""
import html
import math
import re
import time
from urllib.parse import urlsplit, urljoin, unquote
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler
from urllib.error import HTTPError, URLError
from routing import BOUNDS
from sp2 import parse_google_maps_url

SHORT_HOSTS = {'maps.app.goo.gl','goo.gl'}
LONG_HOSTS = {'google.com','www.google.com','maps.google.com','google.co.jp','www.google.co.jp','maps.google.co.jp','google.com.tw','www.google.com.tw','maps.google.com.tw'}


def validate_url(value):
    if not isinstance(value,str) or not value or len(value)>8192:
        raise ValueError('請輸入有效的 Google 地圖網址。')
    value=value.strip()
    if not re.match(r'^https?://',value,re.I):
        value='https://'+value
    parsed=urlsplit(value)
    try:
        port=parsed.port
    except ValueError:
        raise ValueError('請輸入有效的 Google 地圖網址。') from None
    host=(parsed.hostname or '').lower()
    if parsed.scheme not in {'https','http'} or port not in {None,80,443} or parsed.username or parsed.password:
        raise ValueError('請輸入有效的 Google 地圖網址。')
    if host not in SHORT_HOSTS|LONG_HOSTS:
        raise ValueError('僅支援 Google 地圖網址。')
    if host=='goo.gl' and not parsed.path.startswith('/maps/'):
        raise ValueError('請貼上 goo.gl/maps 地圖分享網址。')
    if host in LONG_HOSTS and not (parsed.path=='/maps' or parsed.path.startswith('/maps/') or host.startswith('maps.')):
        raise ValueError('請貼上 Google 地圖地點或分享網址。')
    return value


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None


def resolve_short_url(value):
    """Only fetch allowlisted map hosts, including every redirect; bounded reads/time."""
    opener=build_opener(ProxyHandler({}),NoRedirect())
    target=validate_url(value)
    deadline=time.monotonic()+15
    for _ in range(7):
        remaining=deadline-time.monotonic()
        if remaining<=0:
            raise ValueError('短網址連線逾時，請改貼完整 Google 地圖網址。')
        request=Request(target,headers={'User-Agent':'Mozilla/5.0','Accept-Language':'zh-TW,zh;q=0.9,en;q=0.7'})
        try:
            response=opener.open(request,timeout=min(remaining,5))
        except HTTPError as error:
            if error.code in {301,302,303,307,308}:
                location=error.headers.get('Location')
                error.close()
                if not location:
                    raise ValueError('短網址缺少轉址位置。')
                target=validate_url(urljoin(target,location))
                continue
            error.close()
            raise ValueError('短網址無法開啟，請改貼完整 Google 地圖網址。') from None
        except (URLError,TimeoutError,OSError):
            raise ValueError('短網址連線失敗，請改貼完整 Google 地圖網址。') from None
        with response:
            body=response.read(1024*1024+1)
            if len(body)>1024*1024:
                body=body[:1024*1024]
            content=body.decode('utf-8',errors='replace')
        if urlsplit(target).hostname in SHORT_HOSTS:
            match=re.search(r'<a\s+(?:[^>]*?\s+)?href="([^"]*google\.com/maps[^"]*)"',content)
            if match:
                target=validate_url(html.unescape(match.group(1)))
        return target,content
    raise ValueError('短網址轉址次數過多，請改貼完整網址。')


def parse_map_link(value,resolver=None,dataset='okinawa'):
    url=validate_url(value)
    parsed=parse_google_maps_url(url,resolver=resolver)
    lat,lng=parsed['lat'],parsed['lng']
    if lat is None or lng is None:
        raise ValueError('無法取得地址：網址中找不到經緯度，請改貼地點分享網址或帶座標的完整網址。')
    if not math.isfinite(lat) or not math.isfinite(lng) or not -90<=lat<=90 or not -180<=lng<=180:
        raise ValueError('網址中的經緯度無效。')
    inside=inside_dataset([lng,lat],dataset)
    name=html.unescape(parsed['name']).strip() if parsed['name'] else None
    return {'name':name,'lat':lat,'lng':lng,'coordinates':[lng,lat],'inBounds':inside,'bounds':BOUNDS,'resolved_url':parsed['resolved_url'],'locationKind':parsed.get('locationKind') or 'url-coordinate','warning':None if inside else '此地點不在目前選擇的圖資範圍內，無法加入行程。'}
