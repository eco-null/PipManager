import os
import sys
import json
import re
import shutil
import threading
import time
import webbrowser
import subprocess
from http.server import HTTPServer, BaseHTTPRequestHandler
import importlib.metadata
from pathlib import Path
import urllib.parse

# --- Server & Security Configuration ---

PORT = 49150
CACHE_FILE = ".pip_manager_cache.json"
ALLOWED_ORIGINS = {f"http://localhost:{PORT}", f"http://127.0.0.1:{PORT}"}

CORE_PACKAGES = {
    'pip', 'setuptools', 'wheel', 'distribute', 'virtualenv',
    'conda', 'setuptools-scm', 'pkg-resources'
}

cache_lock = threading.Lock()
execution_lock = threading.Lock()

packages_cache = {}
stats_cache = {}
site_packages_path = None

# --- Sanitization & Normalization ---

def normalize_name(name):
    if not name:
        return ""
    return name.lower().replace('_', '-').replace('.', '-')

def is_safe_pip_spec(spec):
    if not spec or not isinstance(spec, str):
        return False
    s = spec.strip()
    if s.startswith('-') or ';' in s or '&' in s or '|' in s or '`' in s or '$' in s or '\\' in s:
        return False
    return bool(re.match(r'^[a-zA-Z0-9][a-zA-Z0-9_.-]*(?:\[[a-zA-Z0-9_.,-]+\])?(?:[<>=!~]+[a-zA-Z0-9_.*+-]+)?$', s))

def parse_requirement_name(req_str):
    name = req_str.split(';')[0]
    name = name.split('[')[0]
    name = re.split(r'[<>=!~ ]', name)[0]
    return normalize_name(name.strip())

# --- Disk & Cache Operations ---

def load_disk_size_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, dict):
                    if "sizes" in data or "kept_packages" in data:
                        return data.get("sizes", {}), data.get("kept_packages", [])
                    return data, []
        except Exception:
            return {}, []
    return {}, []

def save_disk_size_cache(cache_data, kept_packages):
    try:
        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump({
                "sizes": cache_data,
                "kept_packages": kept_packages
            }, f, indent=2)
    except Exception:
        pass

def get_disk_statistics(path):
    try:
        stat = shutil.disk_usage(path)
        return {
            "total_bytes": stat.total,
            "used_bytes": stat.used,
            "free_bytes": stat.free,
            "percentage": round((stat.used / stat.total) * 100, 1)
        }
    except Exception:
        return {
            "total_bytes": 0,
            "used_bytes": 0,
            "free_bytes": 0,
            "percentage": 0
        }

# --- Package Discovery & Inspection ---

def scan_packages():
    global packages_cache, stats_cache, site_packages_path
    with cache_lock:
        dists = list(importlib.metadata.distributions())
        disk_cache, kept_packages = load_disk_size_cache()

        packages = {}
        cache_updated = False

        site_dirs = [Path(p) for p in sys.path if 'site-packages' in p or 'dist-packages' in p]

        for dist in dists:
            norm_name = normalize_name(dist.name)
            ver = dist.version
            cache_key = f"{norm_name}=={ver}"

            if not site_packages_path:
                try:
                    site_packages_path = str(dist.locate_file(''))
                except Exception:
                    pass

            if cache_key in disk_cache:
                cached_info = disk_cache[cache_key]
                size_bytes = cached_info["size"]
                files_count = cached_info.get("files", 0)
            else:
                size_bytes = 0
                files_count = 0
                if dist.files:
                    files_count = len(dist.files)
                    for f in dist.files:
                        try:
                            abs_path = dist.locate_file(f)
                            if abs_path.exists():
                                size_bytes += abs_path.stat().st_size
                        except Exception:
                            pass
                else:
                    dist_path = getattr(dist, '_path', None)
                    if dist_path and dist_path.exists():
                        try:
                            size_bytes += sum(f.stat().st_size for f in dist_path.rglob('*') if f.is_file())
                            top_level_file = dist_path / 'top_level.txt'
                            if top_level_file.exists():
                                mod_names = [line.strip() for line in top_level_file.read_text(encoding='utf-8', errors='ignore').splitlines() if line.strip()]
                                for mod in mod_names:
                                    for s_dir in site_dirs:
                                        cand_dir = s_dir / mod
                                        cand_file = s_dir / f"{mod}.py"
                                        if cand_dir.exists() and cand_dir.is_dir():
                                            size_bytes += sum(f.stat().st_size for f in cand_dir.rglob('*') if f.is_file())
                                            files_count += sum(1 for _ in cand_dir.rglob('*') if _.is_file())
                                        elif cand_file.exists():
                                            size_bytes += cand_file.stat().st_size
                                            files_count += 1
                        except Exception:
                            pass

                disk_cache[cache_key] = {
                    "size": size_bytes,
                    "files": files_count
                }
                cache_updated = True

            urls = []
            if dist.metadata.get('Home-page'):
                urls.append({"label": "Homepage", "url": dist.metadata.get('Home-page')})
            project_urls = dist.metadata.get_all('Project-URL')
            if project_urls:
                for p_url in project_urls:
                    if ',' in p_url:
                        parts = p_url.split(',', 1)
                        label = parts[0].strip()
                        url = parts[1].strip()
                        urls.append({"label": label, "url": url})
                    elif 'http' in p_url:
                        parts = p_url.split('http', 1)
                        label = parts[0].strip().rstrip(':').rstrip(',') or "Project Link"
                        url = "http" + parts[1].strip()
                        urls.append({"label": label, "url": url})

            installed_at = None
            try:
                inst_f = dist.locate_file('INSTALLER')
                inst_p = Path(str(inst_f))
                if inst_p.exists():
                    installed_at = inst_p.stat().st_mtime
                elif dist.files:
                    f0_p = Path(str(dist.locate_file(list(dist.files)[0])))
                    if f0_p.exists():
                        installed_at = f0_p.stat().st_mtime
            except Exception:
                pass

            license_str = dist.metadata.get('License') or dist.metadata.get('Classifier') or "Unknown"

            packages[norm_name] = {
                "name": dist.name,
                "norm_name": norm_name,
                "version": ver,
                "summary": dist.metadata.get('Summary') or "No description provided.",
                "author": dist.metadata.get('Author') or dist.metadata.get('Author-email') or "Unknown",
                "license": license_str,
                "size_bytes": size_bytes,
                "files_count": files_count,
                "urls": urls,
                "dependencies": [],
                "required_by": [],
                "is_core": norm_name in CORE_PACKAGES,
                "is_kept": norm_name in kept_packages,
                "installed_at": installed_at,
                "location": str(dist.locate_file(''))
            }

        for norm_name, info in packages.items():
            dist = next((d for d in dists if normalize_name(d.name) == norm_name), None)
            if not dist:
                continue

            reqs = dist.requires or []
            for req in reqs:
                dep_name = parse_requirement_name(req)
                if dep_name and dep_name in packages:
                    if dep_name not in info["dependencies"]:
                        info["dependencies"].append(dep_name)
                    if norm_name not in packages[dep_name]["required_by"]:
                        packages[dep_name]["required_by"].append(norm_name)

        if cache_updated:
            save_disk_size_cache(disk_cache, kept_packages)

        total_size = sum(p["size_bytes"] for p in packages.values())
        orphans = [p for p in packages.values() if not p["required_by"] and not p["is_core"] and not p.get("is_kept", False)]
        orphans_size = sum(p["size_bytes"] for p in orphans)

        packages_cache = packages
        disk_stats = get_disk_statistics(site_packages_path or os.getcwd())

        stats_cache = {
            "total_packages": len(packages),
            "total_size_bytes": total_size,
            "orphan_packages_count": len(orphans),
            "orphan_size_bytes": orphans_size,
            "disk": disk_stats,
            "python_version": sys.version.split()[0],
            "site_packages_path": site_packages_path or "Unknown"
        }

# --- Dependency Simulation & Actions ---

def simulate_uninstall(target_names):
    targets = [normalize_name(t) for t in target_names if is_safe_pip_spec(t)]
    temp_required_by = {}
    for name, info in packages_cache.items():
        temp_required_by[name] = set(info["required_by"])

    cascade_orphans = set()
    queue = list(targets)
    processed = set()

    while queue:
        current = queue.pop(0)
        if current in processed:
            continue
        processed.add(current)

        if current in packages_cache:
            deps = packages_cache[current]["dependencies"]
            for dep in deps:
                if dep in temp_required_by:
                    temp_required_by[dep].discard(current)
                    if len(temp_required_by[dep]) == 0 and dep not in targets and dep not in processed:
                        if not packages_cache[dep]["is_core"]:
                            cascade_orphans.add(dep)
                            queue.append(dep)

    return list(cascade_orphans)

def perform_install(specifiers):
    with execution_lock:
        if not specifiers:
            return False, "No package specified."

        safe_specs = []
        for s in specifiers:
            clean = s.strip()
            if not is_safe_pip_spec(clean):
                return False, f"Invalid or unsafe package specification: '{clean}'"
            safe_specs.append(clean)

        cmd = [sys.executable, "-m", "pip", "install"] + safe_specs
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            success = (res.returncode == 0)
            return success, res.stdout if success else f"Pip error (code {res.returncode}):\n{res.stderr or res.stdout}"
        except Exception as e:
            return False, f"Failed to execute pip install: {str(e)}"

def perform_upgrade(package_names):
    with execution_lock:
        if not package_names:
            return True, "No packages selected."

        names = [normalize_name(p) for p in package_names if is_safe_pip_spec(p)]
        if not names:
            return False, "Invalid package names provided."

        actual_names = []
        for n in names:
            if n in packages_cache:
                actual_names.append(packages_cache[n]["name"])
            else:
                actual_names.append(n)

        cmd = [sys.executable, "-m", "pip", "install", "--upgrade"] + actual_names

        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            success = (res.returncode == 0)

            try:
                disk_cache, kept_packages = load_disk_size_cache()
                for n in names:
                    keys_to_del = [k for k in disk_cache if k.startswith(f"{n}==")]
                    for k in keys_to_del:
                        disk_cache.pop(k, None)
                save_disk_size_cache(disk_cache, kept_packages)
            except Exception:
                pass

            return success, res.stdout if success else f"Pip exit code: {res.returncode}\n\nOutput:\n{res.stdout}\n\nError:\n{res.stderr}"
        except Exception as e:
            return False, f"Failed to execute pip command: {str(e)}"

def perform_uninstall(package_names):
    with execution_lock:
        if not package_names:
            return True, "No packages selected."

        names = [normalize_name(p) for p in package_names if is_safe_pip_spec(p)]
        if not names:
            return False, "Invalid package names provided."

        actual_names = []
        for n in names:
            if n in packages_cache:
                actual_names.append(packages_cache[n]["name"])
            else:
                actual_names.append(n)

        cmd = [sys.executable, "-m", "pip", "uninstall", "-y"] + actual_names

        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            success = (res.returncode == 0)

            try:
                disk_cache, kept_packages = load_disk_size_cache()
                for n in names:
                    keys_to_del = [k for k in disk_cache if k.startswith(f"{n}==")]
                    for k in keys_to_del:
                        disk_cache.pop(k, None)
                    if n in kept_packages:
                        kept_packages.remove(n)
                save_disk_size_cache(disk_cache, kept_packages)
            except Exception:
                pass

            return success, res.stdout if success else f"Pip exit code: {res.returncode}\n\nOutput:\n{res.stdout}\n\nError:\n{res.stderr}"
        except Exception as e:
            return False, f"Failed to execute pip command: {str(e)}"

# --- HTTP Request Handler ---

class PipManagerHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        origin = self.headers.get('Origin')
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_OPTIONS(self):
        origin = self.headers.get('Origin')
        if origin and origin not in ALLOWED_ORIGINS:
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(200)
        if origin:
            self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path

        if path in ('/', '/index.html'):
            self.serve_static('frontend/index.html', 'text/html; charset=utf-8')
        elif path == '/index.css':
            self.serve_static('frontend/index.css', 'text/css; charset=utf-8')
        elif path == '/index.js':
            self.serve_static('frontend/index.js', 'application/javascript; charset=utf-8')
        elif path == '/api/packages':
            query = urllib.parse.parse_qs(url.query)
            if 'refresh' in query and query['refresh'][0] == 'true':
                scan_packages()
            with cache_lock:
                self.send_json(list(packages_cache.values()))
        elif path == '/api/stats':
            with cache_lock:
                self.send_json(stats_cache)
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not Found")

    def do_HEAD(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path
        if path in ('/', '/index.html', '/index.css', '/index.js'):
            self.send_response(200)
            self.send_header('Content-Type', 'text/html' if path in ('/', '/index.html') else ('text/css' if path == '/index.css' else 'application/javascript'))
            self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        origin = self.headers.get('Origin')
        if origin and origin not in ALLOWED_ORIGINS:
            self.send_json({"success": False, "error": "Forbidden origin"}, status=403)
            return

        url = urllib.parse.urlparse(self.path)
        path = url.path

        try:
            content_length = int(self.headers.get('Content-Length', 0))
        except (TypeError, ValueError):
            content_length = 0

        post_data = self.rfile.read(content_length)

        try:
            body = json.loads(post_data.decode('utf-8'))
        except Exception:
            body = {}

        if path == '/api/dry-run':
            packages = body.get('packages', [])
            cascade = simulate_uninstall(packages)
            cascade_details = []
            with cache_lock:
                for c in cascade:
                    if c in packages_cache:
                        p = packages_cache[c]
                        cascade_details.append({
                            "name": p["name"],
                            "norm_name": p["norm_name"],
                            "version": p["version"],
                            "size_bytes": p["size_bytes"]
                        })
            self.send_json({"cascade": cascade_details})

        elif path == '/api/install':
            package_spec = body.get('package', '').strip()
            specs = [package_spec] if package_spec else body.get('packages', [])
            success, output = perform_install(specs)
            if success:
                scan_packages()
            self.send_json({"success": success, "output": output})

        elif path == '/api/uninstall':
            packages = body.get('packages', [])
            success, output = perform_uninstall(packages)
            if success:
                scan_packages()
            self.send_json({"success": success, "output": output})

        elif path == '/api/upgrade':
            packages = body.get('packages', [])
            success, output = perform_upgrade(packages)
            if success:
                scan_packages()
            self.send_json({"success": success, "output": output})

        elif path == '/api/keep':
            pkg_name = normalize_name(body.get('package', ''))
            is_kept = body.get('keep', True)

            disk_cache, kept_packages = load_disk_size_cache()
            if is_kept and pkg_name not in kept_packages:
                kept_packages.append(pkg_name)
            elif not is_kept and pkg_name in kept_packages:
                kept_packages.remove(pkg_name)

            save_disk_size_cache(disk_cache, kept_packages)
            scan_packages()
            self.send_json({"success": True, "is_kept": is_kept})

        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Endpoint Not Found")

    def serve_static(self, file_path, content_type):
        try:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            full_path = os.path.join(base_dir, file_path)

            if os.path.exists(full_path):
                with open(full_path, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
                self.end_headers()
                self.wfile.write(content)
            else:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"Asset Not Found")
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(str(e).encode('utf-8'))

# --- Runner & Lifecycle ---

def open_browser():
    time.sleep(1)
    url = f"http://localhost:{PORT}"
    print(f"\nOpening {url} in your browser...")
    webbrowser.open(url)

if __name__ == '__main__':
    no_browser = '--no-open' in sys.argv or os.environ.get('NO_OPEN') == '1'
    print("Initializing Pip Module Manager...")
    print("Scanning python environment packages...")
    scan_packages()

    server = HTTPServer(('localhost', PORT), PipManagerHandler)
    print(f"Pip Manager running on http://localhost:{PORT}")

    if not no_browser:
        threading.Thread(target=open_browser, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down Pip Manager gracefully.")
        server.server_close()
