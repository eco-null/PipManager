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

# Port to run the server on
PORT = 49150  # Using a unique port to avoid conflicts
CACHE_FILE = ".pip_manager_cache.json"

# Only same-machine origins may call the local API (blocks cross-site requests)
ALLOWED_ORIGINS = {f"http://localhost:{PORT}", f"http://127.0.0.1:{PORT}"}

# Core packages that should not be deleted without warning
CORE_PACKAGES = {
    'pip', 'setuptools', 'wheel', 'distribute', 'virtualenv', 
    'conda', 'setuptools-scm', 'pkg-resources'
}

# Thread locks
cache_lock = threading.Lock()
execution_lock = threading.Lock()

# Cached data
packages_cache = {}
stats_cache = {}
site_packages_path = None

def normalize_name(name):
    if not name:
        return ""
    return name.lower().replace('_', '-').replace('.', '-')

def parse_requirement_name(req_str):
    # e.g., "requests[security] >= 2.20.0 ; python_version > '3'"
    # Remove markers
    name = req_str.split(';')[0]
    # Remove extras
    name = name.split('[')[0]
    # Split by operators or spaces
    name = re.split(r'[<>=!~ ]', name)[0]
    return normalize_name(name.strip())

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

def save_disk_size_cache(sizes, kept_packages):
    try:
        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump({"sizes": sizes, "kept_packages": kept_packages}, f, indent=4)
    except Exception as e:
        print(f"Error saving cache: {e}")

def get_disk_statistics(site_packages_path):
    try:
        usage = shutil.disk_usage(site_packages_path)
        return {
            "total": usage.total,
            "used": usage.used,
            "free": usage.free,
            "percentage": round((usage.used / usage.total) * 100, 1)
        }
    except Exception:
        # fallback to C drive
        try:
            usage = shutil.disk_usage(os.path.splitdrive(site_packages_path)[0] or "C:\\")
            return {
                "total": usage.total,
                "used": usage.used,
                "free": usage.free,
                "percentage": round((usage.used / usage.total) * 100, 1)
            }
        except Exception:
            return {"total": 0, "used": 0, "free": 0, "percentage": 0}

def scan_packages():
    global packages_cache, stats_cache, site_packages_path
    with cache_lock:
        disk_cache, kept_packages = load_disk_size_cache()
        dists = list(importlib.metadata.distributions())
        
        packages = {}
        cache_updated = False

        # Pass 1: Gather package details & calculate sizes
        for dist in dists:
            name = dist.name
            norm_name = normalize_name(name)
            version = dist.version
            
            # Find site-packages root path
            if not site_packages_path:
                try:
                    site_packages_path = str(dist.locate_file(''))
                except Exception:
                    pass

            # Unique key for size cache
            cache_key = f"{norm_name}=={version}"
            cached_info = disk_cache.get(cache_key)

            if cached_info and isinstance(cached_info, dict) and "size" in cached_info:
                size_bytes = cached_info["size"]
                files_count = cached_info.get("files", 0)
            else:
                # Calculate size
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
                
                # Update disk cache
                disk_cache[cache_key] = {
                    "size": size_bytes,
                    "files": files_count
                }
                cache_updated = True

            # Extract URLs
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
                        # try to split by space or colon
                        parts = p_url.split('http', 1)
                        label = parts[0].strip().rstrip(':').rstrip(',') or "Project Link"
                        url = "http" + parts[1].strip()
                        urls.append({"label": label, "url": url})

            # Check if editable/local (has direct_url.json or lives outside site-packages/standard dirs)
            is_editable = False
            try:
                if dist.locate_file('direct_url.json').exists():
                    is_editable = True
            except Exception:
                pass

            # Get installation date (metadata file creation time)
            installed_at0 = 0.0
            if dist.files:
                mf = next((f for f in dist.files if f.name in ('METADATA', 'RECORD', 'INSTALLER')), None)
                if not mf:
                    mf = next(iter(dist.files), None)
                if mf:
                    try:
                        abs_meta_path = dist.locate_file(mf)
                        if abs_meta_path.exists():
                            installed_at0 = abs_meta_path.stat().st_mtime
                    except Exception:
                        pass

            packages[norm_name] = {
                "name": name,
                "norm_name": norm_name,
                "version": version,
                "summary": dist.metadata.get("Summary", ""),
                "author": dist.metadata.get("Author", "Unknown"),
                "license": dist.metadata.get("License", "Unknown"),
                "homepage": urls[0]["url"] if urls else "",
                "urls": urls,
                "dependencies": [],      # normalized names
                "required_by": [],       # normalized names
                "size_bytes": size_bytes,
                "files_count": files_count,
                "is_editable": is_editable,
                "is_core": norm_name in CORE_PACKAGES,
                "is_kept": norm_name in kept_packages,
                "installed_at": installed_at0,
                "location": str(dist.locate_file(''))
            }

        # Pass 2: Establish dependency links
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

        # Calculate Statistics
        total_size = sum(p["size_bytes"] for p in packages.values())
        orphans = [p for p in packages.values() if not p["required_by"] and not p["is_core"] and not p.get("is_kept", False)]
        orphans_size = sum(p["size_bytes"] for p in orphans)

        packages_cache = packages
        
        # Disk health status
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

def simulate_uninstall(target_names):
    """
    Simulates uninstall of target_names.
    Finds which additional dependencies will become orphaned (leaf nodes and not core).
    """
    targets = [normalize_name(t) for t in target_names]
    
    # Store initial required_by links
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
                        # Do not auto-cascade core packages
                        if not packages_cache[dep]["is_core"]:
                            cascade_orphans.add(dep)
                            queue.append(dep)
                            
    return list(cascade_orphans)

def perform_upgrade(package_names):
    """
    Runs pip install --upgrade in a subprocess
    """
    with execution_lock:
        if not package_names:
            return True, "No packages selected."
        
        names = [normalize_name(p) for p in package_names]
        actual_names = []
        for n in names:
            if n in packages_cache:
                actual_names.append(packages_cache[n]["name"])
            else:
                actual_names.append(n)
                
        cmd = [sys.executable, "-m", "pip", "install", "--upgrade"] + actual_names
        
        try:
            res = subprocess.run(cmd, capture_output=True, text=True)
            success = (res.returncode == 0)
            
            # Reset cached sizes since package files might have changed
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
    """
    Runs pip uninstall in a subprocess
    """
    with execution_lock:
        if not package_names:
            return True, "No packages selected."
        
        # Clean packages names
        names = [normalize_name(p) for p in package_names]
        # Map back to their actual casing (or just use normalized)
        actual_names = []
        for n in names:
            if n in packages_cache:
                actual_names.append(packages_cache[n]["name"])
            else:
                actual_names.append(n)
                
        cmd = [sys.executable, "-m", "pip", "uninstall", "-y"] + actual_names
        
        try:
            # Execute and capture
            res = subprocess.run(cmd, capture_output=True, text=True)
            
            # Succeeded if exit code is 0 or "Successfully uninstalled" output present
            success = (res.returncode == 0) or ("Successfully uninstalled" in res.stdout)
            
            # Post-uninstall manual cleanup of leftover empty folders (specifically for this package)
            try:
                for n in names:
                    if n in packages_cache:
                        site_packages = site_packages_path
                        if site_packages and os.path.exists(site_packages):
                            # Safe package folder check
                            pkg_dir = os.path.join(site_packages, n.replace('-', '_'))
                            info_dir = os.path.join(site_packages, f"{n}-{packages_cache[n]['version']}.dist-info")
                            info_dir_d = os.path.join(site_packages, f"{packages_cache[n]['name']}-{packages_cache[n]['version']}.dist-info")
                            
                            for folder in (pkg_dir, info_dir, info_dir_d):
                                if os.path.exists(folder) and os.path.isdir(folder):
                                    is_empty_or_pyc = True
                                    for root, dirs, files_in_dir in os.walk(folder):
                                        for file in files_in_dir:
                                            if not file.endswith(('.pyc', '.pyo')) and file != 'py.typed':
                                                is_empty_or_pyc = False
                                                break
                                        if not is_empty_or_pyc:
                                            break
                                    if is_empty_or_pyc:
                                        shutil.rmtree(folder, ignore_errors=True)
            except Exception:
                pass
            
            # Remove uninstalled packages from size cache
            try:
                disk_cache, kept_packages = load_disk_size_cache()
                for n in names:
                    # Find all cache keys starting with this name
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

class PipManagerHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Silence default console logging
        pass

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
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

        if path == '/' or path == '/index.html':
            self.serve_static('frontend/index.html', 'text/html')
        elif path == '/index.css':
            self.serve_static('frontend/index.css', 'text/css')
        elif path == '/index.js':
            self.serve_static('frontend/index.js', 'application/javascript')
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
            self.wfile.write(b"404 Not Found")

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
            # Fetch basic details for each cascade package
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
            pkg = normalize_name(body.get('package', ''))
            keep_state = bool(body.get('keep', False))
            if pkg:
                with cache_lock:
                    sizes_cache, kept_packages = load_disk_size_cache()
                    if keep_state:
                        if pkg not in kept_packages:
                            kept_packages.append(pkg)
                    else:
                        if pkg in kept_packages:
                            kept_packages.remove(pkg)
                    save_disk_size_cache(sizes_cache, kept_packages)
                scan_packages()
                self.send_json({"success": True, "package": pkg, "is_kept": keep_state})
            else:
                self.send_json({"success": False, "error": "No package specified"}, status=400)
            
        else:
            self.send_response(404)
            self.end_headers()

    def serve_static(self, file_path, content_type):
        try:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            full_path = os.path.join(base_dir, file_path)
            
            if os.path.exists(full_path):
                with open(full_path, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                # Client cache bypass during development/runs
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

def open_browser():
    # Wait a second for server to initialize
    time.sleep(1)
    url = f"http://localhost:{PORT}"
    print(f"\nOpening {url} in your browser...")
    webbrowser.open(url)

if __name__ == '__main__':
    print("Initializing Pip Module Manager...")
    print("Scanning python local environment packages (this might take a few seconds on first run)...")
    scan_packages()
    
    server = HTTPServer(('localhost', PORT), PipManagerHandler)
    print(f"Server successfully started on http://localhost:{PORT}")
    
    # Start browser in a background thread
    threading.Thread(target=open_browser, daemon=True).start()
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server gracefully. Goodbye!")
        server.server_close()
