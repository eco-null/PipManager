# PipCleaner

**PipCleaner** is a lightweight, high-performance visual package manager with a modern Web GUI designed to simplify python environment package auditing and cleanup. Built strictly with standard Python libraries and vanilla Javascript/CSS, it is completely self-contained and zero-dependency.

## Key Features

- **Unused (Orphan) Detection**: Analyzes package dependency graphs to highlight packages that aren't required by any other modules.
- **Deep Dependency Inspection**: View detailed "Depends On" and "Required By" trees for every installed module with click-through navigation.
- **Pinning ("Keep" State)**: Mark developer dependencies or user tools to exclude them from the cleanup recommendations list.
- **One-Click Upgrades**: Upgrade single or bulk packages to their latest versions directly from the UI.
- **Dynamic Action Console**: Watch pip subprocess execution in real-time inside an integrated console overlay.
- **Export requirements.txt**: Export your selected packages, or the currently filtered search results, into standard `requirements.txt` files output.
- **Premium Dark Aesthetics**: High-contrast, minimalist theme optimized for speed and professional developer sandbox workspaces.

## How to Run

Clone this repository and run the server file:
```powershell
python server.py
```
After executing, navigate to `http://localhost:49150` in your web browser.

## Tech Specs
- **Backend**: Python 3.x (with standard libraries: `http.server`, `importlib.metadata`, `subprocess`, etc.)
- **Frontend**: HTML5, Vanilla CSS3, Modern ES6 Javascript
- **Platform**: Multi-platform (developed and tested on Windows/Linux environments)
