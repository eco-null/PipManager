/**
 * Pip Manager — Frontend Orchestrator Script
 * High-Performance, Zero-Slop Architecture
 */

// --- Application State ---

const state = {
  packages: [],
  stats: {},
  selectedPackages: new Set(),
  activeFilter: 'all',
  sortBy: 'size_desc',
  searchQuery: '',
  activePackage: null
};

// --- DOM Cache ---

const dom = {
  pythonVersion: document.getElementById('pythonVersion'),
  sitePackagesPath: document.getElementById('sitePackagesPath'),
  btnRefresh: document.getElementById('btnRefresh'),
  btnExport: document.getElementById('btnExport'),
  btnResetFilters: document.getElementById('btnResetFilters'),

  installForm: document.getElementById('installForm'),
  installInput: document.getElementById('installInput'),
  btnInstallSubmit: document.getElementById('btnInstallSubmit'),

  valTotalPackages: document.getElementById('valTotalPackages'),
  valTotalSize: document.getElementById('valTotalSize'),
  valOrphanPackages: document.getElementById('valOrphanPackages'),
  valOrphanSize: document.getElementById('valOrphanSize'),
  valDiskPercentage: document.getElementById('valDiskPercentage'),
  valDiskFree: document.getElementById('valDiskFree'),
  cardCleanupSuggestion: document.getElementById('cardCleanupSuggestion'),
  cardOrphans: document.getElementById('cardOrphans'),
  cleanRecommendationText: document.getElementById('cleanRecommendationText'),
  btnQuickClean: document.getElementById('btnQuickClean'),

  searchInput: document.getElementById('searchInput'),
  filterStatusGroup: document.getElementById('filterStatusGroup'),
  sortBySelect: document.getElementById('sortBySelect'),
  badgeCountUnused: document.getElementById('badgeCountUnused'),

  loadingState: document.getElementById('loadingState'),
  emptyState: document.getElementById('emptyState'),
  packageTable: document.getElementById('packageTable'),
  packageTableBody: document.getElementById('packageTableBody'),
  selectAllCheckbox: document.getElementById('selectAllCheckbox'),

  batchActionBar: document.getElementById('batchActionBar'),
  batchCountBadge: document.getElementById('batchCountBadge'),
  batchCountText: document.getElementById('batchCountText'),
  batchSizeText: document.getElementById('batchSizeText'),
  btnBatchCancel: document.getElementById('btnBatchCancel'),
  btnBatchUninstall: document.getElementById('btnBatchUninstall'),

  detailModal: document.getElementById('detailModal'),
  btnDetailClose: document.getElementById('btnDetailClose'),
  btnDetailUpgrade: document.getElementById('btnDetailUpgrade'),
  btnDetailUninstall: document.getElementById('btnDetailUninstall'),
  detailName: document.getElementById('detailName'),
  detailVersion: document.getElementById('detailVersion'),
  detailSummary: document.getElementById('detailSummary'),
  detailLicense: document.getElementById('detailLicense'),
  detailAuthor: document.getElementById('detailAuthor'),
  detailSize: document.getElementById('detailSize'),
  detailFilesCount: document.getElementById('detailFilesCount'),
  detailLocation: document.getElementById('detailLocation'),
  detailRequiredByCount: document.getElementById('detailRequiredByCount'),
  detailRequiredByList: document.getElementById('detailRequiredByList'),
  detailDependenciesCount: document.getElementById('detailDependenciesCount'),
  detailDependenciesList: document.getElementById('detailDependenciesList'),
  detailLinksSection: document.getElementById('detailLinksSection'),
  detailLinksList: document.getElementById('detailLinksList'),
  detailKeepCheckbox: document.getElementById('detailKeepCheckbox'),

  confirmModal: document.getElementById('confirmModal'),
  btnConfirmCancel: document.getElementById('btnConfirmCancel'),
  btnConfirmProceed: document.getElementById('btnConfirmProceed'),
  confirmCountText: document.getElementById('confirmCountText'),
  confirmTargetList: document.getElementById('confirmTargetList'),
  cascadeCheckbox: document.getElementById('cascadeCheckbox'),
  cascadeResultsBox: document.getElementById('cascadeResultsBox'),
  cascadeTargetList: document.getElementById('cascadeTargetList'),
  systemWarningAlert: document.getElementById('systemWarningAlert'),
  systemWarningAlertText: document.getElementById('systemWarningAlertText'),

  terminalModal: document.getElementById('terminalModal'),
  terminalModalTitle: document.getElementById('terminalModalTitle'),
  terminalOutput: document.getElementById('terminalOutput'),
  btnTerminalClose: document.getElementById('btnTerminalClose')
};

// --- Utilities ---

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  if (!bytes) return 'Unknown';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(timestamp) {
  if (!timestamp || timestamp === 0) return '—';
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Data Fetching ---

async function loadStats() {
  try {
    const response = await fetch('/api/stats');
    if (!response.ok) throw new Error("Stats request failed");
    state.stats = await response.json();
    renderStats();
  } catch (error) {
    console.error("Error loading stats:", error);
  }
}

async function loadPackages(forceRefresh = false, quiet = false) {
  if (!quiet) {
    dom.loadingState.classList.remove('hidden');
    dom.emptyState.classList.add('hidden');
    state.selectedPackages.clear();
    dom.selectAllCheckbox.checked = false;
    updateBatchActionBar();
  }

  try {
    const refreshQuery = forceRefresh ? "?refresh=true" : "";
    const response = await fetch(`/api/packages${refreshQuery}`);
    if (!response.ok) throw new Error("Packages fetch failed.");
    state.packages = await response.json();

    const unusedCount = state.packages.filter(p => !p.required_by.length && !p.is_core && !p.is_kept).length;
    dom.badgeCountUnused.textContent = unusedCount;

    renderTable();
    await loadStats();
  } catch (error) {
    console.error("Error loading packages:", error);
    if (!quiet) {
      alert("Could not load packages from environment.");
    }
  } finally {
    if (!quiet) {
      dom.loadingState.classList.add('hidden');
    }
  }
}

// --- Render Functions ---

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
  dom.valDiskFree.textContent = `${formatSize(disk.free_bytes || disk.free)} free of ${formatSize(disk.total_bytes || disk.total)}`;

  const orphansCount = state.stats.orphan_packages_count || 0;
  if (orphansCount > 0) {
    dom.cleanRecommendationText.textContent = `${orphansCount} unused packages cleanable (${formatSize(state.stats.orphan_size_bytes)}).`;
    dom.btnQuickClean.style.display = 'inline-flex';
  } else {
    dom.cleanRecommendationText.textContent = "All clean. No unused packages detected.";
    dom.btnQuickClean.style.display = 'none';
  }
}

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

function renderTable() {
  const listBody = dom.packageTableBody;
  listBody.innerHTML = '';

  const filtered = getFilteredPackages();

  if (filtered.length === 0) {
    dom.packageTable.classList.add('hidden');
    dom.emptyState.classList.remove('hidden');
    return;
  }

  dom.packageTable.classList.remove('hidden');
  dom.emptyState.classList.add('hidden');

  filtered.forEach(pkg => {
    const tr = document.createElement('tr');
    const isChecked = state.selectedPackages.has(pkg.norm_name);
    if (isChecked) tr.classList.add('selected');

    tr.addEventListener('click', (e) => {
      if (e.target.closest('input[type="checkbox"]') || e.target.closest('.btn-action-delete')) {
        return;
      }
      openPackageDetails(pkg);
    });

    let badgesHtml = '';
    if (pkg.is_core) {
      badgesHtml += `<span class="badge badge-core">core</span>`;
    } else if (pkg.is_kept) {
      badgesHtml += `<span class="badge badge-kept">kept</span>`;
    } else if (!pkg.required_by.length) {
      badgesHtml += `<span class="badge badge-orphan">orphan</span>`;
    }

    const depCount = pkg.required_by.length;
    const depHtml = depCount === 0
      ? '<span style="color: var(--text-muted);">none</span>'
      : `<span style="font-family: var(--font-mono); color: var(--text-primary);">${depCount}</span>`;

    const safeName = escapeHtml(pkg.name);
    const safeVersion = escapeHtml(pkg.version);
    const safeSummary = escapeHtml(pkg.summary || '');

    tr.innerHTML = `
      <td class="col-checkbox">
        <input type="checkbox" class="row-checkbox" value="${pkg.norm_name}" ${isChecked ? 'checked' : ''}>
      </td>
      <td class="col-name">
        <div class="pkg-name-container">
          <span class="pkg-name-text">${safeName}</span>
          ${badgesHtml}
        </div>
      </td>
      <td class="col-version">${safeVersion}</td>
      <td class="col-size">${formatSize(pkg.size_bytes)}</td>
      <td class="col-installed">${formatDate(pkg.installed_at)}</td>
      <td class="col-usage">${depHtml}</td>
      <td class="col-summary" title="${safeSummary}">${safeSummary || '<span style="color: var(--text-muted);">—</span>'}</td>
      <td class="col-actions" style="text-align: right;">
        <button type="button" class="btn btn-secondary btn-sm btn-action-delete" title="Uninstall package" ${pkg.is_core ? 'disabled style="opacity: 0.3;"' : ''}>
          Remove
        </button>
      </td>
    `;

    const chk = tr.querySelector('.row-checkbox');
    chk.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.selectedPackages.add(pkg.norm_name);
        tr.classList.add('selected');
      } else {
        state.selectedPackages.delete(pkg.norm_name);
        tr.classList.remove('selected');
        dom.selectAllCheckbox.checked = false;
      }
      updateBatchActionBar();
    });

    const btnDel = tr.querySelector('.btn-action-delete');
    btnDel.addEventListener('click', (e) => {
      e.stopPropagation();
      openUninstallConfirm([pkg.norm_name]);
    });

    listBody.appendChild(tr);
  });
}

function updateBatchActionBar() {
  const count = state.selectedPackages.size;
  if (count > 0) {
    dom.batchCountBadge.textContent = count;
    dom.batchCountText.textContent = `${count} package${count === 1 ? '' : 's'} selected`;

    let totalBytes = 0;
    state.selectedPackages.forEach(normName => {
      const p = state.packages.find(pkg => pkg.norm_name === normName);
      if (p) totalBytes += p.size_bytes;
    });

    dom.batchSizeText.textContent = formatSize(totalBytes);
    dom.batchActionBar.classList.remove('hidden');
  } else {
    dom.batchActionBar.classList.add('hidden');
  }
}

// --- Drawer & Details ---

function renderTags(container, items, emptyLabel) {
  container.innerHTML = '';
  if (!items || !items.length) {
    container.innerHTML = `<span style="color: var(--text-muted); font-size: 11px;">${emptyLabel}</span>`;
    return;
  }
  items.forEach(name => {
    const tag = document.createElement('span');
    tag.className = 'tag-item';
    tag.textContent = name;
    tag.addEventListener('click', () => {
      const target = state.packages.find(p => p.norm_name === name);
      if (target) openPackageDetails(target);
    });
    container.appendChild(tag);
  });
}

function openPackageDetails(pkg) {
  state.activePackage = pkg;

  dom.detailName.textContent = pkg.name;
  dom.detailVersion.textContent = pkg.version;
  dom.detailSummary.textContent = pkg.summary || "No description provided.";
  dom.detailLicense.textContent = pkg.license || "Unknown";
  dom.detailAuthor.textContent = pkg.author || "Unknown";
  dom.detailSize.textContent = formatSize(pkg.size_bytes);
  dom.detailFilesCount.textContent = pkg.files_count || 0;
  dom.detailLocation.textContent = pkg.location || "—";

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
        await loadPackages(false, true);
        const updated = state.packages.find(p => p.norm_name === pkg.norm_name);
        if (updated) openPackageDetails(updated);
      }
    } catch (err) {
      console.error('Keep toggle failed:', err);
    }
  };

  dom.detailRequiredByCount.textContent = pkg.required_by.length;
  renderTags(dom.detailRequiredByList, pkg.required_by, 'No dependents (orphan)');

  dom.detailDependenciesCount.textContent = pkg.dependencies.length;
  renderTags(dom.detailDependenciesList, pkg.dependencies, 'None');

  dom.detailLinksList.innerHTML = '';
  if (pkg.urls && pkg.urls.length > 0) {
    dom.detailLinksSection.classList.remove('hidden');
    pkg.urls.forEach(urlObj => {
      const a = document.createElement('a');
      a.className = 'btn btn-secondary btn-sm';
      a.href = urlObj.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = urlObj.label || 'Project URL';
      dom.detailLinksList.appendChild(a);
    });
  } else {
    dom.detailLinksSection.classList.add('hidden');
  }

  dom.btnDetailUninstall.disabled = pkg.is_core;
  dom.detailModal.classList.remove('hidden');
}

function closePackageDetails() {
  dom.detailModal.classList.add('hidden');
  state.activePackage = null;
}

// --- Uninstall Confirmation & Dry Run ---

let activeUninstallTargets = [];
let activeCascadeTargets = [];

async function openUninstallConfirm(packageNormNames) {
  activeUninstallTargets = packageNormNames;
  dom.confirmCountText.textContent = `${packageNormNames.length} package${packageNormNames.length === 1 ? '' : 's'}`;

  dom.confirmTargetList.innerHTML = '';
  let containsCore = false;

  packageNormNames.forEach(norm => {
    const pkg = state.packages.find(p => p.norm_name === norm);
    const div = document.createElement('div');
    if (pkg) {
      if (pkg.is_core) containsCore = true;
      div.textContent = `• ${pkg.name} (${pkg.version})`;
    } else {
      div.textContent = `• ${norm}`;
    }
    dom.confirmTargetList.appendChild(div);
  });

  if (containsCore) {
    dom.systemWarningAlert.classList.remove('hidden');
    dom.systemWarningAlertText.textContent = "Caution: One or more selected packages are core environment dependencies. Removing them may break pip!";
  } else {
    dom.systemWarningAlert.classList.add('hidden');
  }

  dom.cascadeCheckbox.checked = true;
  await fetchCascadeDryRun();

  dom.confirmModal.classList.remove('hidden');
}

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
      dom.cascadeTargetList.innerHTML = activeCascadeTargets.map(c => `• ${c.name} (${formatSize(c.size_bytes)})`).join('<br>');
      dom.cascadeResultsBox.classList.remove('hidden');
    } else {
      dom.cascadeResultsBox.classList.add('hidden');
    }
  } catch (e) {
    dom.cascadeResultsBox.classList.add('hidden');
  }
}

function closeUninstallConfirm() {
  dom.confirmModal.classList.add('hidden');
  activeUninstallTargets = [];
  activeCascadeTargets = [];
}

// --- Terminal Operations ---

async function runPipTransaction(endpoint, payload, title) {
  dom.terminalModalTitle.textContent = title;
  dom.terminalOutput.textContent = `Executing: ${title}...\n`;
  dom.btnTerminalClose.disabled = true;
  dom.terminalModal.classList.remove('hidden');

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    dom.terminalOutput.textContent = result.output || (result.success ? "Command succeeded with no output." : "Command failed.");
  } catch (err) {
    dom.terminalOutput.textContent = `Network / broker error: ${err.message}`;
  } finally {
    dom.btnTerminalClose.disabled = false;
    await loadPackages(false);
  }
}

async function executeUninstall() {
  const targets = [...activeUninstallTargets];
  if (dom.cascadeCheckbox.checked) {
    activeCascadeTargets.forEach(c => {
      if (!targets.includes(c.norm_name)) targets.push(c.norm_name);
    });
  }

  closeUninstallConfirm();
  closePackageDetails();

  await runPipTransaction('/api/uninstall', { packages: targets }, `pip uninstall -y ${targets.join(' ')}`);
}

async function executeUpgrade(targets) {
  closePackageDetails();
  await runPipTransaction('/api/upgrade', { packages: targets }, `pip install --upgrade ${targets.join(' ')}`);
}

async function handleInstallSubmit(e) {
  e.preventDefault();
  const spec = dom.installInput.value.trim();
  if (!spec) return;

  dom.installInput.value = '';
  await runPipTransaction('/api/install', { package: spec }, `pip install ${spec}`);
}

// --- Export Requirements ---

function exportRequirements() {
  const targets = state.selectedPackages.size > 0
    ? state.packages.filter(p => state.selectedPackages.has(p.norm_name))
    : getFilteredPackages();

  if (!targets.length) {
    alert("No packages to export.");
    return;
  }

  const content = targets.map(p => `${p.name}==${p.version}`).join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.selectedPackages.size > 0 ? 'selected-requirements.txt' : 'requirements.txt';
  a.click();
  URL.revokeObjectURL(url);
}

// --- Event Binding ---

function bindEvents() {
  dom.btnRefresh.addEventListener('click', () => loadPackages(true));
  dom.btnExport.addEventListener('click', exportRequirements);
  dom.installForm.addEventListener('submit', handleInstallSubmit);

  dom.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderTable();
  });

  dom.sortBySelect.addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    renderTable();
  });

  dom.filterStatusGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment-btn');
    if (!btn) return;
    dom.filterStatusGroup.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.activeFilter = btn.dataset.filter;
    renderTable();
  });

  dom.btnResetFilters.addEventListener('click', () => {
    dom.searchInput.value = '';
    state.searchQuery = '';
    state.activeFilter = 'all';
    dom.filterStatusGroup.querySelectorAll('.segment-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    state.sortBy = 'size_desc';
    dom.sortBySelect.value = 'size_desc';
    renderTable();
  });

  dom.selectAllCheckbox.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    const filtered = getFilteredPackages();
    filtered.forEach(p => {
      if (isChecked) {
        state.selectedPackages.add(p.norm_name);
      } else {
        state.selectedPackages.delete(p.norm_name);
      }
    });
    renderTable();
    updateBatchActionBar();
  });

  dom.btnBatchCancel.addEventListener('click', () => {
    state.selectedPackages.clear();
    dom.selectAllCheckbox.checked = false;
    renderTable();
    updateBatchActionBar();
  });

  dom.btnBatchUninstall.addEventListener('click', () => {
    if (state.selectedPackages.size === 0) return;
    openUninstallConfirm([...state.selectedPackages]);
  });

  dom.cardOrphans.addEventListener('click', () => {
    dom.filterStatusGroup.querySelectorAll('.segment-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === 'unused'));
    state.activeFilter = 'unused';
    renderTable();
  });

  dom.btnQuickClean.addEventListener('click', (e) => {
    e.stopPropagation();
    const orphans = state.packages.filter(p => !p.required_by.length && !p.is_core && !p.is_kept).map(p => p.norm_name);
    if (orphans.length) openUninstallConfirm(orphans);
  });

  dom.btnDetailClose.addEventListener('click', closePackageDetails);
  dom.btnDetailUpgrade.addEventListener('click', () => {
    if (state.activePackage) executeUpgrade([state.activePackage.norm_name]);
  });
  dom.btnDetailUninstall.addEventListener('click', () => {
    if (state.activePackage) openUninstallConfirm([state.activePackage.norm_name]);
  });

  dom.btnConfirmCancel.addEventListener('click', closeUninstallConfirm);
  dom.btnConfirmProceed.addEventListener('click', executeUninstall);
  dom.cascadeCheckbox.addEventListener('change', fetchCascadeDryRun);

  dom.btnTerminalClose.addEventListener('click', () => {
    dom.terminalModal.classList.add('hidden');
  });

  // Table header sorting
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const sortKey = th.dataset.sort;
      if (sortKey === 'name') {
        state.sortBy = state.sortBy === 'name_asc' ? 'name_desc' : 'name_asc';
      } else if (sortKey === 'size') {
        state.sortBy = state.sortBy === 'size_desc' ? 'size_asc' : 'size_desc';
      } else if (sortKey === 'installed') {
        state.sortBy = state.sortBy === 'installed_desc' ? 'installed_asc' : 'installed_desc';
      } else if (sortKey === 'deps') {
        state.sortBy = state.sortBy === 'deps_desc' ? 'name_asc' : 'deps_desc';
      }
      dom.sortBySelect.value = state.sortBy;
      renderTable();
    });
  });
}

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadPackages();
});
