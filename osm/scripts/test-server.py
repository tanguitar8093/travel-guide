"""Exercise HTTP responses and expected client disconnects without map data."""
import io
import json
from pathlib import Path
import sys
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class RequestSocket:
    def __init__(self, request, error=None, fail_at=1):
        self.request = request
        self.error = error
        self.fail_at = fail_at
        self.writes = []

    def makefile(self, mode, buffering):
        return io.BytesIO(self.request)

    def sendall(self, body):
        self.writes.append(bytes(body))
        if self.error is not None and len(self.writes) == self.fail_at:
            raise self.error


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.router = patch.object(server, 'load_dataset', return_value={
            'router': SimpleNamespace(timestamp='test', ways=[1,2]), 'search':None,'tiles':None,
            'roads':Path('/missing'), 'compact':Path('/missing'),
        })
        self.router.start()
        self.addCleanup(self.router.stop)
        self.search = patch.object(server, 'SEARCH', None)
        self.search.start()
        self.addCleanup(self.search.stop)
        self.log = patch.object(server.Handler, 'log_message')
        self.messages = self.log.start()
        self.addCleanup(self.log.stop)

    def handle(self, request, error=None, fail_at=1):
        connection = RequestSocket(request, error, fail_at)
        handler = server.Handler(connection, ('127.0.0.1', 12345), None)
        return handler, connection

    def test_route_budget_is_retryable_503_not_a_distance_rejection(self):
        from routing import RouteSearchLimit
        from unittest.mock import Mock
        router=SimpleNamespace(lock=threading.RLock(),route=Mock(side_effect=RouteSearchLimit()))
        body=json.dumps({'points':[[127.68,26.21],[127.70,26.21]],'mode':'car'}).encode()
        request=b'POST /api/route HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: '+str(len(body)).encode()+b'\r\n\r\n'+body
        with patch.object(server,'dataset_router',return_value=router):
            _,connection=self.handle(request)
        headers,response=b''.join(connection.writes).split(b'\r\n\r\n',1)
        self.assertIn(b'503 Service Unavailable',headers)
        result=json.loads(response)
        self.assertEqual(result['code'],'ROUTE_SEARCH_LIMIT')
        self.assertTrue(result['retryable'])
        self.assertNotIn('過大',result['error'])

    def test_health_response(self):
        _, connection = self.handle(b'GET /api/health HTTP/1.0\r\n\r\n')
        headers, body = b''.join(connection.writes).split(b'\r\n\r\n', 1)
        self.assertIn(b'200 OK', headers)
        self.assertEqual(int(headers.split(b'Content-Length: ')[1].split(b'\r\n')[0]), len(body))
        health = json.loads(body)
        self.assertTrue(health['ok'])
        self.assertEqual(health['datasetId'], 'okinawa')

    def test_head_response(self):
        _, connection = self.handle(b'HEAD /api/health HTTP/1.0\r\n\r\n')
        headers, body = b''.join(connection.writes).split(b'\r\n\r\n', 1)
        self.assertIn(b'200 OK', headers)
        self.assertEqual(body, b'')

    def test_disconnect_during_headers_or_body(self):
        for error in (BrokenPipeError, ConnectionResetError):
            for fail_at in (1, 2):
                with self.subTest(error=error, fail_at=fail_at):
                    self.messages.reset_mock()
                    handler, connection = self.handle(
                        b'GET /api/health HTTP/1.0\r\n\r\n', error(), fail_at
                    )
                    self.assertTrue(handler.close_connection)
                    self.assertEqual(len(connection.writes), fail_at)
                    self.messages.assert_any_call(
                        'Client disconnected before request completed'
                    )

    def test_head_and_post_disconnects(self):
        for request in (
            b'HEAD /api/health HTTP/1.0\r\n\r\n',
            b'POST /unknown HTTP/1.0\r\n\r\n',
        ):
            with self.subTest(request=request):
                handler, connection = self.handle(request, BrokenPipeError())
                self.assertTrue(handler.close_connection)
                self.assertEqual(len(connection.writes), 1)

    def test_static_disconnect_does_not_send_another_response(self):
        for error in (BrokenPipeError, ConnectionResetError):
            with self.subTest(error=error):
                with patch.object(server.Handler, 'send_static', side_effect=error()):
                    handler, connection = self.handle(b'GET / HTTP/1.0\r\n\r\n')
                self.assertTrue(handler.close_connection)
                self.assertEqual(connection.writes, [])
                self.messages.assert_any_call(
                    'Client disconnected before request completed'
                )

    def test_missing_static_file_still_returns_503(self):
        with patch.object(server.Handler, 'send_static', side_effect=FileNotFoundError()):
            _, connection = self.handle(b'GET / HTTP/1.0\r\n\r\n')
        self.assertIn(b'503 Service Unavailable', b''.join(connection.writes))

    def test_unrelated_errors_are_not_suppressed(self):
        for error in (OSError('unexpected I/O failure'), RuntimeError('unexpected bug')):
            with self.subTest(error=error):
                with self.assertRaises(type(error)):
                    self.handle(b'GET /api/health HTTP/1.0\r\n\r\n', error)


if __name__ == '__main__':
    unittest.main()
