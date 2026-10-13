#!/usr/bin/env python3

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


class GifRequestHandler(BaseHTTPRequestHandler):
    server_version = 'DCRMockCamera/1.0'

    def do_GET(self):
        if urlparse(self.path).path not in {'/', '/stream'}:
            self.send_error(404, 'Mock camera stream not found')
            return

        image_path = self.server.image_path
        try:
            image = image_path.read_bytes()
        except OSError:
            self.send_error(503, 'Mock camera image is unavailable')
            return

        self.send_response(200)
        self.send_header('Content-Type', 'image/gif')
        self.send_header('Content-Length', str(len(image)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(image)

    def log_message(self, format, *args):
        print(f'[{self.server.server_port}] {self.address_string()} - {format % args}')


def main():
    parser = argparse.ArgumentParser(description='Serve one canned GIF as a mock camera feed.')
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--image', type=Path, required=True)
    args = parser.parse_args()

    server = ThreadingHTTPServer(('0.0.0.0', args.port), GifRequestHandler)
    server.image_path = args.image

    print(f'Serving {args.image} on http://0.0.0.0:{args.port}/?action=stream')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
