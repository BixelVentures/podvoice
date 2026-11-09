"""Serve the review and one pinned PodView renderer locally."""
import argparse
import functools
import http.server
import io
from ipaddress import IPv4Address
from pathlib import Path
import subprocess
import tarfile
import tempfile
from urllib.parse import parse_qs, unquote, urlsplit


HERE = Path(__file__).resolve().parent
RENDERER = 'podvoice/gatekeeper/static/podview'
BASELINE = '5cf897a4'
DEFAULT_REPO = next(parent for parent in HERE.parents if (parent / '.git').exists())
PREVIEW_PAGES = {'/index.html', '/library.html', '/setup.html'}
CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; "
    "media-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"
)


def handler_for(source, revision):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def translate_path(self, url):
            path = unquote(urlsplit(url).path)
            if path == '/assets/review-heartless.jpg':
                return str(HERE / 'references/heartless.jpg')
            root = HERE if path.startswith('/comparison/') else source
            suffix = path.removeprefix('/comparison/') if root == HERE else path.lstrip('/')
            target = (root / suffix).resolve()
            return str(target if target.is_relative_to(root) else root / '__unavailable__')

        def end_headers(self):
            self.send_header('Content-Security-Policy', CSP)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            super().end_headers()

        def send_head(self):
            url = urlsplit(self.path)
            if url.path == '/':
                if not url.query:
                    self.send_response(302)
                    self.send_header('Location', '/comparison/')
                    self.end_headers()
                    return None
                self.path = '/index.html?' + url.query
                url = urlsplit(self.path)

            if url.path == '/comparison/baseline.json':
                return self.send_bytes(('{"revision":"' + revision + '"}').encode(), 'application/json')

            if url.path in PREVIEW_PAGES:
                page = Path(self.translate_path(url.path)).read_text(encoding='utf-8')
                query = parse_qs(url.query)
                candidate = query.get('design') == ['candidate']
                mode = query.get('specimen') == ['1'] and url.path == '/library.html'
                # The fixture layer also blocks media before the application boots.
                additions = '<script src="/comparison/inert.js"></script>'
                additions += '<script type="module" src="/comparison/library-parity.js"></script>'
                if mode:
                    additions += '<link rel="stylesheet" href="/comparison/specimen.css">'
                if candidate:
                    additions += '<link rel="stylesheet" href="/comparison/candidate.css">'
                    additions += '<link rel="stylesheet" href="/comparison/component-parity.css">'
                    page = page.replace('<html lang="da">', '<html lang="da" data-design="candidate">', 1)
                page = page.replace('</head>', additions + '</head>', 1)
                return self.send_bytes(page.encode(), 'text/html; charset=utf-8')

            if Path(self.translate_path(url.path)).is_dir() and url.path != '/comparison/':
                self.send_error(404)
                return None
            return super().send_head()

        def send_bytes(self, data, content_type):
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            return io.BytesIO(data)

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=DEFAULT_REPO)
    parser.add_argument('--revision', default=BASELINE)
    parser.add_argument('--port', type=int, default=4392)
    parser.add_argument('--lan-host', type=IPv4Address, help='Bind to a private IPv4 address on this Mac')
    args = parser.parse_args()
    if args.lan_host and not args.lan_host.is_private:
        parser.error('--lan-host must be a private IPv4 address')
    host = str(args.lan_host) if args.lan_host else '127.0.0.1'
    git = functools.partial(subprocess.check_output, cwd=args.repo)
    revision = git(['git', 'rev-parse', '--verify', args.revision + '^{commit}']).decode().strip()
    archive = git(['git', 'archive', revision, RENDERER])

    with tempfile.TemporaryDirectory(prefix='podview-comparison-') as directory:
        with tarfile.open(fileobj=io.BytesIO(archive)) as content:
            content.extractall(directory, filter='data')
        source = (Path(directory) / RENDERER).resolve()
        with http.server.ThreadingHTTPServer((host, args.port), handler_for(source, revision)) as server:
            print(f'PodView {revision[:8]} · http://{host}:{args.port}/comparison/', flush=True)
            server.serve_forever()


if __name__ == '__main__':
    main()
