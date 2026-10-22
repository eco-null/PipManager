# PipManager

> High-contrast monochrome visual manager & auditor for local Python environment packages.

[![Python: 3.8+](https://img.shields.io/badge/python-3.8+-black.svg)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0%20(stdlib%20only)-black.svg)](server.py)

PipManager is a lightweight, zero-dependency visual interface for inspecting, auditing, and cleaning local Python virtual environments and system packages. It runs purely on the Python standard library and vanilla JavaScript/CSS—no framework bloat, no external CDN dependencies, and no telemetry.

---

## Highlights

- **Package Installation:** Install packages directly from the web interface (`pip install ...`) with strict input sanitization.
- **Orphan & Unused Detection:** Automatically maps reverse-dependency graphs to identify leaf packages that no other module requires.
- **Cascade Uninstall Simulator:** Previews which dependencies will become orphaned before executing an uninstall.
- **Direct Subprocess Security:** All package arguments are strictly validated against injection attempts; execution runs in isolated subshell processes with timeout fences.
- **Pinning & Whitelist:** Tag explicit tools and developer packages as "kept" to prevent accidental cleanup recommendations.
- **Dependency Traversal:** Interactive click-through drawer to inspect bi-directional dependency graphs (`Required By` & `Depends On`).
- **One-Click Upgrades & Bulk Actions:** Multi-select packages for batch removal or upgrade.
- **Requirements Export:** Export active filter views or selected packages to a clean `requirements.txt`.
- **Zero-Dependency Monochrome UI:** Ultra-fast, razor-sharp black-and-white interface with zero external web fonts or AI-slop gradients.

---

## Quick Start

### 1. Clone & Run

```bash
git clone https://github.com/eco-null/PipManager.git
cd PipManager
python3 server.py
```

*On Windows, you can simply double-click `run.bat`.*

### 2. Flags

- `--no-open`: Run headless without attempting to launch the system web browser (ideal for SSH/remote VPS setups).

```bash
python3 server.py --no-open
```

Then open `http://localhost:49150` in your browser.

---

## Security Architecture

- **Origin Isolation:** Only same-machine origins (`http://localhost:49150`, `http://127.0.0.1:49150`) are permitted to interact with the backend API.
- **Input Validation:** All package specifiers are verified against strict PEP 508 naming patterns before passing to `pip` subprocesses, blocking shell chaining and arbitrary flag injections.
- **Execution Fencing:** Subprocess invocations carry bounded timeouts and non-blocking locks to prevent hung commands.

---

## License

MIT © [eco-null](https://github.com/eco-null)
