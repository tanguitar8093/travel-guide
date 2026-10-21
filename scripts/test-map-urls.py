import sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from maps_urls import parse_map_link,validate_url,resolve_short_url
from urllib.error import HTTPError

class MapLinks(unittest.TestCase):
    def test_pin_priority(self):
        r=parse_map_link('https://www.google.com/maps/place/Oniku+no+Isshin/@26.2138897,127.6749745,17z/data=!3d26.2138849!4d127.6775494')
        self.assertEqual(r['name'],'Oniku no Isshin');self.assertEqual(r['coordinates'],[127.6775494,26.2138849]);self.assertTrue(r['inBounds'])
    def test_formats(self):
        for u in ['https://www.google.com/maps?q=26.21,127.68','https://www.google.com/maps?api=1&query=26.21%2C127.68','https://www.google.com/maps?ll=26.21,127.68','https://www.google.com/maps/embed?pb=!2d127.68!3d26.21','https://www.google.com/maps/embed?pb=!3d26.21!2d127.68']:
            with self.subTest(url=u):self.assertEqual(parse_map_link(u)['coordinates'],[127.68,26.21])
    def test_center_unnamed_and_outside(self):
        r=parse_map_link('https://www.google.com/maps/@26.21,127.68,17z');self.assertIsNone(r['name']);self.assertEqual(r['locationKind'],'map-center')
        r=parse_map_link('https://www.google.com/maps?q=25.033964,121.564468');self.assertFalse(r['inBounds']);self.assertIn('範圍',r['warning'])
    def test_short_redirect(self):
        r=parse_map_link('https://maps.app.goo.gl/test',resolver=lambda u:('https://www.google.com/maps/place/店名/!3d26.21!4d127.68',''))
        self.assertEqual(r['name'],'店名');self.assertTrue(r['inBounds'])
    def test_short_title_and_html_fallback(self):
        r=parse_map_link('https://maps.app.goo.gl/test',resolver=lambda u:('https://maps.app.goo.gl/test','<a href="https://www.google.com/maps?q=26.21,127.68">Go</a><title>店名 - Google Maps</title>'))
        self.assertEqual(r['name'],'店名')
    def test_invalid(self):
        for u in ['http://127.0.0.1/maps','https://www.google.com.evil.test/maps','https://www.google.com@127.0.0.1/maps','https://google.com:9000/maps','https://goo.gl/notmaps','https://www.google.com/maps?q=restaurant','https://www.google.com/maps?q=999,127.68']:
            with self.subTest(url=u):
                with self.assertRaises(ValueError):parse_map_link(u)
    def test_redirect_validation(self):
        error=HTTPError('https://maps.app.goo.gl/test',302,'Found',{'Location':'http://127.0.0.1/private'},None)
        with patch('maps_urls.build_opener') as builder:
            builder.return_value.open.side_effect=error
            with self.assertRaises(ValueError):resolve_short_url('https://maps.app.goo.gl/test')
            self.assertEqual(builder.return_value.open.call_count,1)

unittest.main()
