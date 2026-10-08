# Minimal stand-in for POST /v1/projects/<ref>/database/query, backed by a local psql.
# Plain SELECTs come back as JSON rows; anything else runs as a script and returns [].
import json, subprocess, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
PSQL = sys.argv[2:]  # psql command prefix
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        q = json.loads(self.rfile.read(int(self.headers['Content-Length'])))['query']
        if self.headers.get('Authorization') != 'Bearer test-token':
            return self.reply(401, {'message': 'bad token'})
        single_select = q.strip().lower().startswith('select') and ';' not in q.strip().rstrip(';')
        sql = f"select coalesce(json_agg(t), '[]') from ({q.strip().rstrip(';')}) t" if single_select else q
        p = subprocess.run(PSQL + ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
        if p.returncode: return self.reply(400, {'message': p.stderr.strip()[-400:]})
        self.reply(200, json.loads(p.stdout) if single_select else [])
    def reply(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code)
        self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
HTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
