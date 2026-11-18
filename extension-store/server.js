const express = require('express');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3333;

const MODULES_REPO_URL = 'https://forgejo.tail233080.ts.net/Nico_and_Luna_Swiss_GmbH/Modules.git';
const CHECK_INTERVAL_SECONDS = 60;
const CHECK_INTERVAL_MS = CHECK_INTERVAL_SECONDS * 1000;
const MODULES_REPO_BRANCH = 'main';
const CACHE_DIR = '/tmp/ExtensionStoreCache';
const MODULE_CACHE_TTL = CHECK_INTERVAL_MS;

app.use(compression({
  filter: (req, res) => {
    // Don't compress binary module downloads - they are already ZIP archives
    if (req.path.endsWith('/download')) {
      return false;
    }
    return compression.filter(req, res);
  }
}));
app.use(express.json());

let moduleList = null;
let moduleListCacheTime = 0;
let lastGitHash = null;

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getRepoPath() {
  return path.join(CACHE_DIR, 'modules-repo');
}

function downloadAllModules() {
  ensureCacheDir();
  const repoPath = getRepoPath();

  if (fs.existsSync(path.join(repoPath, '.git'))) {
    try {
      execSync(`git -C ${repoPath} fetch --depth 1 origin ${MODULES_REPO_BRANCH}`, { stdio: 'pipe' });
      execSync(`git -C ${repoPath} reset --hard origin/${MODULES_REPO_BRANCH}`, { stdio: 'pipe' });
      console.log('Modules repo updated via fetch+reset');
    } catch (error) {
      console.error('Failed to update modules repo, re-cloning:', error.message);
      fs.rmSync(repoPath, { recursive: true, force: true });
      execSync(`git clone --depth 1 --branch ${MODULES_REPO_BRANCH} ${MODULES_REPO_URL} ${repoPath}`, { stdio: 'pipe' });
      console.log('Modules repo re-cloned');
    }
  } else {
    execSync(`git clone --depth 1 --branch ${MODULES_REPO_BRANCH} ${MODULES_REPO_URL} ${repoPath}`, { stdio: 'pipe' });
    console.log('Modules repo cloned at startup - ALL modules downloaded');
  }

  const currentHash = execSync(`git -C ${repoPath} rev-parse HEAD`, { encoding: 'utf8' }).trim();
  const isNew = lastGitHash !== null && lastGitHash !== currentHash;
  lastGitHash = currentHash;

  return { repoPath, currentHash, isNew };
}

function scanModules(repoPath) {
  const modulesDir = path.join(repoPath, 'modules');

  if (!fs.existsSync(modulesDir)) {
    console.error('modules/ directory not found in repo');
    return [];
  }

  const entries = fs.readdirSync(modulesDir, { withFileTypes: true });
  const modules = [];

  for (const entry of entries) {
    const fullPath = path.join(modulesDir, entry.name);

    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const moduleJsonPath = path.join(fullPath, 'module.json');
      const mod = {
        id: entry.name,
        name: entry.name,
        version: '1.0.0',
        description: 'Module from Modules repo',
        files: []
      };

      if (fs.existsSync(moduleJsonPath)) {
        try {
          const moduleJson = JSON.parse(fs.readFileSync(moduleJsonPath, 'utf8'));
          mod.name = moduleJson.name || entry.name;
          mod.version = moduleJson.version || '1.0.0';
          if (moduleJson.description) {
            mod.description = moduleJson.description;
          }
        } catch (parseError) {
          console.error(`Failed to parse module.json for ${entry.name}:`, parseError.message);
        }
      }

      mod.files = fs.readdirSync(fullPath).filter(f => !f.startsWith('.'));
      modules.push(mod);
    }
  }

  return modules;
}

function getModuleList() {
  const now = Date.now();

  if (moduleList && (now - moduleListCacheTime) < MODULE_CACHE_TTL) {
    return moduleList;
  }

  try {
    const { repoPath, currentHash, isNew } = downloadAllModules();
    const modules = scanModules(repoPath);

    moduleList = modules;
    moduleListCacheTime = now;

    if (isNew) {
      console.log(`Modules repo changed (${currentHash}). New/updated modules: ${modules.length} total.`);
    } else {
      console.log(`Modules loaded from cache/startup: ${modules.length} total.`);
    }

    return modules;
  } catch (error) {
    console.error('Failed to get module list:', error.message);
    return moduleList || [];
  }
}

function checkForChanges() {
  try {
    const repoPath = getRepoPath();
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      return { isNew: true, newModules: [], removedModules: [] };
    }

    const currentHash = execSync(`git -C ${repoPath} rev-parse HEAD`, { encoding: 'utf8' }).trim();
    const isNew = lastGitHash !== null && lastGitHash !== currentHash;

    let newModules = [];
    let removedModules = [];

    if (isNew) {
      const { repoPath: freshPath } = downloadAllModules();
      const currentModules = scanModules(freshPath).map(m => m.id);
      const previousModules = moduleList ? moduleList.map(m => m.id) : [];

      newModules = currentModules.filter(id => !previousModules.includes(id));
      removedModules = previousModules.filter(id => !currentModules.includes(id));

      console.log(`Module changes detected: +${newModules.length} new, -${removedModules.length} removed`);
      if (newModules.length) console.log('New modules:', newModules.join(', '));
      if (removedModules.length) console.log('Removed modules:', removedModules.join(', '));
    }

    lastGitHash = currentHash;
    return { isNew, newModules, removedModules };
  } catch (error) {
    console.error('Failed to check for changes:', error.message);
    return { isNew: false, newModules: [], removedModules: [] };
  }
}

app.get('/modules', async (req, res) => {
  try {
    const modules = await getModuleList();
    res.json({
      success: true,
      count: modules.length,
      modules
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/modules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const modules = await getModuleList();
    const module = modules.find(m => m.id === id || m.id === id.replace(/-/g, '_'));

    if (!module) {
      return res.status(404).json({ success: false, error: `Module ${id} not found` });
    }

    res.json({
      success: true,
      module
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/modules/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const modules = await getModuleList();
    const module = modules.find(m => m.id === id || m.id === id.replace(/-/g, '_'));

    if (!module) {
      return res.status(404).json({ success: false, error: `Module ${id} not found` });
    }

    const repoPath = getRepoPath();
    const modulePath = path.join(repoPath, 'modules', id);

    if (!fs.existsSync(modulePath)) {
      const altId = id.replace(/-/g, '_');
      const altPath = path.join(repoPath, 'modules', altId);
      if (fs.existsSync(altPath)) {
        module.id = altId;
      } else {
        return res.status(404).json({ success: false, error: `Module directory not found` });
      }
    }

    const zipPath = path.join(CACHE_DIR, `${id}.zip`);
    execSync(`cd "${repoPath}/modules" && zip -r "${zipPath}" "${id}"`, { stdio: 'pipe' });

    res.setHeader('Content-Type', 'application/zip');
    res.download(zipPath, `${id}.zip`, (err) => {
      if (err) {
        console.error('Download error:', err.message);
        res.status(500).json({ success: false, error: err.message });
      }
      setTimeout(() => {
        try { fs.unlinkSync(zipPath); } catch (e) {}
      }, 60000);
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/modules/check', async (req, res) => {
  try {
    const { isNew, newModules, removedModules } = checkForChanges();
    const modules = await getModuleList();

    res.json({
      success: true,
      count: modules.length,
      newModules: newModules.length,
      removedModules: removedModules.length,
      newModuleIds: newModules,
      removedModuleIds: removedModules,
      timestamp: new Date().toISOString(),
      repoChanged: isNew,
      note: 'Module list refreshed from repository every minute'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    port: PORT
  });
});

setInterval(async () => {
  try {
    moduleListCacheTime = 0;
    const { isNew, newModules } = checkForChanges();
    await getModuleList();
    if (isNew && newModules.length > 0) {
      console.log(`Periodic check: ${newModules.length} new module(s) downloaded`);
    } else {
      console.log('Periodic module check completed - no changes');
    }
  } catch (error) {
    console.error('Periodic module check failed:', error.message);
  }
}, CHECK_INTERVAL_MS);

try {
    const modules = getModuleList();
    console.log(`Initial modules loaded: ${modules.length}`);
  } catch (err) {
    console.error('Failed to load initial modules:', err.message);
  }

app.listen(PORT, () => {
  console.log(`Extension Store server running on port ${PORT}`);
});