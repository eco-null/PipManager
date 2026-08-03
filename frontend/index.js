/**
 * Pip Manager — Frontend Orchestrator Script
 */

// Application State
const state = {
    packages: [],
    stats: {},
    selectedPackages: new Set(),
    activeFilter: 'all',
    sortBy: 'size_desc',
    searchQuery: '',
    activePackage: null
};

// DOM Cache
const dom = {
    pythonVersion: document.getElementById('pythonVersion'),
    sitePackagesPath: document.getElementById('sitePackagesPath'),
    btnRefresh: document.getElementById('btnRefresh'),
    btnExport: document.getElementById('btnExport'),
    btnResetFilters: document.getElementById('btnResetFilters'),

    // Stats Cards
    valTotalPackages: document.getElementById('valTotalPackages'),
    valTotalSize: document.getElementById('valTotalSize'),
    valOrphanPackages: document.getElementById('valOrphanPackages'),
    valOrphanSize: document.getElementById('valOrphanSize'),
    valDiskPercentage: document.getElementById('valDiskPercentage'),
    diskProgress: document.getElementById('diskProgress'),
    valDiskFree: document.getElementById('valDiskFree'),
    cardCleanupSuggestion: document.getElementById('cardCleanupSuggestion'),
    cardOrphans: document.getElementById('cardOrphans'),
    cleanRecommendationText: document.getElementById('cleanRecommendationText'),
    btnQuickClean: document.getElementById('btnQuickClean'),

    // Filtering
    searchInput: document.getElementById('searchInput'),
    filterStatusGroup: document.getElementById('filterStatusGroup'),
    sortBySelect: document.getElementById('sortBySelect'),
    badgeCountUnused: document.getElementById('badgeCountUnused'),

    // Table/Loader/Empty States
    loadingState: document.getElementById('loadingState'),
    emptyState: document.getElementById('emptyState'),
    packageListWrapper: document.getElementById('packageListWrapper'),
    packageTableBody: document.getElementById('packageTableBody'),
    selectAllCheckbox: document.getElementById('selectAllCheckbox'),

    // Floating Batch Panel
    batchActionBar: document.getElementById('batchActionBar'),
    batchCountBadge: document.getElementById('batchCountBadge'),
    batchCountText: document.getElementById('batchCountText'),
    batchSizeText: document.getElementById('batchSizeText'),
    btnBatchCancel: document.getElementById('btnBatchCancel'),
    btnBatchUninstall: document.getElementById('btnBatchUninstall'),

    // Detail Drawer Modal
    detailModal: document.getElementById('detailModal'),
    btnDetailClose: document.getElementById('btnDetailClose'),
    btnDetailCancel: document.getElementById('btnDetailCancel'),
    btnDetailUpgrade: document.getElementById('btnDetailUpgrade'),
    btnDetailUninstall: document.getElementById('btnDetailUninstall'),
    detailName: document.getElementById('detailName'),
    detailVersion: document.getElementById('detailVersion'),
    detailSummary: document.getElementById('detailSummary'),
    detailBadges: document.getElementById('detailBadges'),
    detailLicense: document.getElementById('detailLicense'),
    detailAuthor: document.getElementById('detailAuthor'),
    detailSize: document.getElementById('detailSize'),
    detailFilesCount: document.getElementById('detailFilesCount'),
    detailLocation: document.getElementById('detailLocation'),
    detailRequiredByList: document.getElementById('detailRequiredByList'),
    detailDependenciesList: document.getElementById('detailDependenciesList'),
    detailLinksSection: document.getElementById('detailLinksSection'),
    detailLinksList: document.getElementById('detailLinksList'),
    detailKeepCheckbox: document.getElementById('detailKeepCheckbox'),

    // Confirm Dialog Modal
    confirmModal: document.getElementById('confirmModal'),
    btnConfirmCancel: document.getElementById('btnConfirmCancel'),
    btnConfirmProceed: document.getElementById('btnConfirmProceed'),
    confirmCountText: document.getElementById('confirmCountText'),
    confirmTargetList: document.getElementById('confirmTargetList'),
    cascadeBox: document.getElementById('cascadeBox'),
    cascadeCheckbox: document.getElementById('cascadeCheckbox'),
    cascadeResultsBox: document.getElementById('cascadeResultsBox'),
    cascadeTargetList: document.getElementById('cascadeTargetList'),
    systemWarningAlert: document.getElementById('systemWarningAlert'),
    systemWarningAlertText: document.getElementById('systemWarningAlertText'),

    // Terminal Log Console
    terminalModal: document.getElementById('terminalModal'),
    terminalOutput: document.getElementById('terminalOutput'),
    btnTerminalClose: document.getElementById('btnTerminalClose')
};

// Constants removed: frontend no longer needs a local core-packages list
// (system-core status comes from the backend).

// Format File Size
function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    if (!bytes) return 'Unknown';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format Date
function formatDate(timestamp) {
    if (!timestamp || timestamp === 0) return '';
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Escape HTML entities to prevent XSS from package metadata
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Lock/unlock body scroll while any modal overlay is visible
let openModalCount = 0;
function showModal(el) {
    if (el.classList.contains('hidden')) {
        el.classList.remove('hidden');
        openModalCount++;
        document.body.classList.add('modal-open');
    }
}
function hideModal(el) {
    if (!el.classList.contains('hidden')) {
        el.classList.add('hidden');
        openModalCount = Math.max(0, openModalCount - 1);
        if (openModalCount === 0) {
            document.body.classList.remove('modal-open');
        }
    }
}

// Render extendable dependency list to avoid squished styling
function renderExtendableList(container, items, labelWhenEmpty) {
    container.innerHTML = '';
    if (!items || items.length === 0) {
        container.innerHTML = `<li class="dep-item-empty">${labelWhenEmpty}</li>`;
        return;
    }

    const maxInitial = 5;

    function createItemEl(name) {
        const li = document.createElement('li');
        li.className = 'dep-item';
        li.textContent = name;
        li.title = name;
        li.addEventListener('click', () => {
            const targetPkg = state.packages.find(p => p.norm_name === name);
            if (targetPkg) openPackageDetails(targetPkg);
        });
        return li;
    }

    if (items.length <= maxInitial) {
        items.forEach(name => container.appendChild(createItemEl(name)));
    } else {
        // Render first 4
        for (let i = 0; i < maxInitial - 1; i++) {
            container.appendChild(createItemEl(items[i]));
        }

        // Show More item
        const moreLi = document.createElement('li');
        moreLi.className = 'dep-item-more';
        moreLi.textContent = `Show more (+${items.length - (maxInitial - 1)})`;
        moreLi.addEventListener('click', (e) => {
            e.stopPropagation();
            moreLi.remove();
            container.classList.add('expanded');
            for (let i = maxInitial - 1; i < items.length; i++) {
                container.appendChild(createItemEl(items[i]));
            }
        });
        container.appendChild(moreLi);
    }
}

// Fetch stats and UI setup
async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        if (!response.ok) throw new Error("Stats request failed");
        state.stats = await response.json();
        renderStats();
    } catch (error) {
        console.error("Error loading environmental stats:", error);
    }
}

// Fetch list of packages
async function loadPackages(forceRefresh = false, quiet = false) {
    if (!quiet) {
        // Show loading state
        dom.loadingState.classList.remove('hidden');
        dom.packageListWrapper.classList.add('hidden');
        dom.emptyState.classList.add('hidden');

        // Reset selection state
        state.selectedPackages.clear();
        dom.selectAllCheckbox.checked = false;
        updateBatchActionBar();
    }

    try {
        const refreshQuery = forceRefresh ? "?refresh=true" : "";
        const response = await fetch(`/api/packages${refreshQuery}`);
        if (!response.ok) throw new Error("Packages fetch failed.");
        state.packages = await response.json();

        // Count unused specifically for badge
        const unusedCount = state.packages.filter(p => !p.required_by.length && !p.is_core && !p.is_kept).length;
        dom.badgeCountUnused.textContent = unusedCount;

        renderTable();
        // Load stats side-by-side to stay in sync
        await loadStats();
    } catch (error) {
        console.error("Error loading packages:", error);
        if (!quiet) {
            alert("Could not load packages from environment. Is the server running?");
        }
    } finally {
        if (!quiet) {
            dom.loadingState.classList.add('hidden');
        }
    }
}

// Render Stats elements
function renderStats() {
    dom.pythonVersion.textContent = `v${state.stats.python_version || 'Loading'}`;
    dom.sitePackagesPath.textContent = state.stats.site_packages_path || 'Unknown';
    dom.sitePackagesPath.title = state.stats.site_packages_path || '';

    dom.valTotalPackages.textContent = state.stats.total_packages || 0;
    dom.valTotalSize.textContent = `${formatSize(state.stats.total_size_bytes)} total`;

    dom.valOrphanPackages.textContent = state.stats.orphan_packages_count ?? 0;
    dom.valOrphanSize.textContent = `${formatSize(state.stats.orphan_size_bytes)} cleanable`;

    const disk = state.stats.disk || {};
    dom.valDiskPercentage.textContent = `${disk.percentage || 0}%`;
    dom.diskProgress.style.width = `${disk.percentage || 0}%`;
    dom.valDiskFree.textContent = `${formatSize(disk.free)} free of ${formatSize(disk.total)}`;

    // Suggestion box setup
    const orphansCount = state.stats.orphan_packages_count || 0;
    if (orphansCount > 0) {
        dom.cleanRecommendationText.innerHTML = `You have <strong class="text-emerald">${orphansCount} unused packages</strong> occupying <strong class="text-glow">${formatSize(state.stats.orphan_size_bytes)}</strong>. Clean them up now!`;
        dom.btnQuickClean.style.display = 'inline-flex';
    } else {
        dom.cleanRecommendationText.textContent = "All clean! No unused library orphans detected in this sandbox. Awesome!";
        dom.btnQuickClean.style.display = 'none';
    }
}

// Get packages matching active query filters
function getFilteredPackages() {
    let filtered = state.packages.filter(p => {
        const q = state.searchQuery.toLowerCase();
        const matchesQuery = !q ||
            p.name.toLowerCase().includes(q) ||
            p.summary.toLowerCase().includes(q) ||
            p.author.toLowerCase().includes(q);

        if (!matchesQuery) return false;

        if (state.activeFilter === 'all') return true;
        if (state.activeFilter === 'unused') return !p.required_by.length && !p.is_core && !p.is_kept;
        if (state.activeFilter === 'large') return p.size_bytes >= 15 * 1024 * 1024;
        if (state.activeFilter === 'editable') return p.is_editable;
        if (state.activeFilter === 'core') return p.is_core;

        return true;
    });

    filtered.sort((a, b) => {
        if (state.sortBy === 'size_desc') return b.size_bytes - a.size_bytes;
        if (state.sortBy === 'size_asc') return a.size_bytes - b.size_bytes;
        if (state.sortBy === 'name_asc') return a.name.localeCompare(b.name);
        if (state.sortBy === 'name_desc') return b.name.localeCompare(a.name);
        if (state.sortBy === 'deps_desc') return b.required_by.length - a.required_by.length;
        if (state.sortBy === 'installed_desc') return (b.installed_at || 0) - (a.installed_at || 0);
        if (state.sortBy === 'installed_asc') return (a.installed_at || 0) - (b.installed_at || 0);
        return 0;
    });

    return filtered;
}

// Render Table Items
function renderTable() {
    const listBody = dom.packageTableBody;
    listBody.innerHTML = '';

    const filtered = getFilteredPackages();

    if (filtered.length === 0) {
        dom.packageListWrapper.classList.add('hidden');
        dom.emptyState.classList.remove('hidden');
        return;
    }

    dom.packageListWrapper.classList.remove('hidden');
    dom.emptyState.classList.add('hidden');

    filtered.forEach(pkg => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';

        // Click row opens details, EXCEPT clicking checkbox or action button
        tr.addEventListener('click', (e) => {
            if (e.target.closest('.custom-checkbox') || e.target.closest('.col-actions')) {
                return;
            }
            openPackageDetails(pkg);
        });

        const isChecked = state.selectedPackages.has(pkg.norm_name);

        // Badges helper
        let statusBadgesHtml = '';
        if (pkg.is_editable) {
            statusBadgesHtml += `<span class="pkg-status-badge badge-status-editable">Editable</span> `;
        }
        if (pkg.is_kept) {
            statusBadgesHtml += `<span class="pkg-status-badge badge-status-kept" title="Pinned to prevent cleanup suggestion">Kept</span> `;
        }
        if (pkg.is_core) {
            statusBadgesHtml += `<span class="pkg-status-badge badge-status-core" title="Vital CLI ecosystem module">System</span> `;
        } else if (!pkg.required_by.length && !pkg.is_kept) {
            statusBadgesHtml += `<span class="pkg-status-badge badge-status-unused" title="Not required by any packages">Unused</span> `;
        }

        // Required by pill details
        const dependentsCount = pkg.required_by.length;
        const requiredByTitle = escapeHtml(pkg.required_by.join(', '));
        const requiredByText = dependentsCount === 0
            ? '<span class="dependent-count-pill none">None</span>'
            : `<span class="dependent-count-pill" title="${requiredByTitle}">${dependentsCount} package${dependentsCount === 1 ? '' : 's'}</span>`;

        const safeName = escapeHtml(pkg.name);
        const safeVersion = escapeHtml(pkg.version);
        const safeSummary = escapeHtml(pkg.summary || '');

        tr.innerHTML = `
            <td class="col-checkbox">
                <label class="custom-checkbox">
                    <input type="checkbox" class="row-checkbox" value="${pkg.norm_name}" ${isChecked ? 'checked' : ''}>
                    <span class="checkmark"></span>
                </label>
            </td>
            <td class="col-name">${safeName} ${statusBadgesHtml}</td>
            <td class="col-version">${safeVersion}</td>
            <td class="col-size">${formatSize(pkg.size_bytes)}</td>
            <td class="col-installed">${formatDate(pkg.installed_at)}</td>
            <td class="col-usage">${requiredByText}</td>
            <td class="col-summary" title="${safeSummary}">${safeSummary || '<span class="text-muted">No description.</span>'}</td>
            <td class="col-actions">
                <button type="button" class="btn-action-delete" title="Uninstall this module">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                </button>
            </td>
        `;

        // Checkbox events
        const chk = tr.querySelector('.row-checkbox');
        chk.addEventListener('change', (e) => {
            if (e.target.checked) {
                state.selectedPackages.add(pkg.norm_name);
            } else {
                state.selectedPackages.delete(pkg.norm_name);
                dom.selectAllCheckbox.checked = false;
            }
            updateBatchActionBar();
        });

        // Single delete button events
        const btnDel = tr.querySelector('.btn-action-delete');
        btnDel.addEventListener('click', (e) => {
            e.stopPropagation();
            openUninstallConfirm([pkg.norm_name]);
        });

        listBody.appendChild(tr);
    });
}

// Update Batch Action Panel visibility & stats
function updateBatchActionBar() {
    const selectedCount = state.selectedPackages.size;
    if (selectedCount > 0) {
        dom.batchCountBadge.textContent = selectedCount;
        dom.batchCountText.textContent = `${selectedCount} package${selectedCount === 1 ? '' : 's'} selected`;

        // Calculate total size of selected packages
        let totalBytes = 0;
        state.selectedPackages.forEach(normName => {
            const p = state.packages.find(pkg => pkg.norm_name === normName);
            if (p) totalBytes += p.size_bytes;
        });

        dom.batchSizeText.textContent = `${formatSize(totalBytes)} size on disk`;
        dom.batchActionBar.classList.remove('hidden');
    } else {
        dom.batchActionBar.classList.add('hidden');
    }
}

// View package detail drawer drawer sidepanel
function openPackageDetails(pkg) {
    state.activePackage = pkg;

    // Fill text values
    dom.detailName.textContent = pkg.name;
    dom.detailVersion.textContent = pkg.version;
    dom.detailSummary.textContent = pkg.summary || "No description provided.";
    dom.detailLicense.textContent = pkg.license || "Unknown";
    dom.detailAuthor.textContent = pkg.author || "Unknown";
    dom.detailSize.textContent = formatSize(pkg.size_bytes);
    dom.detailFilesCount.textContent = `${pkg.files_count} file${pkg.files_count === 1 ? '' : 's'}`;
    dom.detailLocation.textContent = pkg.location || "Unknown location";

    // Generate badges in details
    dom.detailBadges.innerHTML = '';
    if (pkg.is_editable) {
        dom.detailBadges.innerHTML += `<span class="pkg-status-badge badge-status-editable">Local Editable</span>`;
    }
    if (pkg.is_kept) {
        dom.detailBadges.innerHTML += `<span class="pkg-status-badge badge-status-kept">Tagged as Kept</span>`;
    }
    if (pkg.is_core) {
        dom.detailBadges.innerHTML += `<span class="pkg-status-badge badge-status-core">System Core</span>`;
    } else if (!pkg.required_by.length && !pkg.is_kept) {
        dom.detailBadges.innerHTML += `<span class="pkg-status-badge badge-status-unused">Unused (Orphan)</span>`;
    }

    // Bind manually kept checkbox
    dom.detailKeepCheckbox.checked = pkg.is_kept || false;
    dom.detailKeepCheckbox.onchange = async () => {
        try {
            const isChecked = dom.detailKeepCheckbox.checked;
            const res = await fetch('/api/keep', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ package: pkg.norm_name, keep: isChecked })
            });
            const data = await res.json();
            if (data.success) {
                // reload packages from server quietly
                await loadPackages(false, true);
                // obtain updated information for active package
                const updatedPkg = state.packages.find(p => p.norm_name === pkg.norm_name);
                if (updatedPkg) {
                    openPackageDetails(updatedPkg);
                }
            }
        } catch (err) {
            console.error('Failed to change keep flag state:', err);
            dom.detailKeepCheckbox.checked = !dom.detailKeepCheckbox.checked;
        }
    };

    // Dependents list
    renderExtendableList(dom.detailRequiredByList, pkg.required_by, 'No other packages depend on this module');

    // Dependencies (Requires) list
    renderExtendableList(dom.detailDependenciesList, pkg.dependencies, 'None');

    // Resources Links list
    dom.detailLinksList.innerHTML = '';
    if (pkg.urls && pkg.urls.length > 0) {
        dom.detailLinksSection.classList.remove('hidden');
        pkg.urls.forEach(urlObj => {
            const a = document.createElement('a');
            a.className = 'link-pill';
            a.href = urlObj.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.innerHTML = `
                <span>${urlObj.label}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>
                </svg>
            `;
            dom.detailLinksList.appendChild(a);
        });
    } else {
        dom.detailLinksSection.classList.add('hidden');
    }

    // Disable uninstall if core package
    if (pkg.is_core) {
        dom.btnDetailUninstall.disabled = true;
        dom.btnDetailUninstall.title = "Package is marked as system core; direct deletion is locked.";
    } else {
        dom.btnDetailUninstall.disabled = false;
        dom.btnDetailUninstall.removeAttribute('title');
    }

    // Show modal drawer overlay
    showModal(dom.detailModal);
}

// Close detail modal drawer panel
function closePackageDetails() {
    hideModal(dom.detailModal);
    state.activePackage = null;
}

// Open Confirm Selection Uninstall Modal
let activeUninstallTargets = [];
async function openUninstallConfirm(packageNormNames) {
    activeUninstallTargets = packageNormNames;
    const itemsCount = packageNormNames.length;

    dom.confirmCountText.textContent = `${itemsCount} module${itemsCount === 1 ? '' : 's'}`;

    // Build deletion tags List
    dom.confirmTargetList.innerHTML = '';
    let containsCore = false;

    packageNormNames.forEach(norm => {
        const pkg = state.packages.find(p => p.norm_name === norm);
        if (pkg) {
            if (pkg.is_core) containsCore = true;
            const span = document.createElement('span');
            span.className = 'preview-package-tag';
            span.textContent = `${pkg.name} (${pkg.version})`;
            dom.confirmTargetList.appendChild(span);
        } else {
            const span = document.createElement('span');
            span.className = 'preview-package-tag';
            span.textContent = norm;
            dom.confirmTargetList.appendChild(span);
        }
    });

    // Check system danger warning status
    if (containsCore) {
        dom.systemWarningAlert.classList.remove('hidden');
        dom.systemWarningAlertText.textContent = "Caution: One or more selected packages are python system core components! Deleting them is highly discouraged.";
        dom.btnConfirmProceed.classList.remove('btn-danger');
        dom.btnConfirmProceed.classList.add('btn-warning');
        dom.btnConfirmProceed.textContent = "Uninstall Anyway";
    } else {
        dom.systemWarningAlert.classList.add('hidden');
        dom.btnConfirmProceed.classList.add('btn-danger');
        dom.btnConfirmProceed.classList.remove('btn-warning');
        dom.btnConfirmProceed.textContent = "Confirm & Uninstall";
    }

    // Call dry run cascade dependencies analysis
    dom.cascadeResultsBox.classList.add('hidden');
    dom.cascadeCheckbox.checked = true; // reset checkbox

    // Enable Cascade toggle only if cleanups have orphans & sizes
    dom.cascadeBox.classList.remove('hidden');

    await fetchCascadeDryRun();

    showModal(dom.confirmModal);
}

// Fetch Cascade dry run targets
let activeCascadeTargets = [];
async function fetchCascadeDryRun() {
    if (!dom.cascadeCheckbox.checked) {
        dom.cascadeResultsBox.classList.add('hidden');
        activeCascadeTargets = [];
        return;
    }

    try {
        const response = await fetch('/api/dry-run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ packages: activeUninstallTargets })
        });

        if (!response.ok) throw new Error("Dry-run preview failed.");
        const result = await response.json();

        activeCascadeTargets = result.cascade || [];

        if (activeCascadeTargets.length > 0) {
            dom.cascadeTargetList.innerHTML = '';
            activeCascadeTargets.forEach(dep => {
                const span = document.createElement('span');
                span.className = 'cascade-package-tag';
                span.textContent = `${dep.name} (${formatSize(dep.size_bytes)})`;
                dom.cascadeTargetList.appendChild(span);
            });
            dom.cascadeResultsBox.classList.remove('hidden');
        } else {
            dom.cascadeResultsBox.classList.add('hidden');
        }
    } catch (e) {
        console.error("Dry run simulation error:", e);
        dom.cascadeResultsBox.classList.add('hidden');
    }
}

// Close confirmation modal
function closeUninstallConfirm() {
    hideModal(dom.confirmModal);
    activeUninstallTargets = [];
    activeCascadeTargets = [];
}

// Execute Pip Uninstall Command Transaction
async function executeUninstall() {
    // Collect all targets (manual selections + cascade additions if checked)
    const targets = [...activeUninstallTargets];
    if (dom.cascadeCheckbox.checked) {
        activeCascadeTargets.forEach(c => {
            if (!targets.includes(c.norm_name)) {
                targets.push(c.norm_name);
            }
        });
    }

    // Hide confirm modal, load terminal overlay
    closeUninstallConfirm();
    closePackageDetails();

    dom.btnTerminalClose.disabled = true;
    dom.terminalOutput.innerHTML = `
        <div class="console-line line-info">&gt; Initializing pip command transaction...</div>
        <div class="console-line line-cmd">&gt; python -m pip uninstall -y ${targets.join(' ')}</div>
        <div class="console-line line-loading"><span class="cursor-block"></span>Executing transaction on background terminal...</div>
    `;
    showModal(dom.terminalModal);

    try {
        const res = await fetch('/api/uninstall', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ packages: targets })
        });

        if (!res.ok) throw new Error("Uninstall transaction exploded.");
        const result = await res.json();

        // Print transaction outputs
        const lines = result.output.split('\n');
        dom.terminalOutput.innerHTML = '';
        lines.forEach(l => {
            const div = document.createElement('div');
            div.className = 'console-line';
            if (l.startsWith('Uninstalling') || l.startsWith('Proceed')) {
                div.className = 'console-line line-info';
            } else if (l.includes('Successfully uninstalled')) {
                div.className = 'console-line line-success';
                div.style.color = '#10b981';
                div.style.fontWeight = 'bold';
            } else if (l.toLowerCase().includes('error:') || l.toLowerCase().includes('failed:')) {
                div.className = 'console-line line-error';
                div.style.color = '#ef4444';
            }
            div.textContent = l;
            dom.terminalOutput.appendChild(div);
        });

        if (result.success) {
            dom.terminalOutput.innerHTML += `<div class="console-line line-success" style="color:#10b981; font-weight:700; margin-top: 10px;">&gt; Transaction Completed Successfully. Cleaned up ${targets.length} package(s)!</div>`;
        } else {
            dom.terminalOutput.innerHTML += `<div class="console-line line-error" style="color:#ef4444; font-weight:700; margin-top: 10px;">&gt; Pip command failed. View transaction logs above!</div>`;
        }

    } catch (e) {
        console.error(e);
        dom.terminalOutput.innerHTML += `<div class="console-line line-error" style="color:#ef4444; font-weight:700; margin-top: 15px;">&gt; CLI Broker Connection Error: ${e.message}</div>`;
    } finally {
        dom.btnTerminalClose.disabled = false;
        // Trigger table refreshing cache in background
        loadPackages(false);
    }
}

// Execute Upgrade CLI transaction
async function executeUpgrade(targets) {
    if (!targets || targets.length === 0) return;

    // Close detail drawer if opened
    closePackageDetails();

    // Reset and open console terminal overlay
    dom.btnTerminalClose.disabled = true;
    dom.terminalOutput.innerHTML = `
        <div class="console-line line-info">&gt; Initializing pip command transaction...</div>
        <div class="console-line line-cmd">&gt; pip install --upgrade ${targets.join(' ')}</div>
        <div class="console-line line-loading"><span class="cursor-block"></span>Executing upgrade subprocess, please wait...</div>
    `;
    showModal(dom.terminalModal);

    try {
        const res = await fetch('/api/upgrade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ packages: targets })
        });

        if (!res.ok) throw new Error("Upgrade transaction exploded.");
        const result = await res.json();

        // Print transaction outputs
        const lines = result.output.split('\n');
        dom.terminalOutput.innerHTML = '';
        lines.forEach(l => {
            const div = document.createElement('div');
            div.className = 'console-line';
            if (l.startsWith('Requirement already satisfied') || l.includes('Collecting')) {
                div.className = 'console-line line-info';
            } else if (l.includes('Successfully installed')) {
                div.className = 'console-line line-success';
                div.style.color = '#10b981';
                div.style.fontWeight = 'bold';
            } else if (l.toLowerCase().includes('error:') || l.toLowerCase().includes('failed:')) {
                div.className = 'console-line line-error';
                div.style.color = '#ef4444';
            }
            div.textContent = l;
            dom.terminalOutput.appendChild(div);
        });

        if (result.success) {
            dom.terminalOutput.innerHTML += `<div class="console-line line-success" style="color:#10b981; font-weight:700; margin-top: 10px;">&gt; Upgrade Completed Successfully!</div>`;
        } else {
            dom.terminalOutput.innerHTML += `<div class="console-line line-error" style="color:#ef4444; font-weight:700; margin-top: 10px;">&gt; Pip upgrade command failed. View logs above!</div>`;
        }

    } catch (e) {
        console.error(e);
        dom.terminalOutput.innerHTML += `<div class="console-line line-error" style="color:#ef4444; font-weight:700; margin-top: 15px;">&gt; CLI Broker Connection Error: ${e.message}</div>`;
    } finally {
        dom.btnTerminalClose.disabled = false;
        // Trigger table refreshing cache in background
        loadPackages(false);
    }
}

// Export visible requirements format
function exportRequirements() {
    const targets = state.selectedPackages.size > 0
        ? state.packages.filter(p => state.selectedPackages.has(p.norm_name))
        : getFilteredPackages();

    if (targets.length === 0) {
        alert("No packages available to export.");
        return;
    }

    const content = targets.map(p => `${p.name}==${p.version}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', state.selectedPackages.size > 0 ? 'selected-requirements.txt' : 'requirements.txt');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Close terminal logs modal console
function closeTerminalConsole() {
    hideModal(dom.terminalModal);
}

// BIND COMPONENT DOM EVENTS
function bindEvents() {
    // Refresh and Export buttons
    dom.btnRefresh.addEventListener('click', () => loadPackages(true));
    dom.btnExport.addEventListener('click', exportRequirements);

    // Search textbox Input
    dom.searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        renderTable();
    });

    // Sort dropdown changer
    dom.sortBySelect.addEventListener('change', (e) => {
        state.sortBy = e.target.value;
        renderTable();
    });

    // Filter tags buttons group
    dom.filterStatusGroup.addEventListener('click', (e) => {
        const item = e.target.closest('.btn-group-item');
        if (!item) return;

        dom.filterStatusGroup.querySelectorAll('.btn-group-item').forEach(btn => btn.classList.remove('active'));
        item.classList.add('active');

        state.activeFilter = item.dataset.filter;
        renderTable();
    });

    // Reset filters
    dom.btnResetFilters.addEventListener('click', () => {
        dom.searchInput.value = '';
        state.searchQuery = '';
        state.activeFilter = 'all';
        dom.filterStatusGroup.querySelectorAll('.btn-group-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === 'all');
        });
        state.sortBy = 'size_desc';
        dom.sortBySelect.value = 'size_desc';
        renderTable();
    });

    // Select All table rows togglers
    dom.selectAllCheckbox.addEventListener('change', (e) => {
        const checkBoxes = dom.packageTableBody.querySelectorAll('.row-checkbox');
        checkBoxes.forEach(chk => {
            chk.checked = e.target.checked;
            const name = chk.value;
            if (e.target.checked) {
                state.selectedPackages.add(name);
            } else {
                state.selectedPackages.delete(name);
            }
        });
        updateBatchActionBar();
    });

    // Floating Batch buttons Cancel Selection
    dom.btnBatchCancel.addEventListener('click', () => {
        state.selectedPackages.clear();
        dom.selectAllCheckbox.checked = false;
        const checkBoxes = dom.packageTableBody.querySelectorAll('.row-checkbox');
        checkBoxes.forEach(chk => chk.checked = false);
        updateBatchActionBar();
    });

    // Floating Batch button action uninstall trigger
    dom.btnBatchUninstall.addEventListener('click', () => {
        if (state.selectedPackages.size === 0) return;
        openUninstallConfirm([...state.selectedPackages]);
    });

    // Quick clean recommendation click event
    dom.btnQuickClean.addEventListener('click', () => {
        // Collect all orphans (we can filter from state packages)
        const orphans = state.packages.filter(p => !p.required_by.length && !p.is_core && !p.is_kept).map(p => p.norm_name);
        if (orphans.length > 0) {
            openUninstallConfirm(orphans);
        }
    });

    // Also bind click event to the "Unused" card itself so clicking it shifts filter automatically
    dom.cardOrphans.addEventListener('click', () => {
        dom.filterStatusGroup.querySelectorAll('.btn-group-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === 'unused');
        });
        state.activeFilter = 'unused';
        renderTable();
    });

    // Detail drawer Close buttons
    dom.btnDetailClose.addEventListener('click', closePackageDetails);
    dom.btnDetailCancel.addEventListener('click', closePackageDetails);
    dom.btnDetailUpgrade.addEventListener('click', () => {
        if (state.activePackage) {
            executeUpgrade([state.activePackage.norm_name]);
        }
    });
    dom.btnDetailUninstall.addEventListener('click', () => {
        if (state.activePackage) {
            openUninstallConfirm([state.activePackage.norm_name]);
        }
    });

    // Confirmation Dialog buttons
    dom.btnConfirmCancel.addEventListener('click', closeUninstallConfirm);
    dom.btnConfirmProceed.addEventListener('click', executeUninstall);

    // Cascade check change event
    dom.cascadeCheckbox.addEventListener('change', fetchCascadeDryRun);

    // Console Close Button click
    dom.btnTerminalClose.addEventListener('click', closeTerminalConsole);

    // Close modals on clicking backdrop overlay
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (overlay.dataset.backdrop === 'static') return;
            if (e.target === overlay) {
                if (overlay === dom.detailModal) closePackageDetails();
                if (overlay === dom.confirmModal) closeUninstallConfirm();
            }
        });
    });
}

// SETUP INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    // Scan items initially
    loadPackages();
});
